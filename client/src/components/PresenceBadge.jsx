import { usePresence } from '../context/PresenceContext.jsx';

/**
 * Presence dot overlaid on a teammate's avatar: green = online, grey = offline.
 * Renders nothing if presence is unknown. Must sit inside an element with
 * `position: relative` (use the `.avatar-presence` wrapper). Reads live presence
 * from PresenceContext by `userId`.
 */
export default function PresenceBadge({ userId }) {
  const p = usePresence(userId);
  if (!p) return null;
  const online = !!p.online;
  return (
    <span
      className={`presence-badge presence-badge--${online ? 'online' : 'offline'}`}
      role="img"
      aria-label={online ? 'Online' : 'Offline'}
      title={online ? 'Online' : 'Offline'}
    />
  );
}

// A drop-in wrapper: put any avatar element inside so the badge can be absolutely
// positioned at its bottom-right corner without being clipped by the avatar's own
// border-radius/overflow.
export function AvatarWithPresence({ userId, children, className = '' }) {
  return (
    <span className={`avatar-presence ${className}`.trim()}>
      {children}
      <PresenceBadge userId={userId} />
    </span>
  );
}
