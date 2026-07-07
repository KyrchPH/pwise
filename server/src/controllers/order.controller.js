import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/order.service.js';
import { onOrderEvent } from '../services/order.events.js';
import { resolveSession } from '../services/auth.service.js';

// Shop → Orders + the checkout agreement flow. Authed (JWT) handlers below; the public
// customer-facing token handlers live in public_agreements.routes.js but call the same
// service. `stream` is SSE (auth via ?token=, like the messaging stream).

// ---- Authed: agreements (staff) --------------------------------------------
export const createAgreement = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const agreement = await service.createAgreement({
    actor: req.user,
    accountId: b.accountId,
    currency: b.currency,
    items: b.items,
    selectedDiscountIds: b.selectedDiscountIds,
    language: b.language,
    delivery: b.delivery || {},
  });
  sendSuccess(res, { agreement }, 201);
});

export const getAgreement = asyncHandler(async (req, res) => {
  sendSuccess(res, { agreement: await service.getAgreementForOwner(req.params.id, req.user) });
});

export const emailAgreement = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.sendAgreementEmail(req.params.id, req.user));
});

// SSE: the checkout tab watches its agreement for "customer viewing" + "confirmed".
export async function stream(req, res) {
  let user = null;
  try {
    const token = req.query.token;
    if (token) {
      const r = await resolveSession(token);
      user = r ? r.user : null;
    }
  } catch {
    user = null;
  }
  if (!user) {
    res.status(401).json({ success: false, message: 'unauthorized' });
    return;
  }
  const agreementId = Number(req.params.id);
  try {
    await service.getAgreementForOwner(agreementId, user); // owner/admin guard (throws 403/404)
  } catch (err) {
    res.status(err?.statusCode || 403).json({ success: false, message: err?.message || 'forbidden' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  res.write(': connected\n\n');

  const unsubscribe = onOrderEvent((event, audience) => {
    if (audience && !audience.includes(user.id)) return;
    if (Number(event.agreementId) !== agreementId) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

// ---- Authed: orders (owner-scoped, admin bypass) ---------------------------
export const listOrders = asyncHandler(async (req, res) => {
  const orders = await service.listOrders({
    actor: req.user,
    accountId: req.query.accountId,
    status: req.query.status || null,
    ownerId: req.query.ownerId || null,
  });
  sendSuccess(res, { orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  sendSuccess(res, { order: await service.getOrder(req.params.id, req.user) });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  sendSuccess(res, { order: await service.updateOrderStatus(req.params.id, (req.body || {}).status, req.user) });
});

// ---- Public: token handlers (no auth) --------------------------------------
export const publicGet = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getPublicAgreement(req.params.token));
});

export const publicPing = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.pingViewing(req.params.token));
});

export const publicConfirm = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.confirmAgreement(req.params.token), 201);
});
