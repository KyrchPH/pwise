import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, EmptyState } from '../../components/ui.jsx';
import TemplateDrawer from '../../components/TemplateDrawer.jsx';
import VaultPickerModal from '../../components/VaultPickerModal.jsx';
import { VaultThumb } from '../../components/VaultThumb.jsx';
import { usePages } from '../../context/PageContext.jsx';
import * as messaging from '../../services/messaging.service.js';
import { buildPageCards, messagePreview, resolveSelectedPageId } from './messagingData.js';

// Apply an SSE message:new event to a conversation: append any not-yet-seen
// bubbles (deduped by id, so the sender's own echo is ignored) and merge the
// conversation patch (summary / unread / handledBy / lastActivity).
function mergeIncoming(conversation, event) {
  const seen = new Set(conversation.messages.map((m) => m.id));
  const added = (event.messages || []).filter((m) => !seen.has(m.id));
  return {
    ...conversation,
    ...(event.conversation || {}),
    messages: added.length ? [...conversation.messages, ...added] : conversation.messages,
  };
}

function platformKey(origin) {
  const value = String(origin || '').toLowerCase();
  if (value.includes('telegram')) return 'telegram';
  if (value.includes('instagram')) return 'instagram';
  if (value.includes('whatsapp')) return 'whatsapp';
  if (value.includes('messenger') || value.includes('facebook')) return 'facebook';
  return 'other';
}

