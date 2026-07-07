import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for the order/agreement feature — a sibling of messaging.events.js.
 * The order service emits an event when a customer starts viewing a shared agreement or
 * confirms it; the agreement SSE controller (controllers/order.controller.js `stream`)
 * subscribes and forwards each event to the one staff owner watching in their checkout tab.
 *
 * Events are AUDIENCE-SCOPED: an agreement belongs to the staff member who drafted it, so
 * its updates only reach that user id. Single-process only (matches the app's single-process
 * deploy); a multi-instance setup would need a shared bus (e.g. Redis pub/sub).
 *
 *   emitOrderEvent({ type: 'agreement:viewing',  agreementId, at }, [ownerId])
 *   emitOrderEvent({ type: 'agreement:confirmed', agreementId, orderId }, [ownerId])
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection; don't warn

const CHANNEL = 'event';

// Broadcast (or narrowcast) an event. `audience` (optional) is an array of user ids; when
// set, only those users' SSE streams receive the event. Omit to broadcast.
export function emitOrderEvent(event, audience = null) {
  bus.emit(CHANNEL, event, audience);
}

// Subscribe to order events; returns an unsubscribe function. The listener receives
// (event, audience).
export function onOrderEvent(listener) {
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}
