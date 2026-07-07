import api from './api.js';
import { env } from '../config/env.js';

// Orders + the checkout agreement flow. The authed calls are used by the staff (the
// checkout tab + the Orders page). The public* calls are used by the customer-facing
// /agreement/:token viewer — they hit the unauthenticated /public/agreements endpoints
// (the axios instance attaches a JWT only when one exists; the server ignores it there).

// ---- Staff (authed) --------------------------------------------------------
export async function createAgreement(payload) {
  const { data } = await api.post('/orders/agreements', payload);
  return data.data.agreement;
}

export async function getAgreement(id) {
  const { data } = await api.get(`/orders/agreements/${id}`);
  return data.data.agreement;
}

export async function sendAgreementEmail(id) {
  const { data } = await api.post(`/orders/agreements/${id}/email`);
  return data.data;
}

// EventSource can't set headers, so the JWT rides the query string (like messaging).
export function agreementStreamUrl(id) {
  const token = localStorage.getItem('token') || '';
  return `${env.apiBaseUrl}/orders/agreements/${id}/stream?token=${encodeURIComponent(token)}`;
}

export async function listOrders(accountId, { status, ownerId } = {}) {
  const { data } = await api.get('/orders', { params: { accountId, status: status || undefined, ownerId: ownerId || undefined } });
  return data.data.orders;
}

export async function getOrder(id) {
  const { data } = await api.get(`/orders/${id}`);
  return data.data.order;
}

export async function updateOrderStatus(id, status) {
  const { data } = await api.patch(`/orders/${id}/status`, { status });
  return data.data.order;
}

// ---- Customer (public token) -----------------------------------------------
export async function getPublicAgreement(token) {
  const { data } = await api.get(`/public/agreements/${token}`);
  return data.data; // { state: 'active'|'expired'|'confirmed'|'cancelled', agreement? }
}

export async function pingAgreement(token) {
  const { data } = await api.post(`/public/agreements/${token}/ping`);
  return data.data;
}

export async function confirmAgreement(token) {
  const { data } = await api.post(`/public/agreements/${token}/confirm`);
  return data.data; // { orderId }
}

// Ordered pipeline (matches the server enum). 'cancelled' is an escape hatch, not a step.
export const ORDER_STATUSES = ['pending', 'paid', 'processing', 'ready_for_pickup', 'shipped', 'out_for_delivery', 'completed', 'cancelled'];

export const ORDER_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  processing: 'Processing',
  ready_for_pickup: 'Ready for pickup',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
