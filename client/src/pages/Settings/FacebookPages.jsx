import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as pagesService from '../../services/pages.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { CURRENCIES } from '../../config/currency.js';
import { Card, Button, Field, Modal, Spinner, PageAvatar } from '../../components/ui.jsx';

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

// Monochrome line icons used in the settings-accordion headers (config sections,
// as opposed to the coloured brand badges used for messaging channels).
const iconProps = {
  viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};
const SparkleIcon = () => (
  <svg {...iconProps}>
    <path d="M12 3l1.9 4.9L19 9.8l-4.1 1.9L13 17l-1.9-5.3L6 9.8l4.1-1.9L12 3z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
  </svg>
);
const ChatIcon = () => (
  <svg {...iconProps}>
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
  </svg>
);
const HandoffIcon = () => (
  <svg {...iconProps}>
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <circle cx="9" cy="7" r="4" />
    <path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
  </svg>
);
const DocIcon = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const StoreIcon = () => (
  <svg {...iconProps}>
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
  </svg>
);
const ChartIcon = () => (
  <svg {...iconProps}>
    <line x1="4" y1="20" x2="20" y2="20" />
    <rect x="6" y="12" width="3" height="6" rx="1" />
    <rect x="11" y="8" width="3" height="10" rx="1" />
    <rect x="16" y="4" width="3" height="14" rx="1" />
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
function InstagramLogo({ title = 'Instagram' }) {
  return (
    <span className="platform-logo" title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <defs>
          <linearGradient id="ig-badge-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FEDA75" />
            <stop offset="0.25" stopColor="#FA7E1E" />
            <stop offset="0.5" stopColor="#D62976" />
            <stop offset="0.75" stopColor="#962FBF" />
            <stop offset="1" stopColor="#4F5BD5" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#ig-badge-grad)" />
        <rect x="6" y="6" width="12" height="12" rx="4" fill="none" stroke="#fff" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3" fill="none" stroke="#fff" strokeWidth="1.6" />
        <circle cx="15.6" cy="8.4" r="1" fill="#fff" />
      </svg>
    </span>
  );
}
function WhatsappLogo({ title = 'WhatsApp' }) {
  return (
    <span className="platform-logo" title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#25D366" />
        <path
          d="M12 5.5a6.4 6.4 0 0 0-5.5 9.66L5.6 18.5l3.43-.9A6.4 6.4 0 1 0 12 5.5zm0 1.5a4.9 4.9 0 0 1 0 9.8 4.86 4.86 0 0 1-2.5-.68l-.24-.14-1.78.47.47-1.73-.16-.25A4.9 4.9 0 0 1 12 7zm2.86 6.02c-.15-.08-.9-.44-1.04-.5-.14-.05-.24-.07-.34.08-.1.15-.39.5-.48.6-.09.1-.18.11-.33.04a4.1 4.1 0 0 1-1.22-.75 4.6 4.6 0 0 1-.84-1.05c-.09-.15 0-.23.07-.31.07-.07.15-.18.22-.27.08-.1.1-.16.15-.26.05-.1.03-.19-.01-.27-.04-.07-.34-.82-.47-1.12-.12-.29-.25-.25-.34-.25h-.29c-.1 0-.26.03-.4.19-.14.15-.53.51-.53 1.25s.54 1.46.62 1.56c.08.1 1.06 1.7 2.63 2.32 1.3.5 1.57.4 1.85.38.28-.03.9-.37 1.03-.73.13-.36.13-.66.09-.73-.04-.06-.14-.1-.3-.18z"
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
  // Optional Instagram channel (reuses the page access token).
  instagram_account_id: '',
  instagram_username: '',
  instagram_remove: false,
  instagram_has: false,
  // Optional WhatsApp channel (its own Cloud-API token).
  wa_phone_number_id: '',
  wa_business_account_id: '',
  wa_phone_display: '',
  wa_access_token: '',
  whatsapp_remove: false,
  whatsapp_has: false,
  ai_prompt_sales: '',
  ai_prompt_support: '',
  ai_prompt_general: '',
  comment_dm_default_message: '',
  live_agent_transfer_message: '',
  order_terms: '',
  ai_defaults: null,
  // Business profile (contact / location / hours + per-channel links) the AI reads via get_page_info.
  business_profile: {
    address: '',
    phone: '',
    viber: '',
    email: '',
    hours: '',
    website: '',
    notes: '',
    links: { facebook: '', telegram: '', instagram: '', shopee: '', tiktok: '', lazada: '' },
  },
  an_periodDays: 7,
  an_crrHours: 12,
  an_frtMin: 5,
  an_artMin: 5,
  currency: 'PHP',
};

export default function FacebookPages({ embedded = false }) {
  const toast = useToast();
  const { hash, search, pathname } = useLocation();
  const navigate = useNavigate();
  const { refresh: refreshSwitcher } = usePages();
  const { isAdmin } = useAuth();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id?, ...fields }
  const [busy, setBusy] = useState(false);
  const [fbBusy, setFbBusy] = useState(false); // Connect-with-Facebook / import in flight
  const [importBatch, setImportBatch] = useState(null); // { batch, pages, selected:Set } for the picker
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

  // Return from the Facebook OAuth round-trip: ?fbimport=<batch> opens the page
  // picker; ?fbimport_error=<msg> surfaces a failure. The query is stripped afterward
  // so a refresh doesn't re-trigger it.
  const clearImportQuery = () => navigate(`${pathname}#facebook-pages`, { replace: true });
  useEffect(() => {
    const params = new URLSearchParams(search);
    const err = params.get('fbimport_error');
    const batch = params.get('fbimport');
    if (err) {
      toast.error(`Facebook: ${err}`);
      clearImportQuery();
      return;
    }
    if (!batch) return;
    pagesService
      .facebookDiscovered(batch)
      .then((d) => {
        if (d.expired || !d.pages?.length) {
          toast.error('The Facebook import session expired. Please connect again.');
          clearImportQuery();
          return;
        }
        // Pre-select the pages not already connected (already-linked ones are opt-in,
        // since re-importing them just refreshes the token).
        const selected = new Set(d.pages.filter((p) => !p.alreadyConnected).map((p) => p.fb_page_id));
        setImportBatch({ batch, pages: d.pages, selected });
      })
      .catch((e) => {
        toast.error(apiError(e));
        clearImportQuery();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Kick off the OAuth flow — a full-page redirect to Facebook.
  const startFacebookConnect = async () => {
    if (fbBusy) return;
    setFbBusy(true);
    try {
      const url = await pagesService.facebookOAuthUrl();
      window.location.href = url;
    } catch (e) {
      toast.error(apiError(e));
      setFbBusy(false); // only reset on failure — success navigates away
    }
  };

  const toggleImportPage = (id) =>
    setImportBatch((b) => {
      if (!b) return b;
      const selected = new Set(b.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...b, selected };
    });

  const doImport = async () => {
    if (!importBatch || fbBusy) return;
    setFbBusy(true);
    try {
      const results = await pagesService.facebookImport(importBatch.batch, [...importBatch.selected]);
      const done = results.filter((r) => r.status === 'connected' || r.status === 'reconnected');
      const reconnected = results.filter((r) => r.status === 'reconnected').length;
      const failed = results.filter((r) => r.status === 'failed');
      if (done.length) {
        toast.success(
          `Imported ${done.length} page${done.length === 1 ? '' : 's'}${reconnected ? ` (${reconnected} reconnected)` : ''}.`,
        );
      }
      if (failed.length) toast.error(`${failed.length} page${failed.length === 1 ? '' : 's'} couldn’t be imported.`);
      setImportBatch(null);
      clearImportQuery();
      load();
      refreshSwitcher();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setFbBusy(false);
    }
  };

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
      instagram_account_id: p.instagram_account_id || '',
      instagram_username: p.instagram_username || '',
      instagram_has: !!p.instagram_account_id,
      wa_phone_number_id: p.wa_phone_number_id || '',
      wa_business_account_id: p.wa_business_account_id || '',
      wa_phone_display: p.wa_phone_display || '',
      whatsapp_has: !!p.has_whatsapp,
      an_periodDays: p.analytics_config?.periodDays ?? 7,
      an_crrHours: p.analytics_config?.crrWindowHours ?? 12,
      an_frtMin: Math.round((p.analytics_config?.frtTargetSeconds ?? 300) / 60),
      an_artMin: Math.round((p.analytics_config?.artTargetSeconds ?? 300) / 60),
      currency: p.currency || 'PHP',
      comment_dm_default_message: p.comment_dm_default_message || '',
      live_agent_transfer_message: p.live_agent_transfer_message || '',
      order_terms: p.order_terms || '',
      // Merge stored profile over the blank shape so every field is a controlled input
      // (links are merged separately so missing channels stay '' rather than undefined).
      business_profile: {
        ...BLANK.business_profile,
        ...(p.business_profile || {}),
        links: { ...BLANK.business_profile.links, ...((p.business_profile || {}).links || {}) },
      },
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
  // Business-profile fields (nested object) — also independent of the FB test.
  const setBpField = (k) => (e) => {
    const v = e.target.value;
    setEditing((ed) => ({ ...ed, business_profile: { ...ed.business_profile, [k]: v } }));
  };
  // Per-channel link fields (nested under business_profile.links).
  const setLinkField = (ch) => (e) => {
    const v = e.target.value;
    setEditing((ed) => ({
      ...ed,
      business_profile: { ...ed.business_profile, links: { ...ed.business_profile.links, [ch]: v } },
    }));
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
      // Optional Instagram channel (reuses the page access token).
      if (editing.id && editing.instagram_remove) {
        payload.instagram_remove = true;
      } else {
        payload.instagram_account_id = editing.instagram_account_id.trim();
        payload.instagram_username = editing.instagram_username.trim();
      }
      // Optional WhatsApp channel (token is write-only — blank on edit keeps the current one).
      if (editing.id && editing.whatsapp_remove) {
        payload.whatsapp_remove = true;
      } else {
        payload.wa_phone_number_id = editing.wa_phone_number_id.trim();
        payload.wa_business_account_id = editing.wa_business_account_id.trim();
        payload.wa_phone_display = editing.wa_phone_display.trim();
        if (editing.wa_access_token.trim()) payload.wa_access_token = editing.wa_access_token.trim();
      }
      // Per-agent AI prompts (admin-only) — sent on both connect and edit. The server
      // trims; blanks are blocked above, so every page is saved with all three set.
      if (isAdmin) {
        payload.ai_prompt_sales = editing.ai_prompt_sales ?? '';
        payload.ai_prompt_support = editing.ai_prompt_support ?? '';
        payload.ai_prompt_general = editing.ai_prompt_general ?? '';
        // Business profile the AI reads via get_page_info (the server trims + drops blanks).
        payload.business_profile = editing.business_profile || {};
        // Default first message prefilled when messaging a commenter (Comment → DM).
        payload.comment_dm_default_message = editing.comment_dm_default_message ?? '';
        payload.live_agent_transfer_message = editing.live_agent_transfer_message ?? '';
        payload.order_terms = editing.order_terms ?? '';
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
        payload.currency = editing.currency || 'PHP';
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
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600 }}>Facebook Pages</div>
        <div className="text-sm text-muted">
          Pages you can post to — each can optionally have a Telegram bot attached. Credentials are encrypted at rest;
          switch the active page from the top bar.
        </div>
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

          <div className="set-group">
            <div className="set-group__label">Messaging channels</div>
          {/* Optional Telegram bot attached to this page. */}
          <details className="set-acc">
            <summary className="set-acc__head">
              <span className="set-acc__icon"><TelegramLogo /></span>
              <span className="set-acc__title"><span className="set-acc__label">Telegram bot</span> <span className="set-acc__opt">optional</span></span>
              <span className="set-acc__status">
                {editing.telegram_remove ? 'Will be removed' : editing.telegram_has ? `@${editing.telegram_username || 'connected'}` : 'Not set'}
              </span>
            </summary>
            <div className="set-acc__body">
              {editing.telegram_has && (
                <label className="text-sm row gap-sm" style={{ alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={editing.telegram_remove}
                    onChange={(e) => setEditing((ed) => ({ ...ed, telegram_remove: e.target.checked }))}
                  />
                  Remove bot
                </label>
              )}
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
          </details>

          {/* Optional Instagram channel — replies reuse this page's access token. */}
          <details className="set-acc">
            <summary className="set-acc__head">
              <span className="set-acc__icon"><InstagramLogo /></span>
              <span className="set-acc__title"><span className="set-acc__label">Instagram</span> <span className="set-acc__opt">optional</span></span>
              <span className="set-acc__status">
                {editing.instagram_remove ? 'Will be removed' : editing.instagram_account_id ? 'Linked' : 'Not set'}
              </span>
            </summary>
            <div className="set-acc__body">
              {editing.instagram_has && (
                <label className="text-sm row gap-sm" style={{ alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={editing.instagram_remove}
                    onChange={(e) => setEditing((ed) => ({ ...ed, instagram_remove: e.target.checked }))}
                  />
                  Remove
                </label>
              )}
              {editing.instagram_remove ? (
                <div className="text-sm text-muted">The Instagram channel will be detached when you save.</div>
              ) : (
                <>
                  <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
                    Link this page&apos;s Instagram professional account. Replies reuse the page access token. Auto-filled when
                    you Connect with Facebook.
                  </div>
                  <Field label="Instagram account ID">
                    <input className="input" value={editing.instagram_account_id} onChange={setTgField('instagram_account_id')} placeholder="e.g. 17841400000000000" />
                  </Field>
                  <Field label="Username" hint="optional">
                    <input className="input" value={editing.instagram_username} onChange={setTgField('instagram_username')} placeholder="e.g. wisecleanershop" />
                  </Field>
                </>
              )}
            </div>
          </details>

          {/* Optional WhatsApp channel — its own Cloud-API token. */}
          <details className="set-acc">
            <summary className="set-acc__head">
              <span className="set-acc__icon"><WhatsappLogo /></span>
              <span className="set-acc__title"><span className="set-acc__label">WhatsApp</span> <span className="set-acc__opt">optional</span></span>
              <span className="set-acc__status">
                {editing.whatsapp_remove ? 'Will be removed' : editing.whatsapp_has || editing.wa_phone_number_id ? 'Connected' : 'Not set'}
              </span>
            </summary>
            <div className="set-acc__body">
              {editing.whatsapp_has && (
                <label className="text-sm row gap-sm" style={{ alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={editing.whatsapp_remove}
                    onChange={(e) => setEditing((ed) => ({ ...ed, whatsapp_remove: e.target.checked }))}
                  />
                  Remove
                </label>
              )}
              {editing.whatsapp_remove ? (
                <div className="text-sm text-muted">The WhatsApp channel will be detached when you save.</div>
              ) : (
                <>
                  <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
                    Connect a WhatsApp Cloud API number. From the Meta app&apos;s WhatsApp setup, paste the phone number ID,
                    WhatsApp Business Account ID, and a permanent access token.
                  </div>
                  <Field label="Phone number ID">
                    <input className="input" value={editing.wa_phone_number_id} onChange={setTgField('wa_phone_number_id')} placeholder="e.g. 123456789012345" />
                  </Field>
                  <Field label="WhatsApp Business Account ID" hint="for webhook subscription">
                    <input className="input" value={editing.wa_business_account_id} onChange={setTgField('wa_business_account_id')} placeholder="e.g. 102030405060708" />
                  </Field>
                  <Field label="Display number" hint="optional">
                    <input className="input" value={editing.wa_phone_display} onChange={setTgField('wa_phone_display')} placeholder="e.g. +63 917 000 0000" />
                  </Field>
                  <Field label="Access token" hint={editing.whatsapp_has ? 'leave blank to keep current' : 'permanent system-user token'}>
                    <input
                      className="input"
                      type="password"
                      value={editing.wa_access_token}
                      onChange={setTgField('wa_access_token')}
                      autoComplete="new-password"
                      placeholder={editing.whatsapp_has ? '••••••••' : 'EAAG…'}
                    />
                  </Field>
                </>
              )}
            </div>
          </details>
          </div>

          {/* AI assistant — reply prompts, business knowledge, and automatic messages. Admin only. */}
          {isAdmin && (
            <div className="set-group">
              <div className="set-group__label">AI assistant</div>

              {/* Per-page AI assistant prompts — all three required to connect/save. */}
              <details className="set-acc" open>
                <summary className="set-acc__head">
                  <span className="set-acc__icon set-acc__icon--mono"><SparkleIcon /></span>
                  <span className="set-acc__title"><span className="set-acc__label">Reply prompts</span></span>
                  <span className="set-acc__req">required</span>
                </summary>
                <div className="set-acc__body">
                  <div className="text-sm text-muted" style={{ margin: '0 0 8px' }}>
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
              </details>

              {/* Business profile + channel links — the knowledge the AI reads via get_page_info. */}
              <details className="set-acc">
                <summary className="set-acc__head">
                  <span className="set-acc__icon set-acc__icon--mono"><StoreIcon /></span>
                  <span className="set-acc__title"><span className="set-acc__label">Business info</span> <span className="set-acc__opt">for the AI</span></span>
                </summary>
                <div className="set-acc__body">
                  <div className="text-sm text-muted" style={{ margin: '0 0 8px' }}>
                    Contact, location, and hours for this page. The AI assistant reads these to answer &ldquo;where are
                    you?&rdquo;, &ldquo;what are your hours?&rdquo;, and &ldquo;how do I contact you?&rdquo; — so it never
                    guesses. All optional; leave a field blank to skip it.
                  </div>
                  <Field label="Address / Location">
                    <textarea
                      className="input"
                      rows={2}
                      value={editing.business_profile?.address || ''}
                      onChange={setBpField('address')}
                      placeholder="Blk 30 Lot 2 Rosal Street, TS Cruz subd., Almanza Dos, Las Piñas City"
                    />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Phone">
                      <input className="input" value={editing.business_profile?.phone || ''} onChange={setBpField('phone')} placeholder="(+63) 939-263-6354" />
                    </Field>
                    <Field label="Viber / WhatsApp">
                      <input className="input" value={editing.business_profile?.viber || ''} onChange={setBpField('viber')} placeholder="09392636354" />
                    </Field>
                    <Field label="Email">
                      <input className="input" value={editing.business_profile?.email || ''} onChange={setBpField('email')} placeholder="hello@example.com" />
                    </Field>
                    <Field label="Website">
                      <input className="input" value={editing.business_profile?.website || ''} onChange={setBpField('website')} placeholder="https://example.com" />
                    </Field>
                  </div>
                  <Field label="Operating hours">
                    <input className="input" value={editing.business_profile?.hours || ''} onChange={setBpField('hours')} placeholder="Monday to Sunday — 7:00 am to 5:00 pm" />
                  </Field>
                  <Field label="Other details" hint="anything else the AI should know about the business">
                    <textarea
                      className="input"
                      rows={2}
                      value={editing.business_profile?.notes || ''}
                      onChange={setBpField('notes')}
                      placeholder="Landmarks, parking, branches, payment methods…"
                    />
                  </Field>

                  {/* Per-channel links — optional store / social URLs the AI shares on request. */}
                  <div className="text-sm" style={{ fontWeight: 600, margin: '10px 0 2px' }}>Channel &amp; store links</div>
                  <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
                    Optional. The AI shares these when a customer asks for your page or store (e.g. &ldquo;send me your
                    Shopee&rdquo;). Paste the full URL; leave blank to skip.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { ch: 'facebook', label: 'Facebook / Messenger', ph: 'https://facebook.com/yourpage' },
                      { ch: 'telegram', label: 'Telegram', ph: 'https://t.me/yourhandle' },
                      { ch: 'instagram', label: 'Instagram', ph: 'https://instagram.com/yourhandle' },
                      { ch: 'shopee', label: 'Shopee', ph: 'https://shopee.ph/yourshop' },
                      { ch: 'tiktok', label: 'TikTok', ph: 'https://tiktok.com/@yourhandle' },
                      { ch: 'lazada', label: 'Lazada', ph: 'https://lazada.com.ph/shop/yourshop' },
                    ].map(({ ch, label, ph }) => (
                      <Field key={ch} label={label}>
                        <input
                          className="input"
                          value={editing.business_profile?.links?.[ch] || ''}
                          onChange={setLinkField(ch)}
                          placeholder={ph}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              </details>

              {/* Comment → DM default message. */}
              <details className="set-acc">
                <summary className="set-acc__head">
                  <span className="set-acc__icon set-acc__icon--mono"><ChatIcon /></span>
                  <span className="set-acc__title"><span className="set-acc__label">Comment → DM message</span> <span className="set-acc__opt">optional</span></span>
                </summary>
                <div className="set-acc__body">
                  <div className="text-sm text-muted" style={{ margin: '0 0 8px' }}>
                    When an agent clicks Message on someone who commented on a post, the chat composer opens prefilled with
                    this message. Leave it blank to open an empty composer.
                  </div>
                  <Field label="Default first message" hint="optional">
                    <textarea
                      className="input"
                      rows={3}
                      value={editing.comment_dm_default_message}
                      onChange={(e) => setEditing((ed) => ({ ...ed, comment_dm_default_message: e.target.value }))}
                      placeholder="Hi! Thanks for your comment 😊 How can we help?"
                    />
                  </Field>
                </div>
              </details>

              {/* Live-agent transfer message. */}
              <details className="set-acc">
                <summary className="set-acc__head">
                  <span className="set-acc__icon set-acc__icon--mono"><HandoffIcon /></span>
                  <span className="set-acc__title"><span className="set-acc__label">Live-agent transfer message</span> <span className="set-acc__opt">optional</span></span>
                </summary>
                <div className="set-acc__body">
                  <div className="text-sm text-muted" style={{ margin: '0 0 8px' }}>
                    When the AI hands a conversation to a live agent, the app automatically sends the customer this
                    message, then the AI stops replying. Leave it blank to use the default.
                  </div>
                  <Field label="Message sent on transfer" hint="optional">
                    <textarea
                      className="input"
                      rows={3}
                      value={editing.live_agent_transfer_message}
                      onChange={(e) => setEditing((ed) => ({ ...ed, live_agent_transfer_message: e.target.value }))}
                      placeholder="Let me connect you with a live agent who can better assist you. 🙌 Please hold on."
                    />
                  </Field>
                </div>
              </details>
            </div>
          )}

          {/* Store & orders — order paperwork and currency / inbox metrics. Admin only. */}
          {isAdmin && (
            <div className="set-group">
              <div className="set-group__label">Store &amp; orders</div>

              {/* Shop order terms & conditions. */}
              <details className="set-acc">
                <summary className="set-acc__head">
                  <span className="set-acc__icon set-acc__icon--mono"><DocIcon /></span>
                  <span className="set-acc__title"><span className="set-acc__label">Order terms &amp; conditions</span> <span className="set-acc__opt">optional</span></span>
                </summary>
                <div className="set-acc__body">
                  <div className="text-sm text-muted" style={{ margin: '0 0 8px' }}>
                    Shown to the customer on every order confirmation for this page, above the sworn statement. A copy is
                    snapshotted onto each confirmation when it's generated, so later edits don't change already-sent orders.
                    Leave it blank to show no terms.
                  </div>
                  <Field label="Terms &amp; conditions" hint="optional">
                    <textarea
                      className="input"
                      rows={5}
                      value={editing.order_terms}
                      onChange={(e) => setEditing((ed) => ({ ...ed, order_terms: e.target.value }))}
                      placeholder={'e.g. All sales are final. Delivery within 3–5 business days. Items must be inspected on receipt.'}
                    />
                  </Field>
                </div>
              </details>

              {/* Currency + messaging analytics — existing pages only. */}
              {editing.id && (
                <details className="set-acc">
                  <summary className="set-acc__head">
                    <span className="set-acc__icon set-acc__icon--mono"><ChartIcon /></span>
                    <span className="set-acc__title"><span className="set-acc__label">Currency &amp; messaging analytics</span></span>
                    <span className="set-acc__status">{editing.currency || 'PHP'}</span>
                  </summary>
                  <div className="set-acc__body">
                    <Field label="Currency" hint="used to format product prices">
                      <select
                        className="input"
                        value={editing.currency}
                        onChange={(e) => setEditing((ed) => ({ ...ed, currency: e.target.value }))}
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="text-sm text-muted" style={{ margin: '14px 0 8px' }}>
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
                </details>
              )}
            </div>
          )}

          <div className="ct-form__foot row gap-sm">
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
                  {p.has_telegram_bot || p.instagram_account_id || p.has_whatsapp ? (
                    // Page has extra channels attached → show the platform logos.
                    <span className="fb-page-card__platforms">
                      <FacebookLogo />
                      {p.has_telegram_bot && (
                        <TelegramLogo title={p.telegram_bot_username ? `Telegram · @${p.telegram_bot_username}` : 'Telegram'} />
                      )}
                      {p.instagram_account_id && (
                        <InstagramLogo title={p.instagram_username ? `Instagram · @${p.instagram_username}` : 'Instagram'} />
                      )}
                      {p.has_whatsapp && (
                        <WhatsappLogo title={p.wa_phone_display ? `WhatsApp · ${p.wa_phone_display}` : 'WhatsApp'} />
                      )}
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

      {!editing && (
        <div className="row gap-sm" style={{ flexWrap: 'wrap', marginTop: 16, justifyContent: 'flex-end' }}>
          {isAdmin && (
            <Button size="sm" className="btn--flat" onClick={startFacebookConnect} disabled={fbBusy}>
              {fbBusy ? 'Connecting…' : 'Connect with Facebook'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={startAdd}>
            + Add manually
          </Button>
        </div>
      )}

      <Modal
        open={!!importBatch}
        title="Import Facebook Pages"
        onClose={() => {
          if (fbBusy) return;
          setImportBatch(null);
          clearImportQuery();
        }}
        className="modal--fbimport"
        footer={
          <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setImportBatch(null);
                clearImportQuery();
              }}
              disabled={fbBusy}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={doImport} disabled={fbBusy || !importBatch?.selected.size}>
              {fbBusy
                ? 'Importing…'
                : `Import ${importBatch?.selected.size || 0} page${importBatch?.selected.size === 1 ? '' : 's'}`}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Choose which Pages to connect. Each gets a long-lived token and is subscribed to Messenger automatically.
        </p>
        <ul className="fbimport-list">
          {importBatch?.pages.map((p) => (
            <li key={p.fb_page_id}>
              <label className="fbimport-row">
                <input
                  type="checkbox"
                  checked={importBatch.selected.has(p.fb_page_id)}
                  onChange={() => toggleImportPage(p.fb_page_id)}
                />
                <span className="fbimport-row__name">{p.name}</span>
                {p.alreadyConnected && <span className="fb-chip">Connected · refresh token</span>}
              </label>
            </li>
          ))}
        </ul>
      </Modal>
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
