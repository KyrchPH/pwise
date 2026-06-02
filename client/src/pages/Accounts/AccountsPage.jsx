import { useEffect, useState } from 'react';
import * as adminService from '../../services/admin.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Button, Spinner, EmptyState } from '../../components/ui.jsx';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

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
  const [link, setLink] = useState('');

  const { data, loading, error, refresh } = useCachedResource('accounts', () =>
    Promise.all([adminService.listUsers(), adminService.listInvites()]).then(([users, invites]) => ({ users, invites })),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const { users = [], invites = [] } = data || {};

  const generate = async () => {
    setGenerating(true);
    try {
      const invite = await adminService.createInvite();
      setLink(invite.link);
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
        <Button onClick={generate} disabled={generating}>
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
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
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
                        <td>{u.name}</td>
                        <td className="cell-muted">{u.email}</td>
                        <td>
                          <span className={`badge badge--${u.role === 'admin' ? 'posted' : 'draft'}`}>{u.role}</span>
                        </td>
                        <td>{statusBadge(u)}</td>
                        <td className="cell-muted">{fmt(u.created_at)}</td>
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
                <table className="table">
                  <thead>
                    <tr>
                      <th>Created by</th>
                      <th>Status</th>
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
                          <td className="cell-muted">{inv.created_by_email}</td>
                          <td>
                            {used ? (
                              <span className="badge badge--posted">used</span>
                            ) : (
                              <span className="badge badge--ready">unused</span>
                            )}
                          </td>
                          <td className="cell-muted">{inv.used_by_email || '—'}</td>
                          <td className="cell-muted">{fmt(inv.created_at)}</td>
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
    </>
  );
}
