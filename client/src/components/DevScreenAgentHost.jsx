import DevScreenAgent from './DevScreenAgent.jsx';
import { env } from '../config/env.js';

export default function DevScreenAgentHost() {
  if (!env.showAssistant) return null;

  return <DevScreenAgent />;
}
