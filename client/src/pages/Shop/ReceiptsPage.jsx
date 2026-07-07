import { useMemo, useRef, useState } from 'react';
import { usePages } from '../../context/PageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState, Dropdown, Modal } from '../../components/ui.jsx';
import { apiError } from '../../services/api.js';
import * as receipts from '../../services/receipts.service.js';

const ACCEPT = 'image/*,application/pdf';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const fmtSize = (n) => {
  if (!n) return '';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};

export default function ReceiptsPage() {
  const { activeId } = usePages();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);

  const { data, loading, error, refresh } = useCachedResource(
    activeId ? `receipts:${activeId}` : null,
    () => receipts.list(activeId),
  );

  const [uploading, setUploading] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const rows = data || [];

  const ownerOptions = useMemo(() => {
    const seen = new Map();
    for (const r of rows) if (r.createdBy != null && !seen.has(r.createdBy)) seen.set(r.createdBy, r.createdByName || `User ${r.createdBy}`);
    return [{ value: 'all', label: 'All staff' }, ...[...seen].map(([id, name]) => ({ value: String(id), label: name }))];
  }, [rows]);

  const filtered = rows.filter((r) => ownerFilter === 'all' || String(r.createdBy) === ownerFilter);

  const onFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of files) {
      try {
        await receipts.upload(file, { accountId: activeId });
        ok += 1;
      } catch (e) {
        toast.error(`${file.name}: ${apiError(e)}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok) {
      toast.success(`${ok} receipt${ok === 1 ? '' : 's'} uploaded.`);
      await refresh();
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await receipts.remove(toDelete.id);
      toast.success('Receipt deleted.');
      setToDelete(null);
      await refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDeleting(false);
    }
  };

  if (!activeId) {
    return <EmptyState icon="🏬" title="No page selected" message="Choose a connected page to see its receipts." />;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Receipts</h1>
          <div className="page-head__sub">{isAdmin ? 'Receipts uploaded across your team.' : 'Your uploaded receipts (photos & PDFs).'}</div>
        </div>
        <div className="orders-filters">
          {isAdmin && <Dropdown value={ownerFilter} onChange={setOwnerFilter} options={ownerOptions} ariaLabel="Filter by staff" />}
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
          <button type="button" className="btn btn--primary btn--flat" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload receipt'}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <Spinner label="Loading receipts…" />
      ) : error && !data ? (
        <EmptyState icon="⚠️" title="Couldn't load receipts" message={apiError(error)} />
      ) : filtered.length === 0 ? (
        <Card className="card--pad mt-lg">
          <EmptyState icon="🧾" title="No receipts yet" message="Upload a photo or PDF receipt to keep it here. Only you (and admins) can see yours." />
        </Card>
      ) : (
        <div className="receipts-grid mt-lg">
          {filtered.map((r) => (
            <Card key={r.id} className="receipt-card">
              <a className="receipt-card__media" href={r.url || undefined} target="_blank" rel="noopener noreferrer" title="Open">
                {r.isImage && r.url ? (
                  <img src={r.url} alt={r.title || 'receipt'} loading="lazy" />
                ) : (
                  <span className="receipt-card__file" aria-hidden="true">{r.isPdf ? 'PDF' : '📄'}</span>
                )}
              </a>
              <div className="receipt-card__body">
                <div className="receipt-card__title" title={r.title || ''}>{r.title || 'Receipt'}</div>
                <div className="receipt-card__meta">
                  {fmtDate(r.createdAt)}{r.fileSize ? ` · ${fmtSize(r.fileSize)}` : ''}
                  {isAdmin && r.createdByName ? ` · ${r.createdByName}` : ''}
                </div>
                <div className="receipt-card__actions">
                  {r.url && <a className="btn btn--subtle btn--sm" href={r.url} target="_blank" rel="noopener noreferrer">Open</a>}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setToDelete(r)}>Delete</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!toDelete}
        title="Delete receipt?"
        onClose={() => setToDelete(null)}
        footer={
          <>
            <button type="button" className="btn btn--subtle" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn--danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
          </>
        }
      >
        <p>This will permanently remove “{toDelete?.title || 'this receipt'}”. This can't be undone.</p>
      </Modal>
    </>
  );
}
