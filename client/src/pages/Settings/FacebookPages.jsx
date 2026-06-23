import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as pagesService from '../../services/pages.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, Button, Field, Spinner, PageAvatar } from '../../components/ui.jsx';

const EditIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const GearIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

// Small brand marks for the platforms a page is connected to.
function FacebookLogo({ title = 'Facebook' }) {
  return (
    <span className="platform-logo" title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#1877F2" />
        <path
          d="M15.5 12.5l.4-2.6h-2.5V8.2c0-.7.35-1.4 1.45-1.4h1.15V4.6s-1.05-.18-2.05-.18c-2.1 0-3.45 1.27-3.45 3.56v2.02H8.2v2.6h2.25V19h2.95v-6.5z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}
function TelegramLogo({ title = 'Telegram' }) {
  return (
    <span className="platform-logo" title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#229ED9" />
        <path
          d="M17.8 7.2 15.6 17c-.15.7-.6.85-1.2.53l-3.3-2.43-1.6 1.54c-.18.18-.33.33-.67.33l.24-3.4 6.16-5.56c.27-.24-.06-.37-.42-.13L7.4 12.07l-3.27-1.02c-.7-.22-.72-.7.15-1.04l12.78-4.92c.6-.22 1.12.13.74 1.13z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

// `telegram_has`/`telegram_username` are loaded from the page on edit (display +
// "keep current key" behaviour); `telegram_remove` detaches an attached bot.
const BLANK = {
  account_name: '',
  fb_page_id: '',
  access_token: '',
  telegram_bot_name: '',
  telegram_api_key: '',
  telegram_remove: false,
  telegram_has: false,
  telegram_username: '',
  ai_prompt_sales: '',
  ai_prompt_support: '',
  ai_prompt_general: '',
  ai_defaults: null,
  an_periodDays: 7,
  an_crrHours: 12,
  an_frtMin: 5,
  an_artMin: 5,
};

export default function FacebookPages({ embedded = false }) {
  const toast = useToast();
  const { hash } = useLocation();
  const { refresh: refreshSwitcher } = usePages();
  const { isAdmin } = useAuth();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id?, ...fields }
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false); // FB connection verified for the CURRENT field values
  const [testInfo, setTestInfo] = useState(null); // { name, followers } from the successful test
  const [menuId, setMenuId] = useState(null); // page whose options dropdown is open
  const [refreshingId, setRefreshingId] = useState(null); // page whose webhook is re-registering

  const load = () => {
    setLoading(true);
    pagesService
      .list()
      .then(setPages)
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  // Deep-link from the switcher's "Update" button: scroll this section into view
  // and briefly highlight it when navigated to with #facebook-pages.
  useEffect(() => {
    if (hash !== '#facebook-pages') return undefined;
    const el = document.getElementById('facebook-pages');
    if (!el) return undefined;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash-highlight');
    const t = setTimeout(() => el.classList.remove('flash-highlight'), 1800);
    return () => clearTimeout(t);
  }, [hash]);

  // Close the open page-options dropdown on outside-click / Escape.
  useEffect(() => {
    if (menuId == null) return undefined;
    const onDown = (e) => {
      if (!e.target.closest('.fb-page-menu')) setMenuId(null);
    };
    const onKey = (e) => e.key === 'Escape' && setMenuId(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  const resetTest = () => {
    setTested(false);
    setTestInfo(null);
  };
  const startAdd = () => {
    resetTest();
    setEditing({ ...BLANK });
    // Pre-fill the per-agent prompts with the built-in defaults so the admin edits
    // from a working base (all three are required to connect).
    if (isAdmin) {
      pagesService
        .getAiDefaults()
        .then((d) =>
          setEditing((ed) =>
            ed && !ed.id
              ? {
                  ...ed,
                  ai_prompt_sales: d.sales || '',
                  ai_prompt_support: d.support || '',
                  ai_prompt_general: d.general || '',
                  ai_defaults: d,
                }
              : ed,
          ),
        )
        .catch((e) => toast.error(apiError(e)));
    }
  };
  const startEdit = (p) => {
    resetTest();
    setEditing({
      ...BLANK,
      id: p.id,
      account_name: p.account_name || '',
      fb_page_id: p.fb_page_id || '',
      telegram_bot_name: p.telegram_bot_name || '',
      telegram_has: !!p.has_telegram_bot,
      telegram_username: p.telegram_bot_username || '',
      an_periodDays: p.analytics_config?.periodDays ?? 7,
      an_crrHours: p.analytics_config?.crrWindowHours ?? 12,
      an_frtMin: Math.round((p.analytics_config?.frtTargetSeconds ?? 300) / 60),
      an_artMin: Math.round((p.analytics_config?.artTargetSeconds ?? 300) / 60),
    });
    // Pull this page's per-agent AI prompts (+ defaults) for the editor (admin only).
    if (isAdmin) {
      pagesService
        .getAiConfig(p.id)
        .then((cfg) =>
          setEditing((ed) =>
            ed && ed.id === p.id
              ? {
                  ...ed,
                  ai_prompt_sales: cfg.prompts.sales || cfg.defaults?.sales || '',
                  ai_prompt_support: cfg.prompts.support || cfg.defaults?.support || '',
                  ai_prompt_general: cfg.prompts.general || cfg.defaults?.general || '',
                  ai_defaults: cfg.defaults || null,
                }
              : ed,
          ),
        )
        .catch((e) => toast.error(apiError(e)));
    }
  };
  const cancel = () => {
    resetTest();
    setEditing(null);
  };
  // A Facebook field edit invalidates a prior successful test → back to "Connect".
  const setField = (k) => (e) => {
    const v = e.target.value;
    setEditing((ed) => ({ ...ed, [k]: v }));
    resetTest();
  };
  // Telegram fields are independent of the Facebook connection test, so editing
  // them does NOT reset the test gate.
  const setTgField = (k) => (e) => {
    const v = e.target.value;
    setEditing((ed) => ({ ...ed, [k]: v }));
  };
  // AI prompt fields are independent of the Facebook connection test too.
  const setAiField = (k) => (e) => {
    const v = e.target.value;
    setEditing((ed) => ({ ...ed, [k]: v }));
  };

  // Step 1 — verify the PAGE credentials against Facebook. On success the primary
  // button flips to "Add page" / "Save". (Edits may leave the token blank to reuse
  // the stored one; the server falls back to it.)
  const runTest = async () => {
    const fbPageId = editing.fb_page_id.trim();
    if (!fbPageId && !editing.id) return toast.error('Facebook Page ID is required.');
    if (!editing.id && !editing.access_token.trim()) return toast.error('Page access token is required to test.');
    setBusy(true);
    try {
      const res = await pagesService.test({
        id: editing.id,
        fb_page_id: fbPageId,
        ...(editing.access_token.trim() ? { access_token: editing.access_token.trim() } : {}),
      });
      setTestInfo(res);
      setTested(true);
      toast.success(`Connection OK — ${res.name || 'page verified'}`);
    } catch (e) {
      resetTest();
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  // Step 2 — persist. Only reachable once the FB connection has tested OK. The
  // optional Telegram bot is validated server-side on save (Telegram getMe).
  const commit = async () => {
    const name = editing.account_name.trim();
    const fbPageId = editing.fb_page_id.trim();
    if (!name) return toast.error('Give the page a name.');
    if (!fbPageId) return toast.error('Facebook Page ID is required.');
    // All three agent prompts are required (admins configure them here).
    if (isAdmin) {
      const blank = ['sales', 'support', 'general'].find((r) => !String(editing[`ai_prompt_${r}`] || '').trim());
      if (blank) return toast.error('Set the AI system prompt for all three agents before saving.');
    }
    // Attaching a bot needs its API key (the bot name alone isn't enough).
    const attachingBot = !editing.telegram_has && !editing.telegram_remove && editing.telegram_bot_name.trim();
    if (attachingBot && !editing.telegram_api_key.trim()) {
      return toast.error('Enter the Telegram bot API key to attach it (or clear the bot name).');
    }
    setBusy(true);
    try {
      const payload = {
        account_name: name,
        fb_page_id: fbPageId,
        // Token is write-only: send only when filled (blank on edit = keep current).
        ...(editing.access_token.trim() ? { access_token: editing.access_token.trim() } : {}),
      };
      if (editing.id && editing.telegram_remove) {
        payload.telegram_remove = true;
      } else {
        payload.telegram_bot_name = editing.telegram_bot_name.trim();
        if (editing.telegram_api_key.trim()) payload.telegram_api_key = editing.telegram_api_key.trim();
      }
      // Per-agent AI prompts (admin-only) — sent on both connect and edit. The server
      // trims; blanks are blocked above, so every page is saved with all three set.
      if (isAdmin) {
        payload.ai_prompt_sales = editing.ai_prompt_sales ?? '';
        payload.ai_prompt_support = editing.ai_prompt_support ?? '';
        payload.ai_prompt_general = editing.ai_prompt_general ?? '';
      }
      // Messaging-analytics thresholds (admin-only; existing pages). Minutes → seconds;
      // the server clamps to sane ranges.
      if (editing.id && isAdmin) {
        payload.analytics_config = {
          periodDays: Number(editing.an_periodDays) || 7,
          crrWindowHours: Number(editing.an_crrHours) || 12,
          frtTargetSeconds: Math.round((Number(editing.an_frtMin) || 5) * 60),
          artTargetSeconds: Math.round((Number(editing.an_artMin) || 5) * 60),
        };
      }
      if (editing.id) await pagesService.update(editing.id, payload);
      else await pagesService.create(payload);
      toast.success(editing.id ? 'Page updated' : 'Page connected');
      setEditing(null);
      resetTest();
      load();
      refreshSwitcher(); // keep the switcher in sync
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  // The primary button is a two-step gate: test the connection, then save.
  const onPrimary = () => (tested ? commit() : runTest());

  const del = async (p) => {
    if (busy) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${p.account_name}"? Posts tied to it will be unlinked (not deleted).`)) return;
    setBusy(true);
    try {
      await pagesService.remove(p.id);
      setPages((prev) => prev.filter((x) => x.id !== p.id));
      refreshSwitcher();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  // Re-register this page's Telegram bot webhook with the platform (the menu's
  // "Refresh") — no re-save needed. Reports back what Telegram now has registered.
  const refreshWebhook = async (p) => {
    if (refreshingId != null) return;
    setRefreshingId(p.id);
    try {
      const { telegram } = await pagesService.refreshWebhook(p.id);
      if (telegram?.ok) {
        const pending = telegram.pendingUpdateCount;
        toast.success(
          `Telegram webhook re-registered for "${p.account_name}".` +
            (pending ? ` ${pending} queued message${pending === 1 ? '' : 's'} will arrive shortly.` : ''),
        );
      } else if (telegram && !telegram.ok) {
        toast.error(`Couldn't register the Telegram webhook: ${telegram.error}`);
      } else {
        toast.success('Nothing to refresh — no Telegram bot is attached to this page.');
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setRefreshingId(null);
    }
  };

  const secretHint = (label) => (editing?.id ? 'leave blank to keep current' : label);
  // Show the "keep current"/masked affordances only when a bot is already attached.
  const botKeyHint = editing?.telegram_has ? 'leave blank to keep current' : 'required to attach a bot';

  const body = (
    <>
      <div className="row row--between" style={{ marginBottom: 14, gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Facebook Pages</div>
          <div className="text-sm text-muted">
            Pages you can post to — each can optionally have a Telegram bot attached. Credentials are encrypted at rest;
            switch the active page from the top bar.
          </div>
        </div>
        {!editing && (
          <Button size="sm" onClick={startAdd}>
            + Connect page
          </Button>
        )}
      </div>

      {editing ? (
        <div className="ct-form">
          <Field label="Page name">
            <input className="input" value={editing.account_name} onChange={setField('account_name')} placeholder="e.g. Wise Cleaner Shop" />
          </Field>
          <Field label="Facebook Page ID">
            <input className="input" value={editing.fb_page_id} onChange={setField('fb_page_id')} placeholder="722625860935626" />
          </Field>
          <Field label="Page access token" hint={secretHint('required')}>
            <input className="input" type="password" value={editing.access_token} onChange={setField('access_token')} autoComplete="new-password" placeholder={editing.id ? '••••••••' : ''} />
          </Field>
          {tested && (
            <div className="fb-test-ok">
              ✓ Connection verified{testInfo?.name ? ` — ${testInfo.name}` : ''}
              {testInfo?.followers != null ? ` · ${Number(testInfo.followers).toLocaleString()} followers` : ''}
            </div>
          )}

          {/* Optional Telegram bot attached to this page. */}
          <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid rgba(127,127,127,0.2)' }}>
            <div className="row row--between" style={{ gap: 12, marginBottom: 4 }}>
              <div style={{ fontWeight: 600 }} className="text-sm">
                Telegram bot <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span>
              </div>
              {editing.telegram_has && (
                <label className="text-sm row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editing.telegram_remove}
                    onChange={(e) => setEditing((ed) => ({ ...ed, telegram_remove: e.target.checked }))}
                  />
                  Remove bot
                </label>
              )}
            </div>
            {editing.telegram_remove ? (
              <div className="text-sm text-muted">The attached Telegram bot will be removed when you save.</div>
            ) : (
              <>
                <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
                  Attach a bot to this page. Create one with @BotFather on Telegram, then paste its token.
                  {editing.telegram_has && editing.telegram_username ? ` Currently @${editing.telegram_username}.` : ''}
                </div>
                <Field label="Bot name">
                  <input className="input" value={editing.telegram_bot_name} onChange={setTgField('telegram_bot_name')} placeholder="e.g. Wise Cleaner Bot" />
                </Field>
                <Field label="Bot API key" hint={botKeyHint}>
                  <input
                    className="input"
                    type="password"
                    value={editing.telegram_api_key}
                    onChange={setTgField('telegram_api_key')}
                    autoComplete="new-password"
                    placeholder={editing.telegram_has ? '••••••••' : '123456789:ABCdef…'}
                  />
                </Field>
              </>
            )}
          </div>

          {/* Per-page AI assistant prompts — admin only; all three required to connect/save. */}
          {isAdmin && (
            <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid rgba(127,127,127,0.2)' }}>
              <div className="text-sm" style={{ fontWeight: 600 }}>AI Assistant prompts</div>
              <div className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>
                How this page&apos;s AI replies for each intent. Pre-filled with sensible defaults — edit them for this
                business. All three are required. The tool-grounding, human-handoff, and formatting rules are always
                enforced on top and can&apos;t be removed here.
              </div>
              {[
                { role: 'sales', label: 'Sales agent' },
                { role: 'support', label: 'Support agent' },
                { role: 'general', label: 'General inquiry agent' },
              ].map(({ role, label }) => {
                const key = `ai_prompt_${role}`;
                const def = editing.ai_defaults?.[role] || '';
                const isDefault = !!def && editing[key]?.trim() === def.trim();
                return (
                  <Field key={role} label={label} hint={isDefault ? 'default' : 'custom'}>
                    <textarea
                      className="input"
                      rows={7}
                      value={editing[key]}
                      onChange={setAiField(key)}
                      placeholder="Describe how this agent should behave…"
                    />
                    {def && !isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        style={{ marginTop: 4 }}
                        onClick={() => setEditing((ed) => ({ ...ed, [key]: def }))}
                      >
                        Reset to default
                      </Button>
                    )}
                  </Field>
                );
              })}
            </div>
          )}

          {/* Messaging analytics thresholds — admin only, existing pages (drives the inbox rail gauges). */}
          {isAdmin && editing.id && (
            <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid rgba(127,127,127,0.2)' }}>
              <div className="text-sm" style={{ fontWeight: 600 }}>Messaging analytics</div>
              <div className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>
                Thresholds for this page&apos;s live-agent response metrics (CRR / FRT / ART) in the inbox rail. CRR counts
                customer chats answered within the window; FRT/ART score the average reply time against the target.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Measurement period (days)">
                  <input className="input" type="number" min="1" max="365" value={editing.an_periodDays} onChange={setAiField('an_periodDays')} />
                </Field>
                <Field label="CRR window (hours)">
                  <input className="input" type="number" min="1" max="720" value={editing.an_crrHours} onChange={setAiField('an_crrHours')} />
                </Field>
                <Field label="FRT target (minutes)">
                  <input className="input" type="number" min="1" max="1440" value={editing.an_frtMin} onChange={setAiField('an_frtMin')} />
                </Field>
                <Field label="ART target (minutes)">
                  <input className="input" type="number" min="1" max="1440" value={editing.an_artMin} onChange={setAiField('an_artMin')} />
                </Field>
              </div>
            </div>
          )}

          <div className="row gap-sm" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant={tested ? 'accent' : 'primary'} onClick={onPrimary} disabled={busy}>
              {busy ? (tested ? 'Saving…' : 'Testing…') : tested ? (editing.id ? 'Save' : 'Add page') : 'Connect'}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <Spinner label="Loading pages…" />
      ) : pages.length === 0 ? (
        <div className="text-sm text-muted" style={{ padding: '6px 0' }}>
          No pages connected yet. Connect one to start posting.
        </div>
      ) : (
        <div className="fb-pages">
          {pages.map((p) => (
            <div
              key={p.id}
              className={`fb-page-card${!p.is_active ? ' is-disabled' : ''}${menuId === p.id ? ' is-menu-open' : ''}`}
            >
              <PageAvatar page={p} className="fb-page-card__photo" />
              <div className="fb-page-card__body">
                <div className="fb-page-card__name" title={p.account_name}>{p.account_name}</div>
                <div className="fb-page-card__sub">
                  {p.has_telegram_bot ? (
                    // Page has another platform attached → show the platform logos.
                    <span className="fb-page-card__platforms">
                      <FacebookLogo />
                      <TelegramLogo title={p.telegram_bot_username ? `Telegram · @${p.telegram_bot_username}` : 'Telegram'} />
                    </span>
                  ) : (
                    // Facebook only → just a count.
                    <span>1 connected</span>
                  )}
                  {!p.is_active && <span className="fb-chip">Disabled</span>}
                </div>
              </div>
              <div className="fb-page-card__actions fb-page-menu">
                <button
                  type="button"
                  className="card-iconbtn"
                  title="Options"
                  aria-label={`Options for ${p.account_name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuId === p.id}
                  onClick={() => setMenuId((cur) => (cur === p.id ? null : p.id))}
                >
                  <GearIcon />
                </button>
                {menuId === p.id && (
                  <div className="card-menu" role="menu">
                    <button
                      type="button"
                      className="card-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setMenuId(null);
                        startEdit(p);
                      }}
                    >
                      <EditIcon />
                      Edit
                    </button>
                    {p.has_telegram_bot && (
                      <button
                        type="button"
                        className="card-menu__item"
                        role="menuitem"
                        title="Re-register this page's Telegram webhook"
                        disabled={refreshingId === p.id}
                        onClick={() => {
                          setMenuId(null);
                          refreshWebhook(p);
                        }}
                      >
                        <RefreshIcon />
                        {refreshingId === p.id ? 'Refreshing…' : 'Refresh'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="card-menu__item card-menu__item--danger"
                      role="menuitem"
                      onClick={() => {
                        setMenuId(null);
                        del(p);
                      }}
                    >
                      <TrashIcon />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // In Settings the whole view is one parent card, so render as a bare section;
  // used standalone it keeps its own card wrapper.
  return embedded ? (
    <section id="facebook-pages" className="settings-section">
      {body}
    </section>
  ) : (
    <Card id="facebook-pages" className="card--pad" style={{ marginTop: 24, maxWidth: 640 }}>
      {body}
    </Card>
  );
}
