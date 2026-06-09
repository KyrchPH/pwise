import { Modal } from './ui.jsx';
import UploadPostForm from './UploadPostForm.jsx';

const fmtDate = (key) => {
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
};

/**
 * "Create Post" dialog opened from a calendar day. Hosts the full Upload form
 * (media / template / caption / schedule) with the schedule date pre-set to the
 * cell's day. `onCreated` fires after a post is saved.
 */
export default function CreatePostModal({ dateKey, onClose, onCreated }) {
  return (
    <Modal
      open={!!dateKey}
      title={`Create post — ${fmtDate(dateKey)}`}
      onClose={onClose}
      className="modal--wide modal--scrollbody"
    >
      <UploadPostForm defaultDate={dateKey} embedded onCreated={onCreated} />
    </Modal>
  );
}
