import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireMessagingAccess from '../middleware/messaging_access.middleware.js';
import requireServiceToken from '../middleware/service_token.middleware.js';
import * as ctrl from '../controllers/messaging.controller.js';

const router = Router();

// SSE stream authenticates via ?token= (EventSource can't set headers), so it
// is declared before the blanket requireAuth below.
router.get('/stream', ctrl.stream);

// Machine-only inbound from n8n (service token, not JWT) — also declared before
// the blanket requireAuth so it uses its own auth.
router.post('/inbound', requireServiceToken, ctrl.inbound);
// Machine-only: n8n escalates a thread to a live agent (pauses AI auto-reply).
router.post('/handoff', requireServiceToken, ctrl.handoff);
// Machine-only: the AI agent's keyword lookup over products + reference (FULLTEXT).
router.post('/knowledge', requireServiceToken, ctrl.knowledge);
// Machine-only: the AI agent's page-info tool — the page's Business profile (contact/location/hours).
router.post('/page-info', requireServiceToken, ctrl.pageInfo);
// Machine-only: the AI agent's delivery-distance tool — driving km/time shop → customer (Geoapify).
router.post('/delivery-distance', requireServiceToken, ctrl.deliveryDistance);
// Machine-only: the AI agent's media tool — send a Vault file to the customer.
router.post('/media', requireServiceToken, ctrl.media);
// Machine-only: the AI agent's create-order tool — save the order note + route the
// thread (transfer to the least-busy online agent, or pool it if none are online).
router.post('/order', requireServiceToken, ctrl.order);
// Machine-only: the AI agent's block-customer tool — block by handle (only a human
// Live Agent can unblock). Declared here so the AI's service token can reach it.
router.post('/block', requireServiceToken, ctrl.blockCustomer);

router.use(requireAuth);
router.use(requireMessagingAccess); // JWT routes are messaging-only (stream/inbound gate themselves above)
router.get('/', ctrl.list); // conversations visible to this user (AI shared + own live)
router.get('/config', ctrl.config); // messaging feature flags (e.g. hand-back-to-AI)
router.get('/analytics', ctrl.analytics); // live-agent response metrics for a page (?accountId)
router.post('/enhance', ctrl.enhance); // composer: polish a draft reply via OpenAI

// Transfers + agent list — declared before the /:id routes so they aren't
// swallowed by the :id param.
router.get('/agents', ctrl.agents); // teammates a chat can be transferred to
router.get('/transfers/incoming', ctrl.incomingTransfers); // pending requests for me
router.post('/transfers/:id/accept', ctrl.acceptTransfer);
router.post('/transfers/:id/decline', ctrl.declineTransfer);

router.get('/:id', ctrl.get); // one thread with its messages
router.post('/:id/messages', ctrl.send); // send a reply (media + text split into bubbles)
router.post('/:id/seen', ctrl.seen); // mark thread seen (clears unread)
router.post('/:id/takeover', ctrl.takeover); // take over → bind to me as Live Agent
router.post('/:id/block', ctrl.block); // Live Agent: block the customer (drops their inbound + n8n)
router.post('/:id/unblock', ctrl.unblock); // Live Agent only: unblock (incl. AI-handled threads)
router.post('/:id/return-to-ai', ctrl.returnToAi); // hand back to the AI agent (flag-gated)
router.post('/:id/transfer', ctrl.requestTransfer); // hand this chat to another agent
router.post('/:id/transfer/cancel', ctrl.cancelTransfer); // sender cancels their pending transfer

export default router;
