import { useEffect, useState } from 'react';
import * as adminService from '../../services/admin.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { APP_MODULES, invitableModulesForUser, labelForModule, normalizeModuleAccess } from '../../config/modules.js';
import { Card, Button, Spinner, EmptyState, Modal } from '../../components/ui.jsx';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

const allModuleIds = APP_MODULES.map((m) => m.id);

function accessLabels(access) {
  const ids = normalizeModuleAccess(access) || allModuleIds;
  if (ids.length === allModuleIds.length) return ['All modules'];
  return ids.map(labelForModule);
}

// Access modules on a single line; the rest collapse into a "+N more" pill (the
// full set is shown in the row's details dialog).
const MAX_ACCESS_PILLS = 3;
function AccessPills({ access }) {
  const labels = accessLabels(access);
  const shown = labels.slice(0, MAX_ACCESS_PILLS);
  const extra = labels.length - shown.length;
  return (
    <div className="module-pills module-pills--inline">
      {shown.map((label) => (
        <span className="module-pill" key={label}>
          {label}
        </span>
      ))}
      {extra > 0 && <span className="module-pill module-pill--more">+{extra} more</span>}
    </div>
  );
}

// Full (wrapping) access list — used inside the account details dialog.
function AccessPillsFull({ access }) {
  return (
    <div className="module-pills">
      {accessLabels(access).map((label) => (
        <span className="module-pill" key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// True while a brute-force lockout is still in effect (locked_until in the future).
function isLocked(u) {
  return !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();
}

function statusBadge(u) {
  if (u.deleted_at) return <span className="badge badge--failed">deleted</span>;
  if (isLocked(u)) return <span className="badge badge--failed">locked</span>;
  return u.is_active ? (
    <span className="badge badge--ready">active</span>
  ) : (
    <span className="badge badge--archived">inactive</span>
  );
}

export default function AccountsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [selectedModules, setSelectedModules] = useState([]);
  const [link, setLink] = useState('');
  const [details, setDetails] = useState(null); // account whose details dialog is open
  const [menuId, setMenuId] = useState(null); // account whose options dropdown is open
  const [editUser, setEditUser] = useState(null); // user whose module access is being edited
  const [editModules, setEditModules] = useState([]);
  const [savingAccess, setSavingAccess] = useState(false);

  const { data, loading, error, refresh } = useCachedResource('accounts', () =>
    Promise.all([adminService.listUsers(), adminService.listInvites()]).then(([users, invites]) => ({ users, invites })),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  // Close the open row-options dropdown on outside-click / Escape.
  useEffect(() => {
    if (menuId == null) return undefined;
    const onDown = (e) => {
      if (!e.target.closest('.acct-menu')) setMenuId(null);
    };
    const onKey = (e) => e.key === 'Escape' && setMenuId(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  const { users = [], invites = [] } = data || {};
  const availableModules = invitableModulesForUser(user);

  const openAccessDialog = () => {
    setSelectedModules(availableModules.map((module) => module.id));
    setAccessOpen(true);
  };

  const toggleModule = (module) => {
    if (module.core) return;
    setSelectedModules((current) =>
      current.includes(module.id) ? current.filter((id) => id !== module.id) : [...current, module.id],
    );
  };

  // Edit an existing user's module access. Pre-checks their current grantable
  // modules (core is always on); admin-only modules aren't offered.
  const openEditAccess = (u) => {
    const editableIds = availableModules.map((m) => m.id);
    const current = normalizeModuleAccess(u.module_access) || [];
    const next = editableIds.filter((id) => current.includes(id));
    if (!next.includes('dashboard')) next.push('dashboard');
    setEditUser(u);
    setEditModules(next);
  };

  const toggleEditModule = (module) => {
    if (module.core) return;
    setEditModules((current) =>
      current.includes(module.id) ? current.filter((id) => id !== module.id) : [...current, module.id],
    );
  };

  const saveAccess = async () => {
    if (!editUser || editModules.length === 0) {
      toast.error('Select at least one module');
      return;
    }
    setSavingAccess(true);
    try {
      const res = await adminService.setModuleAccess(editUser.id, editModules);
      toast.success(`Updated access for ${editUser.name}`);
      // Keep the details dialog in sync if it's showing this user.
      setDetails((cur) => (cur && cur.id === editUser.id ? { ...cur, module_access: res.module_access } : cur));
      setEditUser(null);
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingAccess(false);
    }
  };

  const generate = async () => {
    if (selectedModules.length === 0) {
      toast.error('Select at least one module');
      return;
    }
    setGenerating(true);
    try {
      const invite = await adminService.createInvite({ modules: selectedModules });
      setLink(invite.link);
      setAccessOpen(false);
      try {
        await navigator.clipboard?.writeText(invite.link);
        toast.success('Login link generated & copied');
      } catch {
        toast.success('Login link generated');
      }
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard?.writeText(text);
      toast.info('Copied');
    } catch {
      /* clipboard unavailable */
    }
  };

  const toggleActive = async (u) => {
    try {
      await adminService.setActive(u.id, !u.is_active);
      toast.success(u.is_active ? 'Account deactivated' : 'Account activated');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const unlock = async (u) => {
    try {
      await adminService.unlockAccount(u.id);
      toast.success('Account unlocked');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const del = async (u) => {
    if (!window.confirm(`Delete ${u.email}? This soft-deletes the account (it can't log in).`)) return;
    try {
      await adminService.softDelete(u.id);
      toast.success('Account deleted');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const removeInvite = async (inv) => {
    if (!window.confirm('Delete this unused login link?')) return;
    try {
      await adminService.deleteInvite(inv.id);
      toast.success('Link deleted');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Accounts</h1>
          <div className="page-head__sub">Invite people and manage who can access pwise.</div>
        </div>
        <Button onClick={openAccessDialog} disabled={generating || availableModules.length === 0}>
          {generating ? 'Generating…' : '+ Generate login link'}
        </Button>
      </div>

      {link && (
        <Card className="card--pad" style={{ marginBottom: 16 }}>
          <div className="field__label">New single-use sign-up link</div>
          <div className="row gap-sm">
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
            <Button variant="subtle" onClick={() => copy(link)}>
              Copy
            </Button>
          </div>
          <div className="field__hint">Share this with one person — it stops working once they create their account.</div>
        </Card>
      )}

      {loading ? (
        <Spinner label="Loading accounts…" />
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div className="card__head">
              <div className="card__title">Accounts ({users.length})</div>
            </div>
            <div className="table-wrap table-wrap--menu">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Access</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const self = u.id === user.id;
                    const deleted = !!u.deleted_at;
                    return (
                      <tr
                        key={u.id}
                        className="acct-row"
                        style={{ opacity: deleted ? 0.5 : undefined }}
                        onClick={() => setDetails(u)}
                      >
                        <td data-label="Name">{u.name}</td>
                        <td className="cell-muted" data-label="Email">{u.email}</td>
                        <td data-label="Role">
                          <span className={`badge badge--${u.role === 'admin' ? 'posted' : 'draft'}`}>{u.role}</span>
                        </td>
                        <td data-label="Access">
                          <AccessPills access={u.module_access} />
                        </td>
                        <td data-label="Status">{statusBadge(u)}</td>
                        <td className="cell-muted" data-label="Joined">{fmt(u.created_at)}</td>
                        {/* No options menu for your own account; stop row-click on the menu otherwise. */}
                        <td onClick={self ? undefined : (e) => e.stopPropagation()}>
                          {!self && !deleted && (
                            <div className="acct-menu">
                              <button
                                type="button"
                                className="card-iconbtn"
                                aria-haspopup="menu"
                                aria-expanded={menuId === u.id}
                                title="Options"
                                aria-label={`Options for ${u.name}`}
                                onClick={() => setMenuId((cur) => (cur === u.id ? null : u.id))}
                              >
                                <GearIcon />
                              </button>
                              {menuId === u.id && (
                                <div className="card-menu" role="menu">
                                  {u.role !== 'admin' && (
                                    <button
                                      type="button"
                                      className="card-menu__item"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenuId(null);
                                        openEditAccess(u);
                                      }}
                                    >
                                      Edit access
                                    </button>
                                  )}
                                  {isLocked(u) && (
                                    <button
                                      type="button"
                                      className="card-menu__item"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenuId(null);
                                        unlock(u);
                                      }}
                                    >
                                      Unlock
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="card-menu__item"
                                    role="menuitem"
                                    onClick={() => {
                                      setMenuId(null);
                                      toggleActive(u);
                                    }}
                                  >
                                    {u.is_active ? 'Deactivate' : 'Activate'}
                                  </button>
                                  <button
                                    type="button"
                                    className="card-menu__item card-menu__item--danger"
                                    role="menuitem"
                                    onClick={() => {
                                      setMenuId(null);
                                      del(u);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="card__head">
              <div className="card__title">Invite links ({invites.length})</div>
            </div>
            {invites.length === 0 ? (
              <EmptyState icon="🔗" title="No invites yet" message="Generate a login link to invite someone." />
            ) : (
              <div className="table-wrap">
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th>Created by</th>
                      <th>Status</th>
                      <th>Access</th>
                      <th>Used by</th>
                      <th>Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => {
                      const used = !!inv.used_at;
                      const link = `${window.location.origin}/signup?token=${inv.token}`;
                      return (
                        <tr key={inv.id}>
                          <td className="cell-muted" data-label="Created by">{inv.created_by_email}</td>
                          <td data-label="Status">
                            {used ? (
                              <span className="badge badge--posted">used</span>
                            ) : (
                              <span className="badge badge--ready">unused</span>
                            )}
                          </td>
                          <td data-label="Access">
                            <AccessPills access={inv.module_access} />
                          </td>
                          <td className="cell-muted" data-label="Used by">{inv.used_by_email || '—'}</td>
                          <td className="cell-muted" data-label="Created">{fmt(inv.created_at)}</td>
                          <td>
                            <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                              {!used && (
                                <>
                                  <Button variant="ghost" size="sm" onClick={() => copy(link)}>
                                    Copy link
                                  </Button>
                                  <Button variant="danger" size="sm" onClick={() => removeInvite(inv)}>
                                    Delete
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={!!details}
        title={details?.name || 'Account'}
        onClose={() => setDetails(null)}
        footer={
          <>
            {details && details.role !== 'admin' && details.id !== user.id && !details.deleted_at && (
              <Button
                variant="subtle"
                onClick={() => {
                  const target = details;
                  setDetails(null);
                  openEditAccess(target);
                }}
              >
                Edit access
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDetails(null)}>
              Close
            </Button>
          </>
        }
      >
        {details && (
          <div className="acct-details">
            <div className="acct-details__row">
              <span className="acct-details__label">Email</span>
              <span>{details.email}</span>
            </div>
            <div className="acct-details__row">
              <span className="acct-details__label">Role</span>
              <span className={`badge badge--${details.role === 'admin' ? 'posted' : 'draft'}`}>{details.role}</span>
            </div>
            <div className="acct-details__row">
              <span className="acct-details__label">Status</span>
              {statusBadge(details)}
            </div>
            <div className="acct-details__row">
              <span className="acct-details__label">Joined</span>
              <span>{fmt(details.created_at)}</span>
            </div>
            <div className="acct-details__block">
              <span className="acct-details__label">Access</span>
              <AccessPillsFull access={details.module_access} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={accessOpen}
        title="Module access"
        onClose={() => (!generating ? setAccessOpen(false) : undefined)}
        className="modal--module-access"
        dismissable={!generating}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAccessOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={generating || selectedModules.length === 0}>
              {generating ? 'Generating...' : 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="module-access">
          <p className="module-access__intro">
            Choose the modules this login link can unlock. Modules you do not have are not available to grant.
          </p>
          <div className="module-access__list">
            {availableModules.map((module) => {
              const checked = selectedModules.includes(module.id);
              return (
                <label className={`module-access__item${checked ? ' is-checked' : ''}`} key={module.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={module.core || generating}
                    onChange={() => toggleModule(module)}
                  />
                  <span className="module-access__check" aria-hidden="true" />
                  <span>
                    <span className="module-access__name">{module.label}</span>
                    <span className="module-access__hint">
                      {module.core ? 'Required safe landing page' : 'Allow access after signup'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editUser}
        title={editUser ? `Module access — ${editUser.name}` : 'Module access'}
        onClose={() => (!savingAccess ? setEditUser(null) : undefined)}
        className="modal--module-access"
        dismissable={!savingAccess}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditUser(null)} disabled={savingAccess}>
              Cancel
            </Button>
            <Button onClick={saveAccess} disabled={savingAccess || editModules.length === 0}>
              {savingAccess ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="module-access">
          <p className="module-access__intro">
            Choose which modules {editUser?.name || 'this user'} can open. Changes take effect the next time they reload
            the app.
          </p>
          <div className="module-access__list">
            {availableModules.map((module) => {
              const checked = editModules.includes(module.id);
              return (
                <label className={`module-access__item${checked ? ' is-checked' : ''}`} key={module.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={module.core || savingAccess}
                    onChange={() => toggleEditModule(module)}
                  />
                  <span className="module-access__check" aria-hidden="true" />
                  <span>
                    <span className="module-access__name">{module.label}</span>
                    <span className="module-access__hint">
                      {module.core ? 'Always available' : 'Can open this module'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
