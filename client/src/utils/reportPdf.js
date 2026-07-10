// Professional PDF reports for post analytics, built client-side with jsPDF.
// Two builders: a per-post insights report and a date-range posts report. Both
// share a branded header/footer, summary cards, styled tables (jspdf-autotable),
// and vector line charts drawn straight from the insight points (crisp at any zoom).
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const M = 40; // page margin (pt)

const COLORS = {
  primary: [24, 122, 204],
  dark: [28, 39, 51],
  muted: [120, 130, 140],
  border: [223, 230, 237],
  zebra: [246, 249, 252],
  foot: [237, 242, 247],
};

// Metric palette — mirrors the in-app InsightsDrawer so the report matches the UI.
const METRIC_META = {
  reactions: { label: 'Reactions', color: [224, 36, 94] },
  comments: { label: 'Comments', color: [31, 155, 230] },
  shares: { label: 'Shares', color: [47, 180, 87] },
  views: { label: 'Views', color: [124, 58, 237] },
};

const num = (n) => Number(n) || 0;
const fmtInt = (n) => num(n).toLocaleString();
const fmtCompact = (n) => {
  const v = num(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(v));
};
const signed = (n) => `${n > 0 ? '+' : ''}${fmtInt(n)}`;
const growthStr = (g) => `${parseFloat(g >= 10 ? g.toFixed(1) : g.toFixed(2))}x`;

const fmtDateLong = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateShort = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDateTime = (d) =>
  new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDurationMs = (ms) => {
  const mins = Math.round(num(ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};
// Format a metric value honouring an Insights card's `format` ('percent' | 'duration' | count).
const fmtMetricValue = (v, format) => {
  if (v == null || v === '') return '—';
  if (format === 'percent') return `${v}%`;
  if (format === 'duration') return fmtDurationMs(v);
  return fmtInt(v);
};
const pctStr = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p}%`);

// jsPDF's standard fonts (Helvetica) only render WinAnsi/Latin-1, so emoji and fancy
// Unicode letters come out as garbage. Fold compatible forms to plain text (𝐋 → L,
// fullwidth → ASCII, é stays é) and drop anything outside Latin-1 (emoji, CJK, …).
const pdfSafe = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

// A period string ('YYYY-MM-DD' | 'YYYY-MM' | ISO hour) → a local Date, parsed at local
// midnight so day-granular periods don't shift a day across the UTC boundary.
function periodDate(period) {
  const s = String(period);
  return s.includes('T') ? new Date(s) : s.length > 7 ? new Date(`${s}T00:00:00`) : new Date(`${s}-01T00:00:00`);
}
// A period string → short axis label.
function labelForPeriod(period) {
  const d = periodDate(period);
  return Number.isNaN(d.getTime()) ? String(period) : fmtDateShort(d);
}

// Load any image URL as a data URL (+ natural size). Best-effort — returns null on
// any failure (including CORS on a cross-origin/S3 URL), so the report still renders.
export async function loadImageData(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
    return dims && dims.h ? { dataUrl, fmt: blob.type === 'image/png' ? 'PNG' : 'JPEG', ...dims } : null;
  } catch {
    return null;
  }
}

// Header logo (client/public/logo.png). Best-effort → null so the header falls back
// to the text wordmark.
export async function loadLogo() {
  return loadImageData('/logo.png');
}

// Render wrapped text to a PNG data URL using the BROWSER's fonts — so emoji and any
// Unicode the PDF's Latin-1 font can't draw appear (in colour) as an image instead.
// Returns { dataUrl, wPt, hPt } or null. Used only for captions that contain
// non-Latin-1 characters; plain text stays crisp vector text.
function textImage(text, { widthPt, fontPt = 9.5, lineHeightPt = 13, maxLines = 6, color = '#1c2733' }) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t || typeof document === 'undefined') return null;
  const SCALE = 3; // supersample for a crisp result at print resolution
  const font = `${Math.round(fontPt * SCALE)}px Arial, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const maxW = widthPt * SCALE;

  const lines = [];
  let truncated = false;
  for (const para of t.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (measure.measureText(test).width <= maxW || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
      if (lines.length >= maxLines) { truncated = true; break; }
    }
    if (lines.length >= maxLines) { truncated = true; break; }
    if (line) lines.push(line);
  }
  if (!lines.length) return null;
  if (truncated) lines[lines.length - 1] = `${lines[lines.length - 1]} …`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(maxW);
  canvas.height = Math.ceil(lines.length * lineHeightPt * SCALE);
  const cx = canvas.getContext('2d');
  cx.font = font;
  cx.textBaseline = 'top';
  cx.fillStyle = color;
  lines.forEach((ln, i) => cx.fillText(ln, 0, Math.round(i * lineHeightPt * SCALE)));
  return { dataUrl: canvas.toDataURL('image/png'), wPt: widthPt, hPt: lines.length * lineHeightPt };
}

const pageW = (doc) => doc.internal.pageSize.getWidth();
const pageH = (doc) => doc.internal.pageSize.getHeight();
const curPage = (doc) => doc.internal.getCurrentPageInfo().pageNumber;

