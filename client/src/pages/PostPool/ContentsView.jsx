import { useSearchParams } from 'react-router-dom';
import ContentsOverviewPage from './ContentsOverviewPage.jsx';
import PostPoolPage from './PostPoolPage.jsx';
import CommentsInboxPage from './CommentsInboxPage.jsx';
import StoriesPage from './StoriesPage.jsx';
import ComposePage from './ComposePage.jsx';

// Contents is a single route (/post-pool). The sidebar's "Contents" sub-nav switches
// between Overview, Posts & reels, Stories, Comments, and Create via a ?view= query
// param (see AppLayout PRIMARY_NAV), so there's no in-page tab bar — the active view
// is driven entirely by the sidebar (and the "+ Create" dropdown).
export default function ContentsView() {
  const [params] = useSearchParams();
  const view = params.get('view');
  if (view === 'compose') return <ComposePage />;
  if (view === 'comments') return <CommentsInboxPage />;
  if (view === 'stories') return <StoriesPage />;
  if (view === 'posts' || view === 'contents') return <PostPoolPage />;
  return <ContentsOverviewPage />;
}
