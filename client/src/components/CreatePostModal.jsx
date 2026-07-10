import { Modal } from './ui.jsx';
import ContentComposer from './ContentComposer.jsx';

const fmtDate = (key) => {
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
};

/**
 * "Create Post" dialog opened from a calendar day. Hosts the content composer
 * (type / media / caption) pre-set to schedule on the cell's day. `onCreated`
 * fires after a post is saved.
 */
export default function CreatePostModal({ dateKey, onClose, onCreated }) {
  return (
    <Modal
      open={!!dateKey}
      title={`Create post — ${fmtDate(dateKey)}`}
      onClose={onClose}
      className="modal--wide modal--scrollbody"
    >
      <ContentComposer layout="modal" defaultDate={dateKey} defaultScheduled onCreated={onCreated} />
    </Modal>
  );
}