// Branded header: logo, title + subtitle, page name + generated timestamp, accent
// rule. Records the page it drew on (so multi-page tables only get one header each)
// and returns the y where body content should start.
function drawHeader(doc, ctx) {
  ctx.headered = ctx.headered || new Set();
  ctx.headered.add(curPage(doc));
  const W = pageW(doc);
  const topY = 34;
  let x = M;
  if (ctx.logo) {
    const lh = 32;
    const lw = ctx.logo.w * (lh / ctx.logo.h);
    doc.addImage(ctx.logo.dataUrl, 'PNG', M, topY - 4, lw, lh);
    x = M + lw + 12;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COLORS.dark);
  doc.text(ctx.title, x, topY + 7);
  if (ctx.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(ctx.subtitle, x, topY + 22);
  }
  const rx = W - M;
  if (ctx.pageName) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.dark);
    doc.text(pdfSafe(ctx.pageName), rx, topY + 4, { align: 'right' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Generated ${ctx.generatedAt}`, rx, topY + 18, { align: 'right' });
  const ruleY = topY + 34;
  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(2);
  doc.line(M, ruleY, W - M, ruleY);
  return ruleY + 20;
}

// Page footer with a rule + page numbers, drawn on every page at the very end.
function drawFooters(doc) {
  const total = doc.getNumberOfPages();
  const W = pageW(doc);
  const H = pageH(doc);
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.5);
    doc.line(M, H - 30, W - M, H - 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text('SocialDesk · Analytics report', M, H - 18);
    doc.text(`Page ${i} of ${total}`, W - M, H - 18, { align: 'right' });
  }
}

// Add a page (and re-draw the header) if `needed` pt won't fit before the footer.
function ensureSpace(doc, ctx, needed) {
  if (ctx.y + needed > pageH(doc) - 44) {
    doc.addPage();
    ctx.y = drawHeader(doc, ctx);
  }
}

// Shared autoTable options — brand styling + header redraw on any page the table
// spills onto (margin.top reserves the header band).
function tableOptions(doc, ctx) {
  return {
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, lineColor: COLORS.border, lineWidth: 0.4, textColor: COLORS.dark },
    headStyles: { fillColor: COLORS.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: COLORS.zebra },
    margin: { left: M, right: M, top: 92 },
    didDrawPage: () => {
      if (!ctx.headered.has(curPage(doc))) drawHeader(doc, ctx);
    },
  };
}

// A row of summary cards (label + big value). `cards`: [{ label, value, color? }].
function drawStatCards(doc, ctx, cards) {
  const W = pageW(doc);
  const gap = 10;
  const cw = (W - 2 * M - gap * (cards.length - 1)) / cards.length;
  const ch = 50;
  ensureSpace(doc, ctx, ch + 12);
  cards.forEach((c, i) => {
    const cx = M + i * (cw + gap);
    doc.setFillColor(...COLORS.zebra);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.5);
    doc.roundedRect(cx, ctx.y, cw, ch, 5, 5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(String(c.label).toUpperCase(), cx + 10, ctx.y + 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...(c.color || COLORS.dark));
    doc.text(String(c.value), cx + 10, ctx.y + 37);
  });
  ctx.y += ch + 16;
}

// A soft callout box with a left accent bar and wrapped body text — used for a
// metric's plain-language description so the report explains what it's showing.
function drawNote(doc, ctx, text) {
  const W = pageW(doc);
  const boxW = W - 2 * M;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(pdfSafe(text), boxW - 26);
  const boxH = 15 + lines.length * 12;
  ensureSpace(doc, ctx, boxH + 14);
  doc.setFillColor(...COLORS.zebra);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.5);
  doc.roundedRect(M, ctx.y, boxW, boxH, 5, 5, 'FD');
  doc.setFillColor(...COLORS.primary);
  doc.rect(M + 0.5, ctx.y + 4, 3, boxH - 8, 'F');
  doc.setTextColor(...COLORS.dark);
  let ty = ctx.y + 18;
  lines.forEach((ln) => {
    doc.text(ln, M + 14, ty);
    ty += 12;
  });
  ctx.y += boxH + 16;
}

// Vector line chart drawn from points [{ period, value }] into a bordered box.
function drawLineChart(doc, ctx, { points, color, title }) {
  const W = pageW(doc);
  const boxW = W - 2 * M;
  const boxH = 132;
  ensureSpace(doc, ctx, boxH + 18);
  const x0 = M;
  const y0 = ctx.y;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.dark);
  doc.text(title, x0, y0 + 2);

  const boxTop = y0 + 10;
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.5);
  doc.roundedRect(x0, boxTop, boxW, boxH, 4, 4, 'S');

  const padL = 38;
  const padR = 12;
  const padT = 12;
  const padB = 18;
  const px = x0 + padL;
  const py = boxTop + padT;
  const pw = boxW - padL - padR;
  const ph = boxH - padT - padB;

  const vals = points.map((p) => num(p.value));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    hi = lo + 1;
    lo = Math.max(0, lo - 1);
  }
  const n = points.length;
  const yOf = (v) => py + ph - ((v - lo) / (hi - lo)) * ph;
  const xOf = (i) => (n === 1 ? px + pw / 2 : px + (i / (n - 1)) * pw);

  // Horizontal gridlines + y labels.
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.muted);
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const v = lo + ((hi - lo) * t) / ticks;
    const gy = yOf(v);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.4);
    doc.line(px, gy, px + pw, gy);
    doc.text(fmtCompact(Math.round(v)), px - 5, gy + 2.4, { align: 'right' });
  }

  // Data line + point dots.
  doc.setDrawColor(...color);
  doc.setLineWidth(1.4);
  for (let i = 0; i < n - 1; i += 1) doc.line(xOf(i), yOf(vals[i]), xOf(i + 1), yOf(vals[i + 1]));
  doc.setFillColor(...color);
  if (n <= 45) points.forEach((p, i) => doc.circle(xOf(i), yOf(vals[i]), n === 1 ? 2.4 : 1.5, 'F'));

  // X labels: first / middle / last.
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(7.5);
  const idxs = [...new Set(n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1])];
  idxs.forEach((i) => {
    const align = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
    doc.text(labelForPeriod(points[i].period), xOf(i), boxTop + boxH - 5, { align });
  });

  ctx.y = boxTop + boxH + 18;
}

// Rounded info box holding the post caption + a muted meta line. A caption with
// emoji / non-Latin-1 characters is drawn as a browser-rendered image (so emoji show
// in colour); a plain caption stays crisp vector text.
function drawPostMeta(doc, ctx, post) {
  const W = pageW(doc);
  const boxW = W - 2 * M;
  const raw = String(post.caption || '').trim();
  const needsImage = /[^\x00-\xFF]/.test(raw);
  const capImg = needsImage ? textImage(raw, { widthPt: boxW - 24, maxLines: 6 }) : null;

  let lines = null;
  let capH;
  if (capImg) {
    capH = capImg.hPt;
  } else {
    const caption = pdfSafe(raw);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const allLines = caption ? doc.splitTextToSize(caption, boxW - 24) : ['No caption'];
    lines = allLines.slice(0, 5);
    if (allLines.length > 5) lines[4] = `${lines[4].slice(0, -1)}…`;
    capH = lines.length * 12;
  }

  const meta = [
    `Status: ${post.status || '—'}`,
    post.posted_at ? `Posted: ${fmtDateTime(post.posted_at)}` : post.scheduled_at ? `Scheduled: ${fmtDateTime(post.scheduled_at)}` : null,
    `Type: ${post.media_type || '—'}`,
  ].filter(Boolean);

  const boxH = 14 + capH + 4 + 16;
  ensureSpace(doc, ctx, boxH + 12);
  doc.setFillColor(...COLORS.zebra);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.5);
  doc.roundedRect(M, ctx.y, boxW, boxH, 5, 5, 'FD');

  if (capImg) {
    doc.addImage(capImg.dataUrl, 'PNG', M + 12, ctx.y + 13, capImg.wPt, capImg.hPt);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.dark);
    let ty = ctx.y + 17;
    lines.forEach((ln) => {
      doc.text(ln, M + 12, ty);
      ty += 12;
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(doc.splitTextToSize(meta.join('    ·    '), boxW - 24)[0], M + 12, ctx.y + boxH - 8);
  ctx.y += boxH + 16;
}

// The post's media thumbnail, scaled into a bordered box (max ~150×150 pt).
function drawThumbnail(doc, ctx, img) {
  const ratio = Math.min(150 / img.w, 150 / img.h, 1);
  const iw = img.w * ratio;
  const ih = img.h * ratio;
  ensureSpace(doc, ctx, ih + 16);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.5);
  doc.roundedRect(M - 2, ctx.y - 2, iw + 4, ih + 4, 4, 4, 'S');
  try {
    doc.addImage(img.dataUrl, img.fmt || 'JPEG', M, ctx.y, iw, ih);
  } catch {
    /* jsPDF couldn't decode this image — skip it */
  }
  ctx.y += ih + 16;
}

/**
 * Per-post insights report: post meta, a summary table across all metrics
 * (total / gained / growth), and a line chart per metric that has history.
 * `seriesByMetric`: { reactions: points[], comments: points[], ... }.
 */
export function buildPostInsightsPdf({ post, seriesByMetric, pageName, logo }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = { title: 'Post insights report', subtitle: `Post #${post.id}`, pageName, logo, generatedAt: fmtDateTime(new Date()) };
  ctx.y = drawHeader(doc, ctx);

  drawPostMeta(doc, ctx, post);

  const order = ['reactions', 'comments', 'shares', 'views'];
  const withData = order.filter((k) => (seriesByMetric[k] || []).length);
  const rows = order
    .filter((k) => seriesByMetric[k] != null)
    .map((k) => {
      const pts = seriesByMetric[k] || [];
      if (!pts.length) return [METRIC_META[k].label, '—', '—', '—', '0'];
      const first = num(pts[0].value);
      const cur = num(pts[pts.length - 1].value);
      const delta = cur - first;
      const growth = first > 0 ? cur / first : null;
      return [
        METRIC_META[k].label,
        fmtInt(cur),
        pts.length > 1 ? signed(delta) : '—',
        pts.length > 1 && growth ? growthStr(growth) : '—',
        String(pts.length),
      ];
    });

  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    head: [['Metric', 'Total', 'Gained', 'Growth', 'Snapshots']],
    body: rows.length ? rows : [['—', '—', '—', '—', '—']],
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });
  ctx.y = doc.lastAutoTable.finalY + 22;

  if (withData.length) {
    withData.forEach((k) => drawLineChart(doc, ctx, { points: seriesByMetric[k], color: METRIC_META[k].color, title: `${METRIC_META[k].label} over time` }));
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    doc.text('No engagement history recorded yet for this post.', M, ctx.y + 4);
  }

  drawFooters(doc);
  return doc;
}

