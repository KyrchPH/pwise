import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as connections from '../../services/connections.service.js';
import { subscribe } from '../../services/messaging.service.js';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Person({ person, actions }) {
  return (
    <li className="connections-row">
      <span className="agentchat-avatar" aria-hidden="true">
        {initialsOf(person.name)}
      </span>
      <span className="connections-row__meta">
        <span className="connections-row__name">{person.name}</span>
        {person.email && <span className="connections-row__email">{person.email}</span>}
      </span>
      <span className="connections-row__actions">{actions}</span>
    </li>
  );
}

export default function ConnectionsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState({ connections: [], incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(null); // user id being acted on

  const load = useCallback(
    () => connections.list().then(setData).catch((e) => toast.error(connections.apiError(e))),
    [toast],
  );
  const refreshSearch = useCallback(() => {
    const q = query.trim();
    if (q) connections.search(q).then(setResults).catch(() => {});
  }, [query]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Live refresh when a request arrives or a connection state changes.
  useEffect(
    () =>
      subscribe((ev) => {
        if (ev?.type === 'connection:request' || ev?.type === 'connection:changed') {
          load();
          refreshSearch();
        }
      }),
    [load, refreshSearch],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      connections.search(q).then((r) => live && setResults(r)).catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const act = async (fn, userId) => {
    setBusy(userId);
    try {
      await fn(userId);
      await load();
      refreshSearch();
    } catch (e) {
      toast.error(connections.apiError(e));
    } finally {
      setBusy(null);
    }
  };

  const searchAction = (p) => {
    if (p.status === 'connected')
      return (
        <>
          <Button variant="primary" size="sm" className="btn--flat" onClick={() => navigate(`/messages?dm=${p.id}`)}>
            Message
          </Button>
          <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(connections.remove, p.id)}>
            Remove
          </Button>
        </>
      );
    if (p.status === 'outgoing')
      return (
        <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(connections.cancel, p.id)}>
          Cancel request
        </Button>
      );
    if (p.status === 'incoming')
      return (
        <Button variant="primary" size="sm" disabled={busy === p.id} onClick={() => act(connections.accept, p.id)}>
          Accept
        </Button>
      );
    return (
      <Button variant="primary" size="sm" disabled={busy === p.id} onClick={() => act(connections.request, p.id)}>
        Connect
      </Button>
    );
  };

  return (
    <div className="connections-page">
      <div className="connections-head">
        <h1 className="connections-head__title">Connections</h1>
        <p className="connections-head__sub">Connect with teammates so you can message each other freely.</p>
      </div>

      <Card className="connections-card">
        <div className="agentchat-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="input agentchat-search__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates to connect..."
            aria-label="Search teammates"
          />
        </div>

        {loading ? (
          <div className="card--pad">
            <EmptyState icon="…" title="Loading" message="Fetching your connections." />
          </div>
        ) : query.trim() ? (
          <div className="connections-section">
            <div className="connections-section__title">Search results</div>
            {results.length === 0 ? (
              <p className="connections-empty">No teammates match that search.</p>
            ) : (
              <ul className="connections-list">
                {results.map((p) => (
                  <Person key={p.id} person={p} actions={searchAction(p)} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            {data.incoming.length > 0 && (
              <div className="connections-section">
                <div className="connections-section__title">Connection requests</div>
                <ul className="connections-list">
                  {data.incoming.map((p) => (
                    <Person
                      key={p.id}
                      person={p}
                      actions={
                        <>
                          <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(connections.decline, p.id)}>
                            Decline
                          </Button>
                          <Button variant="primary" size="sm" disabled={busy === p.id} onClick={() => act(connections.accept, p.id)}>
                            Accept
                          </Button>
                        </>
                      }
                    />
                  ))}
                </ul>
              </div>
            )}

            <div className="connections-section">
              <div className="connections-section__title">Your connections ({data.connections.length})</div>
              {data.connections.length === 0 ? (
                <p className="connections-empty">No connections yet. Search a teammate above to connect.</p>
              ) : (
                <ul className="connections-list">
                  {data.connections.map((p) => (
                    <Person
                      key={p.id}
                      person={p}
                      actions={
                        <>
                          <Button variant="primary" size="sm" className="btn--flat" onClick={() => navigate(`/messages?dm=${p.id}`)}>
                            Message
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(connections.remove, p.id)}>
                            Remove
                          </Button>
                        </>
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            {data.outgoing.length > 0 && (
              <div className="connections-section">
                <div className="connections-section__title">Sent requests</div>
                <ul className="connections-list">
                  {data.outgoing.map((p) => (
                    <Person
                      key={p.id}
                      person={p}
                      actions={
                        <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(connections.cancel, p.id)}>
                          Cancel
                        </Button>
                      }
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
