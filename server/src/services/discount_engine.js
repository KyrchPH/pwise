// Server-side discount evaluation — a faithful port of the pure cart engine in
// client/src/config/discounts.js (evaluateDiscounts + its helpers), minus the currency
// formatting (only used there for rule summaries). Kept in sync with the client so the
// agreement's totals are authoritative: the browser's snapshot totals are display-only;
// the server ALWAYS recomputes from the page's real discount rules before persisting an
// agreement. Discount objects use the camelCase shape returned by page_discounts.service
// (valueType, percentCap, appliesTo, targetCategory, thresholdQty, minAmount, startsAt,
// endsAt, code, stackable).

function sameCategory(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
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
 * Evaluate a cart against a page's discounts. Mirrors the client engine exactly.
 * @param lines [{ productId, category, unitPrice (number|null), quantity }]
 * @param discounts the page's discount rules (camelCase from page_discounts.service)
 * @param options.appliedCodes coupon codes the shopper entered/selected (case-insensitive).
 * @param options.now Date to test schedule windows against (defaults to now)
 * @returns { applied: [{id,name,amount}], totalDiscount, subtotal, total }
 */
export function evaluateDiscounts(lines, discounts, { appliedCodes = [], now = new Date() } = {}) {
  const codes = new Set((appliedCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean));
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
    // A coupon (has a code) only applies when the shopper entered/selected its code;
    // a codeless discount auto-applies.
    if (d.code && !codes.has(String(d.code).trim().toUpperCase())) continue;
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
    applied: applied.map(({ id, name, amount }) => ({ id, name, amount: Math.round(amount * 100) / 100 })),
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round(Math.max(0, subtotal - totalDiscount) * 100) / 100,
  };
}

export default { evaluateDiscounts };
