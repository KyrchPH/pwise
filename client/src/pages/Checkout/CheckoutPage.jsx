import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { evaluateDiscounts, summarizeRule } from '../../config/discounts.js';
import { formatPrice } from '../../config/currency.js';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import { createAgreement } from '../../services/orders.service.js';
import DeliveryForm from './DeliveryForm.jsx';
import AgreementPanel from './AgreementPanel.jsx';

// Standalone checkout, opened in a NEW TAB by the Shop cart's "Proceed to checkout". The
// cart can't cross tabs via React state, so ProductsPage snapshots the line items + the
// page's discount rules into localStorage under a one-time `ref` (passed in the URL) and
// empties itself. This page reads that snapshot and is fully self-contained — no API/auth
// calls — so it works even if the new tab isn't signed in. Discounts and the adjusted
// total live HERE, not in the cart.
//
// Discount model: the shopper picks discounts via the "Select discounts" drawer (search +
// filter over ALL of the shop's active discounts) or by typing a coupon code. Codeless
// ("automatic") discounts are pre-selected on open; coupons start off. A discount only
// actually lowers the price if the cart qualifies for it (min order, category, …).

const STORAGE_PREFIX = 'pwise:checkout:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // drop day-old snapshots so storage can't grow forever
const normCode = (c) => String(c || '').trim().toUpperCase();
const displayPrice = (value, currency) => (value == null ? 'Quote' : formatPrice(value, currency));

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'auto', label: 'Automatic' },
  { value: 'coupon', label: 'Coupons' },
];

