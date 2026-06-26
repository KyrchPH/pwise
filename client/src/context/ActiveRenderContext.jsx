import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as creatomate from '../services/creatomate.service.js';
import { useAuth } from './AuthContext.jsx';

// App-wide state for the "Generate with Template" (Creatomate) render so it survives
// navigating between sections. The render runs server-side (a renderJobId); we keep the
// id here, poll it to completion from ANYWHERE in the app, and surface progress in a
// floating indicator (RenderIndicator). Statuses:
//   'uploading'  input clip → S3 (transient, not persisted — an upload can't resume)
//   'rendering'  Creatomate job in flight (polled)
//   'ready'      finished, awaiting the user's accept/drop on the Upload page
//   'accepted'   kept for the post being composed
const KEY = 'pwise:active-render';
const POLL_MS = 3000;
const MAX_MS = 8 * 60 * 1000; // generous headroom over a typical render
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PERSISTED = new Set(['rendering', 'ready', 'accepted']);
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && PERSISTED.has(v.status) ? v : null;
  } catch {
    return null;
  }
}
function persist(v) {
  try {
    if (v && PERSISTED.has(v.status)) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the render still runs; it just won't survive a reload */
  }
}

const ActiveRenderContext = createContext(null);

export function ActiveRenderProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [render, setRender] = useState(load);
  const [error, setError] = useState(null);
  const pollRef = useRef(null); // job id currently being polled — dedupes effect re-runs

  const update = useCallback((next) => {
    setRender(next);
    persist(next);
  }, []);

  // Poll the active render to completion from anywhere (gated on auth so we never hit the
  // API on the login screen). Re-runs only when the job id changes, and a ref guards
  // against a second concurrent poll for the same job (e.g. StrictMode double-invoke).
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (!render || render.status !== 'rendering' || !render.renderJobId) return undefined;
    const jobId = render.renderJobId;
    const templateId = render.templateId;
    if (pollRef.current === jobId) return undefined;
    pollRef.current = jobId;
    let live = true;
    const deadline = Date.now() + MAX_MS;
    (async () => {
      try {
        while (live && Date.now() < deadline) {
          const job = await creatomate.getRender(jobId);
          if (!live) return;
          if (job.status === 'succeeded') {
            if (!job.url) throw new Error('The render finished but no video came back. Please try again.');
            update({ status: 'ready', templateId, url: job.url });
            return;
          }
          if (job.status === 'failed') throw new Error(job.errorMessage || 'The render failed. Please try again.');
          await sleep(POLL_MS);
        }
        if (live) throw new Error('The render is taking longer than expected — please check back shortly.');
      } catch (e) {
        if (live) {
          setError(e);
          update(null);
        }
      } finally {
        if (pollRef.current === jobId) pollRef.current = null;
      }
    })();
    return () => {
      live = false;
      if (pollRef.current === jobId) pollRef.current = null;
    };
  }, [isAuthenticated, render?.status, render?.renderJobId, update]);

  const value = {
    render,
    error,
    clearError: useCallback(() => setError(null), []),
    // Transient upload phase (before the render job exists) — not persisted.
    beginUpload: useCallback(() => setRender({ status: 'uploading', progress: 0 }), []),
    setUploadProgress: useCallback(
      (p) => setRender((r) => (r && r.status === 'uploading' ? { ...r, progress: p } : r)),
      [],
    ),
    begin: useCallback(
      ({ renderJobId, templateId }) => update({ status: 'rendering', renderJobId, templateId }),
      [update],
    ),
    markAccepted: useCallback(({ templateId, url }) => update({ status: 'accepted', templateId, url }), [update]),
    clear: useCallback(() => {
      setError(null);
      update(null);
    }, [update]),
  };

  return <ActiveRenderContext.Provider value={value}>{children}</ActiveRenderContext.Provider>;
}

export function useActiveRender() {
  const ctx = useContext(ActiveRenderContext);
  if (!ctx) throw new Error('useActiveRender must be used within an ActiveRenderProvider');
  return ctx;
}
