import { useEffect, useRef, useState } from 'react';
import * as creatomate from '../../services/creatomate.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Button, Field, Spinner } from '../../components/ui.jsx';

const PLACEHOLDER = `{
  "template_id": "c8081c94-144d-40a8-b91e-ee6cd6aee24b",
  "modifications": {
    "Video-DHM.source": "https://creatomate.com/files/assets/…"
  }
}`;

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

const templateIdOf = (config) => {
  try {
    return JSON.parse(config)?.template_id ?? null;
  } catch {
    return null;
  }
};

export default function CreatomateTemplates({ embedded = false }) {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id?, name, config }
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => {
    setLoading(true);
    creatomate
      .list()
      .then(setTemplates)
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const startAdd = () => setEditing({ name: '', config: '' });
  const startEdit = (t) => setEditing({ id: t.id, name: t.name, config: t.config });
  const cancel = () => setEditing(null);

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setEditing((ed) => ({ ...ed, config: String(reader.result || '') }));
    reader.onerror = () => toast.error('Couldn’t read that file.');
    reader.readAsText(file);
  };

  const save = async () => {
    const name = (editing.name || '').trim();
    const config = (editing.config || '').trim();
    if (!name) {
      toast.error('Give the template a name.');
      return;
    }
    try {
      JSON.parse(config);
    } catch {
      toast.error('The template isn’t valid JSON.');
      return;
    }
    setBusy(true);
    try {
      if (editing.id) await creatomate.update(editing.id, { name, config });
      else await creatomate.create({ name, config });
      toast.success(editing.id ? 'Template updated' : 'Template added');
      setEditing(null);
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (t) => {
    if (busy) return;
    setBusy(true);
    try {
      await creatomate.remove(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <div className="row row--between" style={{ marginBottom: 14, gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Creatomate templates</div>
          <div className="text-sm text-muted">
            Reusable render configs (template_id + modifications) for video generation.
          </div>
        </div>
        {!editing && (
          <Button size="sm" onClick={startAdd}>
            + Add template
          </Button>
        )}
      </div>

      {editing ? (
        <div className="ct-form">
          <Field label="Name">
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing((ed) => ({ ...ed, name: e.target.value }))}
              placeholder="e.g. Daily promo video"
            />
          </Field>
          <div className="field">
            <span className="field__label">Template JSON</span>
            <textarea
              className="textarea ct-form__json"
              value={editing.config}
              onChange={(e) => setEditing((ed) => ({ ...ed, config: e.target.value }))}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              rows={10}
            />
            <span className="field__hint">Paste or write the Creatomate JSON, or upload a .json file.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onUpload}
            style={{ display: 'none' }}
          />
          <div className="row gap-sm" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              Upload .json
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : editing.id ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <Spinner label="Loading templates…" />
      ) : templates.length === 0 ? (
        <div className="text-sm text-muted" style={{ padding: '6px 0' }}>
          No templates yet. Add one to reuse it for video generation.
        </div>
      ) : (
        <ul className="ct-list">
          {templates.map((t) => {
            const tid = templateIdOf(t.config);
            return (
              <li key={t.id} className="ct-item">
                <div className="ct-item__main">
                  <div className="ct-item__name">{t.name}</div>
                  <div className="ct-item__meta">{tid ? `template_id: ${tid}` : 'no template_id'}</div>
                </div>
                <div className="ct-item__actions">
                  <button type="button" className="card-iconbtn" title="Edit" aria-label="Edit template" onClick={() => startEdit(t)}>
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    className="card-iconbtn card-iconbtn--danger"
                    title="Delete"
                    aria-label="Delete template"
                    onClick={() => del(t)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  // Embedded in the single Settings card → bare section; standalone → own card.
  return embedded ? (
    <section className="settings-section">{body}</section>
  ) : (
    <Card className="card--pad" style={{ marginTop: 24, maxWidth: 640 }}>{body}</Card>
  );
}
