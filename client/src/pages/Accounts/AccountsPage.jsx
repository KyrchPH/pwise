import { useEffect, useState } from 'react';
import * as adminService from '../../services/admin.service.js';
import * as rolesService from '../../services/roles.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  APP_MODULES,
  invitableModulesForUser,
  isAdminRole,
  isSuperAdminRole,
  labelForModule,
  normalizeModuleAccess,
} from '../../config/modules.js';
import { Card, Button, Spinner, EmptyState, Modal, Field } from '../../components/ui.jsx';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

const grantableModules = APP_MODULES.filter((m) => !m.adminOnly);
const allModuleIds = grantableModules.map((m) => m.id);
const MODULE_GROUP_LABELS = {
  workspace: 'Workspace',
  communication: 'Communication',
  planning: 'Planning',
  system: 'System',
};
const MODULE_GROUP_ORDER = Object.keys(MODULE_GROUP_LABELS);

function accessLabels(access) {
  const ids = normalizeModuleAccess(access) || allModuleIds;
  const visibleIds = ids.filter((id) => allModuleIds.includes(id));
  if (allModuleIds.every((id) => visibleIds.includes(id))) return ['All modules'];
  return visibleIds.map(labelForModule);
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

// Table cell for the "Access" column: a bound account/link shows its role name as a
// single pill; an unbound (custom) one shows its module pills.
function AccessCell({ roleName, access }) {
  if (roleName) {
    return (
      <div className="module-pills module-pills--inline">
        <span className="module-pill module-pill--role">{roleName}</span>
      </div>
    );
  }
  return <AccessPills access={access} />;
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

function groupedModules(modules) {
  return MODULE_GROUP_ORDER.map((group) => ({
    group,
    label: MODULE_GROUP_LABELS[group],
    modules: modules.filter((module) => (module.group || 'system') === group),
  })).filter((section) => section.modules.length > 0);
}

// The role chooser sits above the module groups: pick a role to apply its preset
// (the account/link then stays bound to it), or "Custom access" to hand-pick modules.
// `roles` undefined → chooser hidden (used by the role create/edit dialog itself).
function RoleChooser({ roles, roleId, disabled, onSelectRole }) {
  return (
    <div className="role-choose">
      <div className="module-access__group-title">Roles</div>
      <div className="role-choose__list">
        {roles.map((role) => (
          <button
            type="button"
            key={role.id}
            className={`role-choose__chip${roleId === role.id ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => onSelectRole(role)}
          >
            <span className="role-choose__name">{role.name}</span>
            <span className="role-choose__count">{role.module_access.length} modules</span>
          </button>
        ))}
        <button
          type="button"
          className={`role-choose__chip role-choose__chip--custom${roleId == null ? ' is-active' : ''}`}
          disabled={disabled}
          onClick={() => onSelectRole(null)}
        >
          <span className="role-choose__name">Custom access</span>
          <span className="role-choose__count">Hand-pick modules</span>
        </button>
      </div>
      <p className="role-choose__hint">
        {roleId != null
          ? 'Bound to a role — access updates automatically whenever the role changes. Toggle any module below to switch to Custom.'
          : 'Hand-pick modules below, or choose a role above to apply a preset.'}
      </p>
    </div>
  );
}

function ModuleAccessPicker({ modules, selected, disabled, onToggle, coreHint = 'Always available', roles, roleId, onSelectRole }) {
  const selectedCount = modules.filter((module) => selected.includes(module.id)).length;
  return (
    <div className="module-access__picker">
      <div className="module-access__summary">
        <div>
          <span className="module-access__eyebrow">Selected access</span>
          <strong>{selectedCount} of {modules.length} modules enabled</strong>
        </div>
        <span className="module-access__summary-note">Dashboard stays on as the safe landing page.</span>
      </div>

      {roles && roles.length > 0 && (
        <RoleChooser roles={roles} roleId={roleId} disabled={disabled} onSelectRole={onSelectRole} />
      )}

      <div className="module-access__groups">
        {groupedModules(modules).map((section) => (
          <section className="module-access__group" key={section.group}>
            <div className="module-access__group-title">{section.label}</div>
            <div className="module-access__list">
              {section.modules.map((module) => {
                const checked = selected.includes(module.id);
                return (
                  <label
                    className={`module-access__item${checked ? ' is-checked' : ''}${module.core ? ' is-locked' : ''}`}
                    key={module.id}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={module.core || disabled}
                      onChange={() => onToggle(module)}
                    />
                    <span className="module-access__check" aria-hidden="true" />
                    <span className="module-access__copy">
                      <span className="module-access__name">{module.label}</span>
                      <span className="module-access__hint">{module.core ? coreHint : module.description}</span>
                    </span>
                    <span className="module-access__state">{module.core ? 'Required' : checked ? 'On' : 'Off'}</span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
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

function roleLabel(role) {
  if (isSuperAdminRole(role)) return 'Super admin';
  if (isAdminRole(role)) return 'Admin';
  return 'User';
}

function roleBadgeClass(role) {
  return isAdminRole(role) ? 'posted' : 'draft';
}

export default function AccountsPage() {
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [selectedModules, setSelectedModules] = useState([]);
  const [linkRoleId, setLinkRoleId] = useState(null); // role bound to the login link being generated
  const [link, setLink] = useState('');
  const [details, setDetails] = useState(null); // account whose details dialog is open
  const [menuId, setMenuId] = useState(null); // account whose options dropdown is open
  const [editUser, setEditUser] = useState(null); // user whose module access is being edited
  const [editModules, setEditModules] = useState([]);
  const [editRoleId, setEditRoleId] = useState(null); // role bound to the account being edited
  const [savingAccess, setSavingAccess] = useState(false);
  // Role management (create/edit a role preset).
  const [roleModal, setRoleModal] = useState(null); // null | { mode:'create' } | { mode:'edit', role }
  const [roleName, setRoleName] = useState('');
  const [roleModules, setRoleModules] = useState([]);
  const [savingRole, setSavingRole] = useState(false);

  const { data, loading, error, refresh } = useCachedResource('accounts', () =>
    Promise.all([adminService.listUsers(), adminService.listInvites(), rolesService.listRoles()]).then(
      ([users, invites, roles]) => ({ users, invites, roles }),
    ),
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

  const { users = [], invites = [], roles = [] } = data || {};
  const availableModules = invitableModulesForUser(user);
  const currentUserIsSuperAdmin = isSuperAdminRole(user?.role);

  // Only offer role ids the picker actually renders (available to this admin).
  const availableIds = availableModules.map((m) => m.id);

  const openAccessDialog = () => {
    setSelectedModules(availableIds);
    setLinkRoleId(null);
    setAccessOpen(true);
  };

  // Picking a role fills the checkboxes with its access; "Custom" (null) keeps the
  // current selection editable. Modules are clamped to what this admin can grant.
  const selectLinkRole = (role) => {
    if (!role) {
      setLinkRoleId(null);
      return;
    }
    setLinkRoleId(role.id);
    setSelectedModules(role.module_access.filter((id) => availableIds.includes(id)));
  };

  const toggleModule = (module) => {
    if (module.core) return;
    setLinkRoleId(null); // hand-tweaking diverges from any bound role → Custom
    setSelectedModules((current) =>
      current.includes(module.id) ? current.filter((id) => id !== module.id) : [...current, module.id],
    );
  };

  // Edit an existing user's module access. Pre-checks their current grantable
  // modules (core is always on); admin-only modules aren't offered.
  const openEditAccess = (u) => {
    const current = normalizeModuleAccess(u.module_access) || [];
    const next = availableIds.filter((id) => current.includes(id));
    if (!next.includes('dashboard')) next.push('dashboard');
    setEditUser(u);
    setEditModules(next);
    setEditRoleId(u.role_id ?? null); // pre-select the account's current role, if any
  };

  const selectEditRole = (role) => {
    if (!role) {
      setEditRoleId(null);
      return;
    }
    setEditRoleId(role.id);
    setEditModules(role.module_access.filter((id) => availableIds.includes(id)));
  };

  const toggleEditModule = (module) => {
    if (module.core) return;
    setEditRoleId(null); // hand-tweaking diverges from any bound role → Custom
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
      const res = await adminService.setModuleAccess(editUser.id, editModules, editRoleId);
      const boundRole = editRoleId != null ? roles.find((r) => r.id === editRoleId) : null;
      toast.success(`Updated access for ${editUser.name}`);
      // Keep the details dialog in sync if it's showing this user.
      setDetails((cur) =>
        cur && cur.id === editUser.id
          ? { ...cur, module_access: res.module_access, role_id: res.role_id, role_name: boundRole?.name ?? null }
          : cur,
      );
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
      const invite = await adminService.createInvite({ modules: selectedModules, role_id: linkRoleId });
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

  // --- Role management (create / edit / delete a role preset) ---------------
  const openCreateRole = () => {
    setRoleName('');
    setRoleModules(availableIds); // start from everything grantable, then trim
    setRoleModal({ mode: 'create' });
  };

  const openEditRole = (role) => {
    const next = availableIds.filter((id) => role.module_access.includes(id));
    if (!next.includes('dashboard')) next.push('dashboard');
    setRoleName(role.name);
    setRoleModules(next);
    setRoleModal({ mode: 'edit', role });
  };

  const toggleRoleModule = (module) => {
    if (module.core) return;
    setRoleModules((current) =>
      current.includes(module.id) ? current.filter((id) => id !== module.id) : [...current, module.id],
    );
  };

  const saveRole = async () => {
    const name = roleName.trim();
    if (!name) {
      toast.error('Give the role a name');
      return;
    }
    if (roleModules.length === 0) {
      toast.error('Select at least one module');
      return;
    }
    setSavingRole(true);
    try {
      if (roleModal.mode === 'edit') {
        await rolesService.updateRole(roleModal.role.id, { name, modules: roleModules });
        toast.success(`Updated role “${name}”`);
      } else {
        await rolesService.createRole({ name, modules: roleModules });
        toast.success(`Created role “${name}”`);
      }
      setRoleModal(null);
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingRole(false);
    }
  };

  const removeRole = async (role) => {
    const note = role.member_count
      ? ` ${role.member_count} account${role.member_count === 1 ? '' : 's'} on it will keep their current access but become Custom.`
      : '';
    if (!window.confirm(`Delete the role “${role.name}”?${note}`)) return;
    try {
      await rolesService.deleteRole(role.id);
      toast.success('Role deleted');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
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

  const toggleAdminRole = async (u) => {
    if (isSuperAdminRole(u.role)) {
      toast.error('Transfer the super admin role before changing this account.');
      return;
    }
    const nextRole = isAdminRole(u.role) ? 'user' : 'admin';
    const message =
      nextRole === 'admin'
        ? `Add ${u.email} as an admin?`
        : `Remove ${u.email} as an admin? They will lose access to admin-only pages.`;
    if (!window.confirm(message)) return;
    try {
      const res = await adminService.setRole(u.id, nextRole);
      const nextLabel = roleLabel(res.role);
      toast.success(`${u.name || u.email} is now ${nextLabel}.`);
      setDetails((cur) => (cur && cur.id === u.id ? { ...cur, role: res.role } : cur));
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const transferSuperAdminRole = async (u) => {
    if (
      !window.confirm(
        `Transfer the Super Admin role to ${u.email}? You will remain an admin, but only they will be able to transfer it again.`,
      )
    ) {
      return;
    }
    try {
      await adminService.transferSuperAdmin(u.id);
      toast.success(`Super Admin role transferred to ${u.name || u.email}.`);
      setDetails((cur) => (cur && cur.id === u.id ? { ...cur, role: 'super_admin' } : cur));
      await Promise.all([refresh(), refreshUser?.()]);
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
                          <span className={`badge badge--${roleBadgeClass(u.role)}`}>{roleLabel(u.role)}</span>
                        </td>
                        <td data-label="Access">
                          <AccessCell roleName={u.role_name} access={u.module_access} />
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
                                  {!isSuperAdminRole(u.role) && (
                                    <button
                                      type="button"
                                      className="card-menu__item"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenuId(null);
                                        toggleAdminRole(u);
                                      }}
                                    >
                                      {isAdminRole(u.role) ? 'Remove as an admin' : 'Add as an admin'}
                                    </button>
                                  )}
                                  {currentUserIsSuperAdmin && !isSuperAdminRole(u.role) && (
                                    <button
                                      type="button"
                                      className="card-menu__item"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenuId(null);
                                        transferSuperAdminRole(u);
                                      }}
                                    >
                                      Transfer Super Admin Role
                                    </button>
                                  )}
                                  {!isAdminRole(u.role) && (
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

          <Card style={{ marginBottom: 16 }}>
            <div className="card__head">
              <div className="card__title">Roles ({roles.length})</div>
              <Button variant="subtle" size="sm" onClick={openCreateRole}>
                + Create role
              </Button>
            </div>
            {roles.length === 0 ? (
              <EmptyState
                icon="🧩"
                title="No roles yet"
                message="Create a role to grant a preset of module access in one click when inviting or editing accounts."
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Access</th>
                      <th>Accounts</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr key={role.id}>
                        <td data-label="Name">
                          <span className="module-pill module-pill--role">{role.name}</span>
                        </td>
                        <td data-label="Access">
                          <AccessPills access={role.module_access} />
                        </td>
                        <td className="cell-muted" data-label="Accounts">
                          {role.member_count}
                        </td>
                        <td>
                          <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                            <Button variant="ghost" size="sm" onClick={() => openEditRole(role)}>
                              Edit
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => removeRole(role)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                            <AccessCell roleName={inv.role_name} access={inv.module_access} />
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
            {details && !isAdminRole(details.role) && details.id !== user.id && !details.deleted_at && (
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
              <span className={`badge badge--${roleBadgeClass(details.role)}`}>{roleLabel(details.role)}</span>
            </div>
            <div className="acct-details__row">
              <span className="acct-details__label">Status</span>
              {statusBadge(details)}
            </div>
            <div className="acct-details__row">
              <span className="acct-details__label">Joined</span>
              <span>{fmt(details.created_at)}</span>
            </div>
            {details.role_name && (
              <div className="acct-details__row">
                <span className="acct-details__label">Role preset</span>
                <span className="module-pill module-pill--role">{details.role_name}</span>
              </div>
            )}
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
          <ModuleAccessPicker
            modules={availableModules}
            selected={selectedModules}
            disabled={generating}
            onToggle={toggleModule}
            coreHint="Required safe landing page"
            roles={roles}
            roleId={linkRoleId}
            onSelectRole={selectLinkRole}
          />
        </div>
      </Modal>

      <Modal
        open={!!editUser}
        title="Module access"
        onClose={() => (!savingAccess ? setEditUser(null) : undefined)}
        className="modal--module-access"
        dismissable={!savingAccess}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditUser(null)} disabled={savingAccess}>
              Cancel
            </Button>
            <Button className="btn--flat" onClick={saveAccess} disabled={savingAccess || editModules.length === 0}>
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
          <ModuleAccessPicker
            modules={availableModules}
            selected={editModules}
            disabled={savingAccess}
            onToggle={toggleEditModule}
            roles={roles}
            roleId={editRoleId}
            onSelectRole={selectEditRole}
          />
        </div>
      </Modal>

      <Modal
        open={!!roleModal}
        title={roleModal?.mode === 'edit' ? 'Edit role' : 'Create role'}
        onClose={() => (!savingRole ? setRoleModal(null) : undefined)}
        className="modal--module-access"
        dismissable={!savingRole}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRoleModal(null)} disabled={savingRole}>
              Cancel
            </Button>
            <Button onClick={saveRole} disabled={savingRole || !roleName.trim() || roleModules.length === 0}>
              {savingRole ? 'Saving…' : roleModal?.mode === 'edit' ? 'Save role' : 'Create role'}
            </Button>
          </>
        }
      >
        <div className="module-access">
          <Field label="Role name" hint="Shown when binding accounts and login links to this role.">
            <input
              className="input"
              value={roleName}
              maxLength={80}
              placeholder="e.g. Sales, Content Editor"
              onChange={(e) => setRoleName(e.target.value)}
              disabled={savingRole}
            />
          </Field>
          <p className="module-access__intro">
            Choose the modules this role grants. Editing a role updates every account and unused login link bound to it.
          </p>
          <ModuleAccessPicker
            modules={availableModules}
            selected={roleModules}
            disabled={savingRole}
            onToggle={toggleRoleModule}
          />
        </div>
      </Modal>
    </>
  );
}
