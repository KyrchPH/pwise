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

function AccessPills({ access }) {
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

function statusBadge(u) {
  if (u.deleted_at) return <span className="badge badge--failed">deleted</span>;
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

  const { data, loading, error, refresh } = useCachedResource('accounts', () =>
    Promise.all([adminService.listUsers(), adminService.listInvites()]).then(([users, invites]) => ({ users, invites })),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

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
            <div className="table-wrap">
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
                      <tr key={u.id}>
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
                        <td>
                          <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                            <Button
                              variant="subtle"
                              size="sm"
                              disabled={self || deleted}
                              onClick={() => toggleActive(u)}
                            >
                              {u.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button variant="danger" size="sm" disabled={self || deleted} onClick={() => del(u)}>
                              Delete
                            </Button>
                          </div>
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
    </>
  );
}