function PlatformLogo({ origin }) {
  const key = platformKey(origin);
  if (key === 'telegram') {
    return (
      <span className="msg-platform-logo msg-platform-logo--telegram" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <path d="M21.7 4.3 18.5 19c-.2.9-.8 1.1-1.6.7l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.4-.1-.6-.6-.3L6.5 12.6 1.8 11c-1-.3-1-1 .2-1.5l18.3-7c.8-.3 1.6.2 1.4 1.8Z" />
        </svg>
      </span>
    );
  }
  if (key === 'instagram') {
    return (
      <span className="msg-platform-logo msg-platform-logo--instagram" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="5" y="5" width="14" height="14" rx="4" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="16.8" cy="7.2" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  if (key === 'whatsapp') {
    return (
      <span className="msg-platform-logo msg-platform-logo--whatsapp" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.5 19.5 4 20.5l1-3.4A8 8 0 1 1 7.5 19.5Z" />
          <path d="M9 8.8c.4 2.6 2.5 4.7 5.1 5.2l1.2-1.2 2 1.1c-.3 1.5-1.4 2.3-2.8 2-3.9-.8-6.6-3.4-7.4-7.3-.3-1.4.6-2.5 2-2.8l1.1 2Z" />
        </svg>
      </span>
    );
  }
  return <span className="msg-platform-logo msg-platform-logo--facebook" aria-hidden="true">f</span>;
}

function CustomerAvatar({ name, origin, avatarUrl }) {
  const [broken, setBroken] = useState(false);
  const initials = (name || '?')
    .split(' ')
    .map((part) => part[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  useEffect(() => {
    setBroken(false);
  }, [avatarUrl]);

  const showPhoto = avatarUrl && !broken;

  return (
    <span className={`msg-customer-avatar${showPhoto ? ' msg-customer-avatar--photo' : ''}`} aria-hidden="true">
      {showPhoto ? (
        <img className="msg-customer-avatar__img" src={avatarUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        <span>{initials}</span>
      )}
      <PlatformLogo origin={origin} />
    </span>
  );
}

export default function MessagingPage() {
  const { pages, activePage } = usePages();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectedPages = pages.filter((page) => page.is_active !== false);
  const pageCards = buildPageCards(connectedPages);
  const requestedPageId = searchParams.get('page');
  const preferredPageId = activePage?.id != null ? String(activePage.id) : null;
  const filterRef = useRef(null);
  const copyTimerRef = useRef(null);
  const composerInputRef = useRef(null);

  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]); // vault media staged for the next message
  const [pickerOpen, setPickerOpen] = useState(false); // vault attach dialog
  const [templateOpen, setTemplateOpen] = useState(false); // template drawer
  const [dropActive, setDropActive] = useState(false); // template being dragged over the thread
  const [replyTo, setReplyTo] = useState(null);
  const [agentView, setAgentView] = useState('ai'); // 'ai' = AI Agent · 'foryou' = live-agent queue
  const [filterOpen, setFilterOpen] = useState(false); // page-filter dropdown
  const [copiedId, setCopiedId] = useState(null); // message whose copy just succeeded
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Load the shared inbox once on mount.
  useEffect(() => {
    let active = true;
    setLoading(true);
    messaging
      .listConversations()
      .then((list) => {
        if (active) {
          setConversations(list);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (active) setLoadError(messaging.apiError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep it live: SSE pushes new messages and thread changes (sent by any user).
  useEffect(() => {
    return messaging.subscribe((event) => {
      if (event.type === 'message:new') {
        setConversations((cur) =>
          cur.map((c) => (c.id === event.conversationId ? mergeIncoming(c, event) : c)),
        );
      } else if (event.type === 'conversation:updated' && event.conversation) {
        setConversations((cur) =>
          cur.map((c) => (c.id === event.conversation.id ? { ...c, ...event.conversation } : c)),
        );
      }
    });
  }, []);

  // The page filter targets a single page or all of them ('all'); with no request
  // it resolves to the active page so the inbox opens where you left off.
  const isAllPages = requestedPageId === 'all';
  const selectedPageId = isAllPages
    ? null
    : resolveSelectedPageId(pageCards, requestedPageId, preferredPageId);

  useEffect(() => {
    if (isAllPages || !selectedPageId || requestedPageId === selectedPageId) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('page', selectedPageId);
    setSearchParams(nextSearchParams, { replace: true });
  }, [isAllPages, requestedPageId, searchParams, selectedPageId, setSearchParams]);

  // Close the page-filter dropdown on outside-click / Escape.
  useEffect(() => {
    if (!filterOpen) return undefined;
    const onDown = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) setFilterOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setFilterOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  // The list is the selected page's conversations (or every page when 'all'),
  // narrowed to the active tab: AI-handled threads vs. the live-agent queue.
  const wantedHandler = agentView === 'ai' ? 'AI Agent' : 'Live Agent';
  const visibleConversations = conversations.filter(
    (conversation) =>
      (isAllPages || conversation.pageId === selectedPageId) &&
      conversation.handledBy === wantedHandler,
  );
  const conversationSnapshot = visibleConversations.map((conversation) => conversation.id).join('|');

  useEffect(() => {
    setSelectedConversationId((current) =>
      visibleConversations.some((conversation) => conversation.id === current)
        ? current
        : visibleConversations[0]?.id || null,
    );
  }, [conversationSnapshot]);

  const activeConversation =
    visibleConversations.find((conversation) => conversation.id === selectedConversationId) ||
    visibleConversations[0] ||
    null;

  // Live-agent threads are interactive (composer enabled); AI-agent threads are
  // read-only until the user takes over (then they become live-agent threads).
  const isLiveAgent = activeConversation?.handledBy === 'Live Agent';

  // Unread "chats" = conversations not yet seen (unread > 0). These drive the
  // page-filter badges — a per-page count and a grand total.
  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0);
  const unreadForPage = (pageId) =>
    conversations.reduce((sum, c) => sum + (c.pageId === pageId && c.unread > 0 ? 1 : 0), 0);

  // Opening a conversation marks it seen: clears its unread badge and trims the
  // filter counters by one.
  useEffect(() => {
    const id = activeConversation?.id;
    if (!id || !(activeConversation.unread > 0)) return;
    setConversations((cur) => cur.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    messaging.markSeen(id).catch(() => {});
  }, [activeConversation?.id]);

  const filterLabel = isAllPages
    ? 'All pages'
    : pageCards.find((page) => page.id === selectedPageId)?.name || 'All pages';

  const applyPageFilter = (value) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('page', value);
    setSearchParams(nextSearchParams, { replace: true });
    setFilterOpen(false);
  };

  useEffect(() => {
    if (!replyTo) return;
    const stillVisible = activeConversation?.messages.some((message) => message.id === replyTo.id);
    if (!stillVisible) setReplyTo(null);
  }, [activeConversation, replyTo]);

  // Staged attachments belong to the open thread; drop them when you switch threads.
  useEffect(() => {
    setAttachments([]);
  }, [activeConversation?.id]);

  const handleSend = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && attachments.length === 0) || !activeConversation || !isLiveAgent) return;

    const conversationId = activeConversation.id;
    const sentAttachments = attachments;
    const media = sentAttachments.map((a) => ({ type: a.mediaType, url: a.url, name: a.name }));
    const replyRef = replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text } : null;

    // Clear the composer immediately; the server splits media + text into bubbles
    // and returns them (SSE echoes to other clients — deduped by id here).
    setDraft('');
    setAttachments([]);
    setReplyTo(null);

    try {
      const result = await messaging.sendMessage(conversationId, { text, media, replyTo: replyRef });
      setConversations((cur) => cur.map((c) => (c.id === conversationId ? mergeIncoming(c, result) : c)));
    } catch (err) {
      // Restore the composer so nothing is lost.
      setDraft(text);
      setAttachments(sentAttachments);
      setReplyTo(replyRef ? replyTo : null);
      setLoadError(messaging.apiError(err));
    }
  };

  // Stage vault media above the composer (merged, deduped, max 5, single type).
  const handleAttach = (picked) => {
    setAttachments((prev) => {
      const merged = [...prev];
      for (const item of picked) {
        if (merged.length >= 5) break;
        if (merged.some((x) => x.id === item.id)) continue;
        if (merged.length && merged[0].mediaType !== item.mediaType) continue;
        merged.push(item);
      }
      return merged;
    });
    setPickerOpen(false);
  };

  // Drop a template's text into the composer (appended to any existing draft),
  // close the drawer and refocus the input so the agent can edit before sending.
  const insertTemplateText = (body) => {
    if (!body) return;
    setDraft((current) => (current.trim() ? `${current} ${body}` : body));
    setTemplateOpen(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };
  const handleUseTemplate = (template) => insertTemplateText(template.body);

  const hasTemplateDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('application/x-pwise-template');

  const handleTemplateDragOver = (event) => {
    if (!isLiveAgent || !hasTemplateDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };

  const handleTemplateDragLeave = (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setDropActive(false);
  };

  // Drag-and-drop: drop a template anywhere on the live thread to fill the composer.
  const handleTemplateDrop = (event) => {
    if (!isLiveAgent || !hasTemplateDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    insertTemplateText(
      event.dataTransfer.getData('application/x-pwise-template') ||
        event.dataTransfer.getData('text/plain'),
    );
  };

  // Take over an AI-agent thread: mark it Live Agent (enabling the composer) and
  // surface it in the "For You" tab with the same thread kept open.
  const handleTakeOver = () => {
    if (!activeConversation) return;
    const id = activeConversation.id;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...conversation, handledBy: 'Live Agent' } : conversation,
      ),
    );
    setAgentView('foryou');
    setSelectedConversationId(id);
    messaging.takeOver(id).catch(() => {});
  };

  // Copy a message's text; briefly flag the bubble so its icon shows a check.
  const handleCopy = (message) => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(message.text)
      .then(() => {
        setCopiedId(message.id);
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
      })
      .catch(() => {});
  };

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  return (
    <div className={`messaging-page${templateOpen ? ' is-template-open' : ''}`}>
      <section className="msg-workspace">
        <Card className="msg-panel msg-panel--list">
          <div className="card__head">
            <div className="card__title">Messaging</div>
            <div className="msg-filter" ref={filterRef}>
              <button
                type="button"
                className={`msg-filter__btn${filterOpen ? ' is-open' : ''}`}
                onClick={() => setFilterOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={filterOpen}
                aria-label="Filter conversations by page"
                title="Filter by page"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span className="msg-filter__label">{filterLabel}</span>
                {unreadTotal > 0 && (
                  <span className="msg-filter__count" title={`${unreadTotal} unread chats`}>
                    {unreadTotal}
                  </span>
                )}
                <svg className="msg-filter__caret" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {filterOpen && (
                <div className="dropdown__menu msg-filter__menu" role="listbox">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isAllPages}
                    className={`dropdown__opt${isAllPages ? ' is-selected' : ''}`}
                    onClick={() => applyPageFilter('all')}
                  >
                    <span>All pages</span>
                    {unreadTotal > 0 && (
                      <span className="msg-filter__opt-end">
                        <span className="msg-filter__opt-count">{unreadTotal}</span>
                      </span>
                    )}
                  </button>
                  {pageCards.map((page) => {
                    const selected = !isAllPages && page.id === selectedPageId;
                    const pageUnread = unreadForPage(page.id);
                    return (
                      <button
                        key={page.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`dropdown__opt${selected ? ' is-selected' : ''}`}
                        onClick={() => applyPageFilter(page.id)}
                      >
                        <span>{page.name}</span>
                        {pageUnread > 0 && (
                          <span className="msg-filter__opt-end">
                            <span className="msg-filter__opt-count">{pageUnread}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="msg-list-switch">
            <div className="seg msg-list-switch__seg" role="tablist" aria-label="Conversation view">
              <button
                type="button"
                role="tab"
                aria-selected={agentView === 'ai'}
                className={`seg__btn${agentView === 'ai' ? ' is-active' : ''}`}
                onClick={() => setAgentView('ai')}
              >
                AI Agent
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={agentView === 'foryou'}
                className={`seg__btn${agentView === 'foryou' ? ' is-active' : ''}`}
                onClick={() => setAgentView('foryou')}
              >
                For You
              </button>
            </div>
          </div>

          {loading ? (
            <div className="card--pad">
              <EmptyState icon="…" title="Loading conversations" message="Fetching the latest inbox." />
            </div>
          ) : loadError ? (
            <div className="card--pad">
              <EmptyState icon="!" title="Couldn’t load messages" message={loadError} />
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="card--pad">
              <EmptyState
                icon="..."
                title="No conversations"
                message="No conversations match this view yet. Try another page or switch tabs."
              />
            </div>
          ) : (
            <ul className="msg-conversation-list">
              {visibleConversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className={`msg-conversation${conversation.id === activeConversation?.id ? ' is-active' : ''}`}
                    onClick={() => setSelectedConversationId(conversation.id)}
                  >
                    <CustomerAvatar
                      name={conversation.customerName}
                      origin={conversation.origin}
                      avatarUrl={conversation.avatarUrl}
                    />
                    <div className="msg-conversation__main">
                      <div className="msg-conversation__row">
                        <strong className="msg-conversation__name">{conversation.customerName}</strong>
                        <span className="msg-conversation__time">{conversation.lastActivity}</span>
                      </div>
                      <div className="msg-conversation__row">
                        <span className="msg-conversation__mode">{conversation.handledBy}</span>
                      </div>
                      <p className="msg-conversation__preview">{conversation.summary}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          className={`msg-panel msg-panel--thread${dropActive && isLiveAgent ? ' is-template-drop' : ''}`}
          onDragOver={handleTemplateDragOver}
          onDragLeave={handleTemplateDragLeave}
          onDrop={handleTemplateDrop}
        >
          {activeConversation ? (
            <>
              <div className="card__head msg-thread__head">
                <div className="msg-thread__identity">
                  <CustomerAvatar
                    name={activeConversation.customerName}
                    origin={activeConversation.origin}
                    avatarUrl={activeConversation.avatarUrl}
                  />
                  <div>
                    <div className="card__title">{activeConversation.customerName}</div>
                    <div className="msg-panel__sub msg-thread__sub">
                      <span>Last message {activeConversation.lastActivity}</span>
                      <span className="msg-thread__page">{activeConversation.pageName}</span>
                    </div>
                  </div>
                </div>
                <div className="msg-thread__meta">
                  <span className={`msg-status-badge msg-status-badge--${isLiveAgent ? 'live' : 'ai'}`}>
                    <span className="msg-status-badge__dot" aria-hidden="true" />
                    {activeConversation.handledBy}
                  </span>
                </div>
              </div>

              <div className="msg-thread__messages">
                {activeConversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`msg-bubble-wrap${message.side === 'outgoing' ? ' is-outgoing' : ''}`}
                  >
                    <div className={`msg-bubble-stack${message.side === 'outgoing' ? ' is-outgoing' : ''}`}>
                      <div className={`msg-bubble${message.side === 'outgoing' ? ' is-outgoing' : ''}`}>
                        <div className="msg-bubble__sender">{message.sender}</div>
                        {message.replyTo && (
                          <div
                            className={`msg-bubble__replyref${message.side === 'outgoing' ? ' is-outgoing' : ''}`}
                          >
                            <span className="msg-bubble__replyname">{message.replyTo.sender}</span>
                            <span className="msg-bubble__replytext">
                              {messagePreview(message.replyTo.text, 70)}
                            </span>
                          </div>
                        )}
                        {message.media?.length > 0 && (
                          <div className={`msg-bubble__media${message.media.length === 1 ? ' is-single' : ''}`}>
                            {message.media.map((m, index) => (
                              <span key={index} className="msg-bubble__media-tile">
                                <VaultThumb item={{ type: 'file', mediaType: m.type, url: m.url, name: m.name }} />
                              </span>
                            ))}
                          </div>
                        )}
                        {message.text && <div className="msg-bubble__text">{message.text}</div>}
                        <div className="msg-bubble__foot">
                          {message.text && (
                            <button
                              type="button"
                              className={`msg-bubble__copy${copiedId === message.id ? ' is-copied' : ''}`}
                              onClick={() => handleCopy(message)}
                              aria-label={copiedId === message.id ? 'Copied' : 'Copy message'}
                              title={copiedId === message.id ? 'Copied' : 'Copy message'}
                            >
                              {copiedId === message.id ? (
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          )}
                          <span className="msg-bubble__time">{message.time}</span>
                        </div>
                      </div>
                      {isLiveAgent && (
                        <button
                          type="button"
                          className={`msg-bubble__replybtn${message.side === 'outgoing' ? ' is-outgoing' : ''}`}
                          aria-label={`Reply to ${message.sender}`}
                          title={`Reply to ${message.sender}`}
                          onClick={() =>
                            setReplyTo({ id: message.id, sender: message.sender, text: message.text })
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="9 17 4 12 9 7" />
                            <path d="M20 18v-1a4 4 0 0 0-4-4H4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {isLiveAgent ? (
                <form className="msg-composer" onSubmit={handleSend}>
                {replyTo && (
                  <div className="msg-composer__reply">
                    <div className="msg-composer__replycopy">
                      <span className="msg-composer__replylabel">Replying to {replyTo.sender}</span>
                      <span className="msg-composer__replytext">{messagePreview(replyTo.text)}</span>
                    </div>
                    <button
                      type="button"
                      className="msg-composer__replyclose"
                      onClick={() => setReplyTo(null)}
                      aria-label="Cancel reply"
                      title="Cancel reply"
                    >
                      x
                    </button>
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="msg-composer__attachments">
                    {attachments.map((a) => (
                      <div key={a.id} className="msg-attach" title={a.name}>
                        <span className="msg-attach__thumb">
                          <VaultThumb item={a} />
                        </span>
                        <button
                          type="button"
                          className="msg-attach__remove"
                          onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                          aria-label={`Remove ${a.name}`}
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="msg-composer__bar">
                  <button
                    type="button"
                    className={`msg-composer__iconbtn${attachments.length > 0 ? ' is-active' : ''}`}
                    onClick={() => setPickerOpen(true)}
                    aria-label="Attach from Main"
                    title="Attach from Main"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <circle cx="8.5" cy="10" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`msg-composer__iconbtn${templateOpen ? ' is-active' : ''}`}
                    onClick={() => setTemplateOpen(true)}
                    aria-label="Templates"
                    title="Templates"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <line x1="8" y1="9" x2="16" y2="9" />
                      <line x1="8" y1="13" x2="16" y2="13" />
                      <line x1="8" y1="17" x2="13" y2="17" />
                    </svg>
                  </button>
                  <div className="msg-composer__inputwrap">
                    <input
                      ref={composerInputRef}
                      className={`input msg-composer__input${dropActive ? ' is-drop' : ''}`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Type a message..."
                    />
                    <button
                      type="button"
                      className="msg-composer__enhance"
                      aria-label="AI enhance"
                      title="AI enhance"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="17"
                        height="17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3L7.5 7.5l3.3-1.2z" />
                        <path d="m18 13 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
                        <path d="m6 14 .9 2.5L9.4 17l-2.5.5L6 20l-.9-2.5-2.5-.5 2.5-.5z" />
                      </svg>
                    </button>
                  </div>
                  <button
                    type="submit"
                    className="msg-composer__iconbtn msg-composer__iconbtn--send"
                    aria-label="Send message"
                    title="Send message"
                    disabled={!draft.trim() && attachments.length === 0}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M22 2 11 13" />
                      <path d="M22 2 15 22l-4-9-9-4z" />
                    </svg>
                  </button>
                </div>
                </form>
              ) : (
                <div className="msg-composer msg-composer--locked">
                  <span className="msg-composer__lockicon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <p className="msg-composer__locked-text">You cannot interact with this conversation</p>
                  <button type="button" className="msg-composer__takeover" onClick={handleTakeOver}>
                    Take over conversation
                  </button>
                  <p className="msg-composer__takeover-hint">
                    Taking over pauses the AI agent and switches this conversation to a live agent, so
                    you can reply to the customer directly.{' '}
                    <strong className="msg-composer__takeover-warn">
                      This action cannot be reverted or restored.
                    </strong>
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="card--pad">
              <EmptyState
                icon="..."
                title="Choose a conversation"
                message="Select a conversation from the left to open the chat view."
              />
            </div>
          )}
        </Card>
      </section>

      <VaultPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onAttach={handleAttach} />
      <TemplateDrawer open={templateOpen} onClose={() => setTemplateOpen(false)} onUse={handleUseTemplate} />
    </div>
  );
}
