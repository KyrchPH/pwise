import { useCallback, useEffect, useState } from 'react';
import * as messaging from '../../services/messaging.service.js';

// Format seconds → "45s" / "2m 30s" / "1h 5m".
function fmtDuration(sec) {
  if (sec == null) return 'no data';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// One small ring: a percentage in the center and the abbreviation below. Colour
// shifts good/mid/low by value. Hovering (or focusing) reveals the full name + the
// numbers via the rail's floating tooltip (onShow/onHide).
function Gauge({ label, pct, onShow, onHide }) {
  const value = pct == null ? null : Math.max(0, Math.min(100, pct));
  const tone = value == null ? 'na' : value >= 80 ? 'good' : value >= 50 ? 'mid' : 'low';
  return (
    <div
      className="msg-metric"
      tabIndex={0}
      onMouseEnter={onShow}
      onMouseLeave={onHide}
      onFocus={onShow}
      onBlur={onHide}
    >
      <div className={`msg-gauge msg-gauge--${tone}`}>
        <svg viewBox="0 0 36 36" className="msg-gauge__svg" aria-hidden="true">
          <circle className="msg-gauge__track" cx="18" cy="18" r="15.9155" fill="none" />
          <circle
            className="msg-gauge__bar"
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            strokeDasharray={`${value ?? 0} 100`}
            strokeLinecap="round"
          />
        </svg>
        <span className="msg-gauge__val">{value == null ? '—' : `${Math.round(value)}%`}</span>
      </div>
      <span className="msg-metric__label">{label}</span>
    </div>
  );
}

/**
 * Live-agent (human) response metrics for the active page — CRR / FRT / ART — shown
 * as three small rings in the messaging mode rail. "Agent → Customer" only.
 *
 * Real-time-ish: refetches on inbox SSE activity (debounced) plus a slow poll, so
 * time-based changes (a chat aging past the CRR window) surface even with no new
 * message. CRR is a true percentage; FRT/ART rings are a 0–100% score vs the page's
 * target time (configured in Settings → Facebook Pages). Hovering a ring reveals its
 * non-abbreviated name and the underlying numbers in a floating tooltip.
 */
export default function MessagingMetricsRail({ accountId }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tip, setTip] = useState(null); // { name, detail, x, y }

  const load = useCallback(() => {
    if (!accountId) return;
    messaging
      .getAnalytics(accountId)
      .then((m) => {
        setData(m);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [accountId]);

  useEffect(() => {
    setData(null);
    setTip(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!accountId) return undefined;
    let debounce = null;
    const bump = () => {
      clearTimeout(debounce);
      debounce = setTimeout(load, 1500);
    };
    const unsub = messaging.subscribe((e) => {
      if (e && ['message:new', 'conversation:new', 'conversation:updated', 'conversation:reassigned'].includes(e.type)) {
        bump();
      }
    });
    const poll = setInterval(load, 45000); // catch time-based drift (CRR window aging)
    return () => {
      unsub();
      clearTimeout(debounce);
      clearInterval(poll);
    };
  }, [accountId, load]);

  if (!accountId) return null;

  const crr = data?.crr;
  const frt = data?.frt;
  const art = data?.art;
  const cfg = data?.config;
  const days = cfg?.periodDays;
  const t = (s) => fmtDuration(s);

  // label = abbreviation shown under the ring · name = the non-abbreviated title
  // revealed on hover · detail = the underlying numbers.
  const metrics = [
    {
      label: 'CRR',
      name: 'Chat Response Rate',
      pct: crr?.pct,
      detail: failed
        ? 'Metrics unavailable.'
        : `${crr?.pct == null ? 'No data yet' : `${crr.pct}%`} of customer chats answered by a live agent within ${cfg?.crrWindowHours ?? 12}h · last ${days}d · ${crr?.sample ?? 0} chats`,
    },
    {
      label: 'FRT',
      name: 'First Response Time',
      pct: frt?.scorePct,
      detail: failed
        ? 'Metrics unavailable.'
        : `${t(frt?.seconds)} avg to first live-agent reply vs ${t(cfg?.frtTargetSeconds)} target · score ${frt?.scorePct ?? '—'}% · ${frt?.sample ?? 0} chats · last ${days}d`,
    },
    {
      label: 'ART',
      name: 'Average Response Time',
      pct: art?.scorePct,
      detail: failed
        ? 'Metrics unavailable.'
        : `${t(art?.seconds)} avg live-agent reply vs ${t(cfg?.artTargetSeconds)} target · score ${art?.scorePct ?? '—'}% · ${art?.sample ?? 0} replies · last ${days}d`,
    },
  ];

  // Anchor the floating tooltip to the right edge of the hovered ring. position:fixed
  // so the rail's overflow can't clip it.
  const showTip = (m) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ name: m.name, detail: m.detail, x: r.right + 10, y: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);

  return (
    <div className="msg-metrics" role="group" aria-label="Live-agent response metrics">
      {metrics.map((m) => (
        <Gauge key={m.label} label={m.label} pct={m.pct} onShow={showTip(m)} onHide={hideTip} />
      ))}
      {tip && (
        <div className="msg-metric-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }} role="tooltip">
          <div className="msg-metric-tip__name">{tip.name}</div>
          <div className="msg-metric-tip__detail">{tip.detail}</div>
        </div>
      )}
    </div>
  );
}