/**
 * Per-post insights report scoped to a DATE RANGE: post meta, headline cards, a
 * summary table (each metric's value within the range + its running total), a
 * day-by-day breakdown table, and any video watch stats. The caller (the insights
 * tab) precomputes the rows so this stays pure formatting.
 */
export function buildPostRangeReportPdf({ post, pageName, logo, thumbnail = null, from, to, cards = [], summaryTable, dailyTable = null, videoTable = null }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = {
    title: 'Post insights report',
    subtitle: `${fmtDateLong(from)} – ${fmtDateLong(to)}    ·    Post #${post.id}`,
    pageName,
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);
  if (thumbnail) drawThumbnail(doc, ctx, thumbnail);
  drawPostMeta(doc, ctx, post);
  if (cards.length) drawStatCards(doc, ctx, cards);

  if (summaryTable) {
    autoTable(doc, {
      ...tableOptions(doc, ctx),
      startY: ctx.y,
      head: [summaryTable.head],
      body: summaryTable.body.length ? summaryTable.body : [['—', '—', '—']],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });
    ctx.y = doc.lastAutoTable.finalY + 22;
  }

  if (dailyTable && dailyTable.body.length) {
    const numeric = {};
    for (let i = 1; i < dailyTable.head.length; i += 1) numeric[i] = { halign: 'right' };
    autoTable(doc, {
      ...tableOptions(doc, ctx),
      startY: ctx.y,
      head: [dailyTable.head],
      body: dailyTable.body,
      columnStyles: numeric,
    });
    ctx.y = doc.lastAutoTable.finalY + 22;
  }

  if (videoTable && videoTable.body.length) {
    autoTable(doc, {
      ...tableOptions(doc, ctx),
      startY: ctx.y,
      head: [videoTable.head],
      body: videoTable.body,
      columnStyles: { 1: { halign: 'right' } },
    });
    ctx.y = doc.lastAutoTable.finalY + 22;
  }

  drawFooters(doc);
  return doc;
}

