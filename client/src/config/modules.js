export const APP_MODULES = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    route: '/dashboard',
    core: true,
    group: 'workspace',
    description: 'Home base, connected page status, and workspace overview.',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    route: '/analytics',
    group: 'workspace',
    description: 'Page metrics, reach, followers, and performance charts.',
  },
  {
    id: 'insights',
    label: 'Insights',
    route: '/insights',
    group: 'workspace',
    description: 'Performance, messaging, and content insight reports.',
  },
  {
    id: 'post-pool',
    label: 'Contents',
    route: '/post-pool',
    group: 'workspace',
    description: 'Posts, reels, stories, comments, create, and content review.',
  },
  {
    id: 'products',
    label: 'Shop',
    route: '/shop',
    group: 'workspace',
    description: 'Products, discounts, orders, receipts, and catalog tools.',
  },
  {
    id: 'messages',
    label: 'Messaging',
    route: '/messages',
    group: 'communication',
    description: 'Customer inbox, conversations, and team replies.',
  },
  {
    id: 'connections',
    label: 'Connections',
    route: '/connections',
    group: 'communication',
    description: 'Team contacts and connection management.',
  },
  {
    id: 'content-calendar',
    label: 'Content Calendar',
    route: '/content-calendar',
    group: 'planning',
    description: 'Calendar view for scheduled and planned content.',
  },
  {
    id: 'planner',
    label: 'Planner',
    route: '/planner',
    group: 'planning',
    description: 'Goals, targets, and progress planning.',
  },
  {
    id: 'vault',
    label: 'Vault',
    route: '/vault',
    group: 'planning',
    description: 'Shared media and file storage.',
  },
  {
    id: 'logs',
    label: 'Logs',
    route: '/logs',
    group: 'system',
    description: 'Posting logs and automation job history.',
  },
  {
    id: 'activity',
    label: 'Activity',
    route: '/activity',
    group: 'system',
    description: 'Workspace activity and audit timeline.',
  },
  {
    id: 'settings',
    label: 'Settings',
    route: '/settings',
    group: 'system',
    description: 'Posting rules, pages, templates, and automation settings.',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    route: '/accounts',
    group: 'system',
    description: 'Admin account and invite management.',
    adminOnly: true,
  },
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
  const access = normalizeModuleAccess(user?.module_access ?? user?.moduleAccess);
  return access == null ? MODULE_IDS : access;
}

export function canAccessModule(user, moduleId) {
  if (!moduleId || moduleId === 'dashboard') return true;
  if (!user) return false;
  const module = APP_MODULES.find((m) => m.id === moduleId);
  if (!module) return false;
  // Admins have full access regardless of their stored module_access (which may
  // predate newer modules) — mirrors the server's canUseModule.
  if (isAdminRole(user.role)) return true;
  if (module.adminOnly) return false;
  return moduleAccessForUser(user).includes(moduleId);
}

export function invitableModulesForUser(user) {
  return APP_MODULES.filter((module) => !module.adminOnly && canAccessModule(user, module.id));
}

export function labelForModule(id) {
  return APP_MODULES.find((module) => module.id === id)?.label ?? id;
}
