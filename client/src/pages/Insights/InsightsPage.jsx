import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as analytics from '../../services/analytics.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState } from '../../components/ui.jsx';
import LineChart from '../../components/LineChart.jsx';
import MessagingSection from './MessagingSection.jsx';
import OverviewSection from './OverviewSection.jsx';
import ContentsSection from './ContentsSection.jsx';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 28, label: '28 days' },
  { days: 90, label: '90 days' },
];
const INSIGHT_SECTIONS = {
  overview: 'Overview',
  performance: 'Performance',
  messaging: 'Messaging',
  contents: 'Contents',
};
const CHART_COLOR = '#1f9be6';

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
};
const fmtDuration = (ms) => {
  const mins = Math.round((Number(ms) || 0) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtLong = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const subDaysIso = (iso, n) => new Date(new Date(`${iso}T00:00:00`).getTime() - n * 86400 * 1000).toISOString().slice(0, 10);

function cardValue(card) {
  if (!card.available || card.total == null) return 'n/a';
  if (card.format === 'duration') return fmtDuration(card.total);
  if (card.format === 'percent') return `${card.total}%`;
  return fmtCompact(card.total);
}

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

function RangeSeg({ range, onChange }) {
  return (
    <div className="seg">
      {RANGES.map((r) => (
        <button
          key={r.days}
          type="button"
          className={`seg__btn ${range === r.days ? 'is-active' : ''}`}
          onClick={() => onChange(r.days)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function InfoIcon({ text }) {
  return (
    <span className="perf-info" title={text} aria-label={text}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// Export control: a small menu that downloads a professional, detailed PDF report of the
// card's data (description, headline stats, daily-trend chart, and day-by-day table).
function ExportMenu({ card, range, meta }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const disabled = !card.available || !(card.series || []).length;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const downloadPdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Lazy-load the PDF builder (jsPDF) so it stays out of the main bundle, matching
      // how the other analytics exports import it.
      const { buildMetricCardPdf, loadLogo } = await import('../../utils/reportPdf.js');
      const logo = await loadLogo();
      const doc = buildMetricCardPdf({
        card,
        rangeDays: range,
        pageName: meta?.pageName || null,
        sinceDate: meta?.sinceDate || null,
        untilDate: meta?.untilDate || null,
        logo,
      });
      doc.save(`${card.key}-${range}d-report.pdf`);
      setOpen(false);
    } catch {
      toast.error('Could not generate the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="perf-export" ref={ref}>
      <button type="button" className="perf-export__btn" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="perf-export__menu" role="menu">
          <button type="button" className="perf-export__item" role="menuitem" onClick={downloadPdf} disabled={busy}>
            {busy ? 'Preparing…' : 'Download PDF report'}
          </button>
        </div>
      )}
    </div>
  );
}

// Page-level export: one detailed PDF covering every Performance card — headline
// stats, an all-metrics summary table, daily-trend charts and a combined
// day-by-day breakdown. Sits in the page head next to the range selector.
function DownloadReportButton({ cards, range, meta }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const disabled = busy || !cards.some((c) => c.available);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Lazy-load the PDF builder (jsPDF) so it stays out of the main bundle.
      const { buildPerformanceReportPdf, loadLogo } = await import('../../utils/reportPdf.js');
      const logo = await loadLogo();
      const doc = buildPerformanceReportPdf({
        cards,
        rangeDays: range,
        pageName: meta?.pageName || null,
        from: meta?.untilDate ? subDaysIso(meta.untilDate, range - 1) : null,
        to: meta?.untilDate || null,
        logo,
      });
      doc.save(`performance-${range}d-report.pdf`);
    } catch {
      toast.error('Could not generate the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="perf-report-btn" onClick={download} disabled={disabled}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? 'Preparing…' : 'Download report'}
    </button>
  );
}

function AllPagesReportButton({ range }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [report, pdf] = await Promise.all([
        analytics.allPagesMetrics(range),
        import('../../utils/reportPdf.js'),
      ]);
      const logo = await pdf.loadLogo();
      const doc = pdf.buildAllPagesMetricsPdf({ ...report, logo });
      doc.save(`all-pages-metrics-${report.sinceDate}_to_${report.untilDate}.pdf`);
    } catch (e) {
      toast.error(`Could not generate all-pages report: ${apiError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="perf-report-btn perf-report-btn--secondary" onClick={download} disabled={busy}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? 'Preparing...' : 'All pages PDF'}
    </button>
  );
}

function MetricCard({ card, range, meta }) {
  const hasChart = card.available && (card.series || []).length >= 2;
  const showValue = card.available && card.total != null; // hide the "n/a" headline entirely
  return (
    <Card className="perf-card">
      <div className="perf-card__head">
        <div className="perf-card__titlewrap">
          <span className="perf-card__title">{card.title}</span>
          {card.info && <InfoIcon text={card.info} />}
        </div>
        <ExportMenu card={card} range={range} meta={meta} />
      </div>
      <div className="perf-card__value-row">
        {showValue && <span className="perf-card__value">{cardValue(card)}</span>}
        <Delta pct={card.changePct} />
      </div>
      <div className="perf-card__chart">
        {hasChart ? (
          <LineChart points={card.series} color={CHART_COLOR} label={card.title} />
        ) : (
          <div className="perf-card__nochart">{card.available ? 'No daily trend for this period.' : 'No Available Data'}</div>
        )}
      </div>
      <div className="perf-card__legend">
        <span className="perf-card__legend-swatch" />
        {card.title}
      </div>
    </Card>
  );
}

export default function InsightsPage() {
  const { activeId } = usePages();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState(28);
  const view = searchParams.get('view') || 'overview';
  const activeView = INSIGHT_SECTIONS[view] ? view : 'overview';
  const activeTitle = INSIGHT_SECTIONS[activeView];

  // Overview, Messaging and Contents fetch their own data sources, so skip the Performance
  // fetch there (a null key makes the hook a no-op — no wasted request, no wrong spinner).
  const selfFetching = activeView === 'overview' || activeView === 'messaging' || activeView === 'contents';
  const insightsKey = selfFetching ? null : activeId ? `insights:${range}:${activeId}` : `insights:${range}:none`;
  const { data, loading, error } = useCachedResource(insightsKey, () => analytics.insights(range));

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  if (!activeId) {
    return <EmptyState icon="📈" title="No page selected" message="Choose a connected page to see its performance." />;
  }

  // Overview — a digest of the other tabs, with its own data source.
  if (activeView === 'overview') {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">Overview</h1>
            <div className="page-head__sub">A snapshot of your Page&rsquo;s reach, audience and messaging.</div>
          </div>
          <div className="perf-head-actions">
            <AllPagesReportButton range={range} />
            <RangeSeg range={range} onChange={setRange} />
          </div>
        </div>
        <OverviewSection range={range} />
      </>
    );
  }

  // Messaging ("Contacts") — its own layout and data source.
  if (activeView === 'messaging') {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">Messaging</h1>
            <div className="page-head__sub">Who&rsquo;s messaging your Page, and how that&rsquo;s trending.</div>
          </div>
          <div className="perf-head-actions">
            <AllPagesReportButton range={range} />
            <RangeSeg range={range} onChange={setRange} />
          </div>
        </div>
        <MessagingSection range={range} />
      </>
    );
  }

  // Contents — a performance table of every post published in this period.
  if (activeView === 'contents') {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">Contents</h1>
            <div className="page-head__sub">How each post you published is performing.</div>
          </div>
          <div className="perf-head-actions">
            <AllPagesReportButton range={range} />
            <RangeSeg range={range} onChange={setRange} />
          </div>
        </div>
        <ContentsSection range={range} />
      </>
    );
  }

  if (loading && !data) return <Spinner label="Loading performance…" />;

  const cards = data?.cards || [];
  if (activeView !== 'performance') {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">{activeTitle}</h1>
            <div className="page-head__sub">
              {data?.pageName ? `${data.pageName} · ` : ''}
              {activeTitle} insights
            </div>
          </div>
        </div>
        <Card>
          <EmptyState
            icon="📈"
            title={`${activeTitle} insights`}
            message="This section is ready for its dedicated metrics."
          />
        </Card>
      </>
    );
  }
  const rangeText = data?.untilDate ? `${fmtLong(subDaysIso(data.untilDate, range - 1))} – ${fmtLong(data.untilDate)}` : '';
  const cardMeta = { pageName: data?.pageName, sinceDate: data?.sinceDate, untilDate: data?.untilDate };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Performance</h1>
          <div className="page-head__sub">
            {data?.pageName ? `${data.pageName} · ` : ''}
            {rangeText || 'Your page performance vs the previous period.'}
          </div>
        </div>
        <div className="perf-head-actions">
          <AllPagesReportButton range={range} />
          <DownloadReportButton cards={cards} range={range} meta={cardMeta} />
          <RangeSeg range={range} onChange={setRange} />
        </div>
      </div>

      <div className="perf-grid mt-lg">
        {cards.map((card) => (
          <MetricCard key={card.key} card={card} range={range} meta={cardMeta} />
        ))}
      </div>
    </>
  );
}
