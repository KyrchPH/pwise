import { useEffect, useState } from 'react';
import { Modal, Spinner, Dropdown, Button } from './ui.jsx';
import LineChart from './LineChart.jsx';
import * as postPool from '../services/post_pool.service.js';
import { apiError } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { usePages } from '../context/PageContext.jsx';

const METRICS = [
  { key: 'reactions', label: 'Reactions', color: '#e0245e' },
  { key: 'comments', label: 'Comments', color: '#1f9be6' },
  { key: 'shares', label: 'Shares', color: '#2fb457' },
  { key: 'views', label: 'Views', color: '#7c3aed' },
];

const fmtNum = (v) => v.toLocaleString();

// "1.63x"-style growth multiple; only meaningful when the window started > 0.
const fmtGrowth = (first, current) => {
  if (!(first > 0)) return null;
  const g = current / first;
  return `${parseFloat(g >= 10 ? g.toFixed(1) : g.toFixed(2))}x`;
};

/**
 * Stats header (total / gained / growth, like a finance chart) + line chart
 * for one metric's history. Exported separately from the dialog so it can be
 * rendered with ready-made points.
 */
export function InsightsPanel({ points, metric }) {
  const n = points.length;
  const first = points[0].value;
  const current = points[n - 1].value;
  const delta = current - first;
  const growth = fmtGrowth(first, current);

  return (
    <>
      <div className="insights-stats">
        <div className="insights-stat">
          <div className="insights-stat__label">Total {metric.label.toLowerCase()}</div>
          <div className="insights-stat__value">{fmtNum(current)}</div>
        </div>
        <div className="insights-stat">
          <div className="insights-stat__label">Gained</div>
          <div className={`insights-stat__value${n > 1 && delta > 0 ? ' is-up' : ''}${n > 1 && delta < 0 ? ' is-down' : ''}`}>
            {n > 1 ? `${delta > 0 ? '+' : ''}${fmtNum(delta)}` : '—'}
          </div>
        </div>
        <div className="insights-stat">
          <div className="insights-stat__label">Growth</div>
          <div className="insights-stat__value">{(n > 1 && growth) || '—'}</div>
        </div>
      </div>

      <div className="insights__chart">
        <LineChart points={points} color={metric.color} />
      </div>
    </>
  );
}

/**
 * Insights dialog for a single post: a centered popup with a metric filter
 * (reactions/comments/shares/views) and an Hour/Day/Month toggle driving the
 * stats + line chart panel of the post's recorded engagement history. Renders
 * nothing when closed.
 */
export default function InsightsDrawer({ post, open, onClose }) {
  const toast = useToast();
  const { activePage } = usePages();
  const isVideo = post?.media_type === 'video';
  const [metric, setMetric] = useState('reactions');
  const [granularity, setGranularity] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !post) return undefined;
    let active = true;
    setLoading(true);
    postPool
      .insights(post.id, metric, granularity)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((e) => {
        if (active) {
          setData(null);
          toast.error(apiError(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, post, metric, granularity, toast]);

  // Build a professional PDF of this post's insights: pulls the full history for
  // every metric (day granularity), then hands it to the report builder.
  const downloadReport = async () => {
    if (!post || downloading) return;
    setDownloading(true);
    try {
      const metrics = ['reactions', 'comments', 'shares', 'views'].filter((m) => m !== 'views' || isVideo);
      const entries = await Promise.all(
        metrics.map((m) =>
          postPool
            .insights(post.id, m, 'day')
            .then((r) => [m, r.points || []])
            .catch(() => [m, []]),
        ),
      );
      const seriesByMetric = Object.fromEntries(entries);
      const { buildPostInsightsPdf, loadLogo } = await import('../utils/reportPdf.js');
      const logo = await loadLogo();
      const doc = buildPostInsightsPdf({ post, seriesByMetric, pageName: activePage?.account_name || null, logo });
      doc.save(`post-${post.id}-insights.pdf`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDownloading(false);
    }
  };

  const points = data?.points ?? [];
  const activeMetric = METRICS.find((m) => m.key === metric) || METRICS[0];

  return (
    <Modal
      open={open && !!post}
      onClose={onClose}
      className="modal--insights"
      title={post ? <>Insights <span className="text-muted">· #{post.id}</span></> : 'Insights'}
      headerActions={
        <Dropdown
          ariaLabel="Chart options"
          sections={[
            {
              label: 'Metric',
              value: metric,
              onChange: setMetric,
              options: METRICS.map((m) => ({ value: m.key, label: m.label, disabled: m.key === 'views' && !isVideo })),
            },
            {
              label: 'Granularity',
              value: granularity,
              onChange: setGranularity,
              options: [
                { value: 'hour', label: 'Hour' },
                { value: 'day', label: 'Day' },
                { value: 'month', label: 'Month' },
              ],
            },
          ]}
        />
      }
      footer={
        <Button onClick={downloadReport} disabled={downloading} className="btn--flat">
          {downloading ? 'Preparing…' : 'Download PDF report'}
        </Button>
      }
    >
      <div className="insights">
        <div className="insights__body">
          {loading ? (
            <div className="insights__placeholder">
              <Spinner label="Loading insights…" />
            </div>
          ) : points.length === 0 ? (
            <div className="insights__placeholder">
              <div className="insights-empty">
                <div className="insights-empty__title">No history yet</div>
                <div className="insights-empty__msg">
                  Insights are recorded each time the app pulls fresh numbers from Facebook (when you view the post
                  pool or open this dialog). A line will appear once there are a couple of days of data.
                </div>
              </div>
            </div>
          ) : (
            <InsightsPanel points={points} metric={activeMetric} />
          )}
        </div>
      </div>
    </Modal>
  );
}
