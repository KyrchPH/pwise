import { Fragment, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import profilePhoto from '../assets/images/profile.png';
import { useAuth } from '../context/AuthContext.jsx';
import { askWiseAssistant, getWiseAssistantHistory, apiError } from '../services/wise_assistant.service.js';

const GREETINGS = [
  'Hey there.',
  'Hello from dev mode.',
  'Hi, builder.',
  'Hope your flow is going smoothly.',
  'Just checking in.',
  'Greetings, human.',
  'You are doing good work.',
  'Need anything?',
];
const GREETING_INTERVAL_MS = 60 * 1000;
const GREETING_VISIBLE_MS = 8 * 1000;
const ROBOT_NAME = 'Rovi';
const INTRO_MESSAGE = `Hi, I'm ${ROBOT_NAME}. Ask me a question and I will help guide you.`;
const INTRO_MESSAGES = [{ id: 'intro', role: 'agent', text: INTRO_MESSAGE }];
const MAX_STORED_MESSAGES = 50;

// The chat always opens with the static greeting; everything else is the real
// exchange. Normalize any source (cache or server) to "[intro, …real messages]".
function withIntro(list) {
  const rest = Array.isArray(list)
    ? list.filter((m) => m && m.id !== 'intro' && typeof m.text === 'string' && (m.role === 'agent' || m.role === 'user'))
    : [];
  return [INTRO_MESSAGES[0], ...rest];
}

// The conversation is persisted SERVER-SIDE per user (so it follows them across
// devices); localStorage is just a per-user cache for instant paint + offline. Keying
// the cache by user id keeps a shared browser from showing one user's chat to another.
const CHAT_CACHE_PREFIX = 'pwise.wiseAssistant.chat.';
function cacheKey(userId) {
  return userId ? `${CHAT_CACHE_PREFIX}${userId}` : null;
}
function loadCache(userId) {
  const key = cacheKey(userId);
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function saveCache(userId, messages) {
  const key = cacheKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    /* storage unavailable/full — non-fatal */
  }
}

// Typewriter reveal for assistant answers. The reveal is time-boxed rather than
// a fixed per-character speed, so a long answer doesn't crawl: ~TARGET_TICKS
// steps of TICK_MS each ≈ a steady ~1.4s no matter the length.
const TYPE_TICK_MS = 20;
const TYPE_TARGET_TICKS = 70;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Drag-to-dock: the robot snaps to one of four screen corners. The choice is a
// pure UI preference persisted in localStorage only (no server).
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const DEFAULT_CORNER = 'bottom-right';
const CORNER_KEY = 'pwise.wiseAssistant.corner';
const DRAG_THRESHOLD = 6; // px the pointer must travel before a press becomes a drag

function loadCorner() {
  try {
    const value = localStorage.getItem(CORNER_KEY);
    return CORNERS.includes(value) ? value : DEFAULT_CORNER;
  } catch {
    return DEFAULT_CORNER;
  }
}
function saveCorner(corner) {
  try {
    localStorage.setItem(CORNER_KEY, corner);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function pickGreeting(lastIndex) {
  if (GREETINGS.length <= 1) return { index: 0, message: GREETINGS[0] || '' };

  let index = lastIndex;
  while (index === lastIndex) index = Math.floor(Math.random() * GREETINGS.length);
  return { index, message: GREETINGS[index] };
}

// Inline markdown: **bold** and `code`. Returns an array of strings/elements
// so we never inject HTML (no dangerouslySetInnerHTML, no XSS surface).
const INLINE_PATTERN = /\*\*(.+?)\*\*|`([^`]+?)`/g;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let token = 0;
  let match;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${token}`}>{match[1]}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${token}`}>{match[2]}</code>);
    }
    lastIndex = INLINE_PATTERN.lastIndex;
    token += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

// Group raw assistant text into paragraph / list blocks. A blank line ends a
// block; lines starting with -, * or "1." become list items.
function formatMessage(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const ordered = line.match(/^(\d+)[.)]\s+(.*)$/);

    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
    } else if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ordered[2]);
    } else {
      flushList();
      paragraph.push(line);
    }
  });

  flushParagraph();
  flushList();
  return blocks;
}

// When `caret` is set the text is mid-typewriter, so a blinking cursor is
// rendered inline right after the last revealed character.
function AgentMessage({ text, caret = false }) {
  const blocks = formatMessage(text);
  const cursor = <span className="dev-agent__caret" aria-hidden="true" />;
  if (!blocks.length) return caret ? cursor : text;

  const lastBlock = blocks.length - 1;
  return blocks.map((block, bi) => {
    const blockCaret = caret && bi === lastBlock;
    if (block.type === 'ul' || block.type === 'ol') {
      const Tag = block.type === 'ul' ? 'ul' : 'ol';
      const lastItem = block.items.length - 1;
      return (
        <Tag key={`l${bi}`} className="dev-agent__md-list">
          {block.items.map((item, ii) => (
            <li key={ii}>
              {renderInline(item, `${bi}-${ii}`)}
              {blockCaret && ii === lastItem && cursor}
            </li>
          ))}
        </Tag>
      );
    }
    return (
      <p key={`p${bi}`} className="dev-agent__md-p">
        {block.lines.map((line, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${bi}-${li}`)}
          </Fragment>
        ))}
        {blockCaret && cursor}
      </p>
    );
  });
}

