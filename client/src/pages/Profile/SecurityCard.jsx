import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as authService from '../../services/auth.service.js';
import { apiError } from '../../services/api.js';
import { Button, Card } from '../../components/ui.jsx';

const fmt = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

// A friendly "Chrome on Windows"-style label from the raw user-agent.
function deviceLabel(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const os = /Windows/i.test(s) ? 'Windows'
    : /Macintosh|Mac OS X/i.test(s) ? 'macOS'
    : /Android/i.test(s) ? 'Android'
    : /iPhone|iPad|iPod/i.test(s) ? 'iOS'
    : /Linux/i.test(s) ? 'Linux'
    : '';
  const browser = /Edg\//i.test(s) ? 'Edge'
    : /OPR\/|Opera/i.test(s) ? 'Opera'
    : /Chrome\//i.test(s) ? 'Chrome'
    : /Firefox\//i.test(s) ? 'Firefox'
    : /Safari\//i.test(s) ? 'Safari'
    : '';
  return [browser, os].filter(Boolean).join(' on ') || 'Unknown device';
}

// Profile → Security: your sessions (login history), each revocable, plus "log out of
// all other devices". The current session is flagged and can't be revoked from here
// (use the normal Log out for that).
export default function SecurityCard() {
  const { logoutOtherDevices } = useAuth();
  const toast = useToast();
  const [list, setList] = useState(null); // null = loading
  const [busy, setBusy] = useState(false); // "log out others" in flight
  const [revokingId, setRevokingId] = useState(null);

  const load = () =>
    authService
      .sessions()
      .then(setList)
      .catch((e) => {
        setList([]);
        toast.error(apiError(e));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogoutOthers = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logoutOtherDevices();
      toast.success('Signed out of all other devices');
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (id) => {
    if (revokingId) return;
    setRevokingId(id);
    try {
      await authService.revokeSession(id);
      toast.success('Device signed out');
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setRevokingId(null);
    }
  };

  const hasOtherActive = (list || []).some((s) => !s.revokedAt && !s.current);

  return (
    <Card className="card--pad profile-card profile-card--security">
      <div className="row row--between" style={{ marginBottom: 12, gap: 12 }}>
        <div>
          <div className="profile-section-title" style={{ margin: 0 }}>Active sessions</div>
          <div className="text-sm text-muted">Devices where you&apos;re signed in. Log out any you don&apos;t recognize.</div>
        </div>
        <Button variant="ghost" onClick={onLogoutOthers} disabled={busy || !hasOtherActive}>
          {busy ? 'Signing out…' : 'Log out all others'}
        </Button>
      </div>

      {list == null ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-sm text-muted">No sessions recorded yet.</div>
      ) : (
        <ul className="login-history">
          {list.map((s) => (
            <li key={s.id} className={`login-history__row${s.revokedAt ? ' is-revoked' : ''}`}>
              <span className="login-history__main">
                <span className="login-history__device">
                  {deviceLabel(s.userAgent)}
                  {s.current && <span className="login-history__badge">This device</span>}
                </span>
                <span className="login-history__meta">
                  {s.ip || 'unknown IP'} · signed in {fmt(s.createdAt)}
                  {s.revokedAt
                    ? ' · signed out'
                    : s.lastSeenAt
                      ? ` · last active ${fmt(s.lastSeenAt)}`
                      : ''}
                </span>
              </span>
              {!s.revokedAt && !s.current && (
                <button
                  type="button"
                  className="login-history__revoke"
                  onClick={() => onRevoke(s.id)}
                  disabled={revokingId === s.id}
                >
                  {revokingId === s.id ? '…' : 'Log out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