/**
 * Date-range report: summary cards + a table of every posted item in the window
 * with its engagement, plus a totals footer row.
 * `posts`: already filtered to the [start, end] window.
 */
export function buildRangeAnalyticsPdf({ start, end, posts, pageName, logo }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = {
    title: 'Analytics report',
    subtitle: `${fmtDateLong(start)} – ${fmtDateLong(end)}`,
    pageName,
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);

  const totals = posts.reduce(
    (a, p) => ({
      r: a.r + num(p.reactions_count),
      c: a.c + num(p.comments_count),
      s: a.s + num(p.shares_count),
      v: a.v + num(p.views_count),
    }),
    { r: 0, c: 0, s: 0, v: 0 },
  );
  const engagement = (p) => num(p.reactions_count) + num(p.comments_count) + num(p.shares_count);
  const top = posts.slice().sort((a, b) => engagement(b) - engagement(a))[0];

  drawStatCards(doc, ctx, [
    { label: 'Posts', value: fmtInt(posts.length) },
    { label: 'Reactions', value: fmtInt(totals.r), color: METRIC_META.reactions.color },
    { label: 'Comments', value: fmtInt(totals.c), color: METRIC_META.comments.color },
    { label: 'Shares', value: fmtInt(totals.s), color: METRIC_META.shares.color },
  ]);

  if (top) {
    const cap = pdfSafe(top.caption).replace(/\s+/g, ' ').trim().slice(0, 70);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(`Top post: #${top.id} · ${fmtInt(engagement(top))} engagements${cap ? ` · "${cap}"` : ''}`, M, ctx.y);
    ctx.y += 16;
  }

  const body = posts
    .slice()
    .sort((a, b) => new Date(a.posted_at) - new Date(b.posted_at))
    .map((p) => [
      p.posted_at ? fmtDateShort(p.posted_at) : '—',
      `#${p.id}`,
      pdfSafe(p.caption).replace(/\s+/g, ' ').trim().slice(0, 64) || '—',
      p.status || '—',
      fmtInt(p.reactions_count),
      fmtInt(p.comments_count),
      fmtInt(p.shares_count),
      p.media_type === 'video' ? fmtInt(p.views_count) : '—',
    ]);

  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    head: [['Date', '#', 'Post', 'Status', 'React', 'Cmt', 'Shr', 'Views']],
    body,
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 30 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 52 },
      4: { halign: 'right', cellWidth: 40 },
      5: { halign: 'right', cellWidth: 36 },
      6: { halign: 'right', cellWidth: 36 },
      7: { halign: 'right', cellWidth: 40 },
    },
    foot: [['', '', 'Total', '', fmtInt(totals.r), fmtInt(totals.c), fmtInt(totals.s), fmtInt(totals.v)]],
    footStyles: { fillColor: COLORS.foot, textColor: COLORS.dark, fontStyle: 'bold', halign: 'right' },
  });
  ctx.y = doc.lastAutoTable.finalY + 16;

  drawFooters(doc);
  return doc;
}

