import { useNavigate, useSearchParams } from 'react-router-dom';
import ContentComposer from '../../components/ContentComposer.jsx';

const VALID = ['post', 'video', 'reel'];

// The Compose view-state of Contents (/post-pool?view=compose&type=…). Reached from
// the "+ Create" dropdown and the Contents "Create" sub-nav tab.
export default function ComposePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = VALID.includes(params.get('type')) ? params.get('type') : 'post';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Create content</h1>
          <div className="page-head__sub">Post now, or schedule it from the ⋮ menu. Media goes straight to S3.</div>
        </div>
      </div>

      <ContentComposer type={type} onCreated={() => navigate('/post-pool?view=posts')} />
    </>
  );
}
