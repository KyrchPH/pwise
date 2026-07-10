import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Dropdown, Field } from '../../components/ui.jsx';

// The plan's sharing model: pick people from your connections and give each an
// access level. Used for both "New plan" (members staged locally, sent with the
// create payload) and "Edit plan" (member changes apply live via the handlers).
const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner' },
];

export const ROLE_HINT = {
  viewer: 'Can only view goals',
  editor: 'Can edit goal details',
  owner: 'Can add, edit & delete goals',
};

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function PersonRow({ person, right }) {
  return (
    <div className="plan-member">
      <span className="agentchat-avatar plan-member__avatar" aria-hidden="true">{initialsOf(person.name)}</span>
      <span className="plan-member__meta">
        <span className="plan-member__name">{person.name}</span>
        {person.email && <span className="plan-member__email">{person.email}</span>}
      </span>
      <span className="plan-member__right">{right}</span>
    </div>
  );
}

function RoleSelect({ value, onChange, disabled }) {
  if (disabled) {
    return <span className={`plan-role-tag plan-role-tag--${value}`}>{ROLE_OPTIONS.find((r) => r.value === value)?.label || value}</span>;
  }
  return (
    <Dropdown
      className="plan-role-select"
      value={value}
      options={ROLE_OPTIONS}
      onChange={onChange}
      ariaLabel={`Access level: ${ROLE_HINT[value]}`}
    />
  );
}

export default function PlanFormModal({
  open,
  onClose,
  onSubmit,
  onDelete,
  plan = null,
  connections = [],
  saving = false,
  currentUserId,
  onAddMember,
  onSetRole,
  onRemoveMember,
  memberBusy = null,
}) {
  const isEdit = !!plan;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shares, setShares] = useState([]); // create mode: staged [{ user_id, role }]
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');

  // Reset only when the dialog opens or switches to a different plan — NOT on every
  // `plan` object change, so live member edits don't wipe unsaved name/description.
  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? '');
    setDescription(plan?.description ?? '');
    setShares([]);
    setPickerOpen(false);
    setQ('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id]);

  const connById = useMemo(() => {
    const m = new Map();
    for (const c of connections) m.set(Number(c.id), c);
    return m;
  }, [connections]);

  // People already spoken for — hidden from the add picker.
  const takenIds = useMemo(() => {
    const s = new Set();
    if (isEdit) for (const m of plan.members || []) s.add(Number(m.id));
    else {
      s.add(Number(currentUserId));
      for (const sh of shares) s.add(Number(sh.user_id));
    }
    return s;
  }, [isEdit, plan, shares, currentUserId]);

  const pickable = useMemo(() => {
    const term = q.trim().toLowerCase();
    return connections.filter(
      (c) =>
        !takenIds.has(Number(c.id)) &&
        (!term || (c.name || '').toLowerCase().includes(term) || (c.email || '').toLowerCase().includes(term)),
    );
  }, [connections, takenIds, q]);

  const addStaged = (c) => {
    setShares((prev) => [...prev, { user_id: Number(c.id), role: 'viewer' }]);
    setQ('');
    setPickerOpen(false);
  };
  const setStagedRole = (uid, role) => setShares((prev) => prev.map((s) => (s.user_id === uid ? { ...s, role } : s)));
  const removeStaged = (uid) => setShares((prev) => prev.filter((s) => s.user_id !== uid));

  const pickInEdit = (c) => {
    onAddMember?.(Number(c.id), 'viewer');
    setQ('');
    setPickerOpen(false);
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit(
      isEdit
        ? { name: name.trim(), description: description.trim() }
        : { name: name.trim(), description: description.trim(), members: shares },
    );
  };

  const valid = name.trim().length > 0;

  const footer = (
    <>
      {isEdit && onDelete && (
        <Button variant="danger" type="button" className="goal-modal__delete" onClick={() => onDelete(plan)} disabled={saving}>
          Delete plan
        </Button>
      )}
      <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" form="plan-form" className="btn--flat" disabled={!valid || saving}>
        {saving ? 'Saving…' : isEdit ? 'Save plan' : 'Create plan'}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit plan' : 'New plan'} footer={footer} closeOnBackdrop={false} className="plan-modal">
      <form id="plan-form" onSubmit={submit} className="plan-form">
        <Field label="Plan name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 growth plan" maxLength={255} autoFocus />
        </Field>
        <Field label="Description" hint="Optional — a short note about what this plan is for.">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What are we working toward?" maxLength={500} />
        </Field>

        <div className="plan-share">
          <div className="plan-share__head">
            <span className="field__label">Shared with</span>
            <span className="plan-share__hint">People in your connections who can access this plan.</span>
          </div>

          <div className="plan-share__list">
            {isEdit &&
              (plan.members || []).map((m) => {
                const isSelf = Number(m.id) === Number(currentUserId);
                return (
                  <PersonRow
                    key={m.id}
                    person={m}
                    right={
                      isSelf ? (
                        <span className="plan-role-tag plan-role-tag--owner">You · Owner</span>
                      ) : (
                        <>
                          <RoleSelect value={m.role} onChange={(role) => onSetRole?.(Number(m.id), role)} disabled={memberBusy === Number(m.id)} />
                          <button
                            type="button"
                            className="plan-member__remove"
                            onClick={() => onRemoveMember?.(Number(m.id))}
                            disabled={memberBusy === Number(m.id)}
                            aria-label={`Remove ${m.name}`}
                          >
                            ✕
                          </button>
                        </>
                      )
                    }
                  />
                );
              })}

            {!isEdit && shares.length === 0 && (
              <div className="plan-share__empty">Only you (owner) so far. Add people below.</div>
            )}
            {!isEdit &&
              shares.map((s) => {
                const c = connById.get(s.user_id) || { id: s.user_id, name: `User #${s.user_id}`, email: '' };
                return (
                  <PersonRow
                    key={s.user_id}
                    person={c}
                    right={
                      <>
                        <RoleSelect value={s.role} onChange={(role) => setStagedRole(s.user_id, role)} />
                        <button type="button" className="plan-member__remove" onClick={() => removeStaged(s.user_id)} aria-label={`Remove ${c.name}`}>
                          ✕
                        </button>
                      </>
                    }
                  />
                );
              })}
          </div>

          <div className="plan-picker">
            <input
              className="input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 120)}
              placeholder={connections.length ? 'Add a connection…' : 'No connections to share with yet'}
              disabled={!connections.length}
            />
            {pickerOpen && pickable.length > 0 && (
              <div className="plan-picker__menu">
                {pickable.slice(0, 8).map((c) => (
                  <button type="button" key={c.id} className="plan-picker__opt" onClick={() => (isEdit ? pickInEdit(c) : addStaged(c))}>
                    <span className="agentchat-avatar" aria-hidden="true">{initialsOf(c.name)}</span>
                    <span className="plan-picker__meta">
                      <span className="plan-picker__name">{c.name}</span>
                      {c.email && <span className="plan-picker__email">{c.email}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {pickerOpen && q.trim() && pickable.length === 0 && (
              <div className="plan-picker__menu">
                <div className="plan-picker__empty">No matching connections.</div>
              </div>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
