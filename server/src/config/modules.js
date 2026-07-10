export const APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', core: true },
  { id: 'analytics', label: 'Analytics' },
  { id: 'insights', label: 'Insights' },
  { id: 'post-pool', label: 'Contents' },
  { id: 'upload', label: 'Upload' },
  { id: 'products', label: 'Shop' },
  { id: 'messages', label: 'Messaging' },
  { id: 'connections', label: 'Connections' },
  { id: 'content-calendar', label: 'Content Calendar' },
  { id: 'planner', label: 'Planner' },
  { id: 'vault', label: 'Vault' },
  { id: 'logs', label: 'Logs' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
  { id: 'accounts', label: 'Accounts', adminOnly: true },
];

export const MODULE_IDS = APP_MODULES.map((m) => m.id);
const MODULE_ID_SET = new Set(MODULE_IDS);
export const ADMIN_ROLES = ['admin', 'super_admin'];

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(String(role || '').toLowerCase());
}

export function isSuperAdminRole(role) {
  return String(role || '').toLowerCase() === 'super_admin';
}

export function normalizeModuleAccess(value) {
  if (value == null || value === '') return null;
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter((id) => MODULE_ID_SET.has(id)))];
}

export function moduleAccessForUser(user) {
  const access = normalizeModuleAccess(user?.module_access);
  return access == null ? MODULE_IDS : access;
}

// Can this user use a given module? Admins always; otherwise the module must be in
// their access list.
export function canUseModule(user, moduleId) {
  return isAdminRole(user?.role) || moduleAccessForUser(user).includes(moduleId);
}

// Can this user use Messaging? Shared by the route guard and the SSE controller.
export function hasMessagingAccess(user) {
  return canUseModule(user, 'messages');
}

export function serializeModuleAccess(value) {
  const access = normalizeModuleAccess(value);
  return JSON.stringify(access == null ? MODULE_IDS : access);
}
