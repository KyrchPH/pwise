import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Logo } from './ui.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/post-pool', label: 'Post Pool', icon: '▤' },
  { to: '/upload', label: 'Upload', icon: '↑' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/logs', label: 'Logs', icon: '≡' },
];

const TITLES = {
  '/dashboard': 'Dashboard',
  '/post-pool': 'Post Pool',
  '/upload': 'Upload Post',
  '/settings': 'Settings',
  '/logs': 'Posting Logs',
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'pwise';
  const initials = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">p</span>
          <span className="brand__name">pwise</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
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
          Auto-post scheduler
          <br />
          v0.1.0
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">{title}</div>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
