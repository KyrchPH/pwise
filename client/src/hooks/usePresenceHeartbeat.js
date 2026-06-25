import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import * as presence from '../services/presence.service.js';

const HEARTBEAT_MS = 20000; // server TTL is 45s, so a missed beat still keeps us online

// Marks the signed-in user "online" while their tab is ACTIVE (visible), via a
// periodic heartbeat. Tab hidden → stop + go offline; tab visible again → resume.
// Logout/unmount → go offline. A hard close just stops the heartbeat and the
// server-side TTL expires presence on its own. Mounted once in the authed shell.
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
        stop();
        presence.offline().catch(() => {});
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
