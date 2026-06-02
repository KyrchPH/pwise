import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import * as authService from '../../services/auth.service.js';
import { Card, Button, Field, Logo, PasswordInput, Spinner } from '../../components/ui.jsx';

export default function SignupPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const { register, isAuthenticated } = useAuth();

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  // Validate the invite link before showing the form.
  useEffect(() => {
    if (!token) {
      setTokenError('This sign-up link is missing its token.');
      setChecking(false);
      return;
    }
    authService
      .validateInvite(token)
      .then(() => setValid(true))
      .catch((e) => setTokenError(apiError(e)))
      .finally(() => setChecking(false));
  }, [token]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password, token });
      toast.success('Account created!');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(apiError(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Card className="auth__card card--pad">
        <div className="auth__head">
          <Logo height={120} className="auth__logo" />
          <div className="auth__sub">Create your account</div>
        </div>

        {checking ? (
          <Spinner label="Checking your invite…" />
        ) : !valid ? (
          <>
            <div className="banner banner--warning" style={{ marginBottom: 0 }}>
              ⚠️ {tokenError}
            </div>
            <Button as={Link} to="/login" variant="ghost" className="btn--block mt-lg">
              Back to login
            </Button>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="Name">
              <input className="input" value={form.name} onChange={set('name')} placeholder="Jane Doe" required />
            </Field>
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
            <Field label="Password" hint="At least 8 characters">
              <PasswordInput value={form.password} onChange={set('password')} placeholder="••••••••" required />
            </Field>
            <Field label="Confirm password">
              <PasswordInput value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="••••••••" required />
            </Field>
            <Button type="submit" size="lg" className="btn--block" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
