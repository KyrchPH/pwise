// Note bodies are plain text that may contain links. Render URLs as clickable
// anchors (new tab, safe rel) and leave everything else as text; the container uses
// white-space: pre-wrap so newlines survive. Links only — no images or other markup.
const URL_RE = /(https?:\/\/[^\s<]+)/g;

export function renderNoteText(text) {
  const str = String(text ?? '');
  const nodes = [];
  let last = 0;
  let key = 0;
  let match;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(str)) !== null) {
    if (match.index > last) nodes.push(str.slice(last, match.index));
    const url = match[0];
    nodes.push(
      <a key={`l${key}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    last = URL_RE.lastIndex;
    key += 1;
  }
  if (last < str.length) nodes.push(str.slice(last));
  return nodes.length ? nodes : str;
}

// "Jun 24, 2026, 10:12 AM" — the author/time line on a note. Falls back to the raw
// value if it isn't a parseable date.
export function formatNoteTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
