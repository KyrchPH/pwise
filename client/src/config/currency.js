// Per-page currency. Stored on the page as an ISO 4217 code; defaults to PHP (Peso).
// Used to format product prices across the app (Products page, the chat Products
// drawer, and dropped product cards).

export const DEFAULT_CURRENCY = 'PHP';

// The options offered in the page-settings dropdown.
export const CURRENCIES = [
  { code: 'PHP', label: 'Philippine Peso (₱)' },
  { code: 'USD', label: 'US Dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British Pound (£)' },
  { code: 'JPY', label: 'Japanese Yen (¥)' },
  { code: 'AUD', label: 'Australian Dollar (A$)' },
  { code: 'CAD', label: 'Canadian Dollar (C$)' },
  { code: 'SGD', label: 'Singapore Dollar (S$)' },
  { code: 'MYR', label: 'Malaysian Ringgit (RM)' },
  { code: 'IDR', label: 'Indonesian Rupiah (Rp)' },
  { code: 'THB', label: 'Thai Baht (฿)' },
  { code: 'VND', label: 'Vietnamese Dong (₫)' },
  { code: 'INR', label: 'Indian Rupee (₹)' },
  { code: 'HKD', label: 'Hong Kong Dollar (HK$)' },
  { code: 'CNY', label: 'Chinese Yuan (¥)' },
  { code: 'AED', label: 'UAE Dirham (AED)' },
];

const CODES = new Set(CURRENCIES.map((c) => c.code));

export function normalizeCurrency(code) {
  const c = String(code || '').trim().toUpperCase();
  return CODES.has(c) ? c : DEFAULT_CURRENCY;
}

// Format a numeric price with the page's currency symbol. Whole amounts show no
// decimals (₱455), fractional ones up to two (₱455.50). Falls back to a plain number
// if Intl can't handle the code.
export function formatPrice(value, currency = DEFAULT_CURRENCY) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  try {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency: normalizeCurrency(currency),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}
