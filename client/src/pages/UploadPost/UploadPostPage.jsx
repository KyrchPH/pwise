import { useNavigate } from 'react-router-dom';
import UploadPostForm from '../../components/UploadPostForm.jsx';

export default function UploadPostPage() {
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Upload Post</h1>
          <div className="page-head__sub">Add content to the pool. Media goes straight to S3.</div>
        </div>
      </div>

      <UploadPostForm showPreview onCreated={() => navigate('/post-pool')} />
    </>
  );
}
