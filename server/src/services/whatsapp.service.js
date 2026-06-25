import { env } from '../config/env.js';

// WhatsApp Cloud API (Graph). Unlike the page Send API (fb.service.js), WhatsApp uses a
// Bearer token (the WABA system-user token, stored encrypted per account) and a JSON body
// POSTed to /{phone_number_id}/messages. Best-effort helpers — they return
// { ok, messageId } / { ok:false, error } and never throw.

const graphBase = () => `https://graph.facebook.com/${env.facebook.graphVersion}`;

async function waPost(path, token, body) {
  try {
    const res = await fetch(`${graphBase()}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Send a plain text message. `to` is the customer's WhatsApp number (wa_id / E.164).
export async function sendText(token, phoneNumberId, to, text) {
  if (!token || !phoneNumberId || !to) return { ok: false, error: 'missing token, phone number id, or recipient' };
  const r = await waPost(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(text ?? '') },
  });
  if (!r.ok) return r;
  return { ok: true, messageId: r.data?.messages?.[0]?.id ?? null };
}

// Send media by public URL (our presigned S3 links work). Maps our generic media type
// to a WhatsApp object type (image/video/audio/document).
export async function sendMedia(token, phoneNumberId, to, { url, type } = {}) {
  if (!token || !phoneNumberId || !to || !url) return { ok: false, error: 'missing token, recipient, or url' };
  const t = String(type || '').toLowerCase();
  const kind = t.startsWith('image') ? 'image' : t.startsWith('video') ? 'video' : t.startsWith('audio') ? 'audio' : 'document';
  const r = await waPost(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: kind,
    [kind]: { link: String(url) },
  });
  if (!r.ok) return r;
  return { ok: true, messageId: r.data?.messages?.[0]?.id ?? null };
}

// Resolve an inbound media id to a temporary download URL. The returned URL must be
// fetched WITH the same Bearer token (the caller does that, then re-stores to S3).
// Best-effort — returns { url, mimeType } or null.
export async function getMediaUrl(token, mediaId) {
  if (!token || !mediaId) return null;
  try {
    const res = await fetch(`${graphBase()}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) return null;
    return { url: data.url, mimeType: data.mime_type || '' };
  } catch {
    return null;
  }
}

// Subscribe this WABA to the app's webhooks (so inbound reaches /api/webhooks/whatsapp).
// Best-effort.
export async function subscribeWaba(token, wabaId) {
  if (!token || !wabaId) return { ok: false, error: 'missing token or WABA id' };
  const r = await waPost(`${wabaId}/subscribed_apps`, token, {});
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
