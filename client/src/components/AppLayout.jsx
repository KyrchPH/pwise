import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { usePages } from '../context/PageContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { canAccessModule } from '../config/modules.js';
import * as pagesService from '../services/pages.service.js';
import * as connections from '../services/connections.service.js';
import { subscribe } from '../services/messaging.service.js';
import usePresenceHeartbeat from '../hooks/usePresenceHeartbeat.js';
import useTabTitleNotifier from '../hooks/useTabTitleNotifier.js';
import { PresenceProvider } from '../context/PresenceContext.jsx';
import { Modal, PageAvatar, UserAvatar } from './ui.jsx';

// Feather-style outline icons (24-grid, no fill, currentColor stroke) so the
// whole nav is consistent — no emojis. Inherits the link's text color.
function Ico({ children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Circular-arrows refresh icon; spins while a sync is in flight.
function RefreshIcon({ spinning = false }) {
  return (
    <svg
      className={`spin-icon${spinning ? ' is-spinning' : ''}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// Page-scoped views — their content changes with the active page (top group).
function LockIcon() {
  return (
    <svg
      className="nav__lock"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Page-scoped views; their content changes with the active page.
const PRIMARY_NAV = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    moduleId: 'dashboard',
    icon: (
      <Ico>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </Ico>
    ),
  },
  {
    to: '/content-calendar',
    label: 'Content Calendar',
    moduleId: 'content-calendar',
    icon: (
      <Ico>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </Ico>
    ),
  },
  {
    to: '/analytics',
    label: 'Analytics',
    moduleId: 'analytics',
    icon: (
      <Ico>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </Ico>
    ),
  },
  {
    to: '/post-pool',
    label: 'Post Pool',
    moduleId: 'post-pool',
    icon: (
      <Ico>
        <path d="M12 2 2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </Ico>
    ),
  },
  {
    to: '/upload',
    label: 'Upload',
    moduleId: 'upload',
    icon: (
      <Ico>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </Ico>
    ),
  },
  {
    to: '/shop',
    label: 'Shop',
    moduleId: 'products',
    icon: (
      <Ico>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </Ico>
    ),
  },
];

// Page-independent tools — bottom group (with Messaging + the page switcher).
const SECONDARY_NAV = [
  {
    to: '/vault',
    label: 'Vault',
    moduleId: 'vault',
    icon: (
      <Ico>
        <polyline points="21 8 21 21 3 21 3 8" />
        <rect x="1" y="3" width="22" height="5" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </Ico>
    ),
  },
  {
    to: '/logs',
    label: 'Logs',
    moduleId: 'logs',
    icon: (
      <Ico>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </Ico>
    ),
  },
  {
    to: '/activity',
    label: 'Activity',
    moduleId: 'activity',
    icon: (
      <Ico>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </Ico>
    ),
  },
  {
    to: '/accounts',
    label: 'Accounts',
    moduleId: 'accounts',
    admin: true,
    icon: (
      <Ico>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </Ico>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    moduleId: 'settings',
    icon: (
      <Ico>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </Ico>
    ),
  },
];

// Compact follower count: 1234 → "1.2K", 1500000 → "1.5M".
function formatCount(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num % 1_000 === 0 ? 0 : 1)}K`;
  return String(num);
}

// Routes whose content is scoped to the active page (their tools act AS the page —
// posting, messaging, products, analytics). When the active page's Facebook
// connection is broken, these are gated behind a reconnect prompt; page-independent
// routes (Vault, Logs, Settings, Profile…) stay usable so the page can be fixed.
const PAGE_SCOPED_PATHS = ['/dashboard', '/content-calendar', '/analytics', '/post-pool', '/upload', '/shop', '/messages'];

// Full-screen block shown in place of a page-scoped view when the active page's
// Facebook token has been revoked/expired. Admins get a Reconnect shortcut; everyone
// can re-check (the token may have been restored elsewhere).
function ReconnectGate({ page, isAdmin, onFix, onRecheck }) {
  const [rechecking, setRechecking] = useState(false);
  const recheck = async () => {
    if (rechecking) return;
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  };
  return (
    <div className="reconnect-gate">
      <div className="reconnect-gate__card">
        <span className="reconnect-gate__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </span>
        <h2 className="reconnect-gate__title">Page disconnected</h2>
        <p className="reconnect-gate__lead">
          <strong>{page?.account_name}</strong>’s Facebook connection has expired or been revoked, so this page’s tools are paused.
        </p>
        <p className="reconnect-gate__sub">
          This affects messaging, posting, analytics, and products for this page. Other pages aren’t affected — switch pages from the sidebar.
        </p>
        <div className="reconnect-gate__actions">
          {isAdmin ? (
            <button type="button" className="btn btn--primary" onClick={onFix}>
              Reconnect this page
            </button>
          ) : (
            <span className="text-muted">Please ask an admin to reconnect this page.</span>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={recheck} disabled={rechecking}>
            {rechecking ? 'Checking…' : 'Re-check'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout() {
  usePresenceHeartbeat(); // keep this user "online" while their tab is active
  useTabTitleNotifier(); // badge the tab title with new inbox activity when on another tab
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { pages, activeId, activePage, activeFollowers, switching, switchPage, refresh: refreshPages, activePageHealthy, brokenPageIds, refreshHealth } = usePages();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const canConn = canAccessModule(user, 'connections');
  const canMsg = canAccessModule(user, 'messages');
  const isMessagingPage = pathname === '/messages';
  const isConnectionsPage = pathname === '/connections';
  const isVaultPage = pathname === '/vault';
  const isProductsPage = pathname.startsWith('/shop');
  const isActivityPage = pathname === '/activity';
  const isLogsPage = pathname === '/logs';
  // Active page's Facebook connection is broken → gate its page-scoped tools and
  // surface a reconnect prompt (a banner elsewhere, a full block on scoped routes).
  const isPageScoped = PAGE_SCOPED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const pageBroken = pages.length > 0 && !!activePage && !activePageHealthy;
  const gated = pageBroken && isPageScoped;

  // Mobile nav drawer: closes on navigation and on Escape.
  const [navOpen, setNavOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false); // page-switcher dialog
  const [syncing, setSyncing] = useState(false); // refreshing page data from Facebook
  const [expiredIds, setExpiredIds] = useState(() => new Set()); // pages whose token failed to refresh
  const [menuOpen, setMenuOpen] = useState(false); // account dropdown (top-right)
  const menuRef = useRef(null);
  const scrollRef = useRef(null); // scrollable nav region (for the edge-fade mask)
  // Desktop sidebar collapse (icons-only rail), remembered across sessions.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pwise:sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('pwise:sidebar-collapsed', collapsed ? '1' : '0');
    } catch {
      /* storage unavailable — collapse just won't persist */
    }
  }, [collapsed]);

  // Unread-messages count for the sidebar badge. TODO: wire to the real source
  // (e.g. the active page's Facebook inbox); 0 keeps the badge hidden.
  const [messageCount] = useState(0);
  const [connCount, setConnCount] = useState(0); // pending incoming connection requests
  useEffect(() => {
    setNavOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  // Connections nav badge — pending incoming-request count, kept live over SSE.
  useEffect(() => {
    if (!canConn) return;
    connections.list().then((d) => setConnCount(d.incoming.length)).catch(() => {});
  }, [canConn]);
  useEffect(() => {
    if (!canConn || !canMsg) return undefined; // the SSE stream itself requires messaging access
    return subscribe((ev) => {
      if (ev?.type === 'connection:request' || ev?.type === 'connection:changed') {
        connections.list().then((d) => setConnCount(d.incoming.length)).catch(() => {});
      }
    });
  }, [canConn, canMsg]);

  // Close the account menu on outside-click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Soft-fade the nav's top/bottom edges to hint at more items. The fade size
  // tracks how far you can still scroll in that direction, so it shrinks to 0 at
  // each end — a fully-scrolled (or non-scrolling) list shows no fade.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const MAX = 32;
    const update = () => {
      el.style.setProperty('--fade-top', `${Math.min(MAX, el.scrollTop)}px`);
      el.style.setProperty(
        '--fade-bottom',
        `${Math.min(MAX, Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop))}px`,
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [collapsed, isAdmin]);

  // Pull fresh name/followers for every page from Facebook; flag any whose token
  // failed so the tile can show "Expired" + an Update shortcut.
  const syncPages = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const results = await pagesService.refreshAll();
      const failed = results.filter((r) => !r.ok);
      setExpiredIds(new Set(failed.map((r) => r.id)));
      await refreshPages(); // reload names + followers into the switcher/sidebar
      if (failed.length === 0) toast.success('Pages up to date');
      else toast.error(`${failed.length} page${failed.length === 1 ? '' : 's'} need a new token`);
    } catch (e) {
      toast.error('Could not refresh pages');
    } finally {
      setSyncing(false);
    }
  };

  // Expired tile → Settings, scrolled to the Facebook Pages section (admins only).
  const goFixPage = () => {
    setPickerOpen(false);
    navigate('/settings#facebook-pages');
  };
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const renderNavItem = (n, extraClass = '') => {
    const locked = !canAccessModule(user, n.moduleId) || (n.admin && !isAdmin);
    const label = locked ? `${n.label} locked` : n.label;
    const className = ['nav__link', extraClass, locked && 'is-locked'].filter(Boolean).join(' ');
    const content = (
      <>
        <span className="nav__icon">{n.icon}</span>
        <span className="nav__label">{n.label}</span>
        {locked && <LockIcon />}
        {!locked && n.badge}
      </>
    );

    if (locked) {
      return (
        <span key={n.to} className={className} title={label} aria-disabled="true">
          {content}
        </span>
      );
    }

    return (
      <NavLink
        key={n.to}
        to={n.to}
        title={collapsed ? n.label : undefined}
        className={({ isActive }) => [className, isActive && 'active'].filter(Boolean).join(' ')}
      >
        {content}
      </NavLink>
    );
  };

  const renderNavLinks = (items) => items.map((n) => renderNavItem(n));

  return (
    <PresenceProvider>
    <div className="app-shell">
      <aside className={`sidebar${navOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
        <button className="sidebar__close" onClick={() => setNavOpen(false)} aria-label="Close menu">
          ✕
        </button>
        <div className="sidebar__top">
          <button
            type="button"
            className="sidebar__collapse"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
        {/* Nav scrolls if it outgrows the viewport so the footer stays pinned. */}
        <div className="sidebar__scroll" ref={scrollRef}>
          <div className="nav-group">
            <div className="nav__title">Workspace</div>
            <nav className="nav">{renderNavLinks(PRIMARY_NAV)}</nav>
          </div>
          <div className="nav-group">
            <div className="nav__title">General</div>
            <nav className="nav">
              {renderNavItem(
                {
                  to: '/messages',
                  label: 'Messaging',
                  moduleId: 'messages',
                  icon: (
                    <Ico>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </Ico>
                  ),
                  badge:
                    messageCount > 0 ? (
                      <span className="sidebar__msg-badge">{messageCount > 99 ? '99+' : messageCount}</span>
                    ) : null,
                },
                'sidebar__messages',
              )}
              {renderNavItem({
                to: '/connections',
                label: 'Connections',
                moduleId: 'connections',
                icon: (
                  <Ico>
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </Ico>
                ),
                badge:
                  connCount > 0 ? (
                    <span className="sidebar__msg-badge">{connCount > 99 ? '99+' : connCount}</span>
                  ) : null,
              })}
              {renderNavLinks(SECONDARY_NAV)}
            </nav>
          </div>
        </div>
        <div className="sidebar__foot">
          {pages.length > 0 ? (
            <div className="sidebar__acct sidebar__acct--page">
              <PageAvatar page={activePage} />
              <span className="sidebar__acct-id">
                <span className="sidebar__acct-name">{activePage?.account_name || 'Select a page'}</span>
                {activeFollowers != null && (
                  <span className="sidebar__acct-sub">{formatCount(activeFollowers)} followers</span>
                )}
              </span>
              <button
                type="button"
                className="sidebar__switch-btn"
                onClick={() => setPickerOpen(true)}
                disabled={switching}
                title="Switch page"
                aria-label="Switch page"
              >
                <span className="sidebar__switch-btn__label">{switching ? 'Switching…' : 'Switch Page'}</span>
                <svg
                  className={`sidebar__switch-btn__icon spin-icon${switching ? ' is-spinning' : ''}`}
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
            </div>
          ) : (
            user?.role === 'admin' && (
              <Link to="/settings" className="sidebar__footlink">
                + Connect a page
              </Link>
            )
          )}

          <div className="usermenu" ref={menuRef}>
            <button
              type="button"
              className={`sidebar__acct sidebar__acct--user${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              <UserAvatar user={user} className="avatar" />
              <span className="sidebar__acct-id">
                <span className="sidebar__acct-name">{user?.name || user?.email || 'Account'}</span>
                <span className="sidebar__acct-sub" title={user?.email}>
                  {user?.name ? user.email : isAdmin ? 'Admin' : 'Account'}
                </span>
              </span>
              <span className="sidebar__acct-action" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8 9 12 5 16 9" />
                  <polyline points="8 15 12 19 16 15" />
                </svg>
              </span>
            </button>
            {menuOpen && (
              <div className="usermenu__panel" role="menu">
                <Link to="/profile" className="usermenu__head usermenu__head--link" role="menuitem" onClick={() => setMenuOpen(false)}>
                  <UserAvatar user={user} className="avatar avatar--lg" />
                  <div className="usermenu__id">
                    {user?.name && <span className="usermenu__name">{user.name}</span>}
                    <span className="usermenu__email" title={user?.email}>{user?.email}</span>
                  </div>
                </Link>
                <div className="usermenu__sep" />
                <Link to="/profile" className="usermenu__item" role="menuitem" onClick={() => setMenuOpen(false)}>
                  <span className="usermenu__ico">
                    <Ico>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </Ico>
                  </span>
                  User Profile
                </Link>
                <Link to="/privacy" className="usermenu__item" role="menuitem" onClick={() => setMenuOpen(false)}>
                  <span className="usermenu__ico">
                    <Ico>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </Ico>
                  </span>
                  Privacy Policy
                </Link>
                <button type="button" className="usermenu__item" role="menuitem" onClick={toggleTheme}>
                  <span className="usermenu__ico">
                    {theme === 'dark' ? (
                      <Ico>
                        <circle cx="12" cy="12" r="5" />
                        <line x1="12" y1="1" x2="12" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" />
                        <line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </Ico>
                    ) : (
                      <Ico>
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </Ico>
                    )}
                  </span>
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </button>
                <div className="usermenu__sep" />
                <button type="button" className="usermenu__item usermenu__item--danger" role="menuitem" onClick={logout}>
                  <span className="usermenu__ico">
                    <Ico>
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </Ico>
                  </span>
                  Logout
                </button>
                <div className="usermenu__meta">SocialDesk · one place to run your social store</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="topbar__menu" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </header>
        {pageBroken && !isPageScoped && (
          <div className="conn-banner" role="alert">
            <svg className="conn-banner__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="conn-banner__text">
              <strong>{activePage.account_name}</strong>’s Facebook connection isn’t working — reconnect it to restore this page’s messaging, posting, and products.
            </span>
            {isAdmin ? (
              <button type="button" className="conn-banner__btn" onClick={goFixPage}>
                Reconnect
              </button>
            ) : (
              <span className="conn-banner__hint">Ask an admin to reconnect.</span>
            )}
          </div>
        )}
        <main className={`content${isMessagingPage ? ' content--messages' : ''}`}>
          {/* Keyed on the active page: switching pages remounts the routed screen
              so it reloads its data for the newly-selected page. */}
          <div
            className={`content__inner${isMessagingPage ? ' content__inner--messages' : ''}${isVaultPage || isConnectionsPage ? ' content__inner--fill' : ''}${isProductsPage || isActivityPage || isLogsPage ? ' content__inner--wide' : ''}`}
            key={activeId ?? 'no-page'}
          >
            {gated ? (
              <ReconnectGate page={activePage} isAdmin={isAdmin} onFix={goFixPage} onRecheck={refreshHealth} />
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>

      <Modal
        open={pickerOpen}
        title="Switch page"
        onClose={() => setPickerOpen(false)}
        className="modal--pagepicker"
        headerActions={
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={syncPages}
            disabled={syncing}
            title="Refresh page data from Facebook"
            aria-label="Refresh page data from Facebook"
          >
            <RefreshIcon spinning={syncing} />
          </button>
        }
        footer={
          isAdmin ? (
            <Link to="/settings#facebook-pages" className="btn btn--primary" onClick={() => setPickerOpen(false)}>
              + Add page
            </Link>
          ) : null
        }
      >
        <ul className="page-picker">
          {pages
            .filter((p) => p.is_active)
            .map((p) => {
              const expired = expiredIds.has(p.id) || brokenPageIds.has(p.id);
              return (
                <li key={p.id} className="page-picker__row">
                  <button
                    type="button"
                    className={`page-picker__item${p.id === activeId ? ' is-active' : ''}${expired ? ' is-expired' : ''}`}
                    onClick={() => {
                      switchPage(p.id);
                      setPickerOpen(false);
                    }}
                  >
                    <PageAvatar page={p} className="page-picker__photo" />
                    <span className="page-picker__name">{p.account_name}</span>
                    {expired && <span className="badge badge--expired page-picker__badge">Expired</span>}
                    {p.id === activeId && !expired && (
                      <span className="page-picker__check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                  {expired && isAdmin && (
                    <button type="button" className="btn btn--subtle btn--sm page-picker__update" onClick={goFixPage}>
                      Update
                    </button>
                  )}
                </li>
              );
            })}
        </ul>
      </Modal>
    </div>
    </PresenceProvider>
  );
}
