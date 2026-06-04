// Dependency-free SVG line chart. Takes points [{ period, value }] (period is
// 'YYYY-MM-DD' for day granularity or 'YYYY-MM' for month) and draws one smooth
// (spline) line with dots, a 0-based axis with "nice" round gridlines, and
// first/…/last x labels.
const W = 640;
const H = 210;
const PAD_L = 48;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 34;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_T - PAD_B;

const fmtVal = (v) => {
  const r = Math.round(v);
  if (Math.abs(r) >= 1_000_000) return `${(r / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(r) >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(r);
};

const fmtPeriod = (period) => {
  const s = String(period);
  if (s.includes('T')) {
    // hour bucket (ISO UTC, e.g. 2026-06-04T14:00:00Z) → local short time
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
  }
  const parts = s.split('-');
  if (parts.length === 3) {
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const d = new Date(`${s}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

// Round a raw step up to a "nice" 1/2/5 × 10ⁿ value (for clean axis labels).
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return f * mag;
}

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
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function LineChart({ points = [], color = '#7c3aed' }) {
  if (!points.length) return null;

  // 0-based axis with nice round gridlines (counts are integers → step >= 1).
  const dataMax = Math.max(...points.map((p) => p.value), 1);
  const step = Math.max(niceStep(dataMax / 5), 1);
  const top = Math.ceil(dataMax / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);

  const n = points.length;
  const x = (i) => PAD_L + (n === 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W);
  const y = (v) => PAD_T + INNER_H - (v / top) * INNER_H;

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const linePath = smoothPath(coords);

  const xIdxs =
    n <= 8
      ? points.map((_, i) => i)
      : [...new Set(Array.from({ length: 6 }, (_, k) => Math.round((k / 5) * (n - 1))))];

  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Insights over time">
      {ticks.map((t, i) => {
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

      <path className="linechart__line" d={linePath} style={{ stroke: color }} />

      {n <= 60 &&
        coords.map((c, i) => (
          <circle key={`d${i}`} className="linechart__dot" cx={c.x} cy={c.y} r="4" style={{ fill: color }}>
            <title>{`${fmtPeriod(points[i].period)}: ${points[i].value}`}</title>
          </circle>
        ))}

      {xIdxs.map((i) => {
        // Anchor the edge labels inward so they don't overflow the chart and clip.
        const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        const lx = n === 1 ? x(0) : i === 0 ? PAD_L : i === n - 1 ? W - PAD_R : x(i);
        return (
          <text key={`x${i}`} className="linechart__xlabel" x={lx} y={H - 12} textAnchor={anchor} fontSize="11">
            {fmtPeriod(points[i].period)}
          </text>
        );
      })}
    </svg>
  );
}
