export const APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', core: true },
  { id: 'content-calendar', label: 'Content Calendar' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'post-pool', label: 'Post Pool' },
  { id: 'upload', label: 'Upload' },
  { id: 'messages', label: 'Messaging' },
  { id: 'vault', label: 'Vault' },
  { id: 'logs', label: 'Logs' },
  { id: 'activity', label: 'Activity' },
  { id: 'accounts', label: 'Accounts', adminOnly: true },
  { id: 'settings', label: 'Settings' },
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
  const access = normalizeModuleAccess(user?.module_access);
  return access == null ? MODULE_IDS : access;
}

export function serializeModuleAccess(value) {
  const access = normalizeModuleAccess(value);
  return JSON.stringify(access == null ? MODULE_IDS : access);
}

