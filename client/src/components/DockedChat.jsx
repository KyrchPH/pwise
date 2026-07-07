import { useEffect, useRef, useState } from 'react';
import * as messaging from '../services/messaging.service.js';
import * as postPool from '../services/post_pool.service.js';
import { apiError } from '../services/api.js';
import { Button } from './ui.jsx';

// A Facebook-style docked mini-chat (bottom-right) for messaging a commenter. Opens from a
// comment's message button. The FIRST send fires a Messenger PRIVATE REPLY (Facebook hides
// the commenter's PSID, so we address them by comment id) — that creates the conversation;
// after that it behaves like a normal chat (send + live incoming over SSE). `chat` is
// { postId, commentId, prefill } or null.
export default function DockedChat({ chat, onClose, onOpened }) {
  const [phase, setPhase] = useState('compose'); // 'compose' (pre-conversation) | 'open'
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const bodyRef = useRef(null);

  // (Re)initialise whenever a different comment's chat is opened.
  useEffect(() => {
    if (!chat) return;
    setPhase('compose');
    setConversationId(null);
    setMessages([]);
    setDraft(chat.prefill || '');
    setError(null);
    setBusy(false);
    setMinimized(false);
  }, [chat?.commentId]);

  // Live incoming messages once the conversation exists.
  useEffect(() => {
    if (!conversationId) return undefined;
    return messaging.subscribe((event) => {
      if (event.type === 'message:new' && String(event.conversationId) === String(conversationId)) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const add = (event.messages || []).filter((m) => !seen.has(m.id));
          return add.length ? [...prev, ...add] : prev;
        });
      }
    });
  }, [conversationId]);

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, minimized]);

  if (!chat) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (phase === 'compose') {
        const { conversationId: cid } = await postPool.messageCommenter(chat.postId, chat.commentId, text);
        setConversationId(cid);
        setDraft('');
        onOpened?.(chat.commentId, cid); // let the comment flip to "Messaged"
        const conv = await messaging.getConversation(cid);
        setMessages(conv?.messages || []);
        setPhase('open');
      } else {
        const { messages: added } = await messaging.sendMessage(conversationId, { text });
        setDraft('');
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = (added || []).filter((m) => !seen.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`dchat${minimized ? ' dchat--min' : ''}`}>
      <div className="dchat__head" onClick={() => minimized && setMinimized(false)}>
        <div className="dchat__head-main">
          <span className="dchat__avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
            </svg>
          </span>
          <span className="dchat__title">Message commenter</span>
        </div>
        <div className="dchat__head-actions">
          <button
            type="button"
            className="dchat__iconbtn"
            onClick={(e) => { e.stopPropagation(); setMinimized((m) => !m); }}
            aria-label={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▢' : '—'}
          </button>
          <button type="button" className="dchat__iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="dchat__body" ref={bodyRef}>
            {phase === 'compose' && (
              <div className="dchat__hint">
                This sends a private message to the person who left this comment. You can only message them once per
                comment.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`dchat__msg${m.side === 'outgoing' ? ' dchat__msg--out' : ''}`}>
                {m.text && <div className="dchat__bubble">{m.text}</div>}
                {(m.media || []).map((md, i) => (
                  <div key={i} className="dchat__bubble dchat__bubble--media">
                    {md.name || md.type || 'attachment'}
                  </div>
                ))}
                <div className="dchat__time">
                  {m.time}
                  {m.deliveryStatus === 'failed' ? ' · failed' : ''}
                </div>
              </div>
            ))}
            {error && <div className="dchat__error">{error}</div>}
          </div>

          <div className="dchat__composer">
            <textarea
              className="textarea dchat__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={phase === 'compose' ? 'Write your message…' : 'Reply…'}
              rows={2}
              disabled={busy}
              autoFocus
            />
            <Button type="button" size="sm" className="btn--flat" onClick={send} disabled={busy || !draft.trim()}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
