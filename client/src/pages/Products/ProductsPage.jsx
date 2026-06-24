import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { formatPrice } from '../../config/currency.js';
import { isVariable, priceRangeLabel, variantLabel, findVariant, unitPriceOf } from '../../config/variants.js';
import { useToast } from '../../context/ToastContext.jsx';
import * as productsApi from '../../services/products.service.js';
import * as discountsApi from '../../services/discounts.service.js';
import { evaluateDiscounts } from '../../config/discounts.js';
import { apiError } from '../../services/api.js';
import ProductForm from '../Shop/ProductForm.jsx';
import { Button, Card, Modal, Spinner } from '../../components/ui.jsx';

function displayPrice(value, currency) {
  return value == null ? 'Quote' : formatPrice(value, currency);
}

function Icon({ children, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CartIcon() {
  return (
    <Icon>
      <circle cx="9" cy="20" r="1.6" />
      <circle cx="18" cy="20" r="1.6" />
      <path d="M2.5 3.5h2.7l2.1 11.2a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 1.9-1.4l1.5-6.1H6.4" />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon size={16}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

function MinusIcon() {
  return (
    <Icon size={16}>
      <path d="M5 12h14" />
    </Icon>
  );
}

function RemoveIcon() {
  return (
    <Icon size={16}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

function EyeIcon() {
  return (
    <Icon size={16}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

const cartKeyOf = (productId, variantId) => `${productId}:${variantId ?? '_'}`;

export default function ProductsPage() {
  const { isAdmin } = useAuth();
  const { activeId, activePage } = usePages();
  const toast = useToast();
  const currency = activePage?.currency;
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState(null); // product being edited (null = add)
  const [busy, setBusy] = useState(false); // delete in flight
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState([]); // { key, productId, variantId, variantLabel, quantity }
  const [viewing, setViewing] = useState(null); // product shown in the quick-view modal
  const [viewSel, setViewSel] = useState({}); // chosen option values in the quick-view

  useEffect(() => {
    setCart([]);
    setCartOpen(false);
    setFormOpen(false);
    if (activeId == null) {
      setProducts([]);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    productsApi
      .list(activeId)
      .then((list) => live && setProducts(list))
      .catch((e) => live && toast.error(apiError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Active page's discounts — best-effort; a failure here shouldn't hide products.
  useEffect(() => {
    if (activeId == null) {
      setDiscounts([]);
      return undefined;
    }
    let live = true;
    discountsApi
      .list(activeId)
      .then((d) => live && setDiscounts(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [activeId]);

  // Quick-view: default each axis to its first value when a variable product opens.
  useEffect(() => {
    if (!viewing || !isVariable(viewing)) {
      setViewSel({});
      return;
    }
    const sel = {};
    for (const axis of viewing.options) sel[axis.name] = axis.values[0];
    setViewSel(sel);
  }, [viewing]);

  useEffect(() => {
    if (!cartOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setCartOpen(false);
    };
    const scroller = document.querySelector('.content') || document.body;
    const previousOverflow = scroller.style.overflow;
    scroller.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      scroller.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [cartOpen]);

  const cartItems = cart
    .map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return null;
      const variant = item.variantId != null ? (product.variants || []).find((v) => v.id === item.variantId) || null : null;
      const unitPrice = unitPriceOf(product, variant);
      const media = variant?.photoUrl || product.photoUrl || '';
      return { ...item, product, variant, unitPrice, media };
    })
    .filter(Boolean);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cartItems.reduce((sum, item) => sum + (item.unitPrice == null ? 0 : item.unitPrice * item.quantity), 0);
  const hasQuoteItems = cartItems.some((item) => item.unitPrice == null);
  const discountResult = evaluateDiscounts(
    cartItems.map((it) => ({ productId: it.productId, category: it.product.category, unitPrice: it.unitPrice, quantity: it.quantity })),
    discounts,
  );

  const addToCart = (product, variant = null) => {
    const variantId = variant?.id ?? null;
    const key = cartKeyOf(product.id, variantId);
    const label = variant ? variantLabel(variant.optionValues, product.options) : '';
    setCart((cur) => {
      const existing = cur.find((item) => item.key === key);
      if (existing) return cur.map((item) => (item.key === key ? { ...item, quantity: item.quantity + 1 } : item));
      return [...cur, { key, productId: product.id, variantId, variantLabel: label, quantity: 1 }];
    });
    toast.success(`${product.name}${label ? ` (${label})` : ''} added to cart`);
  };

  // Tile quick-add: variable products open the quick-view so a variant can be chosen.
  const onTileAdd = (product) => {
    if (isVariable(product)) setViewing(product);
    else addToCart(product, null);
  };

  const changeCartQty = (key, delta) => {
    setCart((cur) =>
      cur
        .map((item) => (item.key === key ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0),
    );
  };

  const removeFromCart = (key) => setCart((cur) => cur.filter((item) => item.key !== key));
  const removeProductFromCart = (productId) => setCart((cur) => cur.filter((item) => item.productId !== productId));
  const clearCart = () => setCart([]);

  const startAdd = () => {
    if (!isAdmin) return;
    setEditProduct(null);
    setFormOpen(true);
  };
  const startEdit = (p) => {
    if (!isAdmin) return;
    setEditProduct(p);
    setFormOpen(true);
  };
  const onSaved = (saved, wasNew) => {
    setProducts((cur) => (wasNew ? [saved, ...cur] : cur.map((p) => (p.id === saved.id ? saved : p))));
    // A product's variant ids change on save; drop any now-stale cart lines for it.
    removeProductFromCart(saved.id);
    setFormOpen(false);
    setEditProduct(null);
  };

  const del = async (p) => {
    if (!isAdmin) return toast.error('Only admins can change products.');
    if (busy) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await productsApi.remove(p.id);
      setProducts((cur) => cur.filter((x) => x.id !== p.id));
      removeProductFromCart(p.id);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  // Quick-view derived values for the selected combination.
  const viewVariant = viewing && isVariable(viewing) ? findVariant(viewing, viewSel) : null;
  const viewPrice = viewing
    ? isVariable(viewing)
      ? viewVariant
        ? displayPrice(viewVariant.price, currency)
        : priceRangeLabel(viewing, currency)
      : displayPrice(viewing.basePrice, currency)
    : '';
  const viewMedia = viewVariant?.photoUrl || viewing?.photoUrl || '';
  const viewAddDisabled = viewing ? isVariable(viewing) && (!viewVariant || viewVariant.active === false) : false;

  return (
    <section className="products-page">
      <div className="row row--between products-page__head" style={{ gap: 12 }}>
        <div>
          <h1 className="products-page__title">Products</h1>
          <p className="text-sm text-muted">
            Products for {activePage?.account_name ? <strong>{activePage.account_name}</strong> : 'this page'}
          </p>
        </div>
        <div className="products-page__actions">
          <button
            type="button"
            className="cart-button"
            onClick={() => setCartOpen(true)}
            aria-label={`Open cart with ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
          >
            <CartIcon />
            <span>Cart</span>
            {cartCount > 0 && <span className="cart-button__count">{cartCount}</span>}
          </button>
          {isAdmin && !formOpen && activeId != null && (
            <Button size="sm" onClick={startAdd}>
              Add product
            </Button>
          )}
        </div>
      </div>

      {activeId == null ? (
        <Card className="card--pad">
          <p className="text-sm text-muted">
            {isAdmin ? 'Select a page from the sidebar to manage its products.' : 'Select a page from the sidebar to view its products.'}
          </p>
        </Card>
      ) : formOpen ? (
        <ProductForm
          product={editProduct}
          accountId={activeId}
          vaultFolderId={activePage?.vault_folder_id ?? null}
          onClose={() => {
            setFormOpen(false);
            setEditProduct(null);
          }}
          onSaved={onSaved}
        />
      ) : loading ? (
        <Spinner label="Loading products…" />
      ) : products.length === 0 ? (
        <Card className="card--pad">
          <p className="text-sm text-muted">
            {isAdmin ? 'No products yet. Add one to start sharing it in chats.' : 'No products have been added yet.'}
          </p>
        </Card>
      ) : (
        <div className="products-grid">
          {products.map((p) => (
            <Card key={p.id} className="product-tile">
              <div className="product-tile__media">
                {p.photoUrl ? <img src={p.photoUrl} alt="" loading="lazy" /> : <span className="product-tile__noimg">No photo</span>}
                <div className="product-tile__hover">
                  <button
                    type="button"
                    className="product-tile__iconbtn"
                    onClick={() => setViewing(p)}
                    aria-label={`View ${p.name}`}
                    title="View"
                  >
                    <EyeIcon />
                  </button>
                  <button
                    type="button"
                    className="product-tile__iconbtn"
                    onClick={() => onTileAdd(p)}
                    aria-label={`Add ${p.name} to cart`}
                    title={isVariable(p) ? 'Choose a variant' : 'Add to cart'}
                  >
                    <CartIcon />
                  </button>
                </div>
              </div>
              <div className="product-tile__body">
                <div className="product-tile__name" title={p.name}>{p.name}</div>
                <div className="product-tile__price">{priceRangeLabel(p, currency)}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!viewing} title={viewing?.name || ''} onClose={() => setViewing(null)} className="modal--product-view">
        {viewing && (
          <div className="product-view">
            <div className="product-view__media">
              {viewMedia ? <img src={viewMedia} alt="" /> : <span>No photo</span>}
            </div>
            <div className="product-view__price">{viewPrice}</div>
            {viewing.category && <div className="product-view__cat">{viewing.category}</div>}
            {viewing.description && <p className="product-view__desc">{viewing.description}</p>}

            {isVariable(viewing) && (
              <div className="product-view__variants">
                {viewing.options.map((axis) => (
                  <label className="product-view__axis" key={axis.name}>
                    <span className="field__label">{axis.name}</span>
                    <select
                      className="select"
                      value={viewSel[axis.name] ?? ''}
                      onChange={(e) => setViewSel((s) => ({ ...s, [axis.name]: e.target.value }))}
                    >
                      {axis.values.map((val) => (
                        <option key={val} value={val}>{val}</option>
                      ))}
                    </select>
                  </label>
                ))}
                {viewVariant && viewVariant.active === false && (
                  <p className="text-sm text-muted">This combination is unavailable.</p>
                )}
              </div>
            )}

            {viewing.tags?.length > 0 && (
              <div className="product-view__tags">
                {viewing.tags.map((t) => (
                  <span key={t} className="product-tile__tag">{t}</span>
                ))}
              </div>
            )}
            <div className="product-view__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={viewAddDisabled}
                onClick={() => {
                  addToCart(viewing, viewVariant);
                  setViewing(null);
                }}
              >
                <CartIcon /> Add to cart
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    const v = viewing;
                    setViewing(null);
                    startEdit(v);
                  }}
                >
                  Edit
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn--ghost product-view__del"
                  onClick={() => {
                    const v = viewing;
                    setViewing(null);
                    del(v);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {cartOpen && (
        <div className="product-cart" role="dialog" aria-modal="true" aria-label="Cart">
          <button type="button" className="product-cart__scrim" aria-label="Close cart" onClick={() => setCartOpen(false)} />
          <aside className="product-cart__panel">
            <div className="product-cart__head">
              <div>
                <h2 className="product-cart__title">Cart</h2>
                <p className="product-cart__sub">
                  {cartCount} {cartCount === 1 ? 'item' : 'items'}
                </p>
              </div>
              <button type="button" className="product-cart__close" onClick={() => setCartOpen(false)} aria-label="Close cart">
                <RemoveIcon />
              </button>
            </div>

            {cartItems.length === 0 ? (
              <div className="product-cart__empty">
                <CartIcon />
                <div className="product-cart__empty-title">Your cart is empty</div>
              </div>
            ) : (
              <>
                <div className="product-cart__list">
                  {cartItems.map((item) => {
                    const lineTotal = item.unitPrice == null ? null : item.unitPrice * item.quantity;
                    return (
                      <div className="product-cart__item" key={item.key}>
                        <div className="product-cart__media">
                          {item.media ? <img src={item.media} alt="" /> : <span>No photo</span>}
                        </div>
                        <div className="product-cart__item-body">
                          <div className="product-cart__item-top">
                            <div className="product-cart__item-name" title={item.product.name}>
                              {item.product.name}
                              {item.variantLabel && <span className="product-cart__item-variant"> · {item.variantLabel}</span>}
                            </div>
                            <button
                              type="button"
                              className="product-cart__remove"
                              onClick={() => removeFromCart(item.key)}
                              aria-label={`Remove ${item.product.name}`}
                            >
                              <RemoveIcon />
                            </button>
                          </div>
                          <div className="product-cart__item-price">{displayPrice(item.unitPrice, currency)}</div>
                          <div className="product-cart__item-foot">
                            <div className="product-cart__qty" aria-label={`${item.product.name} quantity`}>
                              <button type="button" onClick={() => changeCartQty(item.key, -1)} aria-label="Decrease quantity">
                                <MinusIcon />
                              </button>
                              <span>{item.quantity}</span>
                              <button type="button" onClick={() => changeCartQty(item.key, 1)} aria-label="Increase quantity">
                                <PlusIcon />
                              </button>
                            </div>
                            <div className="product-cart__line">{lineTotal == null ? 'Quote' : formatPrice(lineTotal, currency)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="product-cart__summary">
                  <div className="product-cart__summary-row">
                    <span>Subtotal</span>
                    <span>{formatPrice(cartSubtotal, currency)}</span>
                  </div>
                  {discountResult.applied.map((a) => (
                    <div className="product-cart__summary-row product-cart__summary-row--discount" key={a.id}>
                      <span title={a.name}>{a.name}</span>
                      <span>−{formatPrice(a.amount, currency)}</span>
                    </div>
                  ))}
                  <div className="product-cart__summary-row product-cart__summary-total">
                    <span>Total</span>
                    <strong>{formatPrice(discountResult.total, currency)}</strong>
                  </div>
                  {hasQuoteItems && <p className="product-cart__note">Quote items are not included in the subtotal.</p>}
                  <Button type="button" variant="ghost" size="sm" onClick={clearCart}>
                    Clear cart
                  </Button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
