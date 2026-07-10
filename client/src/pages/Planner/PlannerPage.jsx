import { useEffect, useMemo, useRef, useState } from 'react';
import * as planner from '../../services/planner.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button, Spinner, FilterIcon } from '../../components/ui.jsx';
import GoalCard from './GoalCard.jsx';
import GoalFormModal from './GoalFormModal.jsx';
import PlanFormModal from './PlanFormModal.jsx';

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

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function MemberAvatars({ members = [] }) {
  const shown = members.slice(0, 4);
  const extra = members.length - shown.length;
  return (
    <span className="plan-avatars" aria-label={`${members.length} member${members.length === 1 ? '' : 's'}`}>
      {shown.map((m) => (
        <span key={m.id} className="agentchat-avatar plan-avatars__item" title={`${m.name} · ${ROLE_LABEL[m.role] || m.role}`}>
          {initialsOf(m.name)}
        </span>
      ))}
      {extra > 0 && <span className="agentchat-avatar plan-avatars__item plan-avatars__more">+{extra}</span>}
    </span>
  );
}

// A single plan with its nested goals and role-gated actions.
function PlanSection({ plan, pageById, hasPages, statusFilter, periodFilter, onNewGoal, onEditGoal, onEditPlan }) {
  const canManage = plan.role === 'owner';
  const canEditGoals = plan.role === 'owner' || plan.role === 'editor';
  const { total, counts } = plan.summary;
  const completed = counts.completed;
  const completedPct = total ? Math.round((completed / total) * 100) : 0;

  const goals = plan.goals.filter(
    (g) =>
      (statusFilter === 'all' || g.status === statusFilter) &&
      (periodFilter === 'all' || g.period === periodFilter),
  );

  return (
    <section className="plan-card">
      <header className="plan-card__head">
        <div className="plan-card__ident">
          <div className="plan-card__titlerow">
            <h2 className="plan-card__name">{plan.name}</h2>
            <span className={`plan-role-tag plan-role-tag--${plan.role}`}>{ROLE_LABEL[plan.role] || plan.role}</span>
          </div>
          {plan.description && <p className="plan-card__desc">{plan.description}</p>}
        </div>
        <div className="plan-card__aside">
          <MemberAvatars members={plan.members} />
          {canManage && (
            <div className="plan-card__actions">
              <Button variant="ghost" size="sm" onClick={() => onEditPlan(plan)}>Share</Button>
              <Button size="sm" className="btn--flat" disabled={!hasPages} onClick={() => onNewGoal(plan)}>+ Goal</Button>
            </div>
          )}
        </div>
      </header>

      <div className="plan-card__progress">
        <div
          className="plan-bar"
          role="progressbar"
          aria-valuenow={completedPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="plan-bar__fill" style={{ width: `${completedPct}%` }} />
        </div>
        <span className="plan-card__count">
          {total === 0 ? 'No goals yet' : `${completed} of ${total} goals completed`}
        </span>
      </div>

      {plan.goals.length === 0 ? (
        <div className="planner-empty planner-empty--sm">
          {canManage
            ? hasPages
              ? 'No goals yet. Add your first goal to this plan.'
              : 'Connect a Facebook page first — every goal tracks progress for a page.'
            : 'No goals in this plan yet.'}
        </div>
      ) : goals.length === 0 ? (
        <div className="planner-empty planner-empty--sm">No goals match these filters.</div>
      ) : (
        <div className="planner-list">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              page={pageById[g.account_id]}
              canEdit={canEditGoals}
              onEdit={(goal) => onEditGoal(plan, goal)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function PlannerPage() {
  const toast = useToast();
  const { user } = useAuth();
  const { pages, activeId } = usePages();
  const { data, loading, error, refresh } = useCachedResource('planner-plans', planner.listPlans);

  const [connections, setConnections] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef(null);

  // Plan modal (create / edit + share).
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [memberBusy, setMemberBusy] = useState(null);

  // Goal modal (scoped to a plan).
  const [goalModal, setGoalModal] = useState({ open: false, planId: null, goal: null });
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  // Load the share picker's candidate list once.
  useEffect(() => {
    planner.listConnections().then(setConnections).catch(() => {});
  }, []);

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

  const plans = data?.plans || [];
  const hasPages = pages.length > 0;
  const filtersActive = statusFilter !== 'all' || periodFilter !== 'all';

  const pageById = useMemo(() => {
    const map = {};
    for (const p of pages) map[p.id] = p;
    return map;
  }, [pages]);

  const editingPlan = editingPlanId ? plans.find((p) => p.id === editingPlanId) || null : null;
  const goalPlan = goalModal.planId ? plans.find((p) => p.id === goalModal.planId) || null : null;
  const goalCanDelete = goalPlan?.role === 'owner';

  // ── Plan actions ──────────────────────────────────────────────────────────
  const openCreatePlan = () => {
    setEditingPlanId(null);
    setPlanModalOpen(true);
  };
  const openEditPlan = (plan) => {
    setEditingPlanId(plan.id);
    setPlanModalOpen(true);
  };
  const closePlanModal = () => {
    setPlanModalOpen(false);
    setEditingPlanId(null);
  };

  const reload = async () => {
    invalidateCache('planner-plans');
    await refresh();
  };

  const handlePlanSubmit = async (payload) => {
    setSavingPlan(true);
    try {
      if (editingPlanId) {
        await planner.updatePlan(editingPlanId, payload);
        toast.success('Plan updated.');
      } else {
        await planner.createPlan(payload);
        toast.success('Plan created.');
      }
      closePlanModal();
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingPlan(false);
    }
  };

  const handlePlanDelete = async (plan) => {
    if (!window.confirm(`Delete plan “${plan.name}” and all of its goals?`)) return;
    try {
      await planner.deletePlan(plan.id);
      toast.success('Plan deleted.');
      closePlanModal();
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  // Live member management (edit mode). Refreshes so the modal shows fresh members.
  const runMember = async (fn, userId) => {
    setMemberBusy(userId);
    try {
      await fn();
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setMemberBusy(null);
    }
  };
  const handleAddMember = (userId, role) => runMember(() => planner.addMember(editingPlanId, { user_id: userId, role }), userId);
  const handleSetRole = (userId, role) => runMember(() => planner.setMemberRole(editingPlanId, userId, role), userId);
  const handleRemoveMember = (userId) => runMember(() => planner.removeMember(editingPlanId, userId), userId);

  // ── Goal actions ──────────────────────────────────────────────────────────
  const openCreateGoal = (plan) => setGoalModal({ open: true, planId: plan.id, goal: null });
  const openEditGoal = (plan, goal) => setGoalModal({ open: true, planId: plan.id, goal });
  const closeGoalModal = () => setGoalModal({ open: false, planId: null, goal: null });

  const handleGoalSubmit = async (payload) => {
    setSavingGoal(true);
    try {
      if (goalModal.goal) {
        await planner.updateGoal(goalModal.goal.id, payload);
        toast.success('Goal updated.');
      } else {
        await planner.createGoal(goalModal.planId, payload);
        toast.success('Goal created.');
      }
      closeGoalModal();
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingGoal(false);
    }
  };

  const handleGoalDelete = async (goal) => {
    if (!window.confirm(`Delete “${goal.title}”?`)) return;
    try {
      await planner.removeGoal(goal.id);
      toast.success('Goal deleted.');
      closeGoalModal();
      await reload();
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
          <div className="page-head__sub">Group goals into plans and share each plan with your connections.</div>
        </div>
        <Button onClick={openCreatePlan}>+ New plan</Button>
      </div>

      <div className="card card--pad planner-panel">
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

        {plans.length === 0 ? (
          <div className="planner-empty">
            No plans yet. Create your first plan to start setting goals and sharing them with your connections.
          </div>
        ) : (
          <div className="plan-list">
            {plans.map((plan) => (
              <PlanSection
                key={plan.id}
                plan={plan}
                pageById={pageById}
                hasPages={hasPages}
                statusFilter={statusFilter}
                periodFilter={periodFilter}
                onNewGoal={openCreateGoal}
                onEditGoal={openEditGoal}
                onEditPlan={openEditPlan}
              />
            ))}
          </div>
        )}
      </div>

      <PlanFormModal
        open={planModalOpen}
        onClose={closePlanModal}
        onSubmit={handlePlanSubmit}
        onDelete={handlePlanDelete}
        plan={editingPlan}
        connections={connections}
        saving={savingPlan}
        currentUserId={user?.id}
        onAddMember={handleAddMember}
        onSetRole={handleSetRole}
        onRemoveMember={handleRemoveMember}
        memberBusy={memberBusy}
      />

      <GoalFormModal
        open={goalModal.open}
        onClose={closeGoalModal}
        onSubmit={handleGoalSubmit}
        onDelete={goalCanDelete ? handleGoalDelete : undefined}
        pages={pages}
        defaultAccountId={activeId ?? pages[0]?.id}
        goal={goalModal.goal}
        saving={savingGoal}
      />
    </>
  );
}
