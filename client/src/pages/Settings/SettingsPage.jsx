import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import * as settingsService from '../../services/settings.service.js';
import { apiError } from '../../services/api.js';
import env from '../../config/env.js';
import { invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, Button, Field, Toggle, Spinner } from '../../components/ui.jsx';
import CreatomateTemplates from './CreatomateTemplates.jsx';
import FacebookPages from './FacebookPages.jsx';
import AutomationControls from './AutomationControls.jsx';

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

export default function SettingsPage() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { hash } = useLocation();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const requestedSection = hash === '#facebook-pages' ? 'pages' : searchParams.get('section') || 'posting';
  const availableSections = [
    'posting',
    ...(isAdmin ? ['pages'] : []),
    ...(env.templatesEnabled ? ['templates'] : []),
    ...(isAdmin ? ['automation'] : []),
  ];
  const active = availableSections.includes(requestedSection) ? requestedSection : 'posting';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Settings</h1>
          <div className="page-head__sub">Control when and how the agent posts.</div>
        </div>
      </div>

      <div className="settings-layout settings-layout--single">
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
          {active === 'automation' && isAdmin && <AutomationControls />}
        </Card>
      </div>
    </>
  );
}
