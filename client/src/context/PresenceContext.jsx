import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import * as presence from '../services/presence.service.js';

// Holds a live map of every teammate's presence ({ online, lastSeenAt }), refreshed
// on a slow poll (and when the tab regains focus). Components read a single user's
// presence via usePresence(userId) to badge their avatar. Returns null gracefully if
// no provider is mounted (e.g. on the login screen), so UserAvatar/PresenceBadge are
// safe to render anywhere.
const PresenceContext = createContext(null);
const POLL_MS = 30000;

export function PresenceProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [map, setMap] = useState(() => new Map());

  const load = useCallback(() => {
    presence
      .getStatus()
      .then((list) => {
        const next = new Map();
        for (const p of list || []) {
          next.set(Number(p.userId), { online: !!p.online, lastSeenAt: p.lastSeenAt || null });
        }
        setMap(next);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setMap(new Map());
      return undefined;
    }
    load();
    const poll = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, load]);

  return <PresenceContext.Provider value={map}>{children}</PresenceContext.Provider>;
}

// Presence for one user, or null if unknown / no provider. Pass a falsy id to skip.
export function usePresence(userId) {
  const map = useContext(PresenceContext);
  if (!map || userId == null) return null;
  return map.get(Number(userId)) || null;
}

// The whole presence map — for rendering many rows at once (e.g. a conversation
// list) without a hook per row. Returns an empty Map if there's no provider.
export function usePresenceMap() {
  return useContext(PresenceContext) || new Map();
}