/**
 * Page-performance report for the Analytics page: summary cards, the three metric line
 * charts (reach / engagement / new follows) and the top-posts table — mirroring what the
 * Analytics screen shows for the selected range. Reuses the shared header/cards/chart/table
 * helpers. `series` is keyed by metric → [{ period, value }]; `ranking` is the top posts.
 */
export function buildPageAnalyticsPdf({ start, end, pageName, logo, followers, series = {}, ranking = [] }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = {
    title: 'Analytics report',
    subtitle: `${fmtDateLong(start)} – ${fmtDateLong(end)}`,
    pageName,
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);

  const sum = (arr) => (arr || []).reduce((a, p) => a + num(p.value), 0);
  const impressions = sum(series.page_posts_impressions);
  const engagement = sum(series.page_post_engagements);
  const netFollows = sum(series.page_daily_follows_unique) - sum(series.page_daily_unfollows_unique);

  drawStatCards(doc, ctx, [
    { label: 'Followers', value: followers != null ? fmtInt(followers) : '—', color: COLORS.primary },
    { label: 'Net followers', value: signed(netFollows), color: METRIC_META.shares.color },
    { label: 'Impressions', value: fmtCompact(impressions), color: METRIC_META.comments.color },
    { label: 'Engagement', value: fmtCompact(engagement), color: METRIC_META.views.color },
  ]);

  const charts = [
    { key: 'page_impressions_unique', label: 'Reach', color: [31, 155, 230] },
    { key: 'page_post_engagements', label: 'Engagement', color: [47, 180, 87] },
    { key: 'page_daily_follows_unique', label: 'New follows', color: [124, 58, 237] },
  ];
  charts.forEach((c) => {
    const pts = series[c.key] || [];
    if (pts.length) drawLineChart(doc, ctx, { points: pts, color: c.color, title: c.label });
  });

  if (ranking && ranking.length) {
    ensureSpace(doc, ctx, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.dark);
    doc.text('Top posts by engagement', M, ctx.y);
    ctx.y += 12;
    autoTable(doc, {
      ...tableOptions(doc, ctx),
      startY: ctx.y,
      head: [['#', 'Post', 'React', 'Cmt', 'Shr', 'Engagement']],
      body: ranking.map((p) => [
        `#${p.id}`,
        pdfSafe(p.caption).replace(/\s+/g, ' ').trim().slice(0, 70) || '—',
        fmtInt(p.reactions_count),
        fmtInt(p.comments_count),
        fmtInt(p.shares_count),
        fmtInt(p.engagement),
      ]),
      columnStyles: {
        0: { cellWidth: 34 },
        1: { cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: 44 },
        3: { halign: 'right', cellWidth: 40 },
        4: { halign: 'right', cellWidth: 40 },
        5: { halign: 'right', cellWidth: 74 },
      },
    });
    ctx.y = doc.lastAutoTable.finalY + 16;
  }

  drawFooters(doc);
  return doc;
}

/**
 * All-pages metrics report: one compact table across every active connected page.
 * The shape intentionally mirrors the user's spreadsheet reference without
 * generating a spreadsheet: Account / Follows / Unfollow / Visit / Current Followers.
 */
export function buildAllPagesMetricsPdf({ rangeDays, sinceDate, untilDate, rows = [], logo }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const rangeLabel =
    sinceDate && untilDate ? `${fmtDateLong(periodDate(sinceDate))} - ${fmtDateLong(periodDate(untilDate))}` : `Last ${rangeDays} days`;
  const ctx = {
    title: 'All pages metrics report',
    subtitle: `${rangeLabel} - Last ${rangeDays} days`,
    pageName: 'All connected pages',
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text('Follows, Unfollow and Visit are summed for the selected range. Current Followers is the live page count at export time.', M, ctx.y);
  ctx.y += 18;

  const fmtCell = (value) => (value == null ? '----' : fmtInt(value));
  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    tableWidth: 'wrap',
    head: [['ACCOUNT', 'Follows', 'Unfollow', 'Visit', 'Current Followers']],
    body: rows.map((row) => [
      pdfSafe(row.accountName) || `Page #${row.accountId}`,
      fmtCell(row.follows),
      fmtCell(row.unfollows),
      fmtCell(row.visits),
      fmtCell(row.currentFollowers),
    ]),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: [28, 39, 51], lineWidth: 0.35, textColor: [0, 0, 0] },
    headStyles: { fillColor: [255, 255, 255], textColor: COLORS.primary, fontStyle: 'bold', fontSize: 9, lineColor: [28, 39, 51], lineWidth: 0.5 },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 270 },
      1: { halign: 'right', cellWidth: 100 },
      2: { halign: 'right', cellWidth: 100 },
      3: { halign: 'right', cellWidth: 100 },
      4: { halign: 'right', cellWidth: 130 },
    },
  });
  ctx.y = doc.lastAutoTable.finalY + 16;

  if (!rows.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.muted);
    doc.text('No active connected pages were available for this report.', M, ctx.y);
  }

  drawFooters(doc);
  return doc;
}

