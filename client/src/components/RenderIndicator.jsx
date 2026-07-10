import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useActiveRender } from '../context/ActiveRenderContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ProgressBar, Button } from './ui.jsx';

// Floating, app-wide indicator for the "Generate with Template" (Creatomate) render.
// Pinned to the screen's top-right so it stays visible while the user keeps working — or
// moves to another section — since the render is polled globally (ActiveRenderContext).
export default function RenderIndicator() {
  const { render, error, clearError } = useActiveRender();
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [dismissedUrl, setDismissedUrl] = useState(null);

  // Keep it off the login/signup screens (and after logout), even if a stale render
  // lingers in localStorage.
  if (!isAuthenticated) return null;

  // A render that failed anywhere should be surfaced regardless of the current page.
  if (error) {
    return (
      <div className="render-toast render-toast--error" role="alert">
        <div className="render-toast__head">
          <span className="render-toast__title">Render failed</span>
          <button type="button" className="render-toast__close" onClick={clearError} aria-label="Dismiss">
            ×
          </button>
        </div>
        <p className="render-toast__hint">{String(error.message || error)}</p>
      </div>
    );
  }

  if (!render) return null;
  // The compose view (Contents › Create) shows the accept/drop dialog itself, so the
  // toast steps aside there.
  const onCompose = pathname === '/post-pool' && params.get('view') === 'compose';

  if (render.status === 'uploading' || render.status === 'rendering') {
    const uploading = render.status === 'uploading';
    return (
      <div className="render-toast" role="status" aria-live="polite">
        <div className="render-toast__head">
          <span className="render-toast__spinner" aria-hidden="true" />
          <span className="render-toast__title">{uploading ? 'Uploading your video…' : 'Rendering with Creatomate…'}</span>
        </div>
        <ProgressBar
          value={uploading ? render.progress || 0 : 0}
          indeterminate={!uploading}
          label={uploading ? `${render.progress || 0}%` : 'This can take a minute'}
        />
        <p className="render-toast__hint">You can keep working — we’ll let you know when it’s ready.</p>
      </div>
    );
  }

  // Finished while the user was elsewhere → nudge them to Compose to use it. On the
  // compose view the form itself shows the accept/drop dialog, so the toast steps aside.
  if (render.status === 'ready' && !onCompose && dismissedUrl !== render.url) {
    return (
      <div className="render-toast render-toast--ready" role="status">
        <div className="render-toast__head">
          <span className="render-toast__check" aria-hidden="true">
            ✓
          </span>
          <span className="render-toast__title">Your video is ready</span>
          <button
            type="button"
            className="render-toast__close"
            onClick={() => setDismissedUrl(render.url)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
        <p className="render-toast__hint">Open Compose to add it to your post.</p>
        <div className="render-toast__actions">
          <Button size="sm" onClick={() => navigate('/post-pool?view=compose&type=video')}>
            View
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
