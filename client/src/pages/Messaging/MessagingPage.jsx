import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, EmptyState } from '../../components/ui.jsx';
import { usePages } from '../../context/PageContext.jsx';
import {
  buildConversations,
  buildPageCards,
  formatTotal,
  messagePreview,
  resolveSelectedPageId,
} from './messagingData.js';

function CustomerAvatar({ name }) {
  return (
    <span className="msg-customer-avatar" aria-hidden="true">
      {(name || '?')
        .split(' ')
        .map((part) => part[0] || '')
        .slice(0, 2)
        .join('')
        .toUpperCase()}
    </span>
  );
}

export default function MessagingPage() {
  const { pages, activePage } = usePages();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectedPages = pages.filter((page) => page.is_active !== false);
  const pageCards = buildPageCards(connectedPages);
  const pageSnapshot = pageCards.map((page) => `${page.id}:${page.name}:${page.fbPageId}`).join('|');
  const requestedPageId = searchParams.get('page');
  const preferredPageId = activePage?.id != null ? String(activePage.id) : null;
  const mediaInputRef = useRef(null);

  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [mediaCount, setMediaCount] = useState(0);
  const [replyTo, setReplyTo] = useState(null);
  const [conversations, setConversations] = useState(() => buildConversations(buildPageCards([])));

  useEffect(() => {
    setConversations(buildConversations(pageCards));
  }, [pageSnapshot]);

  const selectedPageId = resolveSelectedPageId(pageCards, requestedPageId, preferredPageId);

  useEffect(() => {
    if (!selectedPageId || requestedPageId === selectedPageId) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('page', selectedPageId);
    setSearchParams(nextSearchParams, { replace: true });
  }, [requestedPageId, searchParams, selectedPageId, setSearchParams]);

  const pageSummaries = pageCards.map((page) => {
    const pageConversations = conversations.filter((conversation) => conversation.pageId === page.id);
    return {
      ...page,
      aiAgentMessages: formatTotal(pageConversations, 'AI Agent'),
      liveAgentMessages: formatTotal(pageConversations, 'Live Agent'),
    };
  });

  const visibleConversations = conversations.filter((conversation) => conversation.pageId === selectedPageId);
  const conversationSnapshot = visibleConversations.map((conversation) => conversation.id).join('|');

  useEffect(() => {
    setSelectedConversationId((current) =>
      visibleConversations.some((conversation) => conversation.id === current)
        ? current
        : visibleConversations[0]?.id || null,
    );
  }, [conversationSnapshot]);

  const activePageCard =
    pageSummaries.find((page) => page.id === selectedPageId) || pageSummaries[0] || null;
  const activeConversation =
    visibleConversations.find((conversation) => conversation.id === selectedConversationId) ||
    visibleConversations[0] ||
    null;

  useEffect(() => {
    if (!replyTo) return;
    const stillVisible = activeConversation?.messages.some((message) => message.id === replyTo.id);
    if (!stillVisible) setReplyTo(null);
  }, [activeConversation, replyTo]);

  const handleSend = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeConversation) return;

    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              summary: text,
              lastActivity: 'Just now',
              messages: [
                ...conversation.messages,
                {
                  id: `${conversation.id}-message-${conversation.messages.length + 1}`,
                  side: 'outgoing',
                  replyTo: replyTo
                    ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text }
                    : null,
                  sender: 'You',
                  time,
                  text,
                },
              ],
            }
          : conversation,
      ),
    );
    setDraft('');
    setMediaCount(0);
    setReplyTo(null);
    if (mediaInputRef.current) mediaInputRef.current.value = '';
  };

  return (
    <div className="messaging-page">
      <section className="msg-workspace">
        <Card className="msg-panel msg-panel--list">
          <div className="card__head">
            <div>
              <div className="card__title">Conversations</div>
              <div className="msg-panel__sub">
                {activePageCard ? `${activePageCard.name} inbox` : 'Messenger-style inbox list'}
              </div>
            </div>
            <span className="msg-pill">{visibleConversations.length} open</span>
          </div>

          {visibleConversations.length === 0 ? (
            <div className="card--pad">
              <EmptyState
                icon="..."
                title="No conversations yet"
                message="Once customers start messaging this page, the inbox list will appear here."
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
                    <CustomerAvatar name={conversation.customerName} />
                    <div className="msg-conversation__main">
                      <div className="msg-conversation__row">
                        <strong className="msg-conversation__name">{conversation.customerName}</strong>
                        <span className="msg-conversation__time">{conversation.lastActivity}</span>
                      </div>
                      <div className="msg-conversation__row">
                        <span className="msg-conversation__mode">{conversation.handledBy}</span>
                        {conversation.unread > 0 && (
                          <span className="msg-conversation__unread">{conversation.unread}</span>
                        )}
                      </div>
                      <p className="msg-conversation__preview">{conversation.summary}</p>
                      <div className="msg-conversation__foot">
                        <span className="msg-pill msg-pill--soft">{conversation.status}</span>
                        <span className="msg-conversation__count">
                          {conversation.activeMessages} active messages
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="msg-panel msg-panel--thread">
          {activeConversation ? (
            <>
              <div className="card__head msg-thread__head">
                <div className="msg-thread__identity">
                  <CustomerAvatar name={activeConversation.customerName} />
                  <div>
                    <div className="card__title">{activeConversation.customerName}</div>
                    <div className="msg-panel__sub">
                      {activeConversation.customerHandle} - {activeConversation.pageName}
                    </div>
                  </div>
                </div>
                <div className="msg-thread__meta">
                  <span className="msg-pill">{activeConversation.handledBy}</span>
                  <span className="msg-pill msg-pill--soft">{activeConversation.status}</span>
                </div>
              </div>

              <div className="msg-thread__tags">
                {activeConversation.tags.map((tag) => (
                  <span key={tag} className="msg-tag">
                    {tag}
                  </span>
                ))}
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
                        <div className="msg-bubble__text">{message.text}</div>
                        <div className="msg-bubble__time">{message.time}</div>
                      </div>
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
                    </div>
                  </div>
                ))}
              </div>

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
                <div className="msg-composer__bar">
                  <label
                    className={`msg-composer__iconbtn${mediaCount > 0 ? ' is-active' : ''}`}
                    title={
                      mediaCount > 0
                        ? `${mediaCount} file${mediaCount === 1 ? '' : 's'} selected`
                        : 'Upload media'
                    }
                    aria-label={
                      mediaCount > 0
                        ? `${mediaCount} file${mediaCount === 1 ? '' : 's'} selected`
                        : 'Upload media'
                    }
                  >
                    <input
                      ref={mediaInputRef}
                      type="file"
                      className="msg-composer__file"
                      multiple
                      onChange={(event) => setMediaCount(event.target.files?.length || 0)}
                    />
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
                  </label>
                  <button
                    type="button"
                    className="msg-composer__iconbtn"
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
                      className="input msg-composer__input"
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
                    disabled={!draft.trim()}
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
                {mediaCount > 0 && (
                  <div className="msg-composer__meta">
                    {mediaCount} media file{mediaCount === 1 ? '' : 's'} selected
                  </div>
                )}
              </form>
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
    </div>
  );
}
