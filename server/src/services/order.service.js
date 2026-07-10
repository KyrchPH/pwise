import crypto from 'node:crypto';
import { query, getConnection } from '../config/db.js';
import { isAdminRole } from '../config/modules.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import * as pageDiscounts from './page_discounts.service.js';
import { evaluateDiscounts } from './discount_engine.js';
import { sendMail, mailEnabled } from './mail.service.js';
import { emitOrderEvent } from './order.events.js';

// Orders + agreements. An agreement is the immutable pre-order a staff member generates
// at checkout: a snapshot of the cart (items + applied discounts + SERVER-recomputed
// totals) and the customer's delivery details. It's shared via an unguessable token
// (public /agreement/:token), expires 30 min after creation, and — once the customer
// ticks the sworn-statement box and confirms — spawns a real `orders` row. Orders are
// owner-scoped (created_by); admins bypass. See discount_engine.js for the totals math.

const AGREEMENT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ORDER_STATUSES = ['pending', 'paid', 'processing', 'ready_for_pickup', 'shipped', 'out_for_delivery', 'completed', 'cancelled'];

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cleanText(value, max, { required = false, label = 'value' } = {}) {
  const s = String(value ?? '').trim();
  if (!s) {
    if (required) throw ApiError.badRequest(`${label} is required`);
    return null;
  }
  return s.slice(0, max);
}

function requireAccount(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('a valid page (accountId) is required');
  return id;
}

// Normalize the cart lines the client sends into the snapshot we persist. Trusts the unit
// prices from our own ProductsPage snapshot (the staff is authenticated); only the DISCOUNT
// math is recomputed from authoritative rules.
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw ApiError.badRequest('the cart has no items');
  return items.map((it) => {
    const quantity = Math.max(1, Math.trunc(Number(it.quantity) || 0));
    const unitPrice = it.unitPrice == null || it.unitPrice === '' ? null : money(it.unitPrice);
    const name = cleanText(it.name, 255, { required: true, label: 'a product name' });
    return {
      productId: it.productId == null ? null : Number(it.productId),
      variantId: it.variantId == null ? null : Number(it.variantId),
      name,
      variantLabel: cleanText(it.variantLabel, 255) || null,
      category: cleanText(it.category, 120) || null,
      media: typeof it.media === 'string' ? it.media.slice(0, 1024) : null,
      unitPrice,
      quantity,
      lineTotal: unitPrice == null ? null : money(unitPrice * quantity),
    };
  });
}

