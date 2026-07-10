import { useEffect, useState } from 'react';
import * as analytics from '../../services/analytics.service.js';
import * as surveys from '../../services/surveys.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner } from '../../components/ui.jsx';
import LineChart from '../../components/LineChart.jsx';

const CHART_COLOR = '#1f9be6';

// Per-channel colour + display label. `origin` is stored lower-cased
// (e.g. "messenger"), so match case-insensitively and Title-case it for display.
const CHANNEL_META = {
  messenger: { label: 'Messenger', color: '#1f9be6' },
  instagram: { label: 'Instagram', color: '#c13584' },
  whatsapp: { label: 'WhatsApp', color: '#25d366' },
  telegram: { label: 'Telegram', color: '#f59e0b' },
};
const channelInfo = (origin) => CHANNEL_META[String(origin || '').toLowerCase()] || { label: origin || 'Other', color: '#94a3b8' };

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
};
const fmtLong = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function Delta({ pct }) {
  if (pct == null) return null;
  const cls = pct > 0 ? 'perf-delta--up' : pct < 0 ? 'perf-delta--down' : 'perf-delta--flat';
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  return (
    <span className={`perf-delta ${cls}`}>
      {arrow} {Math.abs(pct)}%
    </span>
  );
}

function InfoIcon({ text }) {
  return (
    <span className="perf-info" title={text} aria-label={text}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// A selectable headline tile (drives the main chart when active).
function MetricTile({ id, title, info, metric, active, onSelect }) {
  return (
    <button type="button" className={`msg-tile ${active ? 'is-active' : ''}`} onClick={() => onSelect(id)} aria-pressed={active}>
      <span className="msg-tile__title">
        {title}
        <InfoIcon text={info} />
      </span>
      <span className="msg-tile__value-row">
        <span className="msg-tile__value">{fmtCompact(metric.total)}</span>
        <Delta pct={metric.changePct} />
      </span>
    </button>
  );
}

// Horizontal channel bars for the New / Returning contacts blocks.
function ChannelBars({ channels }) {
  const max = Math.max(1, ...channels.map((c) => c.value));
  if (!channels.length) return <div className="msg-bars__empty">No channels in this period.</div>;
  return (
    <div className="msg-bars">
      {channels.map((c) => (
        <div className="msg-bar" key={c.origin}>
          <div className="msg-bar__label">{channelInfo(c.origin).label}</div>
          <div className="msg-bar__track">
            <div className="msg-bar__fill" style={{ width: `${Math.max(2, (c.value / max) * 100)}%`, background: channelInfo(c.origin).color }} />
          </div>
          <div className="msg-bar__value">{fmtCompact(c.value)}</div>
        </div>
      ))}
    </div>
  );
}

function NewReturningCard({ title, info, metric }) {
  const hasData = metric.total > 0 || metric.channels.length > 0;
  return (
    <div className="msg-nr">
      <span className="msg-nr__title">
        {title}
        <InfoIcon text={info} />
      </span>
      <span className="msg-nr__value-row">
        <span className="msg-nr__value">{hasData ? fmtCompact(metric.total) : '—'}</span>
        <Delta pct={metric.changePct} />
      </span>
      <ChannelBars channels={metric.channels} />
    </div>
  );
}

// Customer satisfaction surveys card — CSAT + NPS from the post-conversation email
// surveys. DAY-LAGGED by design: the server only reports surveys sent before today
// ("how many went out yesterday"), so nobody can correlate a send with a specific
// customer or a chat they just closed.
function SurveysCard({ range }) {
  const { activeId } = usePages();
  const toast = useToast();

  const { data, loading, error } = useCachedResource(
    activeId ? `surveys:${range}:${activeId}` : `surveys:${range}:none`,
    () => surveys.summary(range),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const nps = data?.nps || { score: null, promoters: 0, passives: 0, detractors: 0, sample: 0 };
  const csat = data?.csat || { avg: null, sample: 0 };
  const npsTotal = nps.promoters + nps.passives + nps.detractors;
  const segPct = (n) => (npsTotal > 0 ? Math.max(2, (n / npsTotal) * 100) : 0);
  const hasAny = (data?.sent ?? 0) > 0;

  return (
    <Card className="msg-insights mt-lg">
      <div className="msg-insights__head">
        <h2 className="msg-insights__title">Customer satisfaction</h2>
        <p className="msg-insights__sub">
          How surveyed customers rate your team&rsquo;s handling — accumulated daily; today&rsquo;s sends appear tomorrow.
        </p>
      </div>

      {loading && !data ? (
        <Spinner label="Loading surveys…" />
      ) : (
        <>
          <div className="svy-tiles">
            <div className="svy-tile">
              <span className="svy-tile__title">
                Surveys sent yesterday
                <InfoIcon text="Surveys emailed to customers yesterday. Who receives one is never disclosed." />
              </span>
              <span className="svy-tile__value">{fmtCompact(data?.sentYesterday ?? 0)}</span>
            </div>
            <div className="svy-tile">
              <span className="svy-tile__title">
                Sent (last {range}d)
                <InfoIcon text="All surveys sent in this period, counted through yesterday." />
              </span>
              <span className="svy-tile__value">{fmtCompact(data?.sent ?? 0)}</span>
              <span className="svy-tile__hint">
                {data?.responded ?? 0} answered{data?.responseRatePct != null ? ` · ${data.responseRatePct}%` : ''}
              </span>
            </div>
            <div className="svy-tile">
              <span className="svy-tile__title">
                Satisfaction (CSAT)
                <InfoIcon text="Average of 'How satisfied are you with how we handled your conversation?' (1–5)." />
              </span>
              <span className="svy-tile__value">{csat.avg != null ? `${csat.avg} / 5` : '—'}</span>
              <span className="svy-tile__hint">{csat.sample} rating{csat.sample === 1 ? '' : 's'}</span>
            </div>
            <div className="svy-tile">
              <span className="svy-tile__title">
                NPS
                <InfoIcon text="% promoters (9–10) minus % detractors (0–6) on 'Would you recommend us?' — from −100 to +100." />
              </span>
              <span className="svy-tile__value">{nps.score != null ? nps.score : '—'}</span>
              <span className="svy-tile__hint">{nps.sample} answer{nps.sample === 1 ? '' : 's'}</span>
            </div>
          </div>

          {npsTotal > 0 && (
            <div className="svy-nps">
              <div className="svy-nps__bar" role="img" aria-label={`${nps.detractors} detractors, ${nps.passives} passives, ${nps.promoters} promoters`}>
                {nps.detractors > 0 && <span className="svy-nps__seg--detractor" style={{ width: `${segPct(nps.detractors)}%` }} />}
                {nps.passives > 0 && <span className="svy-nps__seg--passive" style={{ width: `${segPct(nps.passives)}%` }} />}
                {nps.promoters > 0 && <span className="svy-nps__seg--promoter" style={{ width: `${segPct(nps.promoters)}%` }} />}
              </div>
              <div className="svy-nps__legend">
                <span><span className="svy-nps__dot svy-nps__seg--detractor" />Detractors (0–6) · {nps.detractors}</span>
                <span><span className="svy-nps__dot svy-nps__seg--passive" />Passives (7–8) · {nps.passives}</span>
                <span><span className="svy-nps__dot svy-nps__seg--promoter" />Promoters (9–10) · {nps.promoters}</span>
              </div>
            </div>
          )}

          {(data?.comments || []).length > 0 && (
            <div className="svy-comments">
              <div className="msg-breakdown__title">Latest feedback</div>
              {data.comments.map((c, i) => (
                <div className="svy-comment" key={`${c.day}-${i}`}>
                  <div className="svy-comment__meta">
                    {c.satisfaction != null && <span>CSAT {c.satisfaction}/5</span>}
                    {c.nps != null && <span>NPS {c.nps}/10</span>}
                    <span>{fmtLong(c.day)}</span>
                  </div>
                  <div className="svy-comment__text">{c.comment}</div>
                </div>
              ))}
            </div>
          )}

          {!hasAny && (
            <div className="svy-empty">
              No surveys in this period yet. Enable them per page in Settings → Facebook Pages → Customer surveys;
              they&rsquo;re sent by chance after an agent completes a conversation, when the customer&rsquo;s email is
              known from an order.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function MessagingSection({ range }) {
  const { activeId } = usePages();
  const toast = useToast();
  const [selected, setSelected] = useState('totalContacts');

  const { data, loading, error } = useCachedResource(
    activeId ? `messaging:${range}:${activeId}` : `messaging:${range}:none`,
    () => analytics.messaging(range),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  if (loading && !data) return <Spinner label="Loading contacts…" />;

  const totalContacts = data?.totalContacts || { total: 0, changePct: null, channels: [] };
  const conversationsStarted = data?.conversationsStarted || { total: 0, changePct: null, channels: [] };
  const newContacts = data?.newContacts || { total: 0, changePct: null, channels: [] };
  const returningContacts = data?.returningContacts || { total: 0, changePct: null, channels: [] };

  const activeMetric = selected === 'conversationsStarted' ? conversationsStarted : totalContacts;
  const activeSeries = data?.series?.[selected] || [];
  const rangeText = data ? `${fmtLong(data.sinceDate)} – ${fmtLong(data.untilDate)}` : '';

  return (
    <>
    <Card className="msg-insights">
      <div className="msg-insights__head">
        <h2 className="msg-insights__title">Contacts</h2>
        <p className="msg-insights__sub">Here&rsquo;s everyone who messaged your business.</p>
      </div>

      <div className="msg-tiles">
        <MetricTile
          id="totalContacts"
          title="Total contacts"
          info="People who sent your Page a message in this period."
          metric={totalContacts}
          active={selected === 'totalContacts'}
          onSelect={setSelected}
        />
        <MetricTile
          id="conversationsStarted"
          title="Messaging conversations started"
          info="New message threads opened in this period."
          metric={conversationsStarted}
          active={selected === 'conversationsStarted'}
          onSelect={setSelected}
        />
      </div>

      <div className="msg-main">
        <div className="msg-chart">
          {activeSeries.length ? (
            <LineChart points={activeSeries} color={CHART_COLOR} label={selected === 'conversationsStarted' ? 'Conversations started' : 'Total contacts'} wide />
          ) : (
            <div className="msg-chart__empty">No messaging activity in this period yet.</div>
          )}
        </div>
        <div className="msg-breakdown">
          <div className="msg-breakdown__title">Breakdown by channel</div>
          {rangeText && <div className="msg-breakdown__range">{rangeText}</div>}
          {activeMetric.channels.length ? (
            <ul className="msg-breakdown__list">
              {activeMetric.channels.map((c) => (
                <li className="msg-breakdown__row" key={c.origin}>
                  <span className="msg-breakdown__dot" style={{ background: channelInfo(c.origin).color }} />
                  <span className="msg-breakdown__name">{channelInfo(c.origin).label}</span>
                  <span className="msg-breakdown__num">{fmtCompact(c.value)}</span>
                  <Delta pct={c.changePct} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="msg-breakdown__empty">No channel data yet.</div>
          )}
        </div>
      </div>

      <div className="msg-split">
        <NewReturningCard
          title="New contacts"
          info="People who messaged your Page for the first time ever in this period."
          metric={newContacts}
        />
        <NewReturningCard
          title="Returning contacts"
          info="People who had messaged before and came back in this period."
          metric={returningContacts}
        />
      </div>
    </Card>

    <SurveysCard range={range} />
    </>
  );
}
