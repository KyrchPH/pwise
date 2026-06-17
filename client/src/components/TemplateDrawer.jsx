import { useEffect, useState } from 'react';
import { MESSAGE_TEMPLATES } from '../pages/Messaging/messagingData.js';

const TEMPLATES_PER_PAGE = 10;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * Template Drawer — a right-side panel opened from the chat composer's template
 * button. Lists reusable message templates (each styled like a note) with a
 * search box; "Use Template" hands the template back to the composer via onUse.
 */
export default function TemplateDrawer({ open, onClose, onUse }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Reset the search whenever the drawer opens; close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setPage(1);
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const templates = q
    ? MESSAGE_TEMPLATES.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
      )
    : MESSAGE_TEMPLATES;
  const pageCount = Math.max(1, Math.ceil(templates.length / TEMPLATES_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * TEMPLATES_PER_PAGE;
  const pageEnd = Math.min(pageStart + TEMPLATES_PER_PAGE, templates.length);
  const pagedTemplates = templates.slice(pageStart, pageEnd);

  return (
    <aside className={`tmpl-drawer${open ? ' is-open' : ''}`} aria-hidden={!open} aria-label="Templates">
        <div className="tmpl-drawer__head">
          <div className="tmpl-drawer__heading">
            <span className="tmpl-drawer__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <line x1="7.5" y1="9" x2="16.5" y2="9" />
                <line x1="7.5" y1="13" x2="16.5" y2="13" />
                <line x1="7.5" y1="17" x2="12.5" y2="17" />
              </svg>
            </span>
            <div>
              <h2 className="tmpl-drawer__title">Templates</h2>
              <p className="tmpl-drawer__sub">Pick a reply to drop into the message box.</p>
            </div>
          </div>
          <button type="button" className="tmpl-drawer__close" onClick={onClose} aria-label="Close templates">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="tmpl-drawer__search">
          <span className="tmpl-drawer__search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            className="tmpl-drawer__search-input"
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

        <div className="tmpl-drawer__list">
          {templates.length === 0 ? (
            <p className="tmpl-drawer__empty">No templates match “{query}”.</p>
          ) : (
            pagedTemplates.map((template) => (
              <article
                key={template.id}
                className="tmpl-card"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-pwise-template', template.body);
                  event.dataTransfer.setData('text/plain', template.body);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                title="Drag into the conversation, or press Use Template"
              >
                <div className="tmpl-card__head">
                  <h3 className="tmpl-card__title">{template.title}</h3>
                  <button type="button" className="tmpl-card__use" onClick={() => onUse(template)}>
                    Use Template
                  </button>
                </div>
                <p className="tmpl-card__body">{template.body}</p>
                {template.tags?.length > 0 && (
                  <div className="tmpl-card__tags">
                    {template.tags.map((tag) => (
                      <span key={tag} className="tmpl-card__tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
        {templates.length > TEMPLATES_PER_PAGE && (
          <div className="tmpl-drawer__pager" aria-label="Template pagination">
            <span className="tmpl-drawer__pageinfo">
              {pageStart + 1}-{pageEnd} of {templates.length}
            </span>
            <div className="tmpl-drawer__pageactions">
              <button
                type="button"
                className="tmpl-drawer__pagebtn"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={currentPage === 1}
              >
                Prev
              </button>
              <span className="tmpl-drawer__pagenum">
                Page {currentPage} of {pageCount}
              </span>
              <button
                type="button"
                className="tmpl-drawer__pagebtn"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={currentPage === pageCount}
              >
                Next
              </button>
            </div>
          </div>
        )}
    </aside>
  );
}
