import { useEffect, useRef, useState } from 'react';

// Dependency-free grouped vertical bar chart for comparing metrics across time
// buckets (days / weeks / months). Props:
//   buckets: [{ key, label }]                       — the x groups, left→right
//   series:  [{ key, label, color, values:number[] }] — values aligned to buckets
// A legend toggles series on/off; horizontal gridlines + a fitted y-axis; a custom
// cursor-following tooltip per bar (instant — native <title> has an un-overridable
// browser hover delay). The SVG sizes itself to the data (readable bars) and scrolls
// horizontally inside its wrapper when there are many buckets.

const H = 300;
const PAD_T = 16;
const PAD_B = 42;
const PAD_L = 46;
const PAD_R = 14;
const INNER_H = H - PAD_T - PAD_B;

const BAR_W = 16;
const INNER_GAP = 4; // between bars within a group
const GROUP_GAP = 28; // between groups

const fmtVal = (v) => {
  const r = Math.round(v);
  if (Math.abs(r) >= 1_000_000) return `${(r / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(r) >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(r);
};

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const norm = raw / mag;
  const f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return f * mag;
}

export default function BarChart({ buckets = [], series = [], selectedKeys = null, onSelect = null, showLegend = true, ariaLabel = 'Metric history' }) {
  const [hidden, setHidden] = useState(() => new Set());
  // Custom tooltip: cursor position (relative to the chart root) + the hovered bar's
  // data. Shows with zero delay, unlike a native <title>. null when nothing is hovered.
  const rootRef = useRef(null);
  const [tip, setTip] = useState(null);
  // Measure the wrapper so the plot (and its gridlines/axis) can stretch to fill the
  // container when there are only a few buckets, instead of stopping at the last bar.
  const wrapRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => setContainerW(entries[0]?.contentRect?.width || el.clientWidth || 0));
    ro.observe(el);
    setContainerW(el.clientWidth || 0);
    return () => ro.disconnect();
  }, []);

  const toggle = (key) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // Track the cursor over a bar so the tooltip follows it (positioned relative to the
  // chart root, which isn't clipped by the horizontal scroll wrapper).
  const showTip = (e, b, s, v) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, bucket: b.label, series: s.label, color: s.color, value: v });
  };

  const visible = series.filter((s) => !hidden.has(s.key));
  const nB = buckets.length;
  const nS = Math.max(1, visible.length);

  const groupW = nS * BAR_W + (nS - 1) * INNER_GAP;
  // Natural width fits the bars; W stretches to the container so gridlines/axis reach the
  // right edge (and scrolls when the bars need more room than the container has).
  const naturalW = PAD_L + nB * (groupW + GROUP_GAP) + PAD_R;
  const W = Math.max(containerW, naturalW);

  // When a subset of buckets is selected (and there's more than one to choose from),
  // the unselected columns' bars fade back so the selection reads by colour, not a box.
  const hasSelection = nB > 1 && !!selectedKeys && selectedKeys.size > 0;

  // y axis: 0-based, fitted to the data with ≤6 "nice" gridlines.
  const maxVal = Math.max(1, ...visible.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  let step = niceStep(maxVal / 4);
  let top = Math.ceil(maxVal / step) * step;
  while (top / step > 6) {
    step = niceStep(step * 1.5);
    top = Math.ceil(maxVal / step) * step;
  }
  const yTicks = [];
  for (let v = 0; v <= top + 1e-9; v += step) yTicks.push(v);
  const y = (v) => PAD_T + INNER_H - (v / top) * INNER_H;
  const groupX = (i) => PAD_L + GROUP_GAP / 2 + i * (groupW + GROUP_GAP);

  return (
    <div className="barchart" ref={rootRef}>
      {showLegend && (
        <div className="barchart__legend">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`barchart__leg${hidden.has(s.key) ? ' is-off' : ''}`}
              onClick={() => toggle(s.key)}
            >
              <span className="barchart__leg-dot" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="barchart__scroll" ref={wrapRef}>
        <svg className="barchart__svg" width={W} height={H} role="img" aria-label={ariaLabel}>
          {yTicks.map((t, i) => (
            <g key={`y${i}`}>
              <line className="barchart__grid" x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} />
              <text className="barchart__ylabel" x={PAD_L - 8} y={y(t) + 3.5} textAnchor="end">{fmtVal(t)}</text>
            </g>
          ))}

          {buckets.map((b, bi) => {
            const gx = groupX(bi);
            // Only highlight a selection when there's more than one bucket to choose
            // between — a lone column shouldn't look like it has a background box.
            const selected = nB > 1 && !!selectedKeys && selectedKeys.has(b.key);
            const colLeft = PAD_L + bi * (groupW + GROUP_GAP);
            const colW = groupW + GROUP_GAP;
            return (
              <g
                key={b.key}
                className={`barchart__group${onSelect ? ' is-clickable' : ''}${selected ? ' is-selected' : ''}`}
                onClick={onSelect ? () => onSelect(bi) : undefined}
              >
                {/* Full-height hit area so the whole column is clickable. */}
                <rect x={colLeft} y={PAD_T} width={colW} height={INNER_H} fill="transparent" />
                {visible.map((s, si) => {
                  const v = Number(s.values[bi]) || 0;
                  const bh = Math.max(0, (v / top) * INNER_H);
                  const bx = gx + si * (BAR_W + INNER_GAP);
                  const by = PAD_T + INNER_H - bh;
                  return (
                    <rect
                      key={s.key}
                      className={`barchart__bar${hasSelection && !selected ? ' is-dim' : ''}`}
                      x={bx}
                      y={by}
                      width={BAR_W}
                      height={bh}
                      rx="3"
                      fill={s.color}
                      onMouseEnter={(e) => showTip(e, b, s, v)}
                      onMouseMove={(e) => showTip(e, b, s, v)}
                      onMouseLeave={() => setTip(null)}
                    />
                  );
                })}
                <text className={`barchart__xlabel${selected ? ' is-selected' : ''}`} x={gx + groupW / 2} y={H - PAD_B + 18} textAnchor="middle">
                  {b.label}
                </text>
              </g>
            );
          })}

          <line className="barchart__axis" x1={PAD_L} y1={PAD_T + INNER_H} x2={W - PAD_R} y2={PAD_T + INNER_H} />
        </svg>
      </div>

      {tip && (
        <div className="barchart__tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          <span className="barchart__tip-dot" style={{ background: tip.color }} />
          <span className="barchart__tip-name">{tip.bucket} · {tip.series}</span>
          <strong className="barchart__tip-val">{tip.value.toLocaleString()}</strong>
        </div>
      )}
    </div>
  );
}
