// Render the lightweight Markdown our AI agents emit (**bold**, "- " bullets,
// and links) so inbox + team-chat bubbles match what customers see on Telegram
// instead of showing raw asterisks/brackets. Bubbles are white-space: pre-wrap,
// so newlines stay intact inside the plain-text segments.
const BOLD_PATTERN = /\*\*(.+?)\*\*/g;
const LINK_PATTERN = /\[([^\]\n]+)\]\(((?:https?:\/\/|www\.)[^\s)<>]+)\)|((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:]$/;
const CLOSING_PAIRS = {
  ')': '(',
  ']': '[',
  '}': '{',
};

function hrefFor(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function countChar(value, char) {
  return (value.match(new RegExp(`\\${char}`, 'g')) || []).length;
}

function splitBareUrl(value) {
  let url = value;
  let suffix = '';
  while (url) {
    const last = url[url.length - 1];
    if (TRAILING_URL_PUNCTUATION.test(last)) {
      suffix = `${last}${suffix}`;
      url = url.slice(0, -1);
      continue;
    }
    const opening = CLOSING_PAIRS[last];
    if (opening && countChar(url, last) > countChar(url, opening)) {
      suffix = `${last}${suffix}`;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return { url, suffix };
}

function linkNode(url, label, key) {
  return (
    <a className="msg-bubble__link" href={hrefFor(url)} target="_blank" rel="noopener noreferrer" key={key}>
      {label}
    </a>
  );
}

function renderLinks(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  let match;
  LINK_PATTERN.lastIndex = 0;
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2]) {
      nodes.push(linkNode(match[2], match[1], `${keyPrefix}-l${key}`));
    } else {
      const { url, suffix } = splitBareUrl(match[3]);
      nodes.push(linkNode(url, url, `${keyPrefix}-l${key}`));
      if (suffix) nodes.push(suffix);
    }
    lastIndex = LINK_PATTERN.lastIndex;
    key += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : text;
}

function appendTextSegment(nodes, text, keyPrefix) {
  if (!text) return false;
  const rendered = renderLinks(text, keyPrefix);
  if (Array.isArray(rendered)) {
    nodes.push(...rendered);
    return true;
  }
  nodes.push(rendered);
  return false;
}

export function renderMessageText(text) {
  const normalized = String(text ?? '').replace(/^[ \t]*[-*]\s+/gm, '\u2022 ');
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  let hasMarkup = false;
  let match;
  BOLD_PATTERN.lastIndex = 0;
  while ((match = BOLD_PATTERN.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      hasMarkup = appendTextSegment(nodes, normalized.slice(lastIndex, match.index), `t${key}`) || hasMarkup;
    }
    nodes.push(<strong key={`b${key}`}>{renderLinks(match[1], `b${key}`)}</strong>);
    lastIndex = BOLD_PATTERN.lastIndex;
    key += 1;
    hasMarkup = true;
  }
  if (lastIndex < normalized.length) {
    hasMarkup = appendTextSegment(nodes, normalized.slice(lastIndex), `t${key}`) || hasMarkup;
  }
  return hasMarkup ? nodes : normalized;
}
