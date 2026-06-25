import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Modal } from '../../components/ui.jsx';
import { AvatarWithPresence } from '../../components/PresenceBadge.jsx';
import { usePresenceMap } from '../../context/PresenceContext.jsx';
import { VaultThumb } from '../../components/VaultThumb.jsx';
import VaultPickerModal from '../../components/VaultPickerModal.jsx';
import MediaLightbox from './MediaLightbox.jsx';
import messageAnimation from '../../assets/lotties/message.json';
import { renderMessageText } from './messageText.jsx';
import * as connections from '../../services/connections.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as team from '../../services/team.service.js';
import { subscribe } from '../../services/messaging.service.js';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((part) => part[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Messenger-style "time since" — minute granularity and up (no seconds): 2m, 18h, 3d,
// 1w, 4mo, 2y. Sub-minute is handled by the caller as "Active now".
function compactAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

// The other teammate's user id for a DM (groups → null).
function peerIdOf(conv, currentUserId) {
  if (!conv || conv.isGroup) return null;
  const id = conv.otherUserId ?? conv.participants?.find((p) => Number(p.id) !== Number(currentUserId))?.id;
  return id == null ? null : Number(id);
}

// DM subtitle from presence, Messenger-style: "Active now" when online OR seen within the
// last minute (covers just-went-offline + minor clock skew), else "Active 5m/2h/3d ago".
const RECENT_MS = 60 * 1000;
function dmPresenceText(presence) {
  if (!presence) return 'Direct message';
  if (presence.online) return 'Active now';
  if (!presence.lastSeenAt) return 'Offline';
  const diff = Date.now() - new Date(presence.lastSeenAt).getTime();
  if (diff < RECENT_MS) return 'Active now';
  return `Active ${compactAgo(presence.lastSeenAt)} ago`;
}

function Avatar({ conversation, currentUserId }) {
  // For a DM, badge the other teammate's presence; groups have no single presence.
  const peerId = conversation.isGroup
    ? null
    : conversation.otherUserId ?? conversation.participants?.find((p) => p.id !== currentUserId)?.id ?? null;
  return (
    <AvatarWithPresence userId={peerId}>
      <span className="msg-agent__avatar agentchat-avatar" aria-hidden="true">
        {conversation.isGroup ? '#' : initialsOf(conversation.title)}
      </span>
    </AvatarWithPresence>
  );
}

// Replace-or-prepend a conversation in the list (newest first).
function upsert(list, conv) {
  return [conv, ...list.filter((c) => c.id !== conv.id)];
}

export default function AgentChat({ openWithUserId = null, onOpened } = {}) {
  const { user } = useAuth();
  const presenceMap = usePresenceMap();
  const toast = useToast();

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]); // vault media staged for the next message
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null); // media item being viewed fullscreen
  const [connBusy, setConnBusy] = useState(false); // connection request action in flight
  const [query, setQuery] = useState('');
  const [agentResults, setAgentResults] = useState([]);
  const [suggestedAgents, setSuggestedAgents] = useState([]); // teammates to suggest starting a chat with

  const [groupOpen, setGroupOpen] = useState(false); // "new group" modal
  const [groupName, setGroupName] = useState('');
  const [groupPicks, setGroupPicks] = useState([]); // [{id,name,email}]
  const [groupQ, setGroupQ] = useState('');
  const [groupResults, setGroupResults] = useState([]);

  const [manageOpen, setManageOpen] = useState(false); // group settings modal
  const [renameDraft, setRenameDraft] = useState('');
  const [addQ, setAddQ] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const messagesRef = useRef(null);
  const selectedIdRef = useRef(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const reload = useCallback(() => {
    team.listConversations().then(setConversations).catch(() => {});
  }, []);

  // Re-fetch the open thread (e.g. after a connection change flips canReply).
  const refreshActive = useCallback((id) => {
    if (!id) return;
    team.getConversation(id).then((conv) => setActive((cur) => (cur && cur.id === id ? conv : cur))).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    team
      .listConversations()
      .then((list) => live && setConversations(list))
      .catch((e) => live && toast.error(team.apiError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [toast]);

  // Load teammate suggestions once (filtered against existing DMs at render time).
  useEffect(() => {
    team.searchAgents('').then(setSuggestedAgents).catch(() => {});
  }, []);

  // Open a DM with a specific teammate on request (e.g. from a note's "message" icon
  // in the customer inbox). Find-or-create the direct conversation and select it; the
  // ref dedupes so an unrelated re-render can't re-fire or double-create it.
  const requestedPeerRef = useRef(null);
  useEffect(() => {
    if (openWithUserId == null) {
      requestedPeerRef.current = null;
      return;
    }
    if (requestedPeerRef.current === Number(openWithUserId)) return;
    requestedPeerRef.current = Number(openWithUserId);
    team
      .createConversation({ userIds: [Number(openWithUserId)] })
      .then((conv) => {
        setConversations((cur) => upsert(cur, conv));
        setSelectedId(conv.id);
        setActive(conv);
        team.markSeen(conv.id).catch(() => {});
      })
      .catch((e) => toast.error(team.apiError(e)))
      .finally(() => onOpened?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWithUserId]);

  // Auto-scroll the open thread to the newest message.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.id, active?.messages?.length]);

  // Staged attachments belong to the open thread; drop them when you switch.
  useEffect(() => {
    setAttachments([]);
  }, [active?.id]);

  // Live updates over the shared messaging SSE stream (team:* events only).
  useEffect(() => {
    return subscribe((ev) => {
      if (!ev || typeof ev.type !== 'string') return;
      if (ev.type === 'connection:request' || ev.type === 'connection:changed') {
        refreshActive(selectedIdRef.current); // a connection flipped → refresh the open DM's reply gate
        return;
      }
      if (!ev.type.startsWith('team:')) return;
      if (ev.type === 'team:conversation:new' && ev.conversation) {
        setConversations((cur) => upsert(cur, ev.conversation));
      } else if (ev.type === 'team:conversation:updated' && ev.conversation) {
        const patch = {
          title: ev.conversation.title,
          name: ev.conversation.name,
          isGroup: ev.conversation.isGroup,
          participants: ev.conversation.participants,
          createdBy: ev.conversation.createdBy,
        };
        setConversations((cur) => cur.map((c) => (c.id === ev.conversation.id ? { ...c, ...patch } : c)));
        setActive((cur) => (cur && cur.id === ev.conversation.id ? { ...cur, ...patch } : cur));
      } else if (ev.type === 'team:conversation:removed') {
        setConversations((cur) => cur.filter((c) => c.id !== ev.conversationId));
        setActive((cur) => (cur && cur.id === ev.conversationId ? null : cur));
        setSelectedId((cur) => (cur === ev.conversationId ? null : cur));
      } else if (ev.type === 'team:message:new' && ev.message) {
        const isActive = ev.conversationId === selectedIdRef.current;
        const mine = ev.message.senderId === user?.id;
        setConversations((cur) => {
          if (!cur.some((c) => c.id === ev.conversationId)) {
            reload();
            return cur;
          }
          const c = cur.find((x) => x.id === ev.conversationId);
          const updated = {
            ...c,
            lastMessage: ev.message.text || (ev.message.media ? 'Attachment' : c.lastMessage),
            lastActivity: 'Just now',
            unread: isActive || mine ? c.unread : (c.unread || 0) + 1,
          };
          return [updated, ...cur.filter((x) => x.id !== ev.conversationId)];
        });
        setActive((cur) => {
          if (!cur || cur.id !== ev.conversationId) return cur;
          if (cur.messages.some((m) => m.id === ev.message.id)) return cur;
          return { ...cur, messages: [...cur.messages, ev.message] };
        });
        if (isActive && !mine) team.markSeen(ev.conversationId).catch(() => {});
      }
    });
  }, [user?.id, reload, refreshActive]);

  // Teammate search for "start a new chat" (debounced).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setAgentResults([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      team.searchAgents(q).then((r) => live && setAgentResults(r)).catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const q = groupQ.trim();
    if (!q) {
      setGroupResults([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      team.searchAgents(q).then((r) => live && setGroupResults(r)).catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [groupQ]);

  useEffect(() => {
    const q = addQ.trim();
    if (!q) {
      setAddResults([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      team.searchAgents(q).then((r) => live && setAddResults(r)).catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [addQ]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  // Teammates you don't already have a DM with → suggested chats to start.
  const suggestions = useMemo(() => {
    const dmUserIds = new Set(
      conversations
        .filter((c) => !c.isGroup)
        .flatMap((c) => c.participants.filter((p) => p.id !== user?.id).map((p) => p.id)),
    );
    return suggestedAgents.filter((a) => !dmUserIds.has(a.id)).slice(0, 3);
  }, [suggestedAgents, conversations, user?.id]);

  const openConversation = async (id) => {
    setSelectedId(id);
    setConversations((cur) => cur.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    try {
      const conv = await team.getConversation(id);
      setActive(conv);
      team.markSeen(id).catch(() => {});
    } catch (e) {
      toast.error(team.apiError(e));
    }
  };

  const startDm = async (agent) => {
    try {
      const conv = await team.createConversation({ userIds: [agent.id] });
      setConversations((cur) => upsert(cur, conv));
      setSelectedId(conv.id);
      setActive(conv);
      setQuery('');
      setAgentResults([]);
    } catch (e) {
      toast.error(team.apiError(e));
    }
  };

  const toggleGroupPick = (agent) => {
    setGroupPicks((cur) => (cur.some((a) => a.id === agent.id) ? cur.filter((a) => a.id !== agent.id) : [...cur, agent]));
  };

  const createGroup = async () => {
    if (!groupName.trim() || groupPicks.length === 0 || busy) return;
    setBusy(true);
    try {
      const conv = await team.createConversation({
        userIds: groupPicks.map((a) => a.id),
        name: groupName.trim(),
        isGroup: true,
      });
      setConversations((cur) => upsert(cur, conv));
      setSelectedId(conv.id);
      setActive(conv);
      setGroupOpen(false);
      setGroupName('');
      setGroupPicks([]);
      setGroupQ('');
    } catch (e) {
      toast.error(team.apiError(e));
    } finally {
      setBusy(false);
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

  const send = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && attachments.length === 0) || !active) return;
    const convId = active.id;
    const sent = attachments;
    const media = sent.map((a) => ({ type: a.mediaType, url: a.url, name: a.name }));
    setDraft('');
    setAttachments([]);
    try {
      const { message } = await team.sendMessage(convId, { text, media });
      setActive((cur) =>
        cur && cur.id === convId && !cur.messages.some((m) => m.id === message.id)
          ? { ...cur, messages: [...cur.messages, message] }
          : cur,
      );
      setConversations((cur) => {
        const c = cur.find((x) => x.id === convId);
        if (!c) return cur;
        const preview = text || `${media.length} attachment${media.length === 1 ? '' : 's'}`;
        return [{ ...c, lastMessage: preview, lastActivity: 'Just now', unread: 0 }, ...cur.filter((x) => x.id !== convId)];
      });
    } catch (err) {
      setDraft(text);
      setAttachments(sent);
      toast.error(team.apiError(err));
    }
  };

  const acceptConnection = async () => {
    if (!active?.otherUserId || connBusy) return;
    setConnBusy(true);
    try {
      await connections.accept(active.otherUserId);
      refreshActive(active.id);
      toast.success('Connected — you can now reply');
    } catch (e) {
      toast.error(connections.apiError(e));
    } finally {
      setConnBusy(false);
    }
  };

  const sendConnectionRequest = async () => {
    if (!active?.otherUserId || connBusy) return;
    setConnBusy(true);
    try {
      const r = await connections.request(active.otherUserId);
      refreshActive(active.id);
      toast.success(r.status === 'connected' ? 'Connected' : 'Connection request sent');
    } catch (e) {
      toast.error(connections.apiError(e));
    } finally {
      setConnBusy(false);
    }
  };

  const openManage = () => {
    if (!active) return;
    setRenameDraft(active.name || active.title || '');
    setAddQ('');
    setAddResults([]);
    setManageOpen(true);
  };

  const doRename = async () => {
    if (!active || !renameDraft.trim() || busy) return;
    setBusy(true);
    try {
      const conv = await team.rename(active.id, renameDraft.trim());
      setActive((cur) => (cur && cur.id === conv.id ? { ...cur, ...conv, messages: cur.messages } : cur));
      setConversations((cur) => cur.map((c) => (c.id === conv.id ? { ...c, title: conv.title, name: conv.name } : c)));
      toast.success('Group renamed');
    } catch (e) {
      toast.error(team.apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const doAddMember = async (agent) => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const conv = await team.addMembers(active.id, [agent.id]);
      setActive((cur) => (cur && cur.id === conv.id ? { ...cur, ...conv, messages: cur.messages } : cur));
      setAddQ('');
      setAddResults([]);
      toast.success(`Added ${agent.name}`);
    } catch (e) {
      toast.error(team.apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const doRemoveMember = async (member) => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const conv = await team.removeMember(active.id, member.id);
      setActive((cur) => (cur && cur.id === conv.id ? { ...cur, ...conv, messages: cur.messages } : cur));
      toast.success(`Removed ${member.name}`);
    } catch (e) {
      toast.error(team.apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const doLeave = async () => {
    if (!active || busy) return;
    setBusy(true);
    const id = active.id;
    try {
      await team.leave(id);
      setConversations((cur) => cur.filter((c) => c.id !== id));
      setActive(null);
      setSelectedId(null);
      setManageOpen(false);
      toast.success('You left the group');
    } catch (e) {
      toast.error(team.apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const memberIds = new Set((active?.participants || []).map((p) => p.id));

  return (
    <>
      <Card className="msg-panel msg-panel--list">
        <div className="card__head">
          <div className="card__title">Agent to Agent</div>
          <Button variant="ghost" size="sm" onClick={() => setGroupOpen(true)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            New group
          </Button>
        </div>

        <div className="agentchat-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="input agentchat-search__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates or chats..."
            aria-label="Search teammates or conversations"
          />
        </div>

        {loading ? (
          <ul className="msg-conversation-list" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="msg-skel-row">
                <span className="msg-skel msg-skel--avatar" />
                <div className="msg-skel-row__main">
                  <span className="msg-skel msg-skel--line msg-skel--name" />
                  <span className="msg-skel msg-skel--line msg-skel--short" />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="msg-conversation-list">
            {visible.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={`msg-conversation${conversation.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => openConversation(conversation.id)}
                >
                  <Avatar conversation={conversation} currentUserId={user?.id} />
                  <div className="msg-conversation__main">
                    <div className="msg-conversation__row">
                      <strong className="msg-conversation__name">{conversation.title}</strong>
                      <span className="msg-conversation__time">{conversation.lastActivity}</span>
                    </div>
                    <div className="msg-conversation__row">
                      <span className="msg-conversation__mode">
                        {conversation.isGroup
                          ? `${conversation.participants.length} members`
                          : dmPresenceText(presenceMap.get(peerIdOf(conversation, user?.id)))}
                      </span>
                      {conversation.unread > 0 && <span className="agentchat-unread">{conversation.unread}</span>}
                    </div>
                    <p className="msg-conversation__preview">{conversation.lastMessage || 'No messages yet'}</p>
                  </div>
                </button>
              </li>
            ))}

            {query.trim() && agentResults.length > 0 && (
              <li className="agentchat-results">
                <div className="agentchat-results__label">Start a new chat</div>
                {agentResults.map((agent) => (
                  <button key={agent.id} type="button" className="agentchat-result" onClick={() => startDm(agent)}>
                    <AvatarWithPresence userId={agent.id}><span className="msg-agent__avatar agentchat-avatar">{initialsOf(agent.name)}</span></AvatarWithPresence>
                    <span className="agentchat-result__meta">
                      <span className="agentchat-result__name">{agent.name}</span>
                      {agent.email && <span className="agentchat-result__email">{agent.email}</span>}
                    </span>
                  </button>
                ))}
              </li>
            )}

            {!loading && visible.length === 0 && !(query.trim() && agentResults.length > 0) && (
              <li className="card--pad">
                <EmptyState
                  icon="..."
                  title={query.trim() ? 'No matches' : 'No conversations yet'}
                  message={query.trim() ? 'No chats or teammates match that search.' : 'Search a teammate above to start a direct message, or create a group.'}
                />
              </li>
            )}

            {!query.trim() && suggestions.length > 0 && (
              <li className="agentchat-results">
                <div className="agentchat-results__label">Suggested</div>
                {suggestions.map((agent) => (
                  <button key={agent.id} type="button" className="agentchat-result" onClick={() => startDm(agent)}>
                    <AvatarWithPresence userId={agent.id}><span className="msg-agent__avatar agentchat-avatar">{initialsOf(agent.name)}</span></AvatarWithPresence>
                    <span className="agentchat-result__meta">
                      <span className="agentchat-result__name">{agent.name}</span>
                      {agent.email && <span className="agentchat-result__email">{agent.email}</span>}
                    </span>
                  </button>
                ))}
              </li>
            )}
          </ul>
        )}
      </Card>

      <Card className="msg-panel msg-panel--thread">
        {active ? (
          <>
            <div className="card__head msg-thread__head">
              <div className="msg-thread__identity">
                <Avatar conversation={active} currentUserId={user?.id} />
                <div>
                  <div className="card__title">{active.title}</div>
                  <div className="msg-panel__sub msg-thread__sub">
                    <span>
                      {active.isGroup
                        ? active.participants.map((p) => p.name).join(', ')
                        : dmPresenceText(presenceMap.get(peerIdOf(active, user?.id)))}
                    </span>
                  </div>
                </div>
              </div>
              {active.isGroup && (
                <div className="msg-thread__meta">
                  <Button variant="ghost" size="sm" onClick={openManage}>
                    Manage
                  </Button>
                </div>
              )}
            </div>

            <div className="msg-thread__messages" ref={messagesRef}>
              {active.messages.map((message) => {
                const mine = message.senderId === user?.id;
                return (
                  <div key={message.id} className={`msg-bubble-wrap${mine ? ' is-outgoing' : ''}`}>
                    <div className={`msg-bubble-stack${mine ? ' is-outgoing' : ''}`}>
                      <div className={`msg-bubble${mine ? ' is-outgoing' : ''}`}>
                        {!mine && active.isGroup && <div className="msg-bubble__sender">{message.sender}</div>}
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
                          <span className="msg-bubble__time">{message.time}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {active.canReply === false ? (
              <div className="msg-composer msg-composer--locked">
                <span className="msg-composer__lockicon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <p className="msg-composer__locked-text">
                  To reply to this message, you must become a connection of {active.otherUserName || 'this teammate'}.
                </p>
                {active.connectionStatus === 'outgoing' ? (
                  <p className="msg-composer__takeover-hint">
                    Connection request sent — waiting for {active.otherUserName || 'them'} to accept.
                  </p>
                ) : (
                  <Button
                    variant="primary"
                    onClick={active.connectionStatus === 'incoming' ? acceptConnection : sendConnectionRequest}
                    disabled={connBusy}
                  >
                    {active.connectionStatus === 'incoming' ? 'Accept connection request' : 'Send connection request'}
                  </Button>
                )}
              </div>
            ) : (
            <form className="msg-composer" onSubmit={send}>
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
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </button>
                <div className="msg-composer__inputwrap">
                  <input
                    className="input msg-composer__input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Message your teammate..."
                  />
                </div>
                <button
                  type="submit"
                  className="msg-composer__iconbtn msg-composer__iconbtn--send"
                  aria-label="Send message"
                  title="Send message"
                  disabled={!draft.trim() && attachments.length === 0}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 2 11 13" />
                    <path d="M22 2 15 22l-4-9-9-4z" />
                  </svg>
                </button>
              </div>
            </form>
            )}
          </>
        ) : (
          <div className="card--pad">
            <EmptyState
              lottie={messageAnimation}
              title="Choose a conversation"
              message="Pick a chat on the left, or search a teammate to start a new one."
            />
          </div>
        )}
      </Card>

      {/* New group modal */}
      <Modal open={groupOpen} title="New group chat" onClose={() => !busy && setGroupOpen(false)}>
        <div className="agentchat-form">
          <input
            className="input"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name"
            aria-label="Group name"
          />
          {groupPicks.length > 0 && (
            <div className="agentchat-chips">
              {groupPicks.map((a) => (
                <span key={a.id} className="agentchat-chip">
                  {a.name}
                  <button type="button" onClick={() => toggleGroupPick(a)} aria-label={`Remove ${a.name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            className="input"
            value={groupQ}
            onChange={(e) => setGroupQ(e.target.value)}
            placeholder="Search teammates to add..."
            aria-label="Search teammates"
          />
          <div className="agentchat-picklist">
            {groupResults.map((agent) => {
              const picked = groupPicks.some((a) => a.id === agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`agentchat-result${picked ? ' is-picked' : ''}`}
                  onClick={() => toggleGroupPick(agent)}
                >
                  <AvatarWithPresence userId={agent.id}><span className="msg-agent__avatar agentchat-avatar">{initialsOf(agent.name)}</span></AvatarWithPresence>
                  <span className="agentchat-result__meta">
                    <span className="agentchat-result__name">{agent.name}</span>
                    {agent.email && <span className="agentchat-result__email">{agent.email}</span>}
                  </span>
                  {picked && <span className="agentchat-result__check">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="agentchat-form__actions">
            <Button variant="ghost" onClick={() => setGroupOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createGroup} disabled={busy || !groupName.trim() || groupPicks.length === 0}>
              Create group
            </Button>
          </div>
        </div>
      </Modal>

      {/* Group settings modal */}
      <Modal open={manageOpen} title="Group settings" onClose={() => !busy && setManageOpen(false)}>
        {active && active.isGroup && (
          <div className="agentchat-form">
            <label className="agentchat-form__label">Group name</label>
            <div className="agentchat-form__row">
              <input className="input" value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} />
              <Button variant="primary" onClick={doRename} disabled={busy || !renameDraft.trim()}>
                Rename
              </Button>
            </div>

            <label className="agentchat-form__label">Members ({active.participants.length})</label>
            <ul className="agentchat-members">
              {active.participants.map((m) => (
                <li key={m.id} className="agentchat-member">
                  <AvatarWithPresence userId={m.id}>
                    <span className="msg-agent__avatar agentchat-avatar">{initialsOf(m.name)}</span>
                  </AvatarWithPresence>
                  <span className="agentchat-member__name">
                    {m.name}
                    {m.id === user?.id ? ' (you)' : ''}
                  </span>
                  {m.id !== user?.id && (
                    <button
                      type="button"
                      className="agentchat-member__remove"
                      onClick={() => doRemoveMember(m)}
                      disabled={busy}
                      aria-label={`Remove ${m.name}`}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <label className="agentchat-form__label">Add members</label>
            <input
              className="input"
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
              placeholder="Search teammates..."
              aria-label="Search teammates to add"
            />
            <div className="agentchat-picklist">
              {addResults
                .filter((a) => !memberIds.has(a.id))
                .map((agent) => (
                  <button key={agent.id} type="button" className="agentchat-result" onClick={() => doAddMember(agent)} disabled={busy}>
                    <AvatarWithPresence userId={agent.id}><span className="msg-agent__avatar agentchat-avatar">{initialsOf(agent.name)}</span></AvatarWithPresence>
                    <span className="agentchat-result__meta">
                      <span className="agentchat-result__name">{agent.name}</span>
                      {agent.email && <span className="agentchat-result__email">{agent.email}</span>}
                    </span>
                  </button>
                ))}
            </div>

            <div className="agentchat-form__actions">
              <Button variant="danger" onClick={doLeave} disabled={busy}>
                Leave group
              </Button>
              <Button variant="ghost" onClick={() => setManageOpen(false)} disabled={busy}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <VaultPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onAttach={handleAttach} />
      <MediaLightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}