// Effective status accounting for lazy expiry: an 'active' agreement past its expiry is
// really 'expired'. Callers persist the transition when they see it.
function isExpired(row) {
  return row.status === 'active' && Date.now() > new Date(row.expires_at).getTime();
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value; // mysql2 already parsed the JSON column
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ---- Agreement shaping ------------------------------------------------------

// Full shape for the staff owner (checkout tab control panel).
function toOwnerAgreement(row) {
  const status = isExpired(row) ? 'expired' : row.status;
  return {
    id: Number(row.id),
    token: row.token,
    status,
    currency: row.currency,
    language: row.language,
    customerName: row.customer_name,
    deliveryAddress: row.delivery_address,
    contactNumber: row.contact_number,
    email: row.email || null,
    notes: row.notes || null,
    terms: row.terms || null,
    items: parseJson(row.items, []),
    discounts: parseJson(row.discounts, []),
    subtotal: Number(row.subtotal),
    totalDiscount: Number(row.total_discount),
    total: Number(row.total),
    expiresAt: row.expires_at,
    firstViewedAt: row.first_viewed_at,
    lastViewedAt: row.last_viewed_at,
    confirmedAt: row.confirmed_at,
    orderId: row.order_id ?? null,
    createdAt: row.created_at,
    emailEnabled: mailEnabled(),
  };
}

// Public shape for the customer viewer — no owner/internal fields.
function toPublicAgreement(row) {
  return {
    token: row.token,
    currency: row.currency,
    language: row.language,
    customerName: row.customer_name,
    deliveryAddress: row.delivery_address,
    contactNumber: row.contact_number,
    email: row.email || null,
    notes: row.notes || null,
    terms: row.terms || null,
    items: parseJson(row.items, []),
    discounts: parseJson(row.discounts, []),
    subtotal: Number(row.subtotal),
    totalDiscount: Number(row.total_discount),
    total: Number(row.total),
    expiresAt: row.expires_at,
  };
}

async function findByToken(token) {
  const rows = await query('SELECT * FROM order_agreements WHERE token = ? LIMIT 1', [String(token || '')]);
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM order_agreements WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

// ---- Create -----------------------------------------------------------------

export async function createAgreement({ actor = {}, accountId, currency, items, selectedDiscountIds = [], language, delivery = {}, conversationId = null } = {}) {
  const acc = requireAccount(accountId);
  const normItems = normalizeItems(items);

  // Optional attribution: when checkout is started from the inbox, bind the sale to
  // that conversation. Best-effort — only kept if the id is a real thread on THIS
  // page, so a stale/foreign id silently drops to NULL rather than blocking checkout.
  let convId = null;
  const cid = Number(conversationId);
  if (Number.isInteger(cid) && cid > 0) {
    const cRows = await query('SELECT id FROM conversations WHERE id = ? AND account_id = ? LIMIT 1', [cid, acc]);
    if (cRows.length) convId = cid;
  }

  const customerName = cleanText(delivery.customerName, 255, { required: true, label: 'full name' });
  const deliveryAddress = cleanText(delivery.deliveryAddress, 2000, { required: true, label: 'delivery address' });
  const contactNumber = cleanText(delivery.contactNumber, 60, { required: true, label: 'contact number' });
  const email = cleanText(delivery.email, 255);
  const notes = cleanText(delivery.notes, 2000);
  const lang = ['en', 'tl'].includes(String(language)) ? String(language) : 'en';
  const cur = cleanText(currency, 8) || 'PHP';

  // Recompute totals from the page's authoritative discount rules — never trust the
  // browser's numbers. Only the discounts the staff selected (by id) are in play.
  const selectedIds = new Set((selectedDiscountIds || []).map((x) => Number(x)).filter(Number.isFinite));
  const allRules = await pageDiscounts.list(acc);
  const selectedRules = allRules.filter((r) => r.active && selectedIds.has(Number(r.id)));
  const appliedCodes = selectedRules.filter((r) => r.code).map((r) => r.code);
  const lines = normItems.map((it) => ({ productId: it.productId, category: it.category, unitPrice: it.unitPrice, quantity: it.quantity }));
  const result = evaluateDiscounts(lines, selectedRules, { appliedCodes });

  const token = crypto.randomBytes(20).toString('hex'); // 40 hex chars
  const expiresAt = new Date(Date.now() + AGREEMENT_TTL_MS);

  // Snapshot the shop's current terms & conditions so the customer's immutable copy
  // shows the terms in force at generation time (later edits don't reach it).
  const paRows = await query('SELECT order_terms FROM platform_accounts WHERE id = ?', [acc]);
  const terms = paRows[0]?.order_terms || null;

  const res = await query(
    `INSERT INTO order_agreements
       (token, account_id, conversation_id, created_by, created_by_name, currency, customer_name, delivery_address,
        contact_number, email, notes, language, items, discounts, subtotal, total_discount, total,
        terms, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      token, acc, convId, actor.id ?? null, actor.name ?? null, cur, customerName, deliveryAddress,
      contactNumber, email, notes, lang, JSON.stringify(normItems), JSON.stringify(result.applied),
      result.subtotal, result.totalDiscount, result.total, terms, expiresAt,
    ],
  );
  const row = await findById(res.insertId);
  return toOwnerAgreement(row);
}

// ---- Owner (staff) reads ----------------------------------------------------

function assertOwner(row, actor) {
  if (!row) throw ApiError.notFound('agreement not found');
  if (!isAdminRole(actor?.role) && Number(row.created_by) !== Number(actor?.id)) {
    throw ApiError.forbidden('this agreement belongs to another user');
  }
}

export async function getAgreementForOwner(id, actor) {
  const row = await findById(id);
  assertOwner(row, actor);
  if (isExpired(row)) {
    await query('UPDATE order_agreements SET status = ? WHERE id = ? AND status = ?', ['expired', row.id, 'active']);
  }
  return toOwnerAgreement(row);
}

// ---- Public (customer) reads ------------------------------------------------

// Returns a discriminated payload the SPA renders directly:
//   { state: 'active',    agreement }   — show the doc + confirm box
//   { state: 'expired' | 'confirmed' | 'cancelled' } — show the matching end-state
export async function getPublicAgreement(token) {
  const row = await findByToken(token);
  if (!row) throw ApiError.notFound('This order link is not valid.');

  if (isExpired(row)) {
    await query('UPDATE order_agreements SET status = ? WHERE id = ? AND status = ?', ['expired', row.id, 'active']);
    return { state: 'expired' };
  }
  if (row.status !== 'active') return { state: row.status };

  // First open (and every open) stamps the view + pings the watching staff member.
  const now = new Date();
  await query(
    `UPDATE order_agreements
       SET first_viewed_at = COALESCE(first_viewed_at, ?), last_viewed_at = ?
     WHERE id = ?`,
    [now, now, row.id],
  );
  if (row.created_by) emitOrderEvent({ type: 'agreement:viewing', agreementId: Number(row.id), at: now.toISOString() }, [Number(row.created_by)]);
  return { state: 'active', agreement: toPublicAgreement(row) };
}

// Lightweight heartbeat while the customer keeps the page open.
export async function pingViewing(token) {
  const row = await findByToken(token);
  if (!row || row.status !== 'active' || isExpired(row)) return { ok: false };
  const now = new Date();
  await query('UPDATE order_agreements SET last_viewed_at = ? WHERE id = ?', [now, row.id]);
  if (row.created_by) emitOrderEvent({ type: 'agreement:viewing', agreementId: Number(row.id), at: now.toISOString() }, [Number(row.created_by)]);
  return { ok: true };
}

// ---- Confirm → create the order (transactional) -----------------------------

export async function confirmAgreement(token) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM order_agreements WHERE token = ? LIMIT 1 FOR UPDATE', [String(token || '')]);
    const row = rows[0];
    if (!row) throw ApiError.notFound('This order link is not valid.');
    if (row.status !== 'active') throw ApiError.conflict('This order has already been closed and cannot be confirmed again.');
    if (Date.now() > new Date(row.expires_at).getTime()) {
      await conn.query('UPDATE order_agreements SET status = ? WHERE id = ?', ['expired', row.id]);
      await conn.commit();
      throw new ApiError(410, 'This order agreement has expired. Please ask for a new one.');
    }

    const now = new Date();
    const [orderRes] = await conn.query(
      `INSERT INTO orders
         (agreement_id, account_id, conversation_id, created_by, created_by_name, currency, customer_name, delivery_address,
          contact_number, email, notes, subtotal, total_discount, total, status, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        row.id, row.account_id, row.conversation_id ?? null, row.created_by, row.created_by_name, row.currency, row.customer_name,
        row.delivery_address, row.contact_number, row.email, row.notes, row.subtotal, row.total_discount,
        row.total, now,
      ],
    );
    const orderId = orderRes.insertId;

    const items = parseJson(row.items, []);
    for (const it of items) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, name, variant_label, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, it.productId ?? null, it.name, it.variantLabel ?? null, it.unitPrice ?? null, it.quantity, it.lineTotal ?? null],
      );
    }
    const discounts = parseJson(row.discounts, []);
    for (const d of discounts) {
      await conn.query('INSERT INTO order_discounts (order_id, discount_id, name, amount) VALUES (?, ?, ?, ?)', [orderId, d.id ?? null, d.name, money(d.amount)]);
    }

    await conn.query('UPDATE order_agreements SET status = ?, confirmed_at = ?, order_id = ? WHERE id = ?', ['confirmed', now, orderId, row.id]);
    await conn.commit();

    if (row.created_by) emitOrderEvent({ type: 'agreement:confirmed', agreementId: Number(row.id), orderId: Number(orderId) }, [Number(row.created_by)]);
    return { orderId: Number(orderId) };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// ---- Share by email ---------------------------------------------------------

