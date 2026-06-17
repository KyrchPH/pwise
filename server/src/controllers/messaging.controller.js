import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/messaging.service.js';
import { onMessagingEvent } from '../services/messaging.events.js';
import { verifyToken, findActiveById } from '../services/auth.service.js';

// Shared inbox: reads aren't user-scoped (every signed-in user sees all threads).
export const list = asyncHandler(async (req, res) => {
  const conversations = await service.listConversations();
  sendSuccess(res, { conversations });
});

export const get = asyncHandler(async (req, res) => {
  const conversation = await service.getConversation(req.params.id);
  sendSuccess(res, { conversation });
});

export const send = asyncHandler(async (req, res) => {
  const result = await service.sendMessage(req.params.id, req.user, req.body || {});
  sendSuccess(res, result, 201);
});

export const seen = asyncHandler(async (req, res) => {
  const conversation = await service.markSeen(req.params.id);
  sendSuccess(res, { conversation });
});

export const takeover = asyncHandler(async (req, res) => {
  const conversation = await service.takeOver(req.params.id);
  sendSuccess(res, { conversation });
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

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  res.write(': connected\n\n');

  const unsubscribe = onMessagingEvent((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
