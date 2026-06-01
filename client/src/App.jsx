import { useEffect, useState } from 'react';
import api from './services/api.js';

const PAGES = ['Login', 'Dashboard', 'PostPool', 'UploadPost', 'Settings', 'Logs'];

export default function App() {
  const [health, setHealth] = useState('checking…');

  useEffect(() => {
    api
      .get('/health') // -> /api/health, proxied to the Express server in dev
      .then((res) => setHealth(res.data?.status ?? 'ok'))
      .catch(() => setHealth('server offline'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Auto Post Agent</h1>
      <p>Monorepo scaffold is up. Server health: <strong>{health}</strong></p>
      <h2>Planned pages</h2>
      <ul>
        {PAGES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        This placeholder is replaced by real pages in the frontend phase.
      </p>
    </main>
  );
}
