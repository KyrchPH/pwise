import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { usePages } from '../context/PageContext.jsx';
import { Button, Dropdown, Logo } from './ui.jsx';

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

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { pages, activeId, switchPage } = usePages();
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'pwise';
  const initials = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  // Mobile nav drawer: closes on navigation and on Escape.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
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
        <div className="sidebar__logo">
          <Logo height={54} />
        </div>
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
            {pages.length > 0 ? (
              <div className="topbar__page" title="Active Facebook page (scopes everything below)">
                <span className="topbar__page-ico" aria-hidden="true">📄</span>
                <Dropdown
                  className="topbar__pageswitch"
                  ariaLabel="Active Facebook page"
                  value={activeId != null ? String(activeId) : ''}
                  options={pages
                    .filter((p) => p.is_active)
                    .map((p) => ({ value: String(p.id), label: p.account_name }))}
                  onChange={(v) => switchPage(Number(v))}
                />
              </div>
            ) : (
              user?.role === 'admin' && (
                <Link to="/settings" className="topbar__page-connect">
                  + Connect a page
                </Link>
              )
            )}
          </div>
          <div className="user-chip">
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
          <div className="content__inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