/**
 * Full Performance-tab report: every Insights card in one detailed document.
 * Headline stat cards (mirroring the four charts the screen leads with), an
 * all-metrics summary table (total / vs previous period / daily average / best
 * day), a daily-trend chart per metric with history, a combined day-by-day
 * breakdown table with a totals footer, and a metric-definitions appendix so
 * the report is self-explanatory.
 * `cards` are the Insights cards: { key, title, info, total, changePct, series, available, format? }.
 */
export function buildPerformanceReportPdf({ cards = [], rangeDays, pageName, from, to, logo }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const rangeLabel = from && to ? `${fmtDateLong(periodDate(from))} – ${fmtDateLong(periodDate(to))}` : `Last ${rangeDays} days`;
  const ctx = {
    title: 'Performance report',
    subtitle: `${rangeLabel}    ·    Last ${rangeDays} days`,
    pageName,
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);

  const fmtVal = (c, v) => fmtMetricValue(v, c.format);
  // Per-card derived stats from its daily series.
  const detailed = cards
    .filter((c) => c && c.available)
    .map((c) => {
      const series = (c.series || []).filter((p) => p && p.period != null);
      const sum = series.reduce((a, p) => a + num(p.value), 0);
      let peak = null;
      for (const p of series) if (peak == null || num(p.value) > num(peak.value)) peak = p;
      return { c, series, sum, avg: series.length ? Math.round((sum / series.length) * 10) / 10 : null, peak };
    });

  // Headline cards — the first four metrics, mirroring the Performance screen.
  const headline = detailed.slice(0, 4);
  if (headline.length) {
    drawStatCards(doc, ctx, headline.map(({ c }) => ({ label: c.title, value: fmtVal(c, c.total), color: COLORS.primary })));
  }

  // All-metrics summary (unavailable metrics still listed, marked "No data").
  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    head: [['Metric', 'Total', 'vs previous', 'Daily average', 'Best day']],
    body: cards.map((c) => {
      if (!c.available) return [c.title, 'No data', '—', '—', '—'];
      const d = detailed.find((x) => x.c === c);
      return [
        c.title,
        fmtVal(c, c.total),
        pctStr(c.changePct),
        d.avg != null ? fmtVal(c, d.avg) : '—',
        d.peak ? `${fmtDateLong(periodDate(d.peak.period))} (${fmtVal(c, d.peak.value)})` : '—',
      ];
    }),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });
  ctx.y = doc.lastAutoTable.finalY + 22;

  const sectionTitle = (text) => {
    ensureSpace(doc, ctx, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.dark);
    doc.text(text, M, ctx.y);
    ctx.y += 14;
  };

  // Daily trend charts — one per metric with enough history to draw a line.
  const charted = detailed.filter((d) => d.series.length >= 2);
  if (charted.length) {
    sectionTitle('Daily trends');
    charted.forEach((d) => drawLineChart(doc, ctx, { points: d.series, color: [31, 155, 230], title: d.c.title }));
  }

  // Combined day-by-day breakdown: one row per date, one column per metric.
  const daily = detailed.filter((d) => d.series.length);
  if (daily.length) {
    const dates = [...new Set(daily.flatMap((d) => d.series.map((p) => String(p.period))))].sort();
    const byDate = daily.map((d) => new Map(d.series.map((p) => [String(p.period), p.value])));
    sectionTitle('Day-by-day breakdown');
    const numeric = {};
    for (let i = 1; i <= daily.length; i += 1) numeric[i] = { halign: 'right' };
    autoTable(doc, {
      ...tableOptions(doc, ctx),
      startY: ctx.y,
      head: [['Date', ...daily.map((d) => d.c.title)]],
      body: dates.map((date) => [
        fmtDateLong(periodDate(date)),
        ...daily.map((d, i) => (byDate[i].has(date) ? fmtVal(d.c, byDate[i].get(date)) : '—')),
      ]),
      foot: [[{ content: 'Total', styles: { halign: 'left' } }, ...daily.map((d) => fmtVal(d.c, d.sum))]],
      footStyles: { fillColor: COLORS.foot, textColor: COLORS.dark, fontStyle: 'bold', halign: 'right' },
      showFoot: 'lastPage',
      columnStyles: { 0: { cellWidth: 74 }, ...numeric },
    });
    ctx.y = doc.lastAutoTable.finalY + 22;
  }

  // Appendix: what each metric measures (mirrors the in-app info tooltips).
  const defined = cards.filter((c) => c.info);
  if (defined.length) {
    sectionTitle('Metric definitions');
    autoTable(doc, {
      ...tableOptions(doc, ctx),
      startY: ctx.y,
      head: [['Metric', 'What it measures']],
      body: defined.map((c) => [c.title, pdfSafe(c.info)]),
      columnStyles: { 0: { cellWidth: 130 } },
    });
    ctx.y = doc.lastAutoTable.finalY + 16;
  }

  drawFooters(doc);
  return doc;
}

/**
 * Single-metric report for one Insights → Performance card. Replaces the old CSV export
 * with a professional, self-explanatory document: a plain-language description of the
 * metric, headline stat cards (period total, change vs the previous period, daily average,
 * best day), a daily-trend line chart, and a day-by-day breakdown table with a running
 * cumulative and a totals footer.
 * `card` is one Insights card: { key, title, info, total, changePct, series:[{period,value}], available, format? }.
 */
