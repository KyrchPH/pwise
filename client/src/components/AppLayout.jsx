import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { usePages } from '../context/PageContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import * as pagesService from '../services/pages.service.js';
import { Button, Modal } from './ui.jsx';

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

const NAV = [
  {
    to: '/dashboard',
    label: 'Dashboard',
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
    to: '/analytics',
    label: 'Analytics',
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
    icon: (
      <Ico>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </Ico>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <Ico>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </Ico>
    ),
  },
  {
    to: '/logs',
    label: 'Logs',
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
    icon: (
      <Ico>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </Ico>
    ),
  },
  {
    to: '/accounts',
    label: 'Accounts',
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
];

const TITLES = {
  '/dashboard': 'Dashboard',
  '/analytics': 'Analytics',
  '/post-pool': 'Post Pool',
  '/upload': 'Upload Post',
  '/settings': 'Settings',
  '/logs': 'Posting Logs',
  '/activity': 'Activity Log',
  '/accounts': 'Accounts',
};

// Compact follower count: 1234 → "1.2K", 1500000 → "1.5M".
function formatCount(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num % 1_000 === 0 ? 0 : 1)}K`;
  return String(num);
}

// A connected page's photo (the Facebook page picture) with a letter fallback.
function PageAvatar({ page, className = '' }) {
  const [broken, setBroken] = useState(false);
  const src = page?.fb_page_id
    ? `https://graph.facebook.com/v21.0/${page.fb_page_id}/picture?type=square&width=96&height=96`
    : null;
  if (!src || broken) {
    return (
      <span className={`page-avatar page-avatar--fallback ${className}`} aria-hidden="true">
        {(page?.account_name || '?').charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className={`page-avatar ${className}`} src={src} alt="" onError={() => setBroken(true)} />;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { pages, activeId, activePage, activeFollowers, switching, switchPage, refresh: refreshPages } = usePages();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const title = TITLES[pathname] || 'pwise';
  const initials = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  // Mobile nav drawer: closes on navigation and on Escape.
  const [navOpen, setNavOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false); // page-switcher dialog
  const [syncing, setSyncing] = useState(false); // refreshing page data from Facebook
  const [expiredIds, setExpiredIds] = useState(() => new Set()); // pages whose token failed to refresh
  useEffect(() => setNavOpen(false), [pathname]);

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

  return (
    <div className="app-shell">
      <aside className={`sidebar${navOpen ? ' is-open' : ''}`}>
        <button className="sidebar__close" onClick={() => setNavOpen(false)} aria-label="Close menu">
          ✕
        </button>
        <div className="sidebar__spacer" aria-hidden="true" />
        <nav className="nav">
          {NAV.filter((n) => !n.admin || user?.role === 'admin').map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => (isActive ? 'nav__link active' : 'nav__link')}
            >
              <span className="nav__icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__foot">
          {pages.length > 0 ? (
            <div className="sidebar__pagebox">
              <div className="sidebar__page">
                <button
                  type="button"
                  className="sidebar__page-btn"
                  onClick={() => setPickerOpen(true)}
                  disabled={switching}
                  title={switching ? 'Switching page…' : 'Switch page'}
                  aria-label="Switch active page"
                >
                  <PageAvatar page={activePage} className="sidebar__page-photo" />
                  <span className="sidebar__page-switch" aria-hidden="true">
                    {switching ? (
                      <svg className="spin-icon is-spinning" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="17 1 21 5 17 9" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    )}
                  </span>
                </button>
                <span className="sidebar__page-name">{activePage?.account_name || 'Select a page'}</span>
                {activeFollowers != null && (
                  <span className="sidebar__page-followers">{formatCount(activeFollowers)} followers</span>
                )}
              </div>
            </div>
          ) : (
            user?.role === 'admin' && (
              <Link to="/settings" className="sidebar__footlink">
                + Connect a page
              </Link>
            )
          )}
          <Link to="/privacy" className="sidebar__footlink">
            Privacy Policy
          </Link>
          <div className="sidebar__footmeta">Auto-post scheduler · v0.1.0</div>
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
            <div className="topbar__title">{title}</div>
          </div>
          <div className="user-chip">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
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
            </button>
            <div className="avatar">{initials}</div>
            <div className="col" style={{ lineHeight: 1.2 }}>
              {user?.name && <span className="text-sm">{user.name}</span>}
              <span className="text-sm text-muted">{user?.email}</span>
            </div>
            <Button variant="subtle" size="sm" onClick={logout}>
              Logout
            </Button>
          </div>
        </header>
        <main className="content">
          {/* Keyed on the active page: switching pages remounts the routed screen
              so it reloads its data for the newly-selected page. */}
          <div className="content__inner" key={activeId ?? 'no-page'}>
            <Outlet />
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
              const expired = expiredIds.has(p.id);
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
  );
}
