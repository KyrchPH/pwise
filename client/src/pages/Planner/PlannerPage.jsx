import { useEffect, useMemo, useRef, useState } from 'react';
import * as planner from '../../services/planner.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { Button, Spinner, FilterIcon } from '../../components/ui.jsx';
import LottiePlayer from '../../components/LottiePlayer.jsx';
import calendarAnimation from '../../assets/lotties/calendar.json';
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  // Progress is recomputed server-side on every load, so stamp "last updated" when
  // fresh data arrives (mirrors the reference plan's refresh timestamp).
  useEffect(() => {
    if (!data) return;
    setLastUpdated(
      new Date().toLocaleString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
  }, [data]);

  // Close the filter popover on outside-click / Esc.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const onDown = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFiltersOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

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

  const filtersActive = statusFilter !== 'all' || periodFilter !== 'all';

  // Plan hero: progress toward completing every goal (matches the "X of Y tasks
  // completed" bar in the reference), plus a motivational headline.
  const total = summary.total;
  const completed = summary.counts.completed;
  const ongoing = summary.counts.ongoing;
  const completedPct = total ? Math.round((completed / total) * 100) : 0;
  const headline =
    total === 0
      ? 'Create your first goal to start tracking progress.'
      : ongoing > 0
        ? `Keep going — ${ongoing} goal${ongoing === 1 ? '' : 's'} still in progress.`
        : completed === total
          ? 'Every goal completed — great work! 🎉'
          : 'No active goals right now.';

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
      closeModal();
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
        {/* Filter toggle — above the overall progress section, top-right.
            Pressing it opens a dropdown listing the Status + Cadence options. */}
        <div className="planner-panel__toolbar">
          <div className="planner-filter-menu" ref={filterRef}>
            <button
              type="button"
              className={`planner-filter-toggle${filtersOpen ? ' is-open' : ''}${filtersActive ? ' is-active' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={filtersOpen}
              aria-label="Toggle filters"
              title="Filters"
            >
              <FilterIcon />
            </button>
            {filtersOpen && (
              <div className="dropdown__menu planner-filter-menu__panel" role="menu">
                <div className="dropdown__group">
                  <div className="dropdown__caption">Status</div>
                  {STATUS_FILTERS.map((f) => {
                    const selected = statusFilter === f.value;
                    return (
                      <button
                        key={f.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`dropdown__opt${selected ? ' is-selected' : ''}`}
                        onClick={() => setStatusFilter(f.value)}
                      >
                        <span>{f.label}</span>
                        {selected && <span className="dropdown__check" aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="dropdown__sep" aria-hidden="true" />
                <div className="dropdown__group">
                  <div className="dropdown__caption">Cadence</div>
                  {PERIOD_FILTERS.map((f) => {
                    const selected = periodFilter === f.value;
                    return (
                      <button
                        key={f.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`dropdown__opt${selected ? ' is-selected' : ''}`}
                        onClick={() => setPeriodFilter(f.value)}
                      >
                        <span>{f.label}</span>
                        {selected && <span className="dropdown__check" aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Plan hero — overall progress toward completing every goal. */}
        <div className="plan-hero">
          <div className="plan-hero__main">
            <div className="plan-hero__title">Your goals</div>
            <p className="plan-hero__sub">Track progress toward every target you’ve set for your pages.</p>
            <div className="plan-hero__headline">{headline}</div>
            <div
              className="plan-bar"
              role="progressbar"
              aria-valuenow={completedPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="plan-bar__fill" style={{ width: `${completedPct}%` }} />
              {total > 0 && <span className="plan-bar__marker" aria-hidden="true" />}
            </div>
            <div className="plan-hero__foot">
              <div className="plan-hero__footline">
                <span className="plan-hero__count">
                  {total === 0 ? 'No goals yet' : `${completed} of ${total} goals completed`}
                </span>
                {total > 0 && <span className="plan-bar__flag">Goal</span>}
              </div>
              {lastUpdated && <span className="plan-hero__updated">Last updated {lastUpdated}</span>}
            </div>
          </div>
          <div className="plan-hero__art" aria-hidden="true">
            <LottiePlayer animationData={calendarAnimation} className="plan-hero__lottie" />
          </div>
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
              <GoalCard key={g.id} goal={g} page={pageById[g.account_id]} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      <GoalFormModal
        open={modalOpen}
        onClose={closeModal}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        pages={pages}
        defaultAccountId={activeId ?? pages[0]?.id}
        goal={editing}
        saving={saving}
      />
    </>
  );
}
