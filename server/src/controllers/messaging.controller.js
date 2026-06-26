import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import { env } from '../config/env.js';
import * as service from '../services/messaging.service.js';
import * as analyticsService from '../services/messaging_analytics.service.js';
import * as ai from '../services/ai.service.js';
import { onMessagingEvent } from '../services/messaging.events.js';
import { resolveSession } from '../services/auth.service.js';
import { hasMessagingAccess } from '../config/modules.js';

// AI Agent threads are shared; Live Agent threads are scoped to their assigned
// user (the service filters by req.user). Writes pass the acting user.
export const list = asyncHandler(async (req, res) => {
  const conversations = await service.listConversations(req.user);
  sendSuccess(res, { conversations });
});

export const get = asyncHandler(async (req, res) => {
  const conversation = await service.getConversation(req.params.id, req.user);
  sendSuccess(res, { conversation });
});

export const send = asyncHandler(async (req, res) => {
  const result = await service.sendMessage(req.params.id, req.user, req.body || {});
  sendSuccess(res, result, 201);
});

export const seen = asyncHandler(async (req, res) => {
  const conversation = await service.markSeen(req.params.id, req.user);
  sendSuccess(res, { conversation });
});

export const takeover = asyncHandler(async (req, res) => {
  const conversation = await service.takeOver(req.params.id, req.user);
  sendSuccess(res, { conversation });
});

// Live Agent blocks the customer on this thread (drops their inbound + n8n).
export const block = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await service.blockConversation(req.params.id, req.user) });
});

// Unblock — Live Agent (human) only; works on AI-handled threads too.
export const unblock = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await service.unblockConversation(req.params.id, req.user) });
});

// Messaging feature flags the client needs (currently just the hand-back-to-AI
// affordance). Cheap, no DB — read on inbox load to decide whether to enable it.
export const config = asyncHandler(async (req, res) => {
  sendSuccess(res, { allowTransferToAi: env.allowTransferToAi });
});

// Live-agent (human) response metrics for one page — CRR / FRT / ART over the page's
// configured window. Read-only; page scope comes from ?accountId (pages are shared,
// so any messaging user may read a page's metrics). null metrics when no/invalid page.
export const analytics = asyncHandler(async (req, res) => {
  const metrics = await analyticsService.computeAgentMetrics(req.query.accountId);
  sendSuccess(res, { metrics });
});

// Composer "Enhance" — polish a draft reply via OpenAI (server-side, not n8n).
export const enhance = asyncHandler(async (req, res) => {
  sendSuccess(res, await ai.enhanceText((req.body || {}).text));
});

// Hand a Live Agent thread back to the AI agent (flag-gated; see service.returnToAi).
export const returnToAi = asyncHandler(async (req, res) => {
  const conversation = await service.returnToAi(req.params.id, req.user);
  sendSuccess(res, { conversation });
});

// ── Transfers ────────────────────────────────────────────────────────────────
export const agents = asyncHandler(async (req, res) => {
  sendSuccess(res, { agents: await service.listAgents(req.user) });
});

export const incomingTransfers = asyncHandler(async (req, res) => {
  sendSuccess(res, { transfers: await service.listIncomingTransfers(req.user) });
});

export const requestTransfer = asyncHandler(async (req, res) => {
  const transfer = await service.requestTransfer(req.params.id, req.user, (req.body || {}).toUserId);
  sendSuccess(res, { transfer }, 201);
});

export const acceptTransfer = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.acceptTransfer(req.params.id, req.user));
});

export const declineTransfer = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.declineTransfer(req.params.id, req.user));
});

export const cancelTransfer = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.cancelTransfer(req.params.id, req.user));
});

// Machine-only (service token): n8n delivers an incoming customer message (or an
// AI reply it generated). The service appends it to the thread — creating the
// thread if needed — and broadcasts over SSE so open inboxes update in real time.
export const inbound = asyncHandler(async (req, res) => {
  const result = await service.receiveInbound(req.body || {});
  sendSuccess(res, result, 201);
});

