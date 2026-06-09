import { useEffect, useState } from 'react';
import * as pagesService from '../../services/pages.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { Card, Button, Field, Spinner } from '../../components/ui.jsx';

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

const BLANK = { account_name: '', fb_page_id: '', app_id: '', app_secret: '', app_client_token: '', access_token: '' };

export default function FacebookPages() {
  const toast = useToast();
  const { refresh: refreshSwitcher } = usePages();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id?, ...fields }
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false); // connection verified for the CURRENT field values
  const [testInfo, setTestInfo] = useState(null); // { name, followers } from the successful test

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

  const resetTest = () => {
    setTested(false);
    setTestInfo(null);
  };
  const startAdd = () => {
    resetTest();
    setEditing({ ...BLANK });
  };
  const startEdit = (p) => {
    resetTest();
    setEditing({ ...BLANK, id: p.id, account_name: p.account_name || '', fb_page_id: p.fb_page_id || '', app_id: p.app_id || '' });
  };
  const cancel = () => {
    resetTest();
    setEditing(null);
  };
  // Any field edit invalidates a prior successful test → back to the "Connect" step.
  const setField = (k) => (e) => {
    const v = e.target.value;
    setEditing((ed) => ({ ...ed, [k]: v }));
    resetTest();
  };

  // Step 1 — verify credentials against Facebook. On success the primary button
  // flips to "Add page" / "Save". (Edits may leave the token blank to reuse the
  // stored one; the server falls back to it.)
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

  // Step 2 — persist. Only reachable once the connection has tested OK.
  const commit = async () => {
    const name = editing.account_name.trim();
    const fbPageId = editing.fb_page_id.trim();
    if (!name) return toast.error('Give the page a name.');
    if (!fbPageId) return toast.error('Facebook Page ID is required.');
    setBusy(true);
    try {
      const payload = {
        account_name: name,
        fb_page_id: fbPageId,
        app_id: editing.app_id.trim(),
        // Secrets are write-only: send only when filled (blank on edit = keep).
        ...(editing.app_secret.trim() ? { app_secret: editing.app_secret.trim() } : {}),
        ...(editing.app_client_token.trim() ? { app_client_token: editing.app_client_token.trim() } : {}),
        ...(editing.access_token.trim() ? { access_token: editing.access_token.trim() } : {}),
      };
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

  const secretHint = (label) => (editing?.id ? 'leave blank to keep current' : label);

  return (
    <Card className="card--pad" style={{ marginTop: 24, maxWidth: 640 }}>
      <div className="row row--between" style={{ marginBottom: 14, gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Facebook Pages</div>
          <div className="text-sm text-muted">
            Pages you can post to. Credentials are encrypted at rest; switch the active page from the top bar.
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
          <Field label="App ID" hint="optional">
            <input className="input" value={editing.app_id} onChange={setField('app_id')} />
          </Field>
          <Field label="Page access token" hint={secretHint('required')}>
            <input className="input" type="password" value={editing.access_token} onChange={setField('access_token')} autoComplete="new-password" placeholder={editing.id ? '••••••••' : ''} />
          </Field>
          <Field label="App Secret" hint={secretHint('optional')}>
            <input className="input" type="password" value={editing.app_secret} onChange={setField('app_secret')} autoComplete="new-password" placeholder={editing.id ? '••••••••' : ''} />
          </Field>
          <Field label="App Client Token" hint={secretHint('optional')}>
            <input className="input" type="password" value={editing.app_client_token} onChange={setField('app_client_token')} autoComplete="new-password" placeholder={editing.id ? '••••••••' : ''} />
          </Field>
          {tested && (
            <div className="fb-test-ok">
              ✓ Connection verified{testInfo?.name ? ` — ${testInfo.name}` : ''}
              {testInfo?.followers != null ? ` · ${Number(testInfo.followers).toLocaleString()} followers` : ''}
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
        <ul className="ct-list">
          {pages.map((p) => (
            <li key={p.id} className="ct-item">
              <div className="ct-item__main">
                <div className="ct-item__name">{p.account_name}</div>
                <div className="ct-item__meta">
                  Page ID: {p.fb_page_id || '—'}
                  {!p.is_active && ' · disabled'}
                </div>
              </div>
              <div className="ct-item__actions">
                <button type="button" className="card-iconbtn" title="Edit" aria-label="Edit page" onClick={() => startEdit(p)}>
                  <EditIcon />
                </button>
                <button type="button" className="card-iconbtn card-iconbtn--danger" title="Delete" aria-label="Delete page" onClick={() => del(p)}>
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
