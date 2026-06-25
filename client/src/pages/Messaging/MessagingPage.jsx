import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, Modal } from '../../components/ui.jsx';
import { AvatarWithPresence } from '../../components/PresenceBadge.jsx';
import TemplateDrawer from '../../components/TemplateDrawer.jsx';
import ProductsDrawer from '../../components/ProductsDrawer.jsx';
import { formatPrice } from '../../config/currency.js';
import { isVariable, priceRangeLabel } from '../../config/variants.js';
import VaultPickerModal from '../../components/VaultPickerModal.jsx';
import { VaultThumb } from '../../components/VaultThumb.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as messaging from '../../services/messaging.service.js';
import * as productsApi from '../../services/products.service.js';
import * as templatesApi from '../../services/message_templates.service.js';
import { buildPageCards, conversationPreview, messagePreview, resolveSelectedPageId } from './messagingData.js';
import AgentChat from './AgentChat.jsx';
import MediaLightbox from './MediaLightbox.jsx';
import messageAnimation from '../../assets/lotties/message.json';
import MessagingMetricsRail from './MessagingMetricsRail.jsx';
import TemplatesSection from './TemplatesSection.jsx';
import { renderMessageText } from './messageText.jsx';
import NotesDrawer, { NoteSticky } from '../../components/NotesDrawer.jsx';
import * as notesApi from '../../services/notes.service.js';

const AGENT_VIEW_STORAGE_KEY = 'pwise:messaging-agent-view';

function storedAgentView() {
  try {
    return localStorage.getItem(AGENT_VIEW_STORAGE_KEY) === 'foryou' ? 'foryou' : 'ai';
  } catch {
    return 'ai';
  }
}

// Two-way arrows for the transfer action, and an inbox glyph for the request bar.
function TransferIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
// Folded-corner note glyph for the Notes button in the conversation header.
function NotesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}
function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

