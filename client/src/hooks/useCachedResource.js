import { useCallback, useEffect, useRef, useState } from 'react';

// Session-lived stale-while-revalidate cache, keyed by a caller-supplied string.
// A revisited page paints instantly from the last good response, then refreshes
// in the background. Pairs with the server ETag layer (cache.middleware.js) so
// the background refresh is usually a tiny 304. It's just an in-memory Map, so a
// full page reload clears it.
const cache = new Map();

// Forget cached entries so the next read refetches from scratch. Pass a prefix
// (e.g. 'post-pool') to drop a group of keys, or call with no args to clear
// everything (do this on logout so the next user never sees cached data).
export function invalidateCache(prefix) {
  if (prefix == null) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/**
 * Stale-while-revalidate data hook.
 *
 *   const { data, loading, error, refresh } = useCachedResource(key, fetcher);
 *
 * - `key`: a stable cache key string (pass a falsy key to skip fetching).
 * - `fetcher`: () => Promise<data>. May be an inline arrow — it's read through a
 *   ref, so a new identity each render does NOT retrigger the fetch (only `key`
 *   does).
 *
 * Cached data renders immediately with no spinner; a background refetch always
 * runs to refresh it. The spinner (`loading`) only shows on the first load of a
 * key, when there's nothing cached yet. `refresh()` refetches the current key on
 * demand (e.g. after a mutation) while keeping the current data on screen.
 */
export function useCachedResource(key, fetcher) {
  const [data, setData] = useState(() => cache.get(key));
  const [loading, setLoading] = useState(() => key != null && !cache.has(key));
  const [error, setError] = useState(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (key == null) return undefined;
    let active = true;

    // Paint whatever is cached for this key right away; only show the spinner
    // when there's nothing to show yet.
    setData(cache.get(key));
    setError(null);
    setLoading(!cache.has(key));

    // …then revalidate in the background.
    fetcherRef
      .current()
      .then((res) => {
        cache.set(key, res);
        if (active) {
          setData(res);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false; // a newer key (or unmount) wins — ignore this result
    };
  }, [key]);

  // Imperative refetch for the current key — keeps current data on screen (no
  // spinner) and write-through updates the cache. Stable identity (deps: []).
  const refresh = useCallback(async () => {
    const k = keyRef.current;
    if (k == null) return;
    try {
      const res = await fetcherRef.current();
      cache.set(k, res);
      if (keyRef.current === k) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (keyRef.current === k) setError(e);
    }
  }, []);

  return { data, loading, error, refresh };
}
