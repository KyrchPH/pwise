import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
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
