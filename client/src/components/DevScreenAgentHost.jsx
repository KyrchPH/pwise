import DevScreenAgent from './DevScreenAgent.jsx';
import { env } from '../config/env.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function DevScreenAgentHost() {
  const { isAuthenticated } = useAuth();
  // Only show the assistant to a signed-in user — keep it off the login/signup
  // screens (and hide it again on logout). isAuthenticated is false while the
  // session is still restoring, so it stays hidden until login is confirmed.
  if (!env.showAssistant || !isAuthenticated) return null;

  return <DevScreenAgent />;
}