export function buildMetricCardPdf({ card, rangeDays, pageName, sinceDate, untilDate, logo }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const series = (card.series || []).filter((p) => p && p.period != null);
  const rangeLabel =
    sinceDate && untilDate ? `${fmtDateLong(periodDate(sinceDate))} – ${fmtDateLong(periodDate(untilDate))}` : `Last ${rangeDays} days`;
  const ctx = {
    title: `${card.title} report`,
    subtitle: `${rangeLabel}    ·    Last ${rangeDays} days`,
    pageName,
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);

  // Plain-language description of the metric (mirrors the in-app info tooltip).
  if (card.info) drawNote(doc, ctx, card.info);

  // Derived stats from the daily series.
  const vals = series.map((p) => num(p.value));
  const seriesSum = vals.reduce((a, v) => a + v, 0);
  const total = card.total != null ? card.total : seriesSum;
  const days = series.length;
  const avg = days ? seriesSum / days : 0;
  const avgRounded = Math.round(avg * 10) / 10;
  let peak = null;
  for (const p of series) if (peak == null || num(p.value) > num(peak.value)) peak = p;
  const fmtVal = (v) => fmtMetricValue(v, card.format);

  drawStatCards(doc, ctx, [
    { label: `Total (${rangeDays}d)`, value: fmtVal(total), color: COLORS.primary },
    {
      label: 'vs previous period',
      value: pctStr(card.changePct),
      color:
        card.changePct == null
          ? COLORS.muted
          : card.changePct > 0
            ? METRIC_META.shares.color // green — up
            : card.changePct < 0
              ? METRIC_META.reactions.color // red — down
              : COLORS.dark,
    },
    { label: 'Daily average', value: fmtVal(avgRounded) },
    { label: 'Best day', value: peak ? fmtVal(peak.value) : '—' },
  ]);

  // A one-line highlights sentence beneath the cards.
  if (peak) {
    ensureSpace(doc, ctx, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      pdfSafe(`Best day ${fmtDateLong(periodDate(peak.period))} (${fmtVal(peak.value)})    ·    ${days} day${days === 1 ? '' : 's'} of data`),
      M,
      ctx.y,
    );
    ctx.y += 18;
  }

  // Daily trend chart (needs at least two points to draw a line).
  if (series.length >= 2) drawLineChart(doc, ctx, { points: series, color: [31, 155, 230], title: 'Daily trend' });

  // Day-by-day breakdown with a running cumulative and a totals footer.
  ensureSpace(doc, ctx, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.dark);
  doc.text('Day-by-day breakdown', M, ctx.y);
  ctx.y += 12;

  let running = 0;
  const body = series.map((p) => {
    running += num(p.value);
    return [fmtDateLong(periodDate(p.period)), fmtVal(p.value), fmtVal(running)];
  });

  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    head: [['Date', card.title, 'Cumulative']],
    body: body.length ? body : [['No daily data for this period.', '—', '—']],
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 130 }, 2: { halign: 'right', cellWidth: 130 } },
    foot: body.length ? [[{ content: 'Total', styles: { halign: 'left' } }, fmtVal(total), '']] : undefined,
    footStyles: { fillColor: COLORS.foot, textColor: COLORS.dark, fontStyle: 'bold', halign: 'right' },
  });
  ctx.y = doc.lastAutoTable.finalY + 16;

  drawFooters(doc);
  return doc;
}

const NPS_PDF_COLORS = {
  promoter: [47, 180, 87],
  passive: [242, 176, 54],
  detractor: [224, 93, 85],
};

const fmtNpsScore = (score) => (score == null || Number.isNaN(Number(score)) ? '--' : fmtInt(Math.round(Number(score))));
const fmtNullablePct = (value) => (value == null ? '--' : `${fmtInt(value)}%`);
const fmtCsat = (value) => (value == null || Number.isNaN(Number(value)) ? '--' : `${Number(value).toFixed(1).replace(/\.0$/, '')}/5`);
const npsPdfScoreColor = (score) => {
  const value = Number(score);
  if (!Number.isFinite(value)) return COLORS.muted;
  if (value >= 50) return NPS_PDF_COLORS.promoter;
  if (value >= 0) return NPS_PDF_COLORS.passive;
  return NPS_PDF_COLORS.detractor;
};
const npsPdfStatus = (score) => {
  const value = Number(score);
  if (Number.isFinite(value) && value >= 9) return 'Promoter';
  if (Number.isFinite(value) && value >= 7) return 'Neutral';
  return 'Detractor';
};
const npsPdfAgentOwner = (comment = {}) => pdfSafe(comment.agentOwnerName || comment.agentName || 'Unassigned') || 'Unassigned';

