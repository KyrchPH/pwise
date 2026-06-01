import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import { Card, Button, Field } from '../../components/ui.jsx';

export default function LoginPage() {
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
        toast.success('Welcome back!');
      } else {
        await register({ name: form.name, email: form.email, password: form.password });
        toast.success('Account created!');
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Card className="auth__card card--pad">
        <div className="auth__head">
          <div className="brand">
            <span className="brand__mark">p</span>
            <span className="brand__name">pwise</span>
          </div>
          <div className="auth__sub">Automated social-media post scheduler</div>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={`tabs__btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            className={`tabs__btn ${mode === 'register' ? 'active' : ''}`}
            onClick={() => setMode('register')}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <Field label="Name">
              <input className="input" value={form.name} onChange={set('name')} placeholder="Jane Doe" required />
            </Field>
          )}
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
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="••••••••"
              required
            />
          </Field>

          <Button type="submit" size="lg" className="btn--block mt-0" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted mt-lg">
          Demo: <strong>demo@example.com</strong> / <strong>Password123!</strong>
        </p>
      </Card>
    </div>
  );
}
