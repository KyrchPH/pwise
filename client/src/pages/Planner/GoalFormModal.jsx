import { useEffect, useState } from 'react';
import { Modal, Button, Field } from '../../components/ui.jsx';

export const METRIC_OPTIONS = [
  { value: 'followers', label: 'Followers' },
  { value: 'posts', label: 'Posts' },
  { value: 'comments', label: 'Comments' },
  { value: 'shares', label: 'Shares' },
  { value: 'views', label: 'Views' },
  { value: 'reactions', label: 'Reactions' },
];

export const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

// End date a period-length after `startStr` — used to prefill the range when the
// user picks a cadence. A daily goal is a single day (end = start).
function endForPeriod(period, startStr) {
  const d = new Date(`${startStr || todayStr()}T00:00:00Z`);
  switch (period) {
    case 'daily': break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: d.setUTCDate(d.getUTCDate() + 7);
  }
  return d.toISOString().slice(0, 10);
}

function initialState(goal, defaultAccountId) {
  if (goal) {
    return {
      title: goal.title ?? '',
      account_id: String(goal.account_id ?? ''),
      metric: goal.metric ?? 'followers',
      period: goal.period ?? 'weekly',
      target_value: String(goal.target_value ?? ''),
      start_date: goal.start_date ?? todayStr(),
      end_date: goal.end_date ?? endForPeriod(goal.period ?? 'weekly', todayStr()),
    };
  }
  const start = todayStr();
  return {
    title: '',
    account_id: defaultAccountId != null ? String(defaultAccountId) : '',
    metric: 'followers',
    period: 'weekly',
    target_value: '',
    start_date: start,
    end_date: endForPeriod('weekly', start),
  };
}

export default function GoalFormModal({ open, onClose, onSubmit, onDelete, pages = [], defaultAccountId, goal = null, saving = false }) {
  const [form, setForm] = useState(() => initialState(goal, defaultAccountId));

  // Reset the form each time the dialog opens (for a fresh create or a specific edit).
  useEffect(() => {
    if (open) setForm(initialState(goal, defaultAccountId));
  }, [open, goal, defaultAccountId]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Picking a cadence prefills the end date from the current start.
  const onPeriodChange = (period) => set({ period, end_date: endForPeriod(period, form.start_date) });
  const onStartChange = (start_date) => set({ start_date, end_date: endForPeriod(form.period, start_date) });

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      account_id: Number(form.account_id),
      title: form.title.trim(),
      metric: form.metric,
      period: form.period,
      target_value: Number(form.target_value),
      start_date: form.start_date,
      end_date: form.end_date,
    });
  };

  const valid =
    form.title.trim() &&
    form.account_id &&
    Number(form.target_value) > 0 &&
    form.start_date &&
    form.end_date &&
    form.start_date <= form.end_date;

  const footer = (
    <>
      {goal && onDelete && (
        <Button variant="danger" type="button" className="goal-modal__delete" onClick={() => onDelete(goal)} disabled={saving}>
          Delete
        </Button>
      )}
      <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" form="goal-form" className="btn--flat" disabled={!valid || saving}>
        {saving ? 'Saving…' : goal ? 'Save goal' : 'Create goal'}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={goal ? 'Edit goal' : 'New goal'} footer={footer} className="goal-modal">
      <form id="goal-form" onSubmit={submit} className="goal-form">
        <Field label="Goal title">
          <input
            className="input"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Reach 500 new followers"
            maxLength={255}
            autoFocus
          />
        </Field>

        <Field label="Page">
          <select className="select" value={form.account_id} onChange={(e) => set({ account_id: e.target.value })}>
            {!form.account_id && <option value="" disabled>Select a page…</option>}
            {pages.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.account_name || `Page #${p.id}`}</option>
            ))}
          </select>
        </Field>

        <div className="goal-form__row">
          <Field label="Measure">
            <select className="select" value={form.metric} onChange={(e) => set({ metric: e.target.value })}>
              {METRIC_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Cadence">
            <select className="select" value={form.period} onChange={(e) => onPeriodChange(e.target.value)}>
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Target">
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={form.target_value}
              onChange={(e) => set({ target_value: e.target.value })}
              placeholder="100"
            />
          </Field>
        </div>

        <div className="goal-form__row">
          <Field label="Start date">
            <input className="input" type="date" value={form.start_date} onChange={(e) => onStartChange(e.target.value)} />
          </Field>
          <Field label="End date">
            <input className="input" type="date" value={form.end_date} min={form.start_date} onChange={(e) => set({ end_date: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
