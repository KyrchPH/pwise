// A tiny pub/sub bridge that lets the Wise Assistant drive UI state living in
// components OUTSIDE its own render tree: the sidebar collapse + nav pins (AppLayout)
// and the sticky-note visibility (WiseNotes). DevScreenAgent's action runner emits;
// those components subscribe and resolve the op against their own live state (so a
// "toggle" is always correct). Theme and the active page are reachable through React
// context, so they do NOT go through this bus.
//
// Event shapes:
//   { kind: 'sidebar', op: 'collapse' | 'expand' | 'toggle' }
//   { kind: 'notes',   op: 'show' | 'hide' | 'toggle' }
//   { kind: 'pin',     path: '/analytics', op: 'pin' | 'unpin' | 'toggle' }
const listeners = new Set();

export function subscribeWiseUi(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitWiseUi(event) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      /* one bad listener must not break the others */
    }
  }
}
