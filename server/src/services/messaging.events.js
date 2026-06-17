import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for the messaging feature. The messaging service emits an
 * event whenever a thread changes (new message, seen, taken over); the SSE
 * controller (controllers/messaging.controller.js) subscribes and forwards each
 * event to connected browsers. Single-process only — for multiple server
 * instances this would need a shared bus (e.g. Redis pub/sub).
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection; don't warn

const CHANNEL = 'event';

// Broadcast an event to every connected client. `event` is a plain object that
// gets JSON-serialised by the SSE writer, e.g.
//   { type: 'message:new', conversationId, messages, conversation }
//   { type: 'conversation:updated', conversation }
export function emitMessagingEvent(event) {
  bus.emit(CHANNEL, event);
}

// Subscribe to messaging events; returns an unsubscribe function.
export function onMessagingEvent(listener) {
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}
