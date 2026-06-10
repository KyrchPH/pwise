import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as authService from '../../services/auth.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Button, Field, PasswordInput, Modal } from '../../components/ui.jsx';

const STEPS = [
  { key: 'current', label: 'Verify' },
  { key: 'code', label: 'Email code' },
  { key: 'newpass', label: 'New password' },
];

// Outline icons matching the app's SVG convention (24-grid, currentColor stroke).
const Svg = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />
);
const LockIcon = () => (
  <Svg width="26" height="26">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
);
const MailIcon = () => (
  <Svg width="24" height="24">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </Svg>
);
const CheckIcon = () => (
  <Svg width="16" height="16" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

/**
 * Change-password flow (3 steps): confirm the current password (which emails a
 * one-time code) → enter the code in a dialog → set + confirm the new password.
 */
export default function ChangePasswordPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [stage, setStage] = useState('current'); // current | code | newpass
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const stageIndex = STEPS.findIndex((s) => s.key === stage);

  // Step 1: confirm current password → server emails a code → open the dialog.
  const start = async (e) => {
    e?.preventDefault();
    if (!currentPassword) return toast.error('Enter your current password.');
    setBusy(true);
    try {
      const res = await authService.startPasswordChange(currentPassword);
      setSentTo(res.email || 'your email');
      setCode('');
      setStage('code');
      setCodeOpen(true);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  // Step 2: verify the emailed code → advance to the new-password form.
  const verify = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return toast.error('Enter the code from your email.');
    setBusy(true);
    try {
      await authService.verifyPasswordCode(code.trim());
      setCodeOpen(false);
      setStage('newpass');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  // Step 3: set the new password.
  const complete = async (e) => {
    e?.preventDefault();
    if (newPassword.length < 8) return toast.error('New password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return toast.error('Passwords do not match.');
    setBusy(true);
    try {
      await authService.completePasswordChange(newPassword);
      toast.success('Password changed');
      navigate('/settings');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pwchange">
      <Link to="/settings" className="pwchange__back">
        ← Back to settings
      </Link>

      <div className="pwchange__head">
        <span className="pwchange__icon">
          <LockIcon />
        </span>
        <h1 className="pwchange__title">Change password</h1>
        <p className="pwchange__sub">Confirm it&rsquo;s you, enter the code we email you, then set a new password.</p>
      </div>

      <ol className="pwsteps">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className={`pwsteps__item${i === stageIndex ? ' is-active' : ''}${i < stageIndex ? ' is-done' : ''}`}
          >
            <span className="pwsteps__num">{i < stageIndex ? <CheckIcon /> : i + 1}</span>
            <span className="pwsteps__label">{s.label}</span>
          </li>
        ))}
      </ol>

      <Card className="card--pad pwchange__card">
        {stage === 'current' && (
          <form onSubmit={start} className="col gap-sm">
            <div className="pwchange__steptitle">Confirm your current password</div>
            <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
              For your security, re-enter your password to continue.
            </div>
            <Field label="Current password">
              <PasswordInput
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" disabled={busy} className="btn--block mt-lg">
              {busy ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        )}

        {stage === 'code' && (
          <div className="col gap-sm pwchange__notice">
            <span className="pwchange__noticeicon">
              <MailIcon />
            </span>
            <div className="pwchange__steptitle">Check your email</div>
            <div className="text-sm text-muted">
              We sent a 6-digit code to <strong>{sentTo}</strong>. Enter it to continue.
            </div>
            <Button onClick={() => setCodeOpen(true)} className="btn--block mt-lg">
              Enter code
            </Button>
          </div>
        )}

        {stage === 'newpass' && (
          <form onSubmit={complete} className="col gap-sm">
            <div className="fb-test-ok" style={{ marginBottom: 6 }}>
              ✓ Identity verified
            </div>
            <div className="pwchange__steptitle">Set a new password</div>
            <Field label="New password" hint="At least 8 characters">
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm new password">
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </Field>
            <Button type="submit" disabled={busy} className="btn--block mt-lg">
              {busy ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        )}
      </Card>

      <Modal
        open={codeOpen}
        title="Enter verification code"
        onClose={() => setCodeOpen(false)}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCodeOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={verify} disabled={busy}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
          </>
        }
      >
        <form onSubmit={verify} className="col gap-sm">
          <div className="text-sm text-muted">Enter the 6-digit code sent to {sentTo || 'your email'}.</div>
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
          <button type="button" className="link pwresend" onClick={() => start()} disabled={busy}>
            Resend code
          </button>
        </form>
      </Modal>
    </div>
  );
}
