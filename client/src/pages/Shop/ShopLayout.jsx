import { NavLink, Outlet } from 'react-router-dom';

// Sub side-navigation for the Shop module. Mirrors the Settings nav rail: a left
// column of section links + the active section's content (via <Outlet/>). Orders and
// Receipts are placeholders for now; Products and Discounts are live.
function Ico({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const SHOP_NAV = [
  {
    to: '/shop/products',
    label: 'Products',
    icon: (
      <Ico>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </Ico>
    ),
  },
  {
    to: '/shop/orders',
    label: 'Orders',
    icon: (
      <Ico>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="7" y1="9" x2="17" y2="9" />
        <line x1="7" y1="13" x2="17" y2="13" />
        <line x1="7" y1="17" x2="13" y2="17" />
      </Ico>
    ),
  },
  {
    to: '/shop/receipts',
    label: 'Receipts',
    icon: (
      <Ico>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="9" y1="12" x2="15" y2="12" />
      </Ico>
    ),
  },
  {
    to: '/shop/discounts',
    label: 'Discounts',
    icon: (
      <Ico>
        <line x1="19" y1="5" x2="5" y2="19" />
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </Ico>
    ),
  },
];

export default function ShopLayout() {
  return (
    <div className="shop-layout">
      <nav className="shop-subnav card" aria-label="Shop sections">
        {SHOP_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `shop-subnav__link${isActive ? ' is-active' : ''}`}
          >
            <span className="shop-subnav__icon">{n.icon}</span>
            <span className="shop-subnav__label">{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="shop-content">
        <Outlet />
      </div>
    </div>
  );
}
