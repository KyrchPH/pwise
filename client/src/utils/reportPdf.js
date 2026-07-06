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

// A period string ('YYYY-MM-DD' | 'YYYY-MM' | ISO hour) → short axis label.
function labelForPeriod(period) {
  const s = String(period);
  const d = s.includes('T') ? new Date(s) : s.length > 7 ? new Date(`${s}T00:00:00`) : new Date(`${s}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : fmtDateShort(d);
}

// Load /logo.png as a data URL (+ its natural size) for the header. Best-effort —
// returns null on any failure so the report still renders with a text wordmark.
export async function loadLogo() {
  try {
    const res = await fetch('/logo.png');
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
    return dims && dims.h ? { dataUrl, ...dims } : null;
  } catch {
    return null;
  }
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
    doc.text(ctx.pageName, rx, topY + 4, { align: 'right' });
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

// Rounded info box holding the post caption + a muted meta line.
function drawPostMeta(doc, ctx, post) {
  const W = pageW(doc);
  const boxW = W - 2 * M;
  const caption = (post.caption || '').trim();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const allLines = caption ? doc.splitTextToSize(caption, boxW - 24) : ['No caption'];
  const lines = allLines.slice(0, 5);
  if (allLines.length > 5) lines[4] = `${lines[4].slice(0, -1)}…`;
  const meta = [
    `Status: ${post.status || '—'}`,
    post.posted_at ? `Posted: ${fmtDateTime(post.posted_at)}` : post.scheduled_at ? `Scheduled: ${fmtDateTime(post.scheduled_at)}` : null,
    `Type: ${post.media_type || '—'}`,
  ].filter(Boolean);
  const boxH = 16 + lines.length * 12 + 16;
  ensureSpace(doc, ctx, boxH + 12);
  doc.setFillColor(...COLORS.zebra);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.5);
  doc.roundedRect(M, ctx.y, boxW, boxH, 5, 5, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.dark);
  let ty = ctx.y + 17;
  lines.forEach((ln) => {
    doc.text(ln, M + 12, ty);
    ty += 12;
  });
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(doc.splitTextToSize(meta.join('    ·    '), boxW - 24)[0], M + 12, ctx.y + boxH - 8);
  ctx.y += boxH + 16;
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
    const cap = (top.caption || '').replace(/\s+/g, ' ').trim().slice(0, 70);
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
      (p.caption || '').replace(/\s+/g, ' ').trim().slice(0, 64) || '—',
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
