import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import profilePhoto from '../assets/images/profile.png';
import { askWiseAssistant, apiError } from '../services/wise_assistant.service.js';

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

function pickGreeting(lastIndex) {
  if (GREETINGS.length <= 1) return { index: 0, message: GREETINGS[0] || '' };

  let index = lastIndex;
  while (index === lastIndex) index = Math.floor(Math.random() * GREETINGS.length);
  return { index, message: GREETINGS[index] };
}

export default function DevScreenAgent() {
  const { pathname } = useLocation();
  const hostRef = useRef(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(null);
  const lastGreetingRef = useRef(-1);
  const hideTimerRef = useRef(null);
  const replyTimerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [messages, setMessages] = useState([{ id: 'intro', role: 'agent', text: INTRO_MESSAGE }]);

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
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open, replying]);

  const toggleOpen = () => {
    clearTimeout(hideTimerRef.current);
    setGreeting('');
    setOpen((value) => !value);
  };

  const submit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || replying) return;

    const userMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setDraft('');
    setOpen(true);
    setReplying(true);
    setMessages((list) => [...list, userMessage]);

    const history = [...messages, userMessage]
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
        setMessages((list) => [...list, { id: `a-${Date.now()}`, role: 'agent', text: result.answer }]);
      } catch (error) {
        setMessages((list) => [
          ...list,
          {
            id: `a-${Date.now()}`,
            role: 'agent',
            text: `Wise Assistant is unavailable right now: ${apiError(error)}`,
          },
        ]);
      }
      setReplying(false);
    }, 180);
  };

  return (
    <div className="dev-agent-overlay">
      <div ref={rootRef} className={`dev-agent${ready ? ' is-ready' : ''}${open ? ' is-open' : ''}`}>
        {!open && greeting && <div className="dev-agent__bubble">{greeting}</div>}
        {open && (
          <div className="dev-agent__chat" role="dialog" aria-label="Assistant">
            <div className="dev-agent__chat-head">
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
              <button type="button" className="dev-agent__close" onClick={() => setOpen(false)} aria-label="Close assistant chat">
                ×
              </button>
            </div>
            <div className="dev-agent__messages" ref={messagesRef}>
              {messages.map((message) => (
                <div key={message.id} className={`dev-agent__msg dev-agent__msg--${message.role}`}>
                  {message.text}
                </div>
              ))}
              {replying && <div className="dev-agent__msg dev-agent__msg--agent is-pending">Thinking…</div>}
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
          </div>
        )}
        <button
          type="button"
          className="dev-agent__trigger"
          onClick={toggleOpen}
          aria-label="Open assistant chat"
          aria-expanded={open}
          aria-pressed={open}
        >
          <div className="dev-agent__halo" />
          <div className="dev-agent__anim" ref={hostRef} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
