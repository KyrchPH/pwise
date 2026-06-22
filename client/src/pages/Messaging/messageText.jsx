// Render the lightweight Markdown our AI agents emit (**bold**, "- " bullets) so
// the inbox + team-chat bubbles match what customers see on Telegram instead of
// showing raw asterisks. Bubbles are white-space: pre-wrap, so newlines stay intact
// inside the plain-text segments — we only wrap the bold spans and swap bullets.
const BOLD_PATTERN = /\*\*(.+?)\*\*/g;

export function renderMessageText(text) {
  const normalized = String(text ?? '').replace(/^[ \t]*[-*]\s+/gm, '• ');
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  let match;
  BOLD_PATTERN.lastIndex = 0;
  while ((match = BOLD_PATTERN.exec(normalized)) !== null) {
    if (match.index > lastIndex) nodes.push(normalized.slice(lastIndex, match.index));
    nodes.push(<strong key={`b${key}`}>{match[1]}</strong>);
    lastIndex = BOLD_PATTERN.lastIndex;
    key += 1;
  }
  if (lastIndex < normalized.length) nodes.push(normalized.slice(lastIndex));
  return nodes.length ? nodes : normalized;
}
