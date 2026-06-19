export const APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', route: '/dashboard', core: true },
  { id: 'content-calendar', label: 'Content Calendar', route: '/content-calendar' },
  { id: 'analytics', label: 'Analytics', route: '/analytics' },
  { id: 'post-pool', label: 'Post Pool', route: '/post-pool' },
  { id: 'upload', label: 'Upload', route: '/upload' },
  { id: 'messages', label: 'Messaging', route: '/messages' },
  { id: 'connections', label: 'Connections', route: '/connections' },
  { id: 'vault', label: 'Vault', route: '/vault' },
  { id: 'logs', label: 'Logs', route: '/logs' },
  { id: 'activity', label: 'Activity', route: '/activity' },
  { id: 'accounts', label: 'Accounts', route: '/accounts', adminOnly: true },
  { id: 'settings', label: 'Settings', route: '/settings' },
];

export const MODULE_IDS = APP_MODULES.map((m) => m.id);
const MODULE_ID_SET = new Set(MODULE_IDS);

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
  const access = normalizeModuleAccess(user?.module_access ?? user?.moduleAccess);
  return access == null ? MODULE_IDS : access;
}

export function canAccessModule(user, moduleId) {
  if (!moduleId || moduleId === 'dashboard') return true;
  if (!user) return false;
  const module = APP_MODULES.find((m) => m.id === moduleId);
  if (!module) return false;
  if (module.adminOnly && user.role !== 'admin') return false;
  return moduleAccessForUser(user).includes(moduleId);
}

export function invitableModulesForUser(user) {
  return APP_MODULES.filter((module) => !module.adminOnly && canAccessModule(user, module.id));
}

export function labelForModule(id) {
  return APP_MODULES.find((module) => module.id === id)?.label ?? id;
}
