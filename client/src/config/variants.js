// Helpers for option-matrix product variants. A product's `options` is a list of
// axes ([{name, values:[...]}]); the cross-product of their values is the set of
// variant combinations. Each combination has its own price + photo (page_products
// variants). Keep `comboKey` IDENTICAL to the server's (page_products.service.js) so
// a saved variant's price/photo round-trips on edit.

import { formatPrice } from './currency.js';

// Axes that are actually usable (named, with at least one value).
function usableAxes(options) {
  return (options || []).filter(
    (axis) => axis && String(axis.name || '').trim() && Array.isArray(axis.values) && axis.values.length,
  );
}

export function isVariable(product) {
  return usableAxes(product?.options).length > 0;
}

// Canonical identity of a combination, in axis order: "Size=1L|Scent=Lemon".
export function comboKey(optionValues, options) {
  return usableAxes(options)
    .map((axis) => `${axis.name}=${optionValues[axis.name]}`)
    .join('|');
}

// Human label for a combination: "1L · Lemon".
export function variantLabel(optionValues, options) {
  return usableAxes(options)
    .map((axis) => optionValues[axis.name])
    .filter(Boolean)
    .join(' · ');
}

// Cross-product of every axis's values → an ordered list of optionValues objects.
// The last axis varies fastest (1L·Lemon, 1L·Lavender, 5L·Lemon, …).
export function generateCombinations(options) {
  const axes = usableAxes(options);
  if (!axes.length) return [];
  let combos = [{}];
  for (const axis of axes) {
    const next = [];
    for (const base of combos) {
      for (const value of axis.values) next.push({ ...base, [axis.name]: value });
    }
    combos = next;
  }
  return combos;
}

// Active variant prices (ignoring "quote" rows with no price).
function livePrices(product) {
  return (product?.variants || []).filter((v) => v.active && v.price != null).map((v) => v.price);
}

// Tile/drawer price label. Variable products show "from ₱min" (or a single price when
// all combos match); simple products show their base price; nothing priced → "Quote".
export function priceRangeLabel(product, currency) {
  if (!isVariable(product)) {
    return product?.basePrice == null ? 'Quote' : formatPrice(product.basePrice, currency);
  }
  const prices = livePrices(product);
  if (!prices.length) return product?.basePrice == null ? 'Quote' : formatPrice(product.basePrice, currency);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min, currency) : `from ${formatPrice(min, currency)}`;
}

// Find the variant matching a chosen set of option values.
export function findVariant(product, optionValues) {
  const key = comboKey(optionValues, product?.options);
  return (product?.variants || []).find((v) => v.comboKey === key) || null;
}

// The price to charge for a cart line: the variant's price, else the product's base.
export function unitPriceOf(product, variant) {
  if (variant && variant.price != null) return variant.price;
  return product?.basePrice ?? null;
}