function readCheckout(ref) {
  if (!ref) return null;
  try {
    const data = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${ref}`) || 'null');
    if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

// Best-effort cleanup of stale snapshots (this one included once it ages out).
function pruneOldCheckouts() {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      let createdAt = 0;
      try {
        createdAt = JSON.parse(localStorage.getItem(key) || 'null')?.createdAt || 0;
      } catch {
        createdAt = 0;
      }
      if (createdAt < cutoff) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — nothing to prune */
  }
}

function CartIcon({ size = 26 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.6" />
      <circle cx="18" cy="20" r="1.6" />
      <path d="M2.5 3.5h2.7l2.1 11.2a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 1.9-1.4l1.5-6.1H6.4" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function CheckoutPage() {
  const toast = useToast();
  // Read the snapshot once (the ref is fixed for this tab's lifetime).
  const [data] = useState(() => readCheckout(new URLSearchParams(window.location.search).get('ref')));
  // Selected discount ids drive the price. Codeless ("automatic") discounts are on by
  // default; coupons start off until picked in the drawer or entered by code.
  const [selectedIds, setSelectedIds] = useState(
    () => new Set((data?.discounts || []).filter((d) => d.active && !d.code).map((d) => d.id)),
  );
  const [codeInput, setCodeInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [placing, setPlacing] = useState(false);
  // Checkout is a 3-step flow in this tab: review → delivery details → agreement.
  const [step, setStep] = useState('review');
  const [agreement, setAgreement] = useState(null);

  useEffect(() => {
    document.title = 'Checkout · PWise';
    pruneOldCheckouts();
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const currency = data?.currency;
  const products = data?.products || [];
  const items = data?.items || [];
  const activeDiscounts = (data?.discounts || []).filter((d) => d.active);

  const lines = items.map((it) => ({ productId: it.productId, category: it.category, unitPrice: it.unitPrice, quantity: it.quantity }));
  const selectedDiscounts = activeDiscounts.filter((d) => selectedIds.has(d.id));
  const result = evaluateDiscounts(
    lines,
    selectedDiscounts,
    // Every selected coupon's code is "entered" so the engine's code-gate lets it through;
    // codeless discounts pass anyway. Qualification (min order, category…) still applies.
    { appliedCodes: selectedDiscounts.map((d) => d.code).filter(Boolean) },
  );
  const appliedDiscountIds = new Set(result.applied.map((a) => a.id));
  // A selected discount can be absent from `result.applied` for two very different
  // reasons: it doesn't QUALIFY for this cart (min order/category not met), or it qualifies
  // but a bigger non-stackable discount beat it. Evaluating it alone tells them apart so we
  // don't mislabel a perfectly valid discount as "not eligible".
  const qualifiesAlone = (d) => evaluateDiscounts(lines, [d], { appliedCodes: d.code ? [d.code] : [] }).applied.length > 0;
  const hasQuoteItems = items.some((it) => it.unitPrice == null);
  const itemCount = items.reduce((sum, it) => sum + it.quantity, 0);

  // Product-specific discounts (applies_to = matching_items — i.e. scoped to a product,
  // product+qty or category) come off those items directly. We show the discounted price ON
  // the item with the original struck through, fold it into the subtotal, and DON'T also list
  // it in the summary (that would double-count). Whole-order discounts stay as summary lines.
  const sameCategory = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const appliedAmountById = new Map(result.applied.map((a) => [a.id, a.amount]));
  const itemMatches = (d, it) => (d.scope === 'category' ? sameCategory(it.category, d.targetCategory) : it.productId === d.targetProductId);
  const perItemDiscount = items.map(() => 0);
  for (const d of selectedDiscounts) {
    const amount = appliedAmountById.get(d.id);
    if (!amount || d.appliesTo !== 'matching_items') continue; // only item-targeted discounts land on items
    const matchIdx = items.map((it, i) => (it.unitPrice != null && itemMatches(d, it) ? i : -1)).filter((i) => i >= 0);
    const base = matchIdx.reduce((s, i) => s + items[i].unitPrice * items[i].quantity, 0);
    if (base <= 0) continue;
    // Split the discount across the matching lines in proportion to their value.
    for (const i of matchIdx) perItemDiscount[i] += amount * ((items[i].unitPrice * items[i].quantity) / base);
  }
  const itemDiscountTotal = perItemDiscount.reduce((s, v) => s + v, 0);
  const itemSpecificIds = new Set(selectedDiscounts.filter((d) => d.appliesTo === 'matching_items').map((d) => d.id));
  const summaryDiscounts = result.applied.filter((a) => !itemSpecificIds.has(a.id)); // whole-order discounts only
  const displaySubtotal = result.subtotal - itemDiscountTotal;

  const valueBadge = (d) => (d.valueType === 'percent' ? `${d.value}% off` : `${formatPrice(d.value, currency)} off`);

  const toggleDiscount = (id) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addCode = (raw) => {
    const code = normCode(raw);
    if (!code) return;
    const match = activeDiscounts.find((d) => normCode(d.code) === code);
    if (!match) {
      toast.error('That code isn’t valid for this shop.');
      return;
    }
    setSelectedIds((cur) => new Set(cur).add(match.id));
    setCodeInput('');
    if (appliedDiscountIds.has(match.id)) toast.success(`${match.name} is already applied`);
    else toast.success(`Applied ${match.name}`);
  };

  // "Place order" doesn't create anything yet — it moves to the delivery-details step.
  const placeOrder = () => setStep('details');

  // Submit the delivery form → the server snapshots the cart, recomputes the totals from
  // the page's real discount rules, and returns the immutable agreement to share.
  const submitDetails = async (delivery) => {
    setPlacing(true);
    try {
      const created = await createAgreement({
        accountId: data.accountId,
        currency,
        items: items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          name: it.name,
          variantLabel: it.variantLabel,
          category: it.category,
          media: it.media,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
        })),
        selectedDiscountIds: [...selectedIds],
        language: delivery.language,
        delivery: {
          customerName: delivery.customerName,
          deliveryAddress: delivery.deliveryAddress,
          contactNumber: delivery.contactNumber,
          email: delivery.email,
          notes: delivery.notes,
        },
      });
      setAgreement(created);
      setStep('agreement');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setPlacing(false);
    }
  };

  // Drawer list: active discounts matched against the search + the All/Automatic/Coupons filter.
  const q = search.trim().toLowerCase();
  const drawerList = activeDiscounts.filter((d) => {
    if (filter === 'auto' && d.code) return false;
    if (filter === 'coupon' && !d.code) return false;
    if (!q) return true;
    return (d.name || '').toLowerCase().includes(q) || (d.code || '').toLowerCase().includes(q);
  });

  if (!data) {
    return (
      <div className="checkout-page">
        <div className="checkout checkout--empty">
          <CartIcon />
          <h1 className="checkout__empty-title">Nothing to check out</h1>
          <p className="checkout__empty-sub">
            This checkout link has expired or was already used. Head back to the shop and add items to your cart again.
          </p>
          <Link to="/shop/products" className="btn btn--primary btn--flat">Back to shop</Link>
        </div>
      </div>
    );
  }

  // Step 2: delivery details.
  if (step === 'details') {
    return (
      <div className="checkout-page">
        <div className="checkout checkout--narrow">
          <header className="checkout__head">
            <span className="checkout__head-icon"><CartIcon /></span>
            <div>
              <h1 className="checkout__title">Place order</h1>
              <p className="checkout__sub">Step 2 of 3 · Delivery details</p>
            </div>
          </header>
          <DeliveryForm onSubmit={submitDetails} onBack={() => setStep('review')} submitting={placing} />
        </div>
      </div>
    );
  }

  // Step 3: the generated agreement + staff share/tracking controls.
  if (step === 'agreement' && agreement) {
    return (
      <div className="checkout-page">
        <div className="checkout checkout--narrow">
          <header className="checkout__head">
            <span className="checkout__head-icon"><CartIcon /></span>
            <div>
              <h1 className="checkout__title">Order agreement</h1>
              <p className="checkout__sub">Share this with the customer to review and confirm.</p>
            </div>
          </header>
          <AgreementPanel agreement={agreement} />
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <div className="checkout">
        <header className="checkout__head">
          <span className="checkout__head-icon"><CartIcon /></span>
          <div>
            <h1 className="checkout__title">Checkout</h1>
            <p className="checkout__sub">{itemCount} {itemCount === 1 ? 'item' : 'items'} in your order</p>
          </div>
        </header>

        <div className="checkout__grid">
          <section className="checkout__items" aria-label="Order items">
            {items.map((it, i) => {
              const lineTotal = it.unitPrice == null ? null : it.unitPrice * it.quantity;
              // A product-specific discount landed on this line → show the reduced price with
              // the original struck through below it.
              const discounted = lineTotal != null && perItemDiscount[i] > 0.005;
              const newLineTotal = discounted ? Math.max(0, lineTotal - perItemDiscount[i]) : lineTotal;
              return (
                <div className="checkout__item" key={`${it.productId}:${it.variantId ?? '_'}:${i}`}>
                  <div className="checkout__item-media">
                    {it.media ? <img src={it.media} alt="" /> : <CartIcon size={22} />}
                  </div>
                  <div className="checkout__item-body">
                    <div className="checkout__item-name" title={it.name}>
                      {it.name}
                      {it.variantLabel && <span className="checkout__item-variant"> · {it.variantLabel}</span>}
                    </div>
                    <div className="checkout__item-unit">
                      {displayPrice(it.unitPrice, currency)} × {it.quantity}
                    </div>
                  </div>
                  <div className="checkout__item-line">
                    {lineTotal == null ? (
                      'Quote'
                    ) : discounted ? (
                      <>
                        <span className="checkout__item-line-now">{formatPrice(newLineTotal, currency)}</span>
                        <span className="checkout__item-line-was">{formatPrice(lineTotal, currency)}</span>
                      </>
                    ) : (
                      formatPrice(lineTotal, currency)
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <aside className="checkout__aside">
            <div className="checkout__panel">
              <div className="checkout__panel-title">Discounts</div>
              <form
                className="cart-code"
                onSubmit={(event) => {
                  event.preventDefault();
                  addCode(codeInput);
                }}
              >
                <input
                  className="input cart-code__input"
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  placeholder="Enter a discount code"
                  aria-label="Discount code"
                />
                <button type="submit" className="btn btn--subtle cart-code__apply" disabled={!codeInput.trim()}>
                  Apply
                </button>
              </form>

              <button
                type="button"
                className="checkout__select-btn"
                onClick={() => setDrawerOpen(true)}
                disabled={activeDiscounts.length === 0}
              >
                <TagIcon />
                <span className="checkout__select-label">{activeDiscounts.length === 0 ? 'No discounts available' : 'Select discounts'}</span>
                {selectedDiscounts.length > 0 && <span className="checkout__select-count">{selectedDiscounts.length}</span>}
              </button>
            </div>

            <div className="checkout__panel checkout__summary">
              <div className="checkout__summary-row">
                <span>Subtotal</span>
                <span>{formatPrice(displaySubtotal, currency)}</span>
              </div>
              {summaryDiscounts.map((a) => (
                <div className="checkout__summary-row checkout__summary-row--discount" key={a.id}>
                  <span title={a.name}>{a.name}</span>
                  <span>−{formatPrice(a.amount, currency)}</span>
                </div>
              ))}
              <div className="checkout__summary-row checkout__summary-total">
                <span>Total</span>
                <strong>{formatPrice(result.total, currency)}</strong>
              </div>
              {hasQuoteItems && <p className="checkout__note">Quote items are priced separately and not included in the total.</p>}
              <button type="button" className="btn btn--primary btn--block btn--flat checkout__place" onClick={placeOrder} disabled={placing}>
                Place order
              </button>
              <Link to="/shop/products" className="checkout__back">Back to shop</Link>
            </div>
          </aside>
        </div>
      </div>

      {drawerOpen && (
        <div className="disc-drawer" role="dialog" aria-modal="true" aria-label="Select discounts">
          <button type="button" className="disc-drawer__scrim" aria-label="Close" onClick={() => setDrawerOpen(false)} />
          <aside className="disc-drawer__panel">
            <header className="disc-drawer__head">
              <div>
                <h2 className="disc-drawer__title">Select discounts</h2>
                <p className="disc-drawer__sub">{selectedDiscounts.length} of {activeDiscounts.length} selected</p>
              </div>
              <button type="button" className="disc-drawer__close" onClick={() => setDrawerOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </header>

            <div className="disc-drawer__controls">
              <div className="disc-drawer__search">
                <SearchIcon />
                <input
                  className="disc-drawer__search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search discounts…"
                  aria-label="Search discounts"
                />
              </div>
              <div className="disc-drawer__filters" role="tablist" aria-label="Filter discounts">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.value}
                    className={`disc-drawer__filter${filter === f.value ? ' is-active' : ''}`}
                    onClick={() => setFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="disc-drawer__list">
              {drawerList.length === 0 ? (
                <p className="disc-drawer__empty">
                  {activeDiscounts.length === 0 ? 'This shop has no discounts yet.' : 'No discounts match your search.'}
                </p>
              ) : (
                drawerList.map((d) => {
                  const on = selectedIds.has(d.id);
                  // Only compute a note when it's selected but not currently reducing the total.
                  const note = on && !appliedDiscountIds.has(d.id)
                    ? qualifiesAlone(d)
                      ? { muted: true, text: 'A bigger discount is applied' }
                      : { muted: false, text: 'Doesn’t apply to this cart yet' }
                    : null;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className={`disc-row${on ? ' is-on' : ''}`}
                      onClick={() => toggleDiscount(d.id)}
                      aria-pressed={on}
                    >
                      <span className="disc-row__check" aria-hidden="true">{on ? '✓' : ''}</span>
                      <span className="disc-row__body">
                        <span className="disc-row__name">{d.name}</span>
                        <span className="disc-row__sub">{summarizeRule(d, { products, currency })}</span>
                        {note && <span className={note.muted ? 'disc-row__muted' : 'disc-row__warn'}>{note.text}</span>}
                      </span>
                      <span className="disc-row__meta">
                        <span className="disc-row__value">{valueBadge(d)}</span>
                        {d.code ? <span className="disc-row__code">{d.code}</span> : <span className="disc-row__auto">Auto</span>}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <footer className="disc-drawer__foot">
              <button type="button" className="btn btn--primary btn--block btn--flat" onClick={() => setDrawerOpen(false)}>
                Done
              </button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}
