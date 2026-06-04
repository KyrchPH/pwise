import { useEffect, useState } from 'react';
import { Modal, Spinner, Dropdown } from './ui.jsx';
import LineChart from './LineChart.jsx';
import * as postPool from '../services/post_pool.service.js';
import { apiError } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

const METRICS = [
  { key: 'reactions', label: 'Reactions', color: '#e0245e' },
  { key: 'comments', label: 'Comments', color: '#1f9be6' },
  { key: 'shares', label: 'Shares', color: '#2fb457' },
  { key: 'views', label: 'Views', color: '#7c3aed' },
];

const latest = (points) => (points.length ? points[points.length - 1].value : null);

/**
 * Insights dialog for a single post: a centered popup with a metric filter
 * (reactions/comments/shares/views) and a Day/Month toggle driving a line chart
 * of the post's recorded engagement history. Renders nothing when closed.
 */
export default function InsightsDrawer({ post, open, onClose }) {
  const toast = useToast();
  const isVideo = post?.media_type === 'video';
  const [metric, setMetric] = useState('reactions');
  const [granularity, setGranularity] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

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

  const points = data?.points ?? [];
  const activeMetric = METRICS.find((m) => m.key === metric) || METRICS[0];
  const current = latest(points);

  return (
    <Modal
      open={open && !!post}
      onClose={onClose}
      className="modal--insights"
      title={post ? <>Insights <span className="text-muted">· #{post.id}</span></> : 'Insights'}
    >
      <div className="insights">
        <div className="insights__toolbar">
          <Dropdown
            ariaLabel="Metric"
            value={metric}
            onChange={setMetric}
            options={METRICS.map((m) => ({ value: m.key, label: m.label, disabled: m.key === 'views' && !isVideo }))}
          />
          <Dropdown
            ariaLabel="Granularity"
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: 'hour', label: 'Hour' },
              { value: 'day', label: 'Day' },
              { value: 'month', label: 'Month' },
            ]}
          />
        </div>

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
            <>
              <div className="insights-summary">
                <span className="insights-summary__dot" style={{ background: activeMetric.color }} />
                <strong>{current ?? '—'}</strong>
                <span className="text-muted">
                  {activeMetric.label.toLowerCase()} · latest of {points.length}{' '}
                  {granularity === 'hour' ? 'hour' : granularity === 'month' ? 'month' : 'day'}
                  {points.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="insights__chart">
                <LineChart points={points} color={activeMetric.color} />
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
