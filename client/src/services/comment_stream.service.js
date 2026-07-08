import { env } from '../config/env.js';

// Shared SSE connection for live Facebook comments (Contents → Comments). ONE
// EventSource fanned out to every subscriber; opens on the first subscriber, closes
// when the last unsubscribes, and reopens if the auth token changes — mirrors the
// messaging stream. Events: { type: 'comment:new' | 'comment:edited' | 'comment:removed',
// accountId, postId, comment?, post? }. The page filters by its active page.
let _source = null;
let _streamToken = null;
const _listeners = new Set();

function _ensureStream() {
  if (typeof EventSource === 'undefined') return;
  const token = localStorage.getItem('token') || '';
  if (_source && _streamToken === token) return; // already connected with this token
  if (_source) _source.close();
  _streamToken = token;
  _source = new EventSource(`${env.apiBaseUrl}/post-pool/comments/stream?token=${encodeURIComponent(token)}`);
  _source.onmessage = (event) => {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return; // keep-alive / comment frame
    }
    for (const fn of _listeners) {
      try {
        fn(parsed);
      } catch {
        /* one bad handler shouldn't take down the others */
      }
    }
  };
}

// Subscribe to live comment events. Returns an unsubscribe function.
export function subscribeComments(onEvent) {
  if (typeof EventSource === 'undefined') return () => {};
  _listeners.add(onEvent);
  _ensureStream();
  return () => {
    _listeners.delete(onEvent);
    if (_listeners.size === 0 && _source) {
      _source.close();
      _source = null;
      _streamToken = null;
    }
  };
}
