// Compact filled-area sparkline for the Insights ("Performance") cards. Takes the same
// point shape as LineChart ([{ period, value }]); stretches to its container width. Renders
// nothing meaningful with fewer than 2 points (shows a flat placeholder).
export default function Sparkline({ points = [], color = 'var(--blue)', width = 160, height = 44 }) {
  const vals = (points || []).map((p) => Number(p.value) || 0);
  if (vals.length < 2) return <div className="spark spark--empty" style={{ height }} aria-hidden="true" />;

  const pad = 2;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = vals.length;
  const x = (i) => (i / (n - 1)) * (width - pad * 2) + pad;
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);

  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} fillOpacity="0.16" stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
