import { useSearchParams } from 'react-router-dom';
import PostPoolPage from './PostPoolPage.jsx';
import CommentsInboxPage from './CommentsInboxPage.jsx';

// Contents is a single route (/post-pool). The sidebar's "Contents" sub-nav switches
// between Posts & reels and Comments via a ?view= query param (see AppLayout PRIMARY_NAV),
// so there's no in-page tab bar — the active view is driven entirely by the sidebar.
export default function ContentsView() {
  const [params] = useSearchParams();
  return params.get('view') === 'comments' ? <CommentsInboxPage /> : <PostPoolPage />;
}
