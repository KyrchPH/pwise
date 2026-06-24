import { useEffect, useState } from 'react';
import { isVariable, priceRangeLabel } from '../config/variants.js';

const PER_PAGE = 10;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * Products Drawer — a right-side panel opened from the chat composer's Products
 * button. Lists the active page's products with a search box. Each card is draggable
 * into the conversation (drops a "product card": photo + name/price/description) and
 * has a "Use" button that does the same via onUse.
 */
export default function ProductsDrawer({ open, onClose, onUse, products = [], loading = false, currency }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setPage(1);
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q) ||
          (p.tags || []).some((tag) => tag.toLowerCase().includes(q)),
      )
    : products;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PER_PAGE;
  const pageEnd = Math.min(pageStart + PER_PAGE, filtered.length);
  const paged = filtered.slice(pageStart, pageEnd);

  return (
    <aside className={`tmpl-drawer${open ? ' is-open' : ''}`} aria-hidden={!open} aria-label="Products">
      <div className="tmpl-drawer__head">
        <div className="tmpl-drawer__heading">
          <span className="tmpl-drawer__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </span>
          <div>
            <h2 className="tmpl-drawer__title">Products</h2>
            <p className="tmpl-drawer__sub">Drag a product into the chat, or press Use.</p>
          </div>
        </div>
        <button type="button" className="tmpl-drawer__close" onClick={onClose} aria-label="Close products">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="tmpl-drawer__search">
        <span className="tmpl-drawer__search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          className="tmpl-drawer__search-input"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search products…"
          aria-label="Search products"
        />
      </div>

      <div className="tmpl-drawer__list">
        {loading ? (
          <p className="tmpl-drawer__empty">Loading products…</p>
        ) : filtered.length === 0 ? (
          <p className="tmpl-drawer__empty">
            {products.length === 0 ? 'No products for this page yet.' : `No products match “${query}”.`}
          </p>
        ) : (
          paged.map((product) => (
            <article
              key={product.id}
              className="product-card"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-pwise-product', JSON.stringify(product));
                event.dataTransfer.effectAllowed = 'copy';
              }}
              title="Drag into the conversation, or press Use"
            >
              <div className="product-card__media">
                {product.photoUrl ? (
                  <img src={product.photoUrl} alt="" loading="lazy" />
                ) : (
                  <span className="product-card__noimg" aria-hidden="true">No photo</span>
                )}
              </div>
              <div className="product-card__body">
                <div className="product-card__head">
                  <h3 className="product-card__title">{product.name}</h3>
                  <button type="button" className="tmpl-card__use" onClick={() => onUse(product)}>
                    Use
                  </button>
                </div>
                <div className="product-card__meta">
                  {(product.basePrice != null || isVariable(product)) && (
                    <span className="product-card__price">{priceRangeLabel(product, currency)}</span>
                  )}
                  {product.category && <span className="product-card__cat">{product.category}</span>}
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {filtered.length > PER_PAGE && (
        <div className="tmpl-drawer__pager" aria-label="Product pagination">
          <span className="tmpl-drawer__pageinfo">
            {pageStart + 1}-{pageEnd} of {filtered.length}
          </span>
          <div className="tmpl-drawer__pageactions">
            <button
              type="button"
              className="tmpl-drawer__pagebtn"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </button>
            <span className="tmpl-drawer__pagenum">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              className="tmpl-drawer__pagebtn"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={currentPage === pageCount}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
