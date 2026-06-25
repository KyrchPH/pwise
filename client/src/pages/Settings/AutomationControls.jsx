import { useEffect, useState } from 'react';
import api, { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Toggle, Spinner } from '../../components/ui.jsx';

// Admin-only global automation switches (server: app_settings). Pause the AI Agent's
// auto-replies and/or auto-posting. The server enforces both; this is just the control.
export default function AutomationControls() {
  const toast = useToast();
  const [state, setState] = useState(null); // { aiPaused, postingPaused }

  useEffect(() => {
    api
      .get('/admin/pause')
      .then(({ data }) => setState(data.data))
      .catch((e) => toast.error(apiError(e)));
  }, [toast]);

  const setPause = async (key, value) => {
    const prev = state;
    setState((s) => ({ ...s, [key]: value })); // optimistic
    try {
      const { data } = await api.patch('/admin/pause', { [key]: value });
      setState(data.data);
    } catch (e) {
      setState(prev); // revert on failure
      toast.error(apiError(e));
    }
  };

  if (!state) return <Spinner label="Loading…" />;

  return (
    <div>
      <div className="row row--between" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Pause AI Agent</div>
          <div className="text-sm text-muted">
            Stop the AI from auto-replying to customers. Messages still arrive in the inbox so agents can answer.
          </div>
        </div>
        <Toggle checked={state.aiPaused} onChange={(v) => setPause('aiPaused', v)} />
      </div>
      <div className="row row--between">
        <div>
          <div style={{ fontWeight: 600 }}>Pause auto-posting</div>
          <div className="text-sm text-muted">
            Stop scheduled posts from publishing. Queued posts stay put; turn this off to resume.
          </div>
        </div>
        <Toggle checked={state.postingPaused} onChange={(v) => setPause('postingPaused', v)} />
      </div>
    </div>
  );
}
