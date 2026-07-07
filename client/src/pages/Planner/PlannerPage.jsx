import { useEffect, useMemo, useState } from 'react';
import * as planner from '../../services/planner.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { Button, Spinner } from '../../components/ui.jsx';
import GoalCard from './GoalCard.jsx';
import GoalFormModal from './GoalFormModal.jsx';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
];

const PERIOD_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const EMPTY_SUMMARY = { overall_percent: 0, total: 0, counts: { ongoing: 0, completed: 0, expired: 0 } };

export default function PlannerPage() {
  const toast = useToast();
  const { pages, activeId } = usePages();
  const { data, loading, error, refresh } = useCachedResource('planner-goals', planner.list);

  const [statusFilter, setStatusFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const goals = data?.goals || [];
  const summary = data?.summary || EMPTY_SUMMARY;
  const hasPages = pages.length > 0;

  const pageById = useMemo(() => {
    const map = {};
    for (const p of pages) map[p.id] = p;
    return map;
  }, [pages]);

  const filtered = goals.filter(
    (g) =>
      (statusFilter === 'all' || g.status === statusFilter) &&
      (periodFilter === 'all' || g.period === periodFilter),
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (goal) => {
    setEditing(goal);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      if (editing) {
        await planner.update(editing.id, payload);
        toast.success('Goal updated.');
      } else {
        await planner.create(payload);
        toast.success('Goal created.');
      }
      closeModal();
      invalidateCache('planner-goals');
      await refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (goal) => {
    if (!window.confirm(`Delete “${goal.title}”?`)) return;
    try {
      await planner.remove(goal.id);
      toast.success('Goal deleted.');
      invalidateCache('planner-goals');
      await refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  if (loading && !data) return <Spinner label="Loading planner…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Planner</h1>
          <div className="page-head__sub">Set measurable goals for your pages and track progress toward each target.</div>
        </div>
        <Button onClick={openCreate} disabled={!hasPages}>+ New goal</Button>
      </div>

      <div className="card card--pad planner-panel">
        {/* Overall progress across every goal */}
        <div className="planner-banner__head">
          <div>
            <div className="planner-banner__label">Overall progress</div>
            <div className="planner-banner__counts">
              {summary.counts.ongoing} ongoing · {summary.counts.completed} completed · {summary.counts.expired} expired
            </div>
          </div>
          <div className="planner-banner__pct">{summary.overall_percent}%</div>
        </div>
        <div className="planner-progress">
          <div className="planner-progress__fill" style={{ width: `${Math.min(summary.overall_percent, 100)}%` }} />
        </div>

        {/* Filters */}
        <div className="planner-filters">
          <label className="planner-filter">
            <span className="planner-filter__label">Status</span>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="planner-filter">
            <span className="planner-filter__label">Cadence</span>
            <select className="select" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
              {PERIOD_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Goals */}
        {!hasPages ? (
          <div className="planner-empty">
            Connect a Facebook page first — every goal tracks progress for a specific page.
          </div>
        ) : filtered.length === 0 ? (
          <div className="planner-empty">
            {goals.length === 0
              ? 'No goals yet. Create your first goal to start tracking.'
              : 'No goals match these filters.'}
          </div>
        ) : (
          <div className="planner-list">
            {filtered.map((g) => (
              <GoalCard key={g.id} goal={g} page={pageById[g.account_id]} onEdit={openEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      <GoalFormModal
        open={modalOpen}
        onClose={closeModal}
        onSubmit={handleSubmit}
        pages={pages}
        defaultAccountId={activeId ?? pages[0]?.id}
        goal={editing}
        saving={saving}
      />
    </>
  );
}
