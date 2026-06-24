// Discount rules engine — pure functions shared by the Discounts page (rule summaries)
// and the cart (live evaluation). No DOM/state, so Orders can reuse evaluateDiscounts
// server-side later. Discount objects use the camelCase shape returned by the API
// (server/src/services/page_discounts.service.js).

import { formatPrice } from './currency.js';

const SCOPE_LABELS = {
  all: 'Whole order',
  category: 'By category',
  product: 'Specific product',
  cart_item_count: 'Total items in cart',
  product_qty: 'Specific product quantity',
  min_order_amount: 'Minimum order amount',
};

export const SCOPE_OPTIONS = [
  { value: 'all', label: 'Everything (whole order)' },
  { value: 'category', label: 'A specific category' },
  { value: 'product', label: 'A specific product' },
  { value: 'cart_item_count', label: 'Total number of items in the cart' },
  { value: 'product_qty', label: 'A specific product + quantity' },
  { value: 'min_order_amount', label: 'Minimum order amount' },
];

export function scopeLabel(scope) {
  return SCOPE_LABELS[scope] || scope;
}

function sameCategory(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function productName(products, id) {
  return products?.find((p) => p.id === id)?.name || 'a product';
}

// Human-readable one-liner for a discount card.
export function summarizeRule(discount, { products = [], currency } = {}) {
  const valuePart =
    discount.valueType === 'percent'
      ? `${discount.value}%${discount.percentCap != null ? ` (cap ${formatPrice(discount.percentCap, currency)})` : ''}`
      : formatPrice(discount.value, currency);

  let scopePart;
  switch (discount.scope) {
    case 'category':
      scopePart = `on ${discount.targetCategory || 'a category'}`;
      break;
    case 'product':
      scopePart = `on ${productName(products, discount.targetProductId)}`;
      break;
    case 'cart_item_count':
      scopePart = `when the cart has ${discount.thresholdQty}+ items`;
      break;
    case 'product_qty':
      scopePart = `when ${discount.thresholdQty}+ of ${productName(products, discount.targetProductId)} are in the cart`;
      break;
    case 'min_order_amount':
      scopePart = `on orders over ${formatPrice(discount.minAmount, currency)}`;
      break;
    case 'all':
    default:
      scopePart = 'on the whole order';
  }

  const matchingOnly =
    discount.appliesTo === 'matching_items' && ['category', 'product', 'product_qty'].includes(discount.scope);
  return `${valuePart} off ${scopePart}${matchingOnly ? ' (matching items only)' : ''}`;
}

// Money saved by one discount on a given base amount (respecting fixed/percent + cap).
function amountFor(discount, base) {
  if (base <= 0) return 0;
  if (discount.valueType === 'fixed') return Math.min(discount.value, base);
  let amount = base * (Number(discount.value) / 100);
  if (discount.percentCap != null) amount = Math.min(amount, discount.percentCap);
  return Math.min(amount, base);
}

function withinSchedule(discount, now) {
  const t = now.getTime();
  if (discount.startsAt && new Date(discount.startsAt).getTime() > t) return false;
  if (discount.endsAt && new Date(discount.endsAt).getTime() < t) return false;
  return true;
}

function qualifies(discount, ctx) {
  switch (discount.scope) {
    case 'all':
      return ctx.subtotal > 0;
    case 'category':
      return ctx.lines.some((l) => sameCategory(l.category, discount.targetCategory));
    case 'product':
      return ctx.lines.some((l) => l.productId === discount.targetProductId);
    case 'cart_item_count':
      return ctx.totalQty >= (discount.thresholdQty || 0);
    case 'product_qty':
      return (ctx.qtyByProduct.get(discount.targetProductId) || 0) >= (discount.thresholdQty || 0);
    case 'min_order_amount':
      return ctx.subtotal >= (discount.minAmount || 0);
    default:
      return false;
  }
}

// The amount the discount applies against: the whole subtotal, or just the qualifying
// items when applies_to = matching_items.
function baseFor(discount, ctx) {
  if (discount.appliesTo === 'matching_items') {
    if (discount.scope === 'category') {
      return ctx.lines.filter((l) => sameCategory(l.category, discount.targetCategory)).reduce((s, l) => s + l.lineTotal, 0);
    }
    if (discount.scope === 'product' || discount.scope === 'product_qty') {
      return ctx.lines.filter((l) => l.productId === discount.targetProductId).reduce((s, l) => s + l.lineTotal, 0);
    }
  }
  return ctx.subtotal;
}

/**
 * Evaluate a cart against a page's discounts.
 * @param lines [{ productId, category, unitPrice (number|null), quantity }]
 * @param discounts the page's discount rules (camelCase from the API)
 * @param now Date to test schedule windows against (defaults to current time)
 * @returns { applied: [{id,name,amount}], totalDiscount, subtotal, total }
 */
export function evaluateDiscounts(lines, discounts, now = new Date()) {
  const norm = (lines || []).map((l) => {
    const unit = l.unitPrice == null ? 0 : Number(l.unitPrice);
    const qty = Number(l.quantity) || 0;
    return { productId: l.productId, category: l.category, unitPrice: unit, quantity: qty, lineTotal: unit * qty };
  });
  const subtotal = norm.reduce((s, l) => s + l.lineTotal, 0);
  const totalQty = norm.reduce((s, l) => s + l.quantity, 0);
  const qtyByProduct = new Map();
  for (const l of norm) qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) || 0) + l.quantity);
  const ctx = { lines: norm, subtotal, totalQty, qtyByProduct };

  const candidates = [];
  for (const d of discounts || []) {
    if (!d.active) continue;
    if (!(Number(d.value) > 0)) continue;
    if (!withinSchedule(d, now)) continue;
    if (!qualifies(d, ctx)) continue;
    const amount = amountFor(d, baseFor(d, ctx));
    if (amount > 0) candidates.push({ id: d.id, name: d.name, amount, stackable: !!d.stackable });
  }

  // Best single + opt-in stacking: only the largest non-stackable rule applies, plus
  // every stackable rule on top.
  const stackable = candidates.filter((c) => c.stackable);
  const nonStackable = candidates.filter((c) => !c.stackable);
  const bestNonStackable = nonStackable.reduce((best, c) => (!best || c.amount > best.amount ? c : best), null);
  const applied = [...(bestNonStackable ? [bestNonStackable] : []), ...stackable].sort((a, b) => b.amount - a.amount);

  const rawDiscount = applied.reduce((s, a) => s + a.amount, 0);
  const totalDiscount = Math.min(rawDiscount, subtotal);
  return {
    applied: applied.map(({ id, name, amount }) => ({ id, name, amount })),
    totalDiscount,
    subtotal,
    total: Math.max(0, subtotal - totalDiscount),
  };
}
