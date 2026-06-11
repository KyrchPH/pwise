import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as pagesService from '../services/pages.service.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { useAuth } from './AuthContext.jsx';

const PageContext = createContext(null);

/**
 * Holds the connected Facebook pages + the current user's active page, and the
 * `switchPage` action. The active page scopes the data views (Pool, Calendar,
 * Dashboard, Analytics are filtered server-side by it), so switching drops their
 * caches to force a refetch.
 */
export function PageProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [pages, setPages] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeFollowers, setActiveFollowers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false); // a page switch is in flight

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setPages([]);
      setActiveId(null);
      return;
    }
    setLoading(true);
    try {
      const [list, act] = await Promise.all([pagesService.list(), pagesService.active()]);
      setPages(list);
      // Default to the first page when nothing is selected yet, so views always
      // have a page to scope to (persist the choice).
      let sel = act.selected_account_id ?? null;
      if (sel == null && list.length) {
        sel = list[0].id;
        pagesService.select(sel).catch(() => {});
      }
      setActiveId(sel);
      // Re-pull followers for the active page. The activeId effect below only
      // fires when the selection changes, so a manual refresh (same page, fresh
      // data after a sync) wouldn't otherwise update the sidebar count.
      if (sel != null) {
        pagesService
          .stats(sel)
          .then((s) => setActiveFollowers(s?.followers ?? null))
          .catch(() => setActiveFollowers(null));
      } else {
        setActiveFollowers(null);
      }
    } catch {
      /* pages not configured yet — leave empty */
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Followers count for the active page (server-side — needs the page token).
  // Refetched whenever the active page changes; hidden (null) on any failure.
  useEffect(() => {
    if (activeId == null) {
      setActiveFollowers(null);
      return undefined;
    }
    let cancelled = false;
    pagesService
      .stats(activeId)
      .then((s) => !cancelled && setActiveFollowers(s?.followers ?? null))
      .catch(() => !cancelled && setActiveFollowers(null));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const switchPage = useCallback(async (id) => {
    setSwitching(true);
    try {
      await pagesService.select(id);
      setActiveId(id);
      // Every page-scoped view (Pool, Dashboard, Analytics, Logs…) is now stale,
      // so drop the whole cache. The active id also keys the AppLayout content, so
      // the screen you're on remounts and reloads its data for the new page.
      invalidateCache();
    } finally {
      setSwitching(false);
    }
  }, []);

  const activePage = pages.find((p) => p.id === activeId) || null;
  const value = { pages, activePage, activeId, activeFollowers, loading, switching, refresh, switchPage };
  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

export const usePages = () => useContext(PageContext);
