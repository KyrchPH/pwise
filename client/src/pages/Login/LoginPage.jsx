import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError, isServerError } from '../../services/api.js';
import { Card, Button, Field, Logo, PasswordInput, AuthErrorScreen, Modal } from '../../components/ui.jsx';

export default function LoginPage() {
  const { login, verifyLogin, resendLoginCode, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [locked, setLocked] = useState(''); // non-empty → account-locked banner

  // OTP challenge (new device). null when no challenge is in flight.
  const [challenge, setChallenge] = useState(null); // { email, expiresInMinutes, challengeToken }
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const set = (key) => (e) => {
    setLocked('');
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const done = () => {
    toast.success('Welcome back!');
    navigate('/dashboard', { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setLocked('');
    try {
      const res = await login(form.email, form.password);
      if (res.done) return done();
      // New device → collect the emailed code.
      setChallenge({ email: res.email, expiresInMinutes: res.expiresInMinutes, challengeToken: res.challengeToken });
      setCode('');
      setTrustDevice(false);
    } catch (err) {
      // A locked account (423) is a distinct, actionable state — show it inline, not as a
      // fleeting toast. A 5xx/network error means the backend is down (retry screen).
      if (err?.response?.status === 423) setLocked(apiError(err));
      else if (isServerError(err)) setServerError(true);
      else toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return toast.error('Enter the code from your email.');
    setVerifying(true);
    try {
      await verifyLogin({ email: form.email, challengeToken: challenge.challengeToken, code: code.trim(), trustDevice });
      setChallenge(null);
      done();
    } catch (err) {
      // An expired/consumed challenge (410) can't be retried — send them back to the form.
      if (err?.response?.status === 410) {
        setChallenge(null);
        toast.error(apiError(err));
      } else {
        toast.error(apiError(err));
      }
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (!challenge) return;
    try {
      const res = await resendLoginCode(challenge.challengeToken);
      setChallenge((c) => (c ? { ...c, email: res.email ?? c.email } : c));
      toast.info('We sent a new code.');
    } catch (err) {
      if (err?.response?.status === 410) {
        setChallenge(null);
        toast.error(apiError(err));
      } else {
        toast.error(apiError(err));
      }
    }
  };

  if (serverError) return <AuthErrorScreen onRetry={() => setServerError(false)} />;

  return (
    <div className="auth">
      <Card className="auth__card card--pad">
        <div className="auth__head">
          <Logo height={120} className="auth__logo" />
          <div className="auth__sub">One place to run your social store</div>
        </div>

        {locked && (
          <div className="error-text" role="alert" style={{ marginBottom: 12 }}>
            {locked}
          </div>
        )}

        <form onSubmit={submit}>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@example.com"
              required
            />
          </Field>
          <Field label="Password">
            <PasswordInput value={form.password} onChange={set('password')} placeholder="••••••••" required />
          </Field>

          <Button type="submit" size="lg" className="btn--block" disabled={busy}>
            {busy ? 'Please wait…' : 'Log in'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted mt-lg">
          Accounts are invite-only. Need access? Ask an admin for a sign-up link.
        </p>
        <p className="text-center text-sm mt-lg">
          <Link to="/privacy" className="link">
            Privacy Policy
          </Link>
        </p>
      </Card>

      {/* New-device verification: enter the emailed code, optionally trust this device. */}
      <Modal
        open={!!challenge}
        title="Verify it's you"
        onClose={() => (!verifying ? setChallenge(null) : undefined)}
        dismissable={!verifying}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setChallenge(null)} disabled={verifying}>
              Cancel
            </Button>
            <Button size="sm" onClick={verify} disabled={verifying}>
              {verifying ? 'Verifying…' : 'Verify & log in'}
            </Button>
          </>
        }
      >
        <form onSubmit={verify} className="col gap-sm">
          <div className="text-sm text-muted">
            This is a new device, so we emailed a 6-digit code to <strong>{challenge?.email || 'your email'}</strong>.
            Enter it to finish signing in.
          </div>
          <Field label="Verification code">
            <input
              className="input pwcode__input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </Field>
          <label className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            <span className="text-sm">Trust this device — skip this step here for 30 days</span>
          </label>
          <button type="button" className="link pwresend" onClick={resend} disabled={verifying}>
            Resend code
          </button>
        </form>
      </Modal>
    </div>
  );
}
