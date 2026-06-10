import { useId } from 'react';

// Dependency-free SVG line chart, styled like a fintech growth chart. Takes
// points [{ period, value }] (period is 'YYYY-MM-DD', 'YYYY-MM', or an ISO
// hour like '2026-06-04T14:00:00Z') and draws one smooth (spline) line with a
// soft gradient fill, a dashed reference line at the starting value, a y-axis
// fitted to the data with "nice" round gridlines, and x ticks at even time
// intervals. Each point's x position is proportional to its actual time, so
// gaps between snapshots show up as gaps instead of being squashed together.
const W = 640;
const H = 240;
const PAD_L = 48;
const PAD_R = 18;
const PAD_T = 14;
const PAD_B = 30;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_T - PAD_B;

const HOUR = 3_600_000;
const DAY = 86_400_000;

const fmtVal = (v) => {
  const r = Math.round(v);
  if (Math.abs(r) >= 1_000_000) return `${(r / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(r) >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(r);
};

const parseTime = (period) => {
  const s = String(period);
  const d = s.includes('T') ? new Date(s) : s.length > 7 ? new Date(`${s}T00:00:00`) : new Date(`${s}-01T00:00:00`);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
};

const fmtTick = (t, unit) => {
  const d = new Date(t);
  if (unit === 'hour') return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
  if (unit === 'day') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

// Whole units (hours / days / months) between two boundary-aligned timestamps,
// and the timestamp `k` units after `a` — built via the Date constructor so DST
// and month lengths are handled for us. Insight buckets always sit on these
// boundaries (top-of-hour / midnight / first-of-month), so x ticks stepped this
// way land on real calendar dates and stay evenly spaced.
const unitsBetween = (a, b, unit) => {
  if (unit === 'hour') return Math.round((b - a) / HOUR);
  if (unit === 'day') return Math.round((b - a) / DAY);
  const da = new Date(a);
  const db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
};
const addUnits = (a, unit, k) => {
  if (unit === 'hour') return a + k * HOUR;
  const d = new Date(a);
  if (unit === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();
  return new Date(d.getFullYear(), d.getMonth() + k, 1).getTime();
};

// Round a raw step up to a "nice" 1/2/5 × 10ⁿ value (for clean axis labels).
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return f * mag;
}

// Keep spline control points inside the plot so the curve never overshoots the
// axis range (points can sit exactly on the bottom gridline).
const clampY = (v) => Math.min(PAD_T + INNER_H, Math.max(PAD_T, v));

// Smooth path through the points via a Catmull-Rom → cubic-bézier conversion.
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function LineChart({ points = [], color = '#7c3aed' }) {
  const gradId = useId();
  if (!points.length) return null;

  const n = points.length;

  // --- y axis: fit the data (counts are integers → step >= 1) so growth fills
  // the plot instead of hugging a zero baseline. The min sits on the bottom
  // gridline, the max gets headroom, and the step grows until <= 8 ticks fit.
  const values = points.map((p) => p.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const spanV = dataMax - dataMin;
  let step = Math.max(niceStep(Math.max(spanV, 1) / 8), 1);
  let bottom;
  let top;
  for (;;) {
    bottom = Math.floor(dataMin / step) * step;
    top = Math.ceil(dataMax / step) * step;
    if (spanV === 0) bottom = Math.max(0, bottom - step); // flat series: center it
    if (top - dataMax < step * 0.05) top += step;
    if ((top - bottom) / step <= 8) break;
    step = niceStep(step * 1.01);
  }
  const yTicks = [];
  for (let v = bottom; v <= top + 1e-9; v += step) yTicks.push(Math.round(v * 1000) / 1000);
  const y = (v) => PAD_T + INNER_H - ((v - bottom) / (top - bottom)) * INNER_H;

  // --- x axis: position points by actual time when every period parses (and
  // is in order), falling back to even index spacing otherwise.
  const times = points.map((p) => parseTime(p.period));
  const timeMode =
    n > 1 &&
    times.every((t, i) => t !== null && (i === 0 || t > times[i - 1])) &&
    times[n - 1] > times[0];
  const t0 = times[0];
  const tSpan = timeMode ? times[n - 1] - t0 : 0;
  const x = (i) => {
    if (n === 1) return PAD_L + INNER_W / 2;
    if (timeMode) return PAD_L + ((times[i] - t0) / tSpan) * INNER_W;
    return PAD_L + (i / (n - 1)) * INNER_W;
  };

  // Per-point label: the period formatted at its own granularity (used for
  // tooltips and for x ticks when time positioning isn't possible).
  const tipLabel = (i) => {
    const s = String(points[i].period);
    if (times[i] === null) return s;
    return fmtTick(times[i], s.includes('T') ? 'hour' : s.length > 7 ? 'day' : 'month');
  };

  // X ticks at a uniform whole-unit cadence (every 1/2/3… days, etc.) so labels
  // are evenly spaced and none get skipped. The earlier approach placed six
  // fractional positions and snapped each to the nearest day, which could round
  // two onto the same day and drop the one between — e.g. "Jun 7" vanishing on a
  // 6-day range. The step grows to keep ~6–7 ticks; first and last are labelled.
  const xTicks = [];
  if (timeMode) {
    const unit = tSpan >= 56 * DAY ? 'month' : tSpan >= 2 * DAY ? 'day' : 'hour';
    const total = Math.max(1, unitsBetween(t0, times[n - 1], unit));
    const step = Math.max(1, Math.ceil(total / 6));
    const offsets = [];
    for (let k = 0; k <= total; k += step) offsets.push(k);
    if (offsets[offsets.length - 1] !== total) offsets.push(total); // always label the latest bucket
    const seen = new Set();
    for (const k of offsets) {
      const t = addUnits(t0, unit, k);
      const label = fmtTick(t, unit);
      if (seen.has(label)) continue;
      seen.add(label);
      xTicks.push({ x: PAD_L + ((t - t0) / tSpan) * INNER_W, label });
    }
  } else {
    const idxs =
      n <= 8
        ? points.map((_, i) => i)
        : [...new Set(Array.from({ length: 6 }, (_, k) => Math.round((k / 5) * (n - 1))))];
    idxs.forEach((i) => xTicks.push({ x: x(i), label: tipLabel(i) }));
  }

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${coords[n - 1].x.toFixed(1)} ${(PAD_T + INNER_H).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(PAD_T + INNER_H).toFixed(1)} Z`;
  const startY = y(points[0].value);

  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Insights over time">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.24" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => {
        const yy = y(t);
        return (
          <g key={`y${i}`}>
            <line className="linechart__grid" x1={PAD_L} y1={yy} x2={W - PAD_R} y2={yy} />
            <text className="linechart__ylabel" x={PAD_L - 9} y={yy + 3.5} textAnchor="end" fontSize="11">
              {fmtVal(t)}
            </text>
          </g>
        );
      })}

      {n > 1 && (
        <>
          <path className="linechart__area" d={areaPath} fill={`url(#${gradId})`} />
          <line className="linechart__baseline" x1={PAD_L} y1={startY} x2={W - PAD_R} y2={startY}>
            <title>{`Start: ${points[0].value}`}</title>
          </line>
        </>
      )}

      <path className="linechart__line" d={linePath} style={{ stroke: color }} />

      {n === 1 && <circle className="linechart__dot" cx={coords[0].x} cy={coords[0].y} r="4" style={{ fill: color }} />}

      {n <= 90 &&
        coords.map((c, i) => (
          // Invisible hover targets standing in for the old dots: the line stays
          // clean (like a fintech chart) but per-point tooltips still work.
          <circle key={`h${i}`} className="linechart__hit" cx={c.x} cy={c.y} r="8">
            <title>{`${tipLabel(i)}: ${points[i].value}`}</title>
          </circle>
        ))}

      {xTicks.map((tk, i) => {
        // Anchor the edge labels inward so they don't overflow the chart and clip.
        const nearLeft = tk.x <= PAD_L + 4;
        const nearRight = tk.x >= W - PAD_R - 4;
        const anchor = n === 1 ? 'middle' : nearLeft ? 'start' : nearRight ? 'end' : 'middle';
        return (
          <text key={`x${i}`} className="linechart__xlabel" x={tk.x} y={H - 9} textAnchor={anchor} fontSize="11">
            {tk.label}
          </text>
        );
      })}
    </svg>
  );
}
