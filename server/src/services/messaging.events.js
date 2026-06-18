import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for the messaging feature. The messaging service emits an
 * event whenever a thread changes (new message, seen, taken over, transferred);
 * the SSE controller (controllers/messaging.controller.js) subscribes and forwards
 * each event to connected browsers. Single-process only — for multiple server
 * instances this would need a shared bus (e.g. Redis pub/sub).
 *
 * Events can be AUDIENCE-SCOPED: a bound (Live Agent) conversation's updates must
 * only reach the assigned user, so the emitter passes an array of user ids and the
 * SSE writer drops the event for everyone else. Omit the audience to broadcast
 * (e.g. shared AI Agent threads).
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection; don't warn

const CHANNEL = 'event';

// Broadcast (or narrowcast) an event. `audience` (optional) is an array of user
// ids; when set, only those users' SSE streams receive the event. Examples:
//   emitMessagingEvent({ type: 'message:new', ... })            // everyone
//   emitMessagingEvent({ type: 'message:new', ... }, [7])       // only user 7
//   { type: 'conversation:reassigned', conversationId, assignedUserId }
//   { type: 'transfer:new', transfer }      // → [toUserId]
//   { type: 'transfer:resolved', transferId }
export function emitMessagingEvent(event, audience = null) {
  bus.emit(CHANNEL, event, audience);
}

// Subscribe to messaging events; returns an unsubscribe function. The listener
// receives (event, audience).
export function onMessagingEvent(listener) {
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}