// Two-letter initials for an avatar fallback (used for teammates with no photo).
function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((part) => part[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

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

function findTemplateSuggestion(templates, value) {
  const q = String(value || '').trim().toLowerCase();
  if (!q) return null;

  const scored = [];
  for (const template of templates || []) {
    const title = String(template.title || '').toLowerCase();
    const body = String(template.body || '').toLowerCase();
    const tags = Array.isArray(template.tags) ? template.tags.map((tag) => String(tag || '').toLowerCase()) : [];
    if (body.trim() === q) continue;

    let score = null;
    if (title.startsWith(q)) score = 0;
    else if (tags.some((tag) => tag.startsWith(q))) score = 1;
    else if (body.startsWith(q)) score = 2;
    else if (title.includes(q)) score = 3;
    else if (tags.some((tag) => tag.includes(q))) score = 4;
    else if (body.includes(q)) score = 5;

    if (score != null) scored.push({ template, score });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      String(a.template.title || '').length - String(b.template.title || '').length ||
      Number(a.template.id || 0) - Number(b.template.id || 0),
  );
  return scored[0]?.template || null;
}

export default function MessagingPage() {
  const { pages, activePage } = usePages();
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectedPages = pages.filter((page) => page.is_active !== false);
  const pageCards = buildPageCards(connectedPages);
  const requestedPageId = searchParams.get('page');
  const preferredPageId = activePage?.id != null ? String(activePage.id) : null;
  const filterRef = useRef(null);
  const copyTimerRef = useRef(null);
  const composerInputRef = useRef(null);
  const messagesRef = useRef(null); // scroll container for the open thread
  const inboxRefreshSeqRef = useRef(0);
  const stickBottomRef = useRef(true); // follow new messages unless the reader scrolled up
  const prevThreadScrollKeyRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false); // "scroll to latest" affordance when scrolled up
  const [lightbox, setLightbox] = useState(null); // media item being viewed fullscreen

  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [enhancing, setEnhancing] = useState(false); // AI "enhance" call in flight
  const [enhanced, setEnhanced] = useState(false); // hide the enhance button until the draft changes again
  const [attachments, setAttachments] = useState([]); // vault media staged for the next message
  const [pickerOpen, setPickerOpen] = useState(false); // vault attach dialog
  const [templateOpen, setTemplateOpen] = useState(false); // template drawer
  const [productsOpen, setProductsOpen] = useState(false); // products drawer
  const [notesOpen, setNotesOpen] = useState(false); // notes drawer
  const [notes, setNotes] = useState([]); // notes for the open thread (newest first)
  const [noteIndex, setNoteIndex] = useState(0); // which note the floating sticky shows
  const [noteBusy, setNoteBusy] = useState(false); // a note create in flight
  const [productList, setProductList] = useState([]); // products for the open thread's page
  const [productsLoading, setProductsLoading] = useState(false);
  const [composerTemplates, setComposerTemplates] = useState([]); // templates used for inline composer suggestions
  const [dropActive, setDropActive] = useState(false); // template being dragged over the thread
  const [replyTo, setReplyTo] = useState(null);
  const [messageMode, setMessageMode] = useState('customer'); // customer = current inbox, agent = unfiltered team view
  const [pendingAgentPeer, setPendingAgentPeer] = useState(null); // user id to DM when entering A2A (from a note)
  const [templatesView, setTemplatesView] = useState(false); // templates browse section in the content view (mode rail toggle)
  const [agentView, setAgentView] = useState(storedAgentView); // 'ai' = AI Agent · 'foryou' = live-agent queue
  const [filterOpen, setFilterOpen] = useState(false); // page-filter dropdown
  const [copiedId, setCopiedId] = useState(null); // message whose copy just succeeded
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [incomingRequests, setIncomingRequests] = useState([]); // pending transfers addressed to me
  const [requestsOpen, setRequestsOpen] = useState(false); // incoming-requests sidebar
  const [requestsTab, setRequestsTab] = useState('foryou'); // incoming-requests filter: 'foryou' | 'pool'
  const [transferFor, setTransferFor] = useState(null); // conversation being transferred
  const [agents, setAgents] = useState([]); // teammates for the transfer picker
  const [transferBusy, setTransferBusy] = useState(false);
  const [allowTransferToAi, setAllowTransferToAi] = useState(false); // ALLOW_TRANSFER_TO_AI flag (hand a chat back to AI)

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_VIEW_STORAGE_KEY, agentView);
    } catch {
      /* storage unavailable — the view just resets on reload */
    }
  }, [agentView]);

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

  // Refetch the conversations I'm allowed to see. This doubles as a silent
  // ownership validity check: the server only returns shared AI threads and Live
  // Agent threads still assigned to me, so stale/unowned rows disappear.
  const reloadConversations = useCallback(({ silent = true } = {}) => {
    const seq = ++inboxRefreshSeqRef.current;
    return messaging
      .listConversations()
      .then((list) => {
        if (seq === inboxRefreshSeqRef.current) setConversations(list);
        return list;
      })
      .catch((err) => {
        if (!silent && seq === inboxRefreshSeqRef.current) setLoadError(messaging.apiError(err));
        return null;
      });
  }, []);

  const selectAgentView = (nextView) => {
    setAgentView(nextView);
    reloadConversations(); // silent validity/ownership check for the target list
  };

  // Load the transfer requests waiting for me (the incoming-request bar).
  useEffect(() => {
    messaging.incomingTransfers().then(setIncomingRequests).catch(() => {});
  }, []);

  // Messaging feature flags (e.g. whether the hand-back-to-AI affordance is on).
  useEffect(() => {
    messaging.getConfig().then((c) => setAllowTransferToAi(!!c.allowTransferToAi)).catch(() => {});
  }, []);

  // Keep it live: SSE pushes new messages, freshly opened threads, ownership
  // changes, and transfer requests — from other users or n8n's inbound webhook.
  useEffect(() => {
    return messaging.subscribe((event) => {
      if (event.type === 'message:new') {
        setConversations((cur) =>
          cur.map((c) => (c.id === event.conversationId ? mergeIncoming(c, event) : c)),
        );
      } else if (event.type === 'message:status') {
        // Delivery outcome for already-shown bubbles (e.g. a Telegram send failed).
        setConversations((cur) =>
          cur.map((c) =>
            c.id === event.conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    const u = (event.updates || []).find((x) => String(x.id) === m.id);
                    return u ? { ...m, deliveryStatus: u.deliveryStatus } : m;
                  }),
                }
              : c,
          ),
        );
      } else if (event.type === 'conversation:new' && event.conversation) {
        // A new customer thread (e.g. n8n delivered a first message) — prepend it,
        // ignoring duplicates if the stream replays.
        setConversations((cur) =>
          cur.some((c) => c.id === event.conversation.id) ? cur : [event.conversation, ...cur],
        );
      } else if (event.type === 'conversation:updated' && event.conversation) {
        setConversations((cur) =>
          cur.map((c) => (c.id === event.conversation.id ? { ...c, ...event.conversation } : c)),
        );
      } else if (event.type === 'conversation:reassigned') {
        // Ownership moved (take-over or accepted transfer) — refetch what I can see.
        reloadConversations();
      } else if (event.type === 'transfer:new' && event.transfer) {
        setIncomingRequests((cur) => (cur.some((t) => t.id === event.transfer.id) ? cur : [event.transfer, ...cur]));
      } else if (event.type === 'transfer:resolved') {
        setIncomingRequests((cur) => cur.filter((t) => t.id !== event.transferId));
      } else if (event.type === 'note:new' && event.note) {
        if (String(event.conversationId) === String(activeIdRef.current)) {
          setNotes((cur) => (cur.some((n) => n.id === event.note.id) ? cur : [event.note, ...cur]));
          setNoteIndex(0);
        }
      } else if (event.type === 'note:deleted') {
        if (String(event.conversationId) === String(activeIdRef.current)) {
          setNotes((cur) => cur.filter((n) => String(n.id) !== String(event.noteId)));
        }
      }
    });
  }, [reloadConversations]);

  // The page filter targets a single page or all of them ('all'); with no request
  // it resolves to the active page so the inbox opens where you left off.
  const isAllPages = requestedPageId === 'all';
  const selectedPageId = isAllPages
    ? null
    : resolveSelectedPageId(pageCards, requestedPageId, preferredPageId);
  const isAgentToAgent = messageMode === 'agent';

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

  useEffect(() => {
    if (isAgentToAgent) setFilterOpen(false);
  }, [isAgentToAgent]);

  useEffect(() => {
    if (isAgentToAgent || templatesView) return undefined;
    const refresh = () => reloadConversations();
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isAgentToAgent, reloadConversations, templatesView]);

  // The list is the selected page's conversations (or every page when 'all'),
  // narrowed to the active tab: AI-handled threads vs. the live-agent queue.
  const wantedHandler = agentView === 'ai' ? 'AI Agent' : 'Live Agent';
  const currentUserId = Number(user?.id);
  const visibleConversations = isAgentToAgent
    ? conversations
    : conversations.filter(
        (conversation) =>
          (isAllPages || conversation.pageId === selectedPageId) &&
          conversation.handledBy === wantedHandler &&
          (agentView === 'ai' || (Number.isFinite(currentUserId) && Number(conversation.assignedUserId) === currentUserId)),
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
  const composerPageId = activeConversation?.pageId || selectedPageId || preferredPageId;

  const isAdmin = user?.role === 'admin';

  // Notes for the open thread. activeIdRef lets the (stable) SSE subscription check
  // whether a note:new / note:deleted event belongs to the conversation on screen
  // without resubscribing every time the selection changes.
  const activeIdRef = useRef(null);
  useEffect(() => {
    activeIdRef.current = activeConversation?.id || null;
  }, [activeConversation?.id]);

  useEffect(() => {
    const id = activeConversation?.id;
    if (!id) {
      setNotes([]);
      setNoteIndex(0);
      return undefined;
    }
    let alive = true;
    notesApi
      .list(id)
      .then((rows) => {
        if (alive) {
          setNotes(rows);
          setNoteIndex(0);
        }
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [activeConversation?.id]);

  // Keep the sticky's index in range as notes are added or removed.
  useEffect(() => {
    setNoteIndex((i) => Math.min(Math.max(i, 0), Math.max(0, notes.length - 1)));
  }, [notes.length]);

  const addNote = async (body) => {
    if (!activeConversation) return;
    setNoteBusy(true);
    try {
      const note = await notesApi.create(activeConversation.id, body);
      setNotes((cur) => (cur.some((n) => n.id === note.id) ? cur : [note, ...cur]));
      setNoteIndex(0);
      toast.success('Note added');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not add the note');
      throw err;
    } finally {
      setNoteBusy(false);
    }
  };

  const deleteNote = async (id) => {
    try {
      await notesApi.remove(id);
      setNotes((cur) => cur.filter((n) => String(n.id) !== String(id)));
      toast.success('Note deleted');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not delete the note');
    }
  };

  // Message a note's author: jump to the Agent-to-Agent view and open a DM with them.
  const messageAuthor = (note) => {
    if (!note?.createdBy || Number(note.createdBy) === Number(user?.id)) return;
    setNotesOpen(false);
    setPendingAgentPeer(Number(note.createdBy));
    setMessageMode('agent');
  };

  // The composer is enabled only on a Live Agent thread BOUND TO ME. AI-agent
  // threads are read-only until taken over; another agent's bound thread isn't
  // shown here at all (the server filters it out).
  const isLiveAgent =
    activeConversation?.handledBy === 'Live Agent' && activeConversation?.assignedUserId === user?.id;

  // A pending outgoing transfer locks the composer until the recipient accepts (the
  // thread then leaves this view) or declines (it unlocks). Server-backed, so it
  // survives a reload and arrives live over SSE.
  const transferPending = !!activeConversation?.transferPending;

  useEffect(() => {
    if (!composerPageId) {
      setComposerTemplates([]);
      return undefined;
    }
    let alive = true;
    templatesApi
      .list(composerPageId)
      .then((rows) => {
        if (alive) setComposerTemplates(rows);
      })
      .catch(() => {
        if (alive) setComposerTemplates([]);
      });
    return () => {
      alive = false;
    };
  }, [composerPageId]);

  const templateSuggestion = isLiveAgent ? findTemplateSuggestion(composerTemplates, draft) : null;
  const acceptTemplateSuggestion = () => {
    if (!templateSuggestion?.body) return;
    const next = templateSuggestion.body;
    setDraft(next);
    requestAnimationFrame(() => {
      const input = composerInputRef.current;
      input?.focus();
      input?.setSelectionRange?.(next.length, next.length);
    });
  };
  const handleComposerKeyDown = (event) => {
    if (event.key !== 'Tab' || event.shiftKey || !templateSuggestion) return;
    event.preventDefault();
    acceptTemplateSuggestion();
  };

  // Unread "chats" = conversations not yet seen (unread > 0). These drive the
  // page-filter badges — a per-page count and a grand total.
  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0);
  const unreadForPage = (pageId) =>
    conversations.reduce((sum, c) => sum + (c.pageId === pageId && c.unread > 0 ? 1 : 0), 0);

  // The Pool: AI-handled threads flagged for a human (e.g. order requests queued while
  // no agent was online). Any agent can claim one from the Incoming-requests drawer.
  const poolConversations = conversations.filter((c) => c.status === 'Needs human');
  const attentionCount = incomingRequests.length + poolConversations.length;

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

  // Keep the thread pinned to the newest message. Switching threads jumps to the
  // bottom; returning from Agent-to-Agent/templates is also treated as a fresh
  // open even if the selected conversation id did not change. A new bubble only
  // follows down if the reader is already near the bottom, so someone scrolled up
  // reading history isn't yanked back down.
  useEffect(() => {
    const threadScrollKey =
      !isAgentToAgent && !templatesView && activeConversation?.id
        ? `${agentView}:${activeConversation.id}`
        : null;

    if (!threadScrollKey) {
      prevThreadScrollKeyRef.current = null;
      stickBottomRef.current = true;
      setShowScrollBtn(false);
      return undefined;
    }

    const el = messagesRef.current;
    if (!el) return undefined;

    if (prevThreadScrollKeyRef.current !== threadScrollKey) {
      prevThreadScrollKeyRef.current = threadScrollKey;
      stickBottomRef.current = true;
    }

    if (!stickBottomRef.current) return undefined;

    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
      setShowScrollBtn(false);
    };

    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversation?.id, activeConversation?.messages.length, agentView, isAgentToAgent, templatesView]);

  // Re-evaluate "stuck to bottom" as the reader scrolls (80px slack for near-bottom),
  // and reveal the "scroll to latest" arrow once they're well above the bottom.
  const handleMessagesScroll = (event) => {
    const el = event.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = distanceFromBottom < 80;
    setShowScrollBtn(distanceFromBottom > 240);
  };

  // Jump back to the newest message (the floating arrow button).
  const scrollToLatest = () => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickBottomRef.current = true;
    setShowScrollBtn(false);
  };

  // Polish the draft with AI. After it succeeds the button hides (enhanced=true) and
  // only reappears once the draft changes again (the input's onChange clears it).
  const enhanceDraft = async () => {
    const text = draft.trim();
    if (!text || enhancing) return;
    setEnhancing(true);
    try {
      const { text: improved } = await messaging.enhance(text);
      setDraft(improved);
      setEnhanced(true);
    } catch (err) {
      toast.error(messaging.apiError(err));
    } finally {
      setEnhancing(false);
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && attachments.length === 0) || !activeConversation || !isLiveAgent || transferPending) return;

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

  // ── Products drawer ───────────────────────────────────────────────────────────
  const productToText = (p) => {
    const lines = [];
    if (p?.name) lines.push(p.name);
    if (isVariable(p)) lines.push(`Price: ${priceRangeLabel(p, activePage?.currency)}`);
    else if (p?.basePrice != null) lines.push(`Price: ${formatPrice(p.basePrice, activePage?.currency)}`);
    if (p?.description) lines.push(p.description);
    return lines.join('\n');
  };

  // Drop a "product card" into the composer: stage the photo as an image attachment
  // (same single-type/max-5 rules as the Vault) and fill the message box with the text.
  const insertProduct = (product) => {
    if (!product) return;
    if (product.photoUrl) {
      setAttachments((prev) => {
        const pid = `product-${product.id}`;
        if (prev.length >= 5 || prev.some((x) => x.id === pid)) return prev;
        if (prev.length && prev[0].mediaType !== 'image') return prev; // don't mix media types
        return [...prev, { id: pid, mediaType: 'image', url: product.photoUrl, name: product.name || 'product' }];
      });
    }
    const text = productToText(product);
    if (text) setDraft((current) => (current.trim() ? `${current}\n${text}` : text));
    setProductsOpen(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };
  const handleUseProduct = (product) => insertProduct(product);

  // Open the products drawer and load the open thread's page products.
  const openProducts = () => {
    setTemplateOpen(false);
    setProductsOpen(true);
    const pageId = activeConversation?.pageId;
    if (!pageId) {
      setProductList([]);
      return;
    }
    setProductsLoading(true);
    productsApi
      .list(pageId)
      .then(setProductList)
      .catch(() => setProductList([]))
      .finally(() => setProductsLoading(false));
  };

  // ── Drag-and-drop onto the live thread (templates + products) ─────────────────
  const hasTemplateDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('application/x-pwise-template');
  const hasProductDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('application/x-pwise-product');
  const hasInsertableDrag = (event) => hasTemplateDrag(event) || hasProductDrag(event);

  const handleTemplateDragOver = (event) => {
    if (!isLiveAgent || !hasInsertableDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };

  const handleTemplateDragLeave = (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setDropActive(false);
  };

  // A template fills the composer; a product drops a "product card" (photo + text).
  const handleTemplateDrop = (event) => {
    if (!isLiveAgent || !hasInsertableDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    if (hasProductDrag(event)) {
      try {
        insertProduct(JSON.parse(event.dataTransfer.getData('application/x-pwise-product')));
      } catch {
        /* ignore a malformed product payload */
      }
      return;
    }
    insertTemplateText(
      event.dataTransfer.getData('application/x-pwise-template') ||
        event.dataTransfer.getData('text/plain'),
    );
  };

  // Take over an AI-agent thread (the open one, or one claimed from the Pool): mark it
  // Live Agent (enabling the composer), clear any "Needs human" flag, and surface it in
  // the "For You" tab with the thread kept open.
  const takeOverConversation = (id) => {
    if (!id) return;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, handledBy: 'Live Agent', assignedUserId: user?.id, assignedUserName: user?.name, status: '' }
          : conversation,
      ),
    );
    setAgentView('foryou');
    setSelectedConversationId(id);
    messaging.takeOver(id).catch(() => {});
  };
  const handleTakeOver = () => {
    if (activeConversation) takeOverConversation(activeConversation.id);
  };

  // Hand the open Live Agent thread back to the AI agent (double-click the customer
  // avatar). Gated by the ALLOW_TRANSFER_TO_AI flag; only meaningful on a thread I own.
  const handleReturnToAi = () => {
    if (!allowTransferToAi || !activeConversation || !isLiveAgent) return;
    const id = activeConversation.id;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, handledBy: 'AI Agent', assignedUserId: null, assignedUserName: '', status: '' }
          : conversation,
      ),
    );
    setAgentView('ai');
    setSelectedConversationId(id);
    messaging
      .returnToAi(id)
      .then(() => toast.success('Conversation handed back to the AI agent'))
      .catch((e) => {
        toast.error(messaging.apiError(e));
        reloadConversations(); // re-sync if the server rejected it (e.g. flag off)
      });
  };

  // Open the transfer picker for the active (owned) conversation, loading teammates.
  const openTransfer = () => {
    if (!activeConversation) return;
    setTransferFor(activeConversation);
    if (!agents.length) messaging.agents().then(setAgents).catch(() => {});
  };
  const doTransfer = async (toUserId) => {
    if (!transferFor || transferBusy) return;
    setTransferBusy(true);
    try {
      await messaging.requestTransfer(transferFor.id, toUserId);
      // Lock the composer right away; the server also pushes this over SSE (with the
      // recipient's name) and removes the thread once they accept.
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === transferFor.id ? { ...conversation, transferPending: true } : conversation,
        ),
      );
      toast.success('Transfer request sent — waiting for them to accept');
      setTransferFor(null);
    } catch (e) {
      toast.error(messaging.apiError(e));
    } finally {
      setTransferBusy(false);
    }
  };

  // The sender cancels their own pending transfer (from the composer's pending
  // banner). Unlocks the composer immediately; the recipient's request clears via SSE.
  const cancelTransfer = async () => {
    if (!activeConversation) return;
    const id = activeConversation.id;
    try {
      await messaging.cancelTransfer(id);
      setConversations((cur) =>
        cur.map((c) => (c.id === id ? { ...c, transferPending: false, transferPendingTo: '' } : c)),
      );
      toast.success('Transfer cancelled');
    } catch (e) {
      toast.error(messaging.apiError(e));
    }
  };
  const acceptRequest = async (req) => {
    try {
      await messaging.acceptTransfer(req.id);
      setIncomingRequests((cur) => cur.filter((t) => t.id !== req.id));
      reloadConversations();
      setAgentView('foryou');
      setSelectedConversationId(req.conversationId);
      setRequestsOpen(false);
      toast.success('Conversation transferred to you');
    } catch (e) {
      // A stale request (the sender cancelled, it was declined, or superseded) → the
      // server rejects it as no-longer-pending; drop it so it can't be actioned again.
      const status = e?.response?.status;
      if (status === 400 || status === 404) {
        setIncomingRequests((cur) => cur.filter((t) => t.id !== req.id));
        toast.error('This transfer is no longer available.');
      } else {
        toast.error(messaging.apiError(e));
      }
    }
  };
  const declineRequest = async (req) => {
    try {
      await messaging.declineTransfer(req.id);
      setIncomingRequests((cur) => cur.filter((t) => t.id !== req.id));
    } catch (e) {
      // Already resolved (cancelled or accepted elsewhere) → just clear it locally.
      const status = e?.response?.status;
      if (status === 400 || status === 404) setIncomingRequests((cur) => cur.filter((t) => t.id !== req.id));
      else toast.error(messaging.apiError(e));
    }
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
    <div className={`messaging-page${templateOpen || productsOpen ? ' is-template-open' : ''}`}>
      <aside className="msg-mode-rail" aria-label="Messaging mode">
        <button
          type="button"
          className={`msg-mode-card${messageMode === 'agent' && !templatesView ? ' is-active' : ''}`}
          onClick={() => {
            setMessageMode('agent');
            setTemplatesView(false);
          }}
          aria-pressed={messageMode === 'agent' && !templatesView}
          aria-label="Agent to Agent"
          title="Agent to Agent"
        >
          <span className="msg-mode-card__avatar msg-mode-card__avatar--agent" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 11a4 4 0 1 0-8 0" />
              <path d="M4 21a8 8 0 0 1 16 0" />
              <path d="M18 8h1a3 3 0 0 1 0 6h-1" />
              <path d="M6 8H5a3 3 0 0 0 0 6h1" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className={`msg-mode-card${messageMode === 'customer' && !templatesView ? ' is-active' : ''}`}
          onClick={() => {
            setMessageMode('customer');
            setTemplatesView(false);
          }}
          aria-pressed={messageMode === 'customer' && !templatesView}
          aria-label="Agent to Customer"
          title="Agent to Customer"
        >
          <span className="msg-mode-card__avatar msg-mode-card__avatar--customer" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              <path d="M8 9h8" />
              <path d="M8 13h5" />
            </svg>
          </span>
        </button>
        <MessagingMetricsRail accountId={selectedPageId || preferredPageId} />
        <div className="msg-rail-divider" aria-hidden="true" />
        <button
          type="button"
          className={`msg-mode-card${templatesView ? ' is-active' : ''}`}
          onClick={() => setTemplatesView(true)}
          aria-pressed={templatesView}
          aria-label="Templates"
          title="Templates"
        >
          <span className="msg-mode-card__avatar msg-mode-card__avatar--templates" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <line x1="7.5" y1="9" x2="16.5" y2="9" />
              <line x1="7.5" y1="13" x2="16.5" y2="13" />
              <line x1="7.5" y1="17" x2="12.5" y2="17" />
            </svg>
          </span>
        </button>
      </aside>
      <section className="msg-workspace">
        {templatesView ? (
          <TemplatesSection accountId={selectedPageId || preferredPageId} />
        ) : isAgentToAgent ? (
          <AgentChat openWithUserId={pendingAgentPeer} onOpened={() => setPendingAgentPeer(null)} />
        ) : (
        <>
        <Card className="msg-panel msg-panel--list">
          <div className="card__head">
            <div>
              <div className="card__title">{isAgentToAgent ? 'Agent to Agent' : 'Messaging'}</div>
              {isAgentToAgent && <div className="msg-panel__sub">All conversations, unfiltered</div>}
            </div>
            {!isAgentToAgent && (
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
            )}
          </div>

          {!isAgentToAgent && (
            <button
              type="button"
              className="msg-requests-bar"
              onClick={() => setRequestsOpen(true)}
              aria-haspopup="dialog"
            >
              <span className="msg-requests-bar__icon">
                <InboxIcon />
              </span>
              <span className="msg-requests-bar__label">Incoming requests</span>
              {attentionCount > 0 && (
                <span className="msg-requests-bar__count">{attentionCount}</span>
              )}
            </button>
          )}

          {!isAgentToAgent && (
            <div className="msg-list-switch">
              <div className="seg msg-list-switch__seg" role="tablist" aria-label="Conversation view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={agentView === 'ai'}
                  className={`seg__btn${agentView === 'ai' ? ' is-active' : ''}`}
                  onClick={() => selectAgentView('ai')}
                >
                  AI Agent
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={agentView === 'foryou'}
                  className={`seg__btn${agentView === 'foryou' ? ' is-active' : ''}`}
                  onClick={() => selectAgentView('foryou')}
                >
                  For You
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <ul className="msg-conversation-list" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="msg-skel-row">
                  <span className="msg-skel msg-skel--avatar" />
                  <div className="msg-skel-row__main">
                    <span className="msg-skel msg-skel--line msg-skel--name" />
                    <span className="msg-skel msg-skel--line" />
                    <span className="msg-skel msg-skel--line msg-skel--short" />
                  </div>
                </li>
              ))}
            </ul>
          ) : loadError ? (
            <div className="card--pad">
              <EmptyState icon="!" title="Couldn’t load messages" message={loadError} />
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="card--pad">
              <EmptyState
                icon="..."
                title="No conversations"
                message={
                  isAgentToAgent
                    ? 'No conversations are available in the team view yet.'
                    : 'No conversations match this view yet. Try another page or switch tabs.'
                }
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
                        <span className="msg-conversation__tags">
                          <span className="msg-conversation__mode">{conversation.handledBy}</span>
                          {conversation.status && (
                            <span className="msg-conversation__status">{conversation.status}</span>
                          )}
                          {conversation.pageName && (
                            <span className="msg-conversation__page" title={conversation.pageName}>
                              {conversation.pageName}
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="msg-conversation__preview">{conversationPreview(conversation, user?.name)}</p>
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
                  <span
                    onDoubleClick={isLiveAgent && allowTransferToAi ? handleReturnToAi : undefined}
                    title={isLiveAgent && allowTransferToAi ? 'Double-click to hand this chat back to the AI agent' : undefined}
                    style={{
                      display: 'inline-flex',
                      userSelect: 'none',
                      ...(isLiveAgent && allowTransferToAi ? { cursor: 'pointer' } : {}),
                    }}
                  >
                    <CustomerAvatar
                      name={activeConversation.customerName}
                      origin={activeConversation.origin}
                      avatarUrl={activeConversation.avatarUrl}
                    />
                  </span>
                  <div>
                    <div className="card__title">{activeConversation.customerName}</div>
                    <div className="msg-panel__sub msg-thread__sub">
                      {activeConversation.lastActivity && activeConversation.lastActivity !== 'Just now' && (
                        <span>Last message {activeConversation.lastActivity}</span>
                      )}
                      <span className="msg-thread__page">{activeConversation.pageName}</span>
                    </div>
                  </div>
                </div>
                <div className="msg-thread__meta">
                  <button
                    type="button"
                    className="msg-notes-btn"
                    onClick={() => setNotesOpen(true)}
                    title="Notes"
                    aria-label={notes.length ? `Notes (${notes.length})` : 'Notes'}
                  >
                    <NotesIcon />
                    {notes.length > 0 && <span className="msg-notes-btn__badge">{notes.length}</span>}
                  </button>
                  {isLiveAgent && (
                    <button
                      type="button"
                      className="msg-transfer-btn"
                      onClick={openTransfer}
                      title="Transfer conversation"
                      aria-label="Transfer conversation"
                    >
                      <TransferIcon />
                    </button>
                  )}
                  <span className={`msg-status-badge msg-status-badge--${isLiveAgent ? 'live' : 'ai'}`}>
                    <span className="msg-status-badge__dot" aria-hidden="true" />
                    {activeConversation.handledBy}
                  </span>
                </div>
              </div>

              <div className="msg-thread__scrollwrap">
              <NoteSticky notes={notes} index={noteIndex} onIndex={setNoteIndex} onOpen={() => setNotesOpen(true)} />
              <div className="msg-thread__messages" ref={messagesRef} onScroll={handleMessagesScroll}>
                {activeConversation.messages.map((message) => {
                  const isMediaOnly = message.media?.length > 0 && !message.text && !message.replyTo;

                  return (
                    <div
                      key={message.id}
                      className={`msg-bubble-wrap${message.side === 'outgoing' ? ' is-outgoing' : ''}`}
                    >
                      <div className={`msg-bubble-stack${message.side === 'outgoing' ? ' is-outgoing' : ''}`}>
                        {isMediaOnly ? (
                          <div className={`msg-media-message${message.side === 'outgoing' ? ' is-outgoing' : ''}`}>
                            <div className="msg-media-message__sender">{message.sender}</div>
                            <div className={`msg-bubble__media msg-media-message__media${message.media.length === 1 ? ' is-single' : ''}`}>
                              {message.media.map((m, index) => (
                                <button
                                  key={index}
                                  type="button"
                                  className="msg-bubble__media-tile"
                                  onClick={() => setLightbox(m)}
                                  aria-label={`View ${m.name || 'attachment'}`}
                                >
                                  <VaultThumb item={{ type: 'file', mediaType: m.type, url: m.url, name: m.name }} />
                                </button>
                              ))}
                            </div>
                            <div className="msg-media-message__time">{message.time}</div>
                          </div>
                        ) : (
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
                                  <button
                                    key={index}
                                    type="button"
                                    className="msg-bubble__media-tile"
                                    onClick={() => setLightbox(m)}
                                    aria-label={`View ${m.name || 'attachment'}`}
                                  >
                                    <VaultThumb item={{ type: 'file', mediaType: m.type, url: m.url, name: m.name }} />
                                  </button>
                                ))}
                              </div>
                            )}
                            {message.text && <div className="msg-bubble__text">{renderMessageText(message.text)}</div>}
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
                              {message.side === 'outgoing' && message.deliveryStatus === 'failed' && (
                                <span className="msg-bubble__undelivered" title="Not delivered to the customer">
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                                    <path d="M12 9v4" />
                                    <path d="M12 17h.01" />
                                  </svg>
                                  Not delivered
                                </span>
                              )}
                              <span className="msg-bubble__time">{message.time}</span>
                            </div>
                          </div>
                        )}
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
                  );
                })}
              </div>
                {showScrollBtn && (
                  <button
                    type="button"
                    className="msg-scrolldown"
                    onClick={scrollToLatest}
                    aria-label="Scroll to latest messages"
                    title="Scroll to latest"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14" />
                      <path d="M19 12l-7 7-7-7" />
                    </svg>
                  </button>
                )}
              </div>

              {isLiveAgent && transferPending ? (
                <div className="msg-composer msg-composer--locked msg-composer--pending">
                  <span className="msg-composer__lockicon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="17 1 21 5 17 9" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <polyline points="7 23 3 19 7 15" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </span>
                  <p className="msg-composer__locked-text">
                    Transfer pending — waiting for {activeConversation.transferPendingTo || 'the other agent'} to accept. You can&apos;t reply until it&apos;s accepted or declined.
                  </p>
                  <button type="button" className="msg-composer__takeover" onClick={cancelTransfer}>
                    Cancel transfer
                  </button>
                </div>
              ) : isLiveAgent ? (
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
                    onClick={() => {
                      setProductsOpen(false);
                      setTemplateOpen(true);
                    }}
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
                  <button
                    type="button"
                    className={`msg-composer__iconbtn${productsOpen ? ' is-active' : ''}`}
                    onClick={openProducts}
                    aria-label="Products"
                    title="Products"
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
                      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <path d="M16 10a4 4 0 0 1-8 0" />
                    </svg>
                  </button>
                  <div className="msg-composer__inputwrap">
                    {templateSuggestion && (
                      <button
                        type="button"
                        className="msg-composer__template-suggest"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={acceptTemplateSuggestion}
                        title="Press Tab to use this template"
                      >
                        <span className="msg-composer__template-copy">
                          <span className="msg-composer__template-title">{templateSuggestion.title}</span>
                          <span className="msg-composer__template-body">
                            {messagePreview(templateSuggestion.body, 120)}
                          </span>
                        </span>
                        <span className="msg-composer__template-key">Tab</span>
                      </button>
                    )}
                    <input
                      ref={composerInputRef}
                      className={`input msg-composer__input${dropActive ? ' is-drop' : ''}`}
                      value={draft}
                      onChange={(event) => { setDraft(event.target.value); setEnhanced(false); }}
                      onKeyDown={handleComposerKeyDown}
                      placeholder="Type a message..."
                    />
                    {draft.trim() && !enhanced && (
                    <button
                      type="button"
                      className={`msg-composer__enhance${enhancing ? ' is-busy' : ''}`}
                      onClick={enhanceDraft}
                      disabled={enhancing}
                      aria-label="Enhance with AI"
                      title="Enhance with AI"
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
                    )}
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
                lottie={messageAnimation}
                title="Choose a conversation"
                message="Select a conversation from the left to open the chat view."
              />
            </div>
          )}
        </Card>
        </>
        )}
      </section>

      <VaultPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onAttach={handleAttach} />
      <TemplateDrawer open={templateOpen} onClose={() => setTemplateOpen(false)} onUse={handleUseTemplate} />
      <ProductsDrawer
        open={productsOpen}
        onClose={() => setProductsOpen(false)}
        onUse={handleUseProduct}
        products={productList}
        loading={productsLoading}
        currency={activePage?.currency}
      />
      <NotesDrawer
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        notes={notes}
        onCreate={addNote}
        onDelete={deleteNote}
        onMessageAuthor={messageAuthor}
        canDelete={isAdmin}
        creating={noteBusy}
        currentUserId={user?.id}
      />
      <MediaLightbox media={lightbox} onClose={() => setLightbox(null)} />

      {/* Incoming transfer requests — a right-side drawer opened from the request bar. */}
      {requestsOpen && (
        <div className="msg-requests" role="dialog" aria-modal="true" aria-label="Incoming transfer requests">
          <div className="msg-requests__scrim" onClick={() => setRequestsOpen(false)} />
          <aside className="msg-requests__panel">
            <header className="msg-requests__head">
              <div>
                <h3 className="msg-requests__title">Incoming requests</h3>
                <p className="msg-requests__sub">
                  {requestsTab === 'pool'
                    ? 'Unassigned conversations anyone online can take over.'
                    : 'Conversations teammates want to hand to you.'}
                </p>
              </div>
              <button
                type="button"
                className="msg-requests__close"
                onClick={() => setRequestsOpen(false)}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </header>
            <div className="seg msg-requests__seg" role="tablist" aria-label="Request filter">
              <button
                type="button"
                role="tab"
                aria-selected={requestsTab === 'foryou'}
                className={`seg__btn${requestsTab === 'foryou' ? ' is-active' : ''}`}
                onClick={() => setRequestsTab('foryou')}
              >
                For you{incomingRequests.length ? ` (${incomingRequests.length})` : ''}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={requestsTab === 'pool'}
                className={`seg__btn${requestsTab === 'pool' ? ' is-active' : ''}`}
                onClick={() => setRequestsTab('pool')}
              >
                Pool{poolConversations.length ? ` (${poolConversations.length})` : ''}
              </button>
            </div>
            <div className="msg-requests__body">
              {requestsTab === 'foryou' ? (
                incomingRequests.length === 0 ? (
                  <div className="msg-requests__empty">
                    <span className="msg-requests__empty-icon">
                      <InboxIcon />
                    </span>
                    <p className="msg-requests__empty-title">No incoming requests</p>
                    <p className="msg-requests__empty-text">
                      When a teammate transfers a conversation to you, it shows up here for you to accept.
                    </p>
                  </div>
                ) : (
                  <ul className="msg-request-list">
                    {incomingRequests.map((req) => (
                      <li key={req.id} className="msg-request">
                        <div className="msg-request__top">
                          <CustomerAvatar
                            name={req.customerName || 'Customer'}
                            origin={req.origin}
                            avatarUrl={req.avatarUrl}
                          />
                          <div className="msg-request__who">
                            <span className="msg-request__name">{req.customerName || 'Customer'}</span>
                            <span className="msg-request__from">
                              from {req.fromUserName || 'a teammate'}
                              {req.pageName ? ` · ${req.pageName}` : ''}
                            </span>
                          </div>
                        </div>
                        <div className="msg-request__actions">
                          <Button variant="ghost" size="sm" onClick={() => declineRequest(req)}>
                            Decline
                          </Button>
                          <Button variant="primary" size="sm" className="msg-request__accept" onClick={() => acceptRequest(req)}>
                            Accept
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : poolConversations.length === 0 ? (
                <div className="msg-requests__empty">
                  <span className="msg-requests__empty-icon">
                    <InboxIcon />
                  </span>
                  <p className="msg-requests__empty-title">Pool is empty</p>
                  <p className="msg-requests__empty-text">
                    Order requests waiting for a human land here. Anyone can take one over.
                  </p>
                </div>
              ) : (
                <ul className="msg-request-list">
                  {poolConversations.map((c) => (
                    <li key={c.id} className="msg-request">
                      <button
                        type="button"
                        className="msg-request__open"
                        onClick={() => {
                          setAgentView('ai');
                          setSelectedConversationId(c.id);
                          setRequestsOpen(false);
                        }}
                      >
                        <div className="msg-request__top">
                          <CustomerAvatar name={c.customerName || 'Customer'} origin={c.origin} avatarUrl={c.avatarUrl} />
                          <div className="msg-request__who">
                            <span className="msg-request__name">{c.customerName || 'Customer'}</span>
                            <span className="msg-request__from">
                              Waiting in pool{c.pageName ? ` · ${c.pageName}` : ''}
                            </span>
                          </div>
                        </div>
                      </button>
                      <div className="msg-request__actions">
                        <Button
                          variant="primary"
                          size="sm"
                          className="msg-request__accept"
                          onClick={() => {
                            takeOverConversation(c.id);
                            setRequestsOpen(false);
                          }}
                        >
                          Take over
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Transfer picker — choose a teammate to hand the current conversation to. */}
      <Modal
        open={!!transferFor}
        title="Transfer conversation"
        onClose={() => {
          if (!transferBusy) setTransferFor(null);
        }}
        className="msg-transfer-modal"
      >
        <p className="msg-transfer__lead">
          Hand <strong>{transferFor?.customerName || 'this conversation'}</strong> to a teammate. They&apos;ll get an
          incoming request, and it moves to them once they accept.
        </p>
        {agents.length === 0 ? (
          <EmptyState
            icon="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-9 9a7 7 0 0 1 14 0"
            title="No teammates available"
            message="No other active users have Messaging access yet."
          />
        ) : (
          <ul className="msg-agent-list">
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  className="msg-agent"
                  onClick={() => doTransfer(agent.id)}
                  disabled={transferBusy}
                >
                  <AvatarWithPresence userId={agent.id}>
                    <span className="msg-agent__avatar" aria-hidden="true">
                      {initialsOf(agent.name)}
                    </span>
                  </AvatarWithPresence>
                  <span className="msg-agent__meta">
                    <span className="msg-agent__name">{agent.name}</span>
                    {agent.email && <span className="msg-agent__email">{agent.email}</span>}
                  </span>
                  <span className="msg-agent__go" aria-hidden="true">
                    <TransferIcon />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
