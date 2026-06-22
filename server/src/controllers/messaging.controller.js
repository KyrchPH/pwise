import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import { env } from '../config/env.js';
import * as service from '../services/messaging.service.js';
import { onMessagingEvent } from '../services/messaging.events.js';
import { verifyToken, findActiveById } from '../services/auth.service.js';
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

// Messaging feature flags the client needs (currently just the hand-back-to-AI
// affordance). Cheap, no DB — read on inbox load to decide whether to enable it.
export const config = asyncHandler(async (req, res) => {
  sendSuccess(res, { allowTransferToAi: env.allowTransferToAi });
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

// Machine-only (service token): the AI agent's `send_media` tool. Finds a media file
// in the page's Vault folder matching the query and sends it to the customer.
// Body: { accountId, customerHandle, origin, query }.
export const media = asyncHandler(async (req, res) => {
  const { accountId, customerHandle, origin, query } = req.body || {};
  sendSuccess(res, await service.sendVaultMedia({ accountId, customerHandle, origin, query }));
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
    if (token) user = await findActiveById(verifyToken(token).sub);
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