function drawNpsMixBar(doc, ctx, { promoters = 0, passives = 0, detractors = 0, sample = 0 }) {
  const W = pageW(doc);
  const boxW = W - 2 * M;
  ensureSpace(doc, ctx, 92);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.dark);
  doc.text('NPS response mix', M, ctx.y);

  const barY = ctx.y + 16;
  const barH = 16;
  doc.setFillColor(...COLORS.zebra);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(M, barY, boxW, barH, 6, 6, 'FD');

  const segments = [
    { label: 'Detractors', value: num(detractors), color: NPS_PDF_COLORS.detractor },
    { label: 'Passives', value: num(passives), color: NPS_PDF_COLORS.passive },
    { label: 'Promoters', value: num(promoters), color: NPS_PDF_COLORS.promoter },
  ];

  if (sample > 0) {
    let x = M;
    segments.forEach((segment, index) => {
      if (segment.value <= 0) return;
      const width = index === segments.length - 1 ? M + boxW - x : boxW * (segment.value / sample);
      doc.setFillColor(...segment.color);
      doc.rect(x, barY, Math.max(0, width), barH, 'F');
      x += width;
    });
  }

  const legendY = barY + 38;
  const colW = boxW / 3;
  segments.forEach((segment, index) => {
    const pct = sample > 0 ? Math.round((segment.value / sample) * 100) : 0;
    const x = M + index * colW;
    doc.setFillColor(...segment.color);
    doc.circle(x + 3, legendY - 3, 3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.dark);
    doc.text(`${segment.label}: ${fmtInt(segment.value)} (${pct}%)`, x + 12, legendY);
  });

  ctx.y = legendY + 20;
}

export function buildNpsMetricsPdf({ metrics = {}, comments = [], pageName, reportOwnerName, rangeDays, rangeLabel, rangePhrase, logo }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const period = rangePhrase ? rangePhrase.replace(/^last/i, 'Last') : `Last ${rangeDays} days`;
  const ctx = {
    title: 'NPS metrics report',
    subtitle: `${rangeLabel || `${rangeDays} days`} - ${period}`,
    pageName,
    logo,
    generatedAt: fmtDateTime(new Date()),
  };
  ctx.y = drawHeader(doc, ctx);

  const nps = metrics.nps || {};
  const csat = metrics.csat || {};
  const sample = num(nps.sample);
  const score = nps.score == null ? null : Number(nps.score);
  const agentOwners = [...new Set(comments.map((comment) => npsPdfAgentOwner(comment)).filter(Boolean))];
  const reportOwner = pdfSafe(reportOwnerName)
    || (agentOwners.length === 1 ? agentOwners[0] : agentOwners.length > 1 ? agentOwners.join(', ') : 'Unassigned');

  drawStatCards(doc, ctx, [
    { label: 'NPS score', value: fmtNpsScore(score), color: npsPdfScoreColor(score) },
    { label: 'NPS responses', value: fmtInt(sample), color: npsPdfScoreColor(score) },
    { label: 'Response rate', value: fmtNullablePct(metrics.responseRatePct), color: COLORS.primary },
    { label: 'CSAT avg', value: fmtCsat(csat.avg), color: [124, 58, 237] },
  ]);

  drawNote(doc, ctx, 'NPS score is the percentage of promoters minus the percentage of detractors for the selected survey responses. Passives are shown in the mix but do not change the score.');

  drawNpsMixBar(doc, ctx, {
    promoters: nps.promoters,
    passives: nps.passives,
    detractors: nps.detractors,
    sample,
  });

  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    head: [['Metric', 'Value']],
    body: [
      ['Agent / owner', reportOwner],
      ['Surveys sent', fmtInt(metrics.sent)],
      ['Surveys sent yesterday', fmtInt(metrics.sentYesterday)],
      ['Responses', fmtInt(metrics.responded)],
      ['Response rate', fmtNullablePct(metrics.responseRatePct)],
      ['CSAT sample', fmtInt(csat.sample)],
      ['NPS sample', fmtInt(sample)],
    ],
    columnStyles: { 0: { cellWidth: 150 } },
  });
  ctx.y = doc.lastAutoTable.finalY + 22;

  const series = Array.isArray(metrics.series) ? metrics.series : [];
  if (series.length >= 2) {
    drawLineChart(doc, ctx, { points: series, color: COLORS.primary, title: 'Surveys sent per day' });
  }

  ensureSpace(doc, ctx, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.dark);
  doc.text('Latest NPS feedback', M, ctx.y);
  ctx.y += 12;

  autoTable(doc, {
    ...tableOptions(doc, ctx),
    startY: ctx.y,
    head: [['Date', 'Conversation ID', 'Agent / owner', 'Status', 'NPS', 'CSAT', 'Feedback']],
    body: comments.length
      ? comments.map((comment) => [
        comment.day || '--',
        comment.conversationCid || '--',
        npsPdfAgentOwner(comment),
        comment.status || npsPdfStatus(comment.nps),
        comment.nps == null ? '--' : `${comment.nps}/10`,
        comment.satisfaction == null ? '--' : `${comment.satisfaction}/5`,
        pdfSafe(comment.comment || '--').slice(0, 180),
      ])
      : [['No written NPS feedback in this period.', '--', '--', '--', '--', '--', '--']],
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 94 },
      2: { cellWidth: 108 },
      3: { cellWidth: 54 },
      4: { halign: 'right', cellWidth: 34 },
      5: { halign: 'right', cellWidth: 34 },
      6: { cellWidth: 'auto' },
    },
  });
  ctx.y = doc.lastAutoTable.finalY + 16;

  drawFooters(doc);
  return doc;
}