// Machine-only (service token): the AI agent's `search_catalog` tool. Page-scoped
// keyword lookup over products + reference answers via MySQL FULLTEXT.
// Body: { query, accountId, limit? } — accountId scopes to the page (required).
export const knowledge = asyncHandler(async (req, res) => {
  const { query: q, accountId, limit } = req.body || {};
  sendSuccess(res, await service.searchKnowledge(q, { accountId, limit }));
});

// Machine-only (service token): the AI agent's `get_page_info` tool. Returns the page's
// admin-filled Business profile (contact / location / hours) as a readable block.
// Body: { accountId } — scopes to the page (required).
export const pageInfo = asyncHandler(async (req, res) => {
  const { accountId } = req.body || {};
  sendSuccess(res, await service.getPageInfo({ accountId }));
});

// Machine-only (service token): the AI agent's `check_delivery_distance` tool. Driving
// distance/time from the page's shop to the customer's delivery address (via Geoapify).
// Body: { accountId, address } — accountId scopes to the page; address is the customer's.
export const deliveryDistance = asyncHandler(async (req, res) => {
  const { accountId, address } = req.body || {};
  sendSuccess(res, await service.getDeliveryDistance({ accountId, address }));
});

// Machine-only (service token): the AI agent's `send_media` tool. Finds matching
// media in the page's Vault folder and sends it to the customer; `count` (1–10)
// sends a whole set in one call (e.g. all packages), defaulting to 1.
// Body: { accountId, customerHandle, origin, query, count? }.
export const media = asyncHandler(async (req, res) => {
  const { accountId, customerHandle, origin, query, count } = req.body || {};
  sendSuccess(res, await service.sendVaultMedia({ accountId, customerHandle, origin, query, count }));
});

// Machine-only (service token): the AI agent's `create_order` tool. Saves the order
// details the AI gathered as a note, then routes the thread — straight to the least-
// busy ONLINE agent if anyone is online, otherwise into the Pool to be claimed later.
// Body: { accountId, customerHandle, origin, note }.
export const order = asyncHandler(async (req, res) => {
  const { accountId, customerHandle, origin, note } = req.body || {};
  sendSuccess(res, await service.createOrder({ accountId, customerHandle, origin, note }));
});

// Machine-only (service token): the AI agent's `block_customer` tool — block a customer
// by handle so their inbound stops reaching the inbox + n8n. Only a human can unblock.
// Body: { accountId, customerHandle, origin }.
export const blockCustomer = asyncHandler(async (req, res) => {
  const { accountId, customerHandle, origin } = req.body || {};
  sendSuccess(res, await service.blockByCustomer({ accountId, customerHandle, origin }));
});

// Machine-only (service token): n8n escalates a thread to a human. Pauses AI auto-reply
// for the thread and flags it for an agent to take over. Body: { accountId,
// customerHandle, origin, reason? }.
export const handoff = asyncHandler(async (req, res) => {
  const result = await service.handoffToLiveAgent(req.body || {});
  sendSuccess(res, result);
});

// Server-Sent Events stream of inbox changes (new messages, seen, take-over).
// EventSource can't send an Authorization header, so the JWT is passed as
// ?token=. Holds the connection open and forwards every messaging event.
export async function stream(req, res) {
  let user = null;
  try {
    const token = req.query.token;
    if (token) { const r = await resolveSession(token); user = r ? r.user : null; }
  } catch {
    user = null;
  }
  if (!user) {
    res.status(401).json({ success: false, message: 'unauthorized' });
    return;
  }
  if (!hasMessagingAccess(user)) {
    res.status(403).json({ success: false, message: 'forbidden' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  res.write(': connected\n\n');

  // Audience-scoped events (bound conversations, transfers) only reach the
  // targeted users; unscoped events (audience null) go to everyone.
  const unsubscribe = onMessagingEvent((event, audience) => {
    if (audience && !audience.includes(user.id)) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
