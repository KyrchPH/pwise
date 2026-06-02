import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import { Card, Button, Field, Logo, PasswordInput } from '../../components/ui.jsx';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(form.email, form.password);
      toast.success('Welcome back!');
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
          <div className="auth__sub">Automated social-media post scheduler</div>
        </div>

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
    </div>
  );
}
