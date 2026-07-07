import { useEffect } from 'react';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner } from '../../components/ui.jsx';
import CalendarMonth from '../../components/CalendarMonth.jsx';

export default function ContentCalendarPage() {
  const toast = useToast();
  const { data, loading, error, refresh } = useCachedResource('content-calendar', () =>
    postPool.list({ scheduled: 1 }).then((r) => r.posts),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  // Refresh the calendar's posts and let the dashboard's "scheduled" count refetch.
  const onPostsChanged = () => {
    refresh();
    invalidateCache('dashboard');
  };

  const scheduled = data || [];
  if (loading && !data) return <Spinner label="Loading calendar…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Content Calendar</h1>
          <div className="page-head__sub">Plan posts and notes across the month — open days have no post scheduled yet.</div>
        </div>
      </div>

      <Card className="card--pad calendar-card">
        <CalendarMonth posts={scheduled} onPostsChanged={onPostsChanged} />
      </Card>
    </>
  );
}