// Diagonal arrows pointing to opposite corners — "expand into the side panel".
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M21 3l-8 8" />
      <path d="M9 21H3v-6" />
      <path d="M3 21l8-8" />
    </svg>
  );
}

// Arrows pointing inward — "collapse back to the floating chat".
function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 4l-7 7" />
      <path d="M14 4v6h6" />
      <path d="M4 20l7-7" />
      <path d="M10 20v-6H4" />
    </svg>
  );
}

export default function DevScreenAgent() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const hostRef = useRef(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(null);
  const lastGreetingRef = useRef(-1);
  const hideTimerRef = useRef(null);
  const replyTimerRef = useRef(null);
  const interactedRef = useRef(false); // true once the user sends a message — guards the async restore
  const [ready, setReady] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [messages, setMessages] = useState(() => withIntro([]));
  // While an answer types out: { id, full, count }. Committed to `messages` once done.
  const [typing, setTyping] = useState(null);
  // Docked corner (drag-to-move), persisted to localStorage. While `drag` is set
  // the robot follows the pointer; on release it snaps to the nearest corner.
  const [corner, setCorner] = useState(loadCorner);
  const [drag, setDrag] = useState(null); // { x, y } px while dragging, else null
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false); // swallow the click that trails a drag

  useEffect(() => {
    if (!hostRef.current) return undefined;

    let live = true;
    let animation = null;

    Promise.all([import('lottie-web'), import('../assets/lotties/assistant.json')])
      .then(([lottieModule, animationModule]) => {
        if (!live || !hostRef.current) return;

        animation = lottieModule.default.loadAnimation({
          container: hostRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData: animationModule.default,
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid meet',
          },
        });
        setReady(true);
      })
      .catch((error) => {
        console.error('Failed to load the dev screen agent.', error);
      });

    return () => {
      live = false;
      clearTimeout(hideTimerRef.current);
      clearTimeout(replyTimerRef.current);
      animation?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!ready || open) return undefined;

    const showGreeting = () => {
      const next = pickGreeting(lastGreetingRef.current);
      lastGreetingRef.current = next.index;
      setGreeting(next.message);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setGreeting(''), GREETING_VISIBLE_MS);
    };

    const intervalId = setInterval(showGreeting, GREETING_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      clearTimeout(hideTimerRef.current);
    };
  }, [open, ready]);

  useEffect(() => {
    if (!open) return undefined;

    inputRef.current?.focus();

    const onPointerDown = (event) => {
      // The side panel is a deliberate, persistent surface — it stays open until
      // dismissed. Only the floating popover dismisses on an outside click.
      if (expanded) return;
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setExpanded(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, expanded]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open, replying, expanded, typing]);

  // Load the conversation for the current user: reset on any identity change (so a
  // shared browser never shows one user's chat to another), paint this user's cache
  // instantly, then reconcile to the server (the source of truth) — unless they've
  // already started typing.
  useEffect(() => {
    const userId = user?.id;
    interactedRef.current = false; // new identity context — start fresh
    if (!userId) {
      setMessages(withIntro([])); // logged out / login screen — just the greeting
      return undefined;
    }
    let live = true;
    setMessages(withIntro(loadCache(userId) || []));
    getWiseAssistantHistory()
      .then((serverMsgs) => {
        if (!live || interactedRef.current) return;
        const restored = withIntro((serverMsgs || []).map((m, i) => ({ id: `srv-${i}`, role: m.role, text: m.text })));
        setMessages(restored);
        saveCache(userId, restored);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user?.id]);

  // Mirror ongoing exchanges to the current user's cache. Depends on `messages` only,
  // so it never fires on the identity-change render (which would write the previous
  // user's chat into the new user's cache before the effect above replaces it).
  useEffect(() => {
    if (user?.id) saveCache(user.id, messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Drive the typewriter reveal one step at a time, then commit the finished
  // answer to `messages` and clear the typing buffer.
  useEffect(() => {
    if (!typing) return undefined;

    if (typing.count >= typing.full.length) {
      const { id, full } = typing;
      setMessages((list) => [...list, { id, role: 'agent', text: full }]);
      setTyping(null);
      return undefined;
    }

    const step = Math.max(1, Math.ceil(typing.full.length / TYPE_TARGET_TICKS));
    const timer = setTimeout(() => {
      setTyping((current) =>
        current ? { ...current, count: Math.min(current.full.length, current.count + step) } : current,
      );
    }, TYPE_TICK_MS);
    return () => clearTimeout(timer);
  }, [typing]);

  const toggleOpen = () => {
    clearTimeout(hideTimerRef.current);
    setGreeting('');
    if (open) {
      setOpen(false);
      setExpanded(false);
    } else {
      setOpen(true);
    }
  };

  const closeChat = () => {
    setOpen(false);
    setExpanded(false);
  };

  // Persist the docked corner — a pure UI preference, localStorage only.
  useEffect(() => {
    saveCorner(corner);
  }, [corner]);

  // Drag the robot anywhere; on release it snaps to the nearest screen corner. A
  // press that never passes the movement threshold stays a click (opens the chat).
  const startDrag = (event) => {
    if (event.button != null && event.button !== 0) return; // primary button / touch only
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    dragRef.current = {
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };

    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDrag({ x: e.clientX - d.grabX, y: e.clientY - d.grabY });
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || !d.moved) return;
      // Snap to the corner of the half the pointer was released in — pointer-based
      // (not robot-based) so dragging by the chat header docks where you drop it.
      const horizontal = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      const vertical = e.clientY < window.innerHeight / 2 ? 'top' : 'bottom';
      setCorner(`${vertical}-${horizontal}`);
      suppressClickRef.current = true; // the trailing click must not toggle the chat
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleTriggerClick = () => {
    if (suppressClickRef.current) return; // just finished a drag — ignore the click
    toggleOpen();
  };

  // The open chat's header doubles as a drag handle, so the assistant can be moved
  // while the chat is open (you grab the chat, not the small robot underneath it).
  // Presses on the action buttons (expand/close) are left alone so they still click.
  const onHeadPointerDown = (event) => {
    if (event.target.closest('.dev-agent__chat-actions')) return;
    startDrag(event);
  };

  // Reveal an answer with the typewriter effect — or, if the user prefers
  // reduced motion (or it's empty), drop it in immediately.
  const startTyping = (id, text) => {
    const full = String(text ?? '');
    if (!full || prefersReducedMotion()) {
      setMessages((list) => [...list, { id, role: 'agent', text: full }]);
      return;
    }
    setTyping({ id, full, count: 0 });
  };

  const submit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || replying) return;
    interactedRef.current = true; // user is engaging — don't let a late restore overwrite this

    // If a previous answer is still typing out, finalize it now so it isn't
    // dropped and is included in the context we send.
    const pending = typing ? { id: typing.id, role: 'agent', text: typing.full } : null;
    if (pending) setTyping(null);
    const pendingList = pending ? [pending] : [];

    const userMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setDraft('');
    setOpen(true);
    setReplying(true);
    setMessages((list) => [...list, ...pendingList, userMessage]);

    const history = [...messages, ...pendingList, userMessage]
      .slice(-8)
      .map((message) => ({ role: message.role, text: message.text }));

    clearTimeout(replyTimerRef.current);
    replyTimerRef.current = setTimeout(async () => {
      try {
        const result = await askWiseAssistant({
          question: text,
          pathname,
          history,
        });
        startTyping(`a-${Date.now()}`, result.answer);
      } catch (error) {
        startTyping(`a-${Date.now()}`, `Wise Assistant is unavailable right now: ${apiError(error)}`);
      }
      setReplying(false);
    }, 180);
  };

  // Shared conversation surface. The floating popover and the expanded side
  // drawer render the exact same chat — only the chrome (head padding, the
  // expand/collapse toggle) differs. Just one variant is mounted at a time,
  // so the shared messagesRef / inputRef never collide.
  const renderPanel = (variant) => {
    const isDrawer = variant === 'drawer';
    return (
      <>
        <div className="dev-agent__chat-head" onPointerDown={isDrawer ? undefined : onHeadPointerDown}>
          <div className="dev-agent__chat-identity">
            <img className="dev-agent__avatar" src={profilePhoto} alt="" />
            <div className="dev-agent__chat-meta">
              <div className="dev-agent__chat-title">Wise Assistant</div>
              <div className="dev-agent__chat-status">
                <span className="dev-agent__status-dot" aria-hidden="true" />
                online
              </div>
            </div>
          </div>
          <div className="dev-agent__chat-actions">
            <button
              type="button"
              className="dev-agent__icon-btn"
              onClick={() => setExpanded(!isDrawer)}
              aria-label={isDrawer ? 'Collapse assistant to floating chat' : 'Expand assistant into side panel'}
              aria-pressed={isDrawer}
              title={isDrawer ? 'Collapse' : 'Expand'}
            >
              {isDrawer ? <CollapseIcon /> : <ExpandIcon />}
            </button>
            <button type="button" className="dev-agent__close" onClick={closeChat} aria-label="Close assistant chat">
              ×
            </button>
          </div>
        </div>
        <div className="dev-agent__messages" ref={messagesRef}>
          {messages.map((message) => (
            <div key={message.id} className={`dev-agent__msg dev-agent__msg--${message.role}`}>
              {message.role === 'agent' ? <AgentMessage text={message.text} /> : message.text}
            </div>
          ))}
          {replying && <div className="dev-agent__msg dev-agent__msg--agent is-pending">Thinking…</div>}
          {typing && (
            <div className="dev-agent__msg dev-agent__msg--agent is-typing">
              <AgentMessage text={typing.full.slice(0, typing.count)} caret />
            </div>
          )}
        </div>
        <form className="dev-agent__composer" onSubmit={submit}>
          <input
            ref={inputRef}
            className="input dev-agent__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask me a question"
            aria-label="Ask the assistant"
          />
          <button type="submit" className="btn btn--primary btn--sm" disabled={!draft.trim() || replying}>
            Ask
          </button>
        </form>
      </>
    );
  };

  const [cornerV, cornerH] = corner.split('-'); // e.g. 'bottom' + 'right'
  const dragStyle = drag ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <div className="dev-agent-overlay">
      <div
        ref={rootRef}
        className={`dev-agent is-${cornerV} is-${cornerH}${ready ? ' is-ready' : ''}${open ? ' is-open' : ''}${expanded ? ' is-expanded' : ''}${drag ? ' is-dragging' : ''}`}
        style={dragStyle}
      >
        {!open && greeting && <div className="dev-agent__bubble">{greeting}</div>}
        {open && !expanded && (
          <div className="dev-agent__chat" role="dialog" aria-label="Wise Assistant">
            {renderPanel('popover')}
          </div>
        )}
        <button
          type="button"
          className="dev-agent__trigger"
          onPointerDown={startDrag}
          onClick={handleTriggerClick}
          aria-label="Open assistant chat — drag to move"
          aria-expanded={open}
          aria-pressed={open}
        >
          <div className="dev-agent__halo" />
          <div className="dev-agent__anim" ref={hostRef} aria-hidden="true" />
        </button>
      </div>
      {open && expanded && (
        <aside className="dev-agent__drawer" role="dialog" aria-label="Wise Assistant" aria-modal="false">
          {renderPanel('drawer')}
        </aside>
      )}
    </div>
  );
}
