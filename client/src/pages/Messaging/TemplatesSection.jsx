import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as templatesApi from '../../services/message_templates.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Button, Modal, Field, Spinner } from '../../components/ui.jsx';

const TEMPLATES_PER_PAGE = 12;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/**
 * Templates section — a full-width browse + manage view of this page's reusable
 * message templates, shown in the messaging content area when the Templates button
 * in the mode rail is active. Templates are per-page (seeded from defaults on first
 * load). Click a card to copy its body; the top-right icons edit / duplicate / delete.
 */
export default function TemplatesSection({ accountId }) {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // { id|null, title, body, tags } or null
  const [busy, setBusy] = useState(false);
  const [newId, setNewId] = useState(null); // most-recently added card → plays the insert animation
  const cardRefs = useRef(new Map()); // id -> card element, for FLIP measuring
  const prevRects = useRef(null); // card rects captured just before an insertion (else null)

  const load = useCallback(() => {
    if (!accountId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    templatesApi
      .list(accountId)
      .then(setTemplates)
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [accountId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Snapshot current card positions right before an insertion, so the FLIP effect can
  // slide each card from where it was to where it lands.
  const capturePositions = () => {
    const map = new Map();
    cardRefs.current.forEach((el, id) => {
      if (el) map.set(id, el.getBoundingClientRect());
    });
    prevRects.current = map;
  };

  // FLIP — after a card is added, the existing cards "push apart" by sliding from their
  // old positions to their new ones; the new copy then fades into the opened gap (the
  // CSS .is-new fade, delayed so the push happens first). Only runs right after an
  // insertion (prevRects was captured); respects reduced motion.
  useLayoutEffect(() => {
    const prev = prevRects.current;
    if (!prev) return;
    prevRects.current = null;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    cardRefs.current.forEach((el, id) => {
      const old = prev.get(id);
      if (!el || !old) return; // the brand-new card has no old rect — it just fades in
      const next = el.getBoundingClientRect();
      const dx = old.left - next.left;
      const dy = old.top - next.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.getBoundingClientRect(); // force reflow so the inverted position paints first
      el.style.transition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
      el.addEventListener(
        'transitionend',
        () => {
          el.style.transition = '';
          el.style.transform = '';
        },
        { once: true },
      );
    });
  }, [templates]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? templates.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.body.toLowerCase().includes(q) ||
              (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
          )
        : templates,
    [q, templates],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / TEMPLATES_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * TEMPLATES_PER_PAGE;
  const pageEnd = Math.min(pageStart + TEMPLATES_PER_PAGE, filtered.length);
  const pageItems = filtered.slice(pageStart, pageEnd);

  const copy = async (body) => {
    try {
      await navigator.clipboard?.writeText(body);
      toast.info('Template copied');
    } catch {
      /* clipboard unavailable */
    }
  };

  // Briefly tag a just-added card so it plays the insert animation, then clear it so
  // the animation styles don't linger (and hover keeps working).
  const flashNew = (id) => {
    setNewId(id);
    window.setTimeout(() => setNewId((cur) => (cur === id ? null : cur)), 450);
  };

  const openNew = () => setEditing({ id: null, title: '', body: '', tags: '' });
  const openEdit = (t) => setEditing({ id: t.id, title: t.title, body: t.body, tags: (t.tags || []).join(', ') });

  const save = async () => {
    const title = editing.title.trim();
    const body = editing.body.trim();
    if (!title) return toast.error('Give the template a title.');
    if (!body) return toast.error('Add the template message.');
    setBusy(true);
    try {
      if (editing.id) {
        const updated = await templatesApi.update(editing.id, accountId, { title, body, tags: editing.tags });
        setTemplates((cur) => cur.map((t) => (t.id === updated.id ? updated : t)));
        toast.success('Template updated');
      } else {
        const created = await templatesApi.create(accountId, { title, body, tags: editing.tags });
        setTemplates((cur) => [...cur, created]);
        flashNew(created.id);
        setPage(Math.max(1, Math.ceil((templates.length + 1) / TEMPLATES_PER_PAGE))); // jump to the page holding the new card
        toast.success('Template added');
      }
      setEditing(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (t) => {
    try {
      const created = await templatesApi.duplicate(t.id, accountId);
      // The copy lands right after the original; work out which page that is so we run
      // the same-page "push" animation only when it stays here (cross-page just jumps
      // to the copy's page and fades it in).
      const fidx = filtered.findIndex((x) => x.id === t.id);
      const copyPage = fidx >= 0 ? Math.floor((fidx + 1) / TEMPLATES_PER_PAGE) + 1 : currentPage;
      const samePage = copyPage === currentPage;
      if (samePage) capturePositions();
      // Insert the copy right after the original (matches the server's sort_order).
      setTemplates((cur) => {
        const idx = cur.findIndex((x) => x.id === t.id);
        if (idx === -1) return [...cur, created];
        const next = cur.slice();
        next.splice(idx + 1, 0, created);
        return next;
      });
      flashNew(created.id);
      if (!samePage) setPage(copyPage);
      toast.success('Template duplicated');
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const del = async (t) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete the "${t.title}" template? This can't be undone.`)) return;
    try {
      await templatesApi.remove(t.id, accountId);
      setTemplates((cur) => cur.filter((x) => x.id !== t.id));
      toast.success('Template deleted');
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <Card className="msg-panel tmpl-section">
      <div className="card__head">
        <div>
          <div className="card__title">Templates</div>
          <div className="msg-panel__sub">
            {templates.length} reusable {templates.length === 1 ? 'reply' : 'replies'} for this page — click a card to
            copy. Drag from the composer&apos;s drawer to drop one into a chat.
          </div>
        </div>
        <Button size="sm" className="tmpl-section__newbtn" onClick={openNew} disabled={!accountId}>
          + New template
        </Button>
      </div>

      <div className="tmpl-section__search">
        <span className="tmpl-section__search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          className="tmpl-section__search-input"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search templates…"
          aria-label="Search templates"
        />
      </div>

      {!accountId ? (
        <p className="tmpl-drawer__empty">Select a page to view its templates.</p>
      ) : loading ? (
        <Spinner label="Loading templates…" />
      ) : filtered.length === 0 ? (
        <p className="tmpl-drawer__empty">
          {templates.length === 0 ? 'No templates yet — add your first one.' : `No templates match “${query}”.`}
        </p>
      ) : (
        <div className="tmpl-section__grid">
          {pageItems.map((t) => (
            <article
              key={t.id}
              ref={(el) => {
                const m = cardRefs.current;
                if (el) m.set(t.id, el);
                else m.delete(t.id);
              }}
              className={`tmpl-card tmpl-card--clickable${t.id === newId ? ' is-new' : ''}`}
              role="button"
              tabIndex={0}
              title="Click to copy"
              onClick={() => copy(t.body)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  copy(t.body);
                }
              }}
            >
              <div className="tmpl-card__head">
                <h3 className="tmpl-card__title">{t.title}</h3>
                <div className="tmpl-card__actions">
                  <button type="button" className="tmpl-card__act" title="Edit" aria-label="Edit template" onClick={(e) => { e.stopPropagation(); openEdit(t); }}>
                    <EditIcon />
                  </button>
                  <button type="button" className="tmpl-card__act" title="Duplicate" aria-label="Duplicate template" onClick={(e) => { e.stopPropagation(); duplicate(t); }}>
                    <DuplicateIcon />
                  </button>
                  <button type="button" className="tmpl-card__act tmpl-card__act--danger" title="Delete" aria-label="Delete template" onClick={(e) => { e.stopPropagation(); del(t); }}>
                    <TrashIcon />
                  </button>
                </div>
              </div>
              <p className="tmpl-card__body">{t.body}</p>
              {t.tags?.length > 0 && (
                <div className="tmpl-card__tags">
                  {t.tags.map((tag) => (
                    <span key={tag} className="tmpl-card__tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {accountId && !loading && pageCount > 1 && (
        <div className="tmpl-section__pager">
          <span className="tmpl-section__pageinfo">
            {pageStart + 1}–{pageEnd} of {filtered.length}
          </span>
          <div className="tmpl-section__pageactions">
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
              Prev
            </Button>
            <span className="tmpl-section__pagenum">
              Page {currentPage} of {pageCount}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={!!editing}
        title={editing?.id ? 'Edit template' : 'New template'}
        onClose={() => (busy ? undefined : setEditing(null))}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : editing?.id ? 'Save' : 'Add template'}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="ct-form">
            <Field label="Title">
              <input
                className="input"
                value={editing.title}
                onChange={(e) => setEditing((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Friendly greeting"
              />
            </Field>
            <Field label="Message">
              <textarea
                className="input"
                rows={6}
                value={editing.body}
                onChange={(e) => setEditing((f) => ({ ...f, body: e.target.value }))}
                placeholder="The reply text the agent can drop into a chat…"
              />
            </Field>
            <Field label="Tags" hint="comma-separated, optional">
              <input
                className="input"
                value={editing.tags}
                onChange={(e) => setEditing((f) => ({ ...f, tags: e.target.value }))}
                placeholder="greeting, welcome, hello"
              />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
