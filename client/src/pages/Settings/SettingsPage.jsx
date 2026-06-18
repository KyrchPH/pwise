import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as settingsService from '../../services/settings.service.js';
import { apiError } from '../../services/api.js';
import env from '../../config/env.js';
import { invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, Button, Field, Toggle, Spinner } from '../../components/ui.jsx';
import CreatomateTemplates from './CreatomateTemplates.jsx';
import FacebookPages from './FacebookPages.jsx';

const TIMEZONES = [
  'Asia/Manila',
  'UTC',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

function NavIco({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const NAV_ICONS = {
  posting: (
    <NavIco>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </NavIco>
  ),
  pages: (
    <NavIco>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </NavIco>
  ),
  templates: (
    <NavIco>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <line x1="7" y1="3" x2="7" y2="21" />
      <line x1="17" y1="3" x2="17" y2="21" />
      <line x1="2" y1="9" x2="22" y2="9" />
      <line x1="2" y1="15" x2="22" y2="15" />
    </NavIco>
  ),
};

export default function SettingsPage() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { hash } = useLocation();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState('posting'); // selected settings section

  useEffect(() => {
    settingsService
      .get()
      .then((s) =>
        setForm({
          is_enabled: !!s.is_enabled,
          timezone: s.timezone,
          low_pool_alert_threshold: s.low_pool_alert_threshold,
          owner_email: s.owner_email || '',
        }),
      )
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link from the page switcher's "Update"/"Add page" → open the Pages tab
  // (FacebookPages then scrolls/highlights itself via the same hash).
  useEffect(() => {
    if (hash === '#facebook-pages' && isAdmin) setActive('pages');
  }, [hash, isAdmin]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await settingsService.update({
        is_enabled: form.is_enabled,
        timezone: form.timezone,
        low_pool_alert_threshold: Number(form.low_pool_alert_threshold) || 0,
        owner_email: form.owner_email,
      });
      invalidateCache('dashboard'); // the dashboard surfaces these settings
      toast.success('Settings saved');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading settings…" />;
  if (!form) return null;

  const tzOptions = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  // Nav sections (some are conditional on role / feature flags).
  const navItems = [
    { id: 'posting', label: 'Posting' },
    ...(isAdmin ? [{ id: 'pages', label: 'Pages' }] : []),
    ...(env.templatesEnabled ? [{ id: 'templates', label: 'Templates' }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Settings</h1>
          <div className="page-head__sub">Control when and how the agent posts.</div>
        </div>
      </div>

      <div className="settings-layout">
        {/* Container 1 — section navigation. */}
        <Card className="settings-nav">
          <nav className="settings-nav__list" aria-label="Settings sections">
            {navItems.map((it) => (
              <button
                key={it.id}
                type="button"
                className={`settings-nav__item${active === it.id ? ' is-active' : ''}`}
                aria-current={active === it.id ? 'page' : undefined}
                onClick={() => setActive(it.id)}
              >
                <span className="settings-nav__icon">{NAV_ICONS[it.id]}</span>
                <span>{it.label}</span>
              </button>
            ))}
          </nav>
        </Card>

        {/* Container 2 — the active section's options. */}
        <Card className="card--pad settings-content">
          {active === 'posting' && (
            <form onSubmit={save}>
              <div className="row row--between" style={{ marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Scheduled publishing</div>
                  <div className="text-sm text-muted">Master switch for due scheduled posts.</div>
                </div>
                <Toggle checked={form.is_enabled} onChange={(v) => set('is_enabled', v)} />
              </div>

              <Field label="Timezone">
                <select className="select" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {tzOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid-2">
                <Field label="Low-pool alert threshold" hint="Email when ready posts ≤ this">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={form.low_pool_alert_threshold}
                    onChange={(e) => set('low_pool_alert_threshold', e.target.value)}
                  />
                </Field>
                <Field label="Owner email" hint="Where low-pool alerts are sent">
                  <input
                    className="input"
                    type="email"
                    value={form.owner_email}
                    onChange={(e) => set('owner_email', e.target.value)}
                    placeholder="owner@example.com"
                  />
                </Field>
              </div>

              <Button type="submit" size="lg" className="settings-save-btn" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </Button>
            </form>
          )}

          {active === 'pages' && isAdmin && <FacebookPages embedded />}
          {active === 'templates' && env.templatesEnabled && <CreatomateTemplates embedded />}
        </Card>
      </div>
    </>
  );
}
