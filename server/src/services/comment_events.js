import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for live Facebook comments (Contents → Comments). The `feed`
 * webhook handler (comment_realtime.service.js) emits an event whenever a comment
 * is added/edited/removed on one of the page's posts; the SSE controller
 * (post_pool.controller.js → commentStream) forwards each event to connected
 * browsers, which insert it into the comments inbox live.
 *
 * Comments are page-scoped and shared (everyone on a page sees them), so events are
 * broadcast to every open stream; each client keeps only the events whose accountId
 * matches its active page. Single-process only — multi-instance would need a shared
 * bus (e.g. Redis pub/sub), same caveat as messaging.events.js.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection; don't warn

const CHANNEL = 'event';

export function emitCommentEvent(event) {
  bus.emit(CHANNEL, event);
}

// Subscribe to comment events; returns an unsubscribe function.
export function onCommentEvent(listener) {
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}
