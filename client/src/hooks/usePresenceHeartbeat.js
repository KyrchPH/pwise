import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import * as presence from '../services/presence.service.js';

const HEARTBEAT_MS = 20000; // server TTL is 45s, so a missed beat still keeps us online

// Marks the signed-in user "online" while their tab is ACTIVE (visible), via a
// periodic heartbeat. Tab hidden → just STOP beating; we deliberately do NOT go
// offline immediately, so the server-side TTL (45s) lapses on its own. That gives
// a grace window where a quick switch to another tab keeps the agent online (and
// still eligible for order routing) instead of dropping them the instant they look
// away. Tab visible again → resume. Logout/unmount → go offline right away. A hard
// close just stops the heartbeat and the TTL expires presence. Mounted once in the
// authed shell.
export default function usePresenceHeartbeat() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let timer = null;
    const beat = () => {
      presence.ping().catch(() => {});
    };
    const start = () => {
      if (timer) return;
      beat(); // immediate, so we don't wait a full interval to register
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        // Stop beating but stay "online" until the server TTL lapses (grace window).
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
      presence.offline().catch(() => {}); // logout / leaving the app
    };
  }, [isAuthenticated]);
}
