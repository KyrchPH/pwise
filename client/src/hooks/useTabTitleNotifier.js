import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import * as messaging from '../services/messaging.service.js';

// While the agent is looking at ANOTHER tab, surface inbox activity meant for them
// in the document title so they notice without watching the app. We badge the title
// only while the tab is hidden, counting:
//   • incoming transfer requests addressed to this agent (transfer:new),
//   • new customer messages in a chat assigned to this agent (message:new, "for you"),
//   • a chat being routed/assigned to this agent (conversation:reassigned, e.g. an
//     AI order auto-transferred to them).
// Returning to the tab clears the badge and restores the original title. Mounted
// once in the authed shell, alongside usePresenceHeartbeat.
export default function useTabTitleNotifier() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const baseTitle = document.title;
    const myId = Number(user?.id);
    let count = 0;

    const render = () => {
      document.title =
        count <= 0
          ? baseTitle
          : `🔔 ${count === 1 ? 'New message' : `${count} new messages`} — PWise`;
    };

    // Is this event something addressed to THIS agent specifically?
    const isForMe = (event) => {
      if (event.type === 'transfer:new') return true; // requests are emitted to the recipient only
      if (event.type === 'conversation:reassigned') return Number(event.assignedUserId) === myId;
      if (event.type === 'message:new') {
        const conv = event.conversation;
        const mine = conv && conv.handledBy === 'Live Agent' && Number(conv.assignedUserId) === myId;
        const fromCustomer = (event.messages || []).some((m) => m.side === 'incoming');
        return mine && fromCustomer;
      }
      return false;
    };

    const unsubscribe = messaging.subscribe((event) => {
      // Only badge the title while the agent is on a different tab — if they're
      // already looking at the app, the inbox itself is the notification.
      if (document.visibilityState !== 'hidden') return;
      if (!isForMe(event)) return;
      count += 1;
      render();
    });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        count = 0;
        document.title = baseTitle;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe?.();
      document.removeEventListener('visibilitychange', onVisibility);
      document.title = baseTitle;
    };
  }, [isAuthenticated, user?.id]);
}
