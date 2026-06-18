import api, { apiError } from './api.js';
import { env } from '../config/env.js';

// Messaging inbox API. Responses already match the shape MessagingPage uses, so
// callers can drop them straight onto state.

export async function listConversations() {
  const { data } = await api.get('/messages');
  return data.data.conversations;
}

export async function getConversation(id) {
  const { data } = await api.get(`/messages/${id}`);
  return data.data.conversation;
}

// Send a reply. The server splits media + text into separate bubbles and returns
// the created messages plus a conversation patch (summary/unread/handledBy/…).
export async function sendMessage(id, { text, media, replyTo } = {}) {
  const { data } = await api.post(`/messages/${id}/messages`, { text, media, replyTo });
  return data.data; // { messages, conversation }
}

export async function markSeen(id) {
  const { data } = await api.post(`/messages/${id}/seen`);
  return data.data.conversation;
}

export async function takeOver(id) {
  const { data } = await api.post(`/messages/${id}/takeover`);
  return data.data.conversation;
}

// ── Transfers ────────────────────────────────────────────────────────────────
// Teammates a chat can be transferred to (active users with Messaging access).
export async function agents() {
  const { data } = await api.get('/messages/agents');
  return data.data.agents; // [{ id, name, email }]
}

// Pending transfer requests addressed to me.
export async function incomingTransfers() {
  const { data } = await api.get('/messages/transfers/incoming');
  return data.data.transfers;
}

// Hand a conversation off to another agent (they must accept).
export async function requestTransfer(conversationId, toUserId) {
  const { data } = await api.post(`/messages/${conversationId}/transfer`, { toUserId });
  return data.data.transfer;
}

export async function acceptTransfer(transferId) {
  const { data } = await api.post(`/messages/transfers/${transferId}/accept`);
  return data.data; // { accepted, conversationId }
}

export async function declineTransfer(transferId) {
  const { data } = await api.post(`/messages/transfers/${transferId}/decline`);
  return data.data;
}

/**
 * Subscribe to live inbox events over SSE. `onEvent` receives parsed event
 * objects ({ type: 'message:new' | 'conversation:updated', ... }). Returns an
 * unsubscribe function. EventSource can't set headers, so the JWT rides the URL.
 */
export function subscribe(onEvent) {
  if (typeof EventSource === 'undefined') return () => {};
  const token = localStorage.getItem('token') || '';
  const url = `${env.apiBaseUrl}/messages/stream?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      /* ignore keep-alive/comment frames */
    }
  };
  return () => source.close();
}

export { apiError };