export async function sendAgreementEmail(id, actor) {
  const agreement = await getAgreementForOwner(id, actor); // owner/admin guard + shape
  if (!agreement.email) throw ApiError.badRequest('this order has no customer email — copy the link and send it via chat instead');
  if (agreement.status !== 'active') throw ApiError.badRequest('this agreement is no longer active');
  if (!mailEnabled()) throw new ApiError(503, 'email is not configured on the server — copy the link and send it via chat instead');

  const link = `${env.clientUrl}/agreement/${agreement.token}`;
  const subject = `Your order confirmation — ${agreement.customerName}`;
  const text = `Hi ${agreement.customerName},\n\nPlease review and confirm your order using the link below (valid for 30 minutes):\n${link}\n\nThank you.`;
  const html = `<p>Hi ${escapeHtml(agreement.customerName)},</p>
    <p>Please review and confirm your order using the link below. It is valid for 30 minutes:</p>
    <p><a href="${link}">${link}</a></p>
    <p>Thank you.</p>`;
  await sendMail({ to: agreement.email, subject, text, html });
  return { sent: true };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Orders (owner-scoped, admin bypass) ------------------------------------

function toOrderRow(r) {
  return {
    id: Number(r.id),
    accountId: r.account_id,
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name || null,
    currency: r.currency,
    customerName: r.customer_name,
    deliveryAddress: r.delivery_address,
    contactNumber: r.contact_number,
    email: r.email || null,
    notes: r.notes || null,
    subtotal: Number(r.subtotal),
    totalDiscount: Number(r.total_discount),
    total: Number(r.total),
    status: r.status,
    itemCount: r.item_count != null ? Number(r.item_count) : undefined,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listOrders({ actor = {}, accountId, status = null, ownerId = null } = {}) {
  const acc = requireAccount(accountId);
  const where = ['o.account_id = ?'];
  const params = [acc];
  // Owner scope: non-admins only ever see their own; admins may filter by a specific owner.
  if (!isAdminRole(actor.role)) {
    where.push('o.created_by = ?');
    params.push(actor.id);
  } else if (ownerId != null && ownerId !== '' && ownerId !== 'all') {
    where.push('o.created_by = ?');
    params.push(Number(ownerId));
  }
  if (status && ORDER_STATUSES.includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }
  const rows = await query(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o
      WHERE ${where.join(' AND ')}
      ORDER BY o.id DESC
      LIMIT 500`,
    params,
  );
  return rows.map(toOrderRow);
}

async function getOrderRowGuarded(id, actor) {
  const rows = await query('SELECT * FROM orders WHERE id = ? LIMIT 1', [id]);
  const row = rows[0];
  if (!row) throw ApiError.notFound('order not found');
  if (!isAdminRole(actor?.role) && Number(row.created_by) !== Number(actor?.id)) {
    throw ApiError.forbidden('this order belongs to another user');
  }
  return row;
}

export async function getOrder(id, actor) {
  const row = await getOrderRowGuarded(id, actor);
  const items = await query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [id]);
  const discounts = await query('SELECT * FROM order_discounts WHERE order_id = ? ORDER BY id ASC', [id]);
  return {
    ...toOrderRow(row),
    items: items.map((it) => ({
      id: Number(it.id),
      productId: it.product_id ?? null,
      name: it.name,
      variantLabel: it.variant_label || null,
      unitPrice: it.unit_price == null ? null : Number(it.unit_price),
      quantity: Number(it.quantity),
      lineTotal: it.line_total == null ? null : Number(it.line_total),
    })),
    discounts: discounts.map((d) => ({ id: Number(d.id), discountId: d.discount_id ?? null, name: d.name, amount: Number(d.amount) })),
  };
}

export async function updateOrderStatus(id, status, actor) {
  if (!ORDER_STATUSES.includes(status)) throw ApiError.badRequest('invalid order status');
  await getOrderRowGuarded(id, actor); // existence + owner/admin guard
  await query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
  return getOrder(id, actor);
}

export const ORDER_STATUS_LIST = ORDER_STATUSES;
