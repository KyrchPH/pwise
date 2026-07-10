import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as stories from '../../services/stories.service.js';
import * as upload from '../../services/upload.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { Button, Card, Spinner, StatusBadge, EmptyState, Modal, MediaThumb, ProgressBar } from '../../components/ui.jsx';
import MediaDropzone from '../../components/MediaDropzone.jsx';

const PAGE_SIZE = 18;

// Relative "time ago" for when a story went out (same voice as the posts grid).
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// "expires in 5h" / "expires in 40m" — how long a live story remains visible.
function expiresIn(iso) {
  if (!iso) return null;
  const left = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(left) || left <= 0) return null;
  const mins = Math.ceil(left / 60000);
  if (mins < 60) return `expires in ${mins}m`;
  return `expires in ${Math.round(mins / 60)}h`;
}

const isExpired = (story) =>
  story.status === 'posted' && story.expires_at && new Date(story.expires_at).getTime() <= Date.now();

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram' };

function PlatformChip({ platform }) {
  return <span className={`story-card__platform story-card__platform--${platform}`}>{PLATFORM_LABELS[platform] || platform}</span>;
}

function PlatformLogo({ platform }) {
  const key = String(platform || '').toLowerCase();
  const label = PLATFORM_LABELS[key] || platform || 'Platform';

  if (key === 'facebook') {
    return (
      <span className="story-card__platform-logo" title={label} aria-label={label}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#1877F2" />
          <path
            d="M15.5 12.5l.4-2.6h-2.5V8.2c0-.7.35-1.4 1.45-1.4h1.15V4.6s-1.05-.18-2.05-.18c-2.1 0-3.45 1.27-3.45 3.56v2.02H8.2v2.6h2.25V19h2.95v-6.5z"
            fill="#fff"
          />
        </svg>
      </span>
    );
  }

  if (key === 'instagram') {
    return (
      <span className="story-card__platform-logo story-card__platform-logo--instagram" title={label} aria-label={label}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="5" y="5" width="14" height="14" rx="4" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="16.5" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }

  return (
    <span className="story-card__platform-logo story-card__platform-logo--unknown" title={label} aria-label={label}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

// Pressing the media opens the full story view page (media + insights). Video
// plays there, large and with controls — no inline preview player here.
function StoryMedia({ story, onOpen }) {
  return (
    <button type="button" className="story-card__open" onClick={onOpen} aria-label={`View story #${story.id}`}>
      <MediaThumb
        mediaUrl={story.media_preview_url}
        mediaType={story.media_type}
        thumbnailUrl={story.thumbnail_preview_url}
      >
        <span className="story-card__open-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          View insights
        </span>
      </MediaThumb>
    </button>
  );
}

export default function StoriesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { activePage } = usePages();
  const [page, setPage] = useState(1);
  const [composerOpen, setComposerOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  const { data, loading, error, refresh } = useCachedResource(`stories:list:p${page}`, () =>
    stories.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  );
  const items = data?.stories ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Publishing is asynchronous — while any story on this page is still 'posting',
  // re-poll so it flips to posted/failed without a manual reload.
  const hasPosting = items.some((s) => s.status === 'posting');
  useEffect(() => {
    if (!hasPosting) return undefined;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [hasPosting, refresh]);

  const reload = () => {
    invalidateCache('stories');
    refresh();
  };

  const retryStory = async (story) => {
    if (retryingId) return; // one at a time; guards double-clicks
    setRetryingId(story.id);
    try {
      await stories.retry(story.id);
      toast.success('Retrying — publishing the story now');
      reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setRetryingId(null);
    }
  };

  const confirmDelete = async () => {
    if (deletingBusy) return;
    setDeletingBusy(true);
    try {
      await stories.remove(deleting.id);
      toast.success('Story deleted');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <>
      <div className="page-head contents-head">
        <div>
          <h1 className="page-head__title">Stories</h1>
          <div className="page-head__sub">24-hour stories published to Facebook and Instagram.</div>
        </div>
        <div className="row contents-head__actions">
          <Button className="btn--flat" onClick={() => setComposerOpen(true)}>+ Post story</Button>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading stories…" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="📖"
            title="No stories yet"
            message="Post your first story — it goes out immediately and stays visible for 24 hours."
            action={<Button className="btn--flat" onClick={() => setComposerOpen(true)}>Post a story</Button>}
          />
        </Card>
      ) : (
        <div className="story-grid">
          {items.map((story) => {
            const expired = isExpired(story);
            const countdown = !expired && story.status === 'posted' ? expiresIn(story.expires_at) : null;
            const storyTime =
              story.status === 'posted'
                ? timeAgo(story.posted_at)
                : story.status === 'posting'
                  ? 'publishing...'
                  : timeAgo(story.created_at);
            return (
              <div
                key={story.id}
                className={`story-card${expired ? ' story-card--expired' : ''}`}
              >
                <div className="story-card__head">
                  <PlatformLogo platform={story.platform} />
                  <PlatformChip platform={story.platform} />
                  <StatusBadge status={expired ? 'expired' : story.status} />
                </div>
                <div className="story-card__thumb">
                  <StoryMedia story={story} onOpen={() => navigate(`/stories/${story.id}`)} />
                </div>
                {story.status === 'failed' && story.failed_reason && (
                  <div className="story-card__error" title={story.failed_reason}>
                    {story.failed_reason}
                  </div>
                )}
                <div className="story-card__foot">
                  <span className="story-card__time" title={story.posted_at || story.created_at || ''}>
                    <span className="story-card__time-main">{storyTime}</span>
                    {countdown && <span className="story-card__time-sub">{countdown}</span>}
                  </span>
                  <span className="story-card__actions">
                    {story.status === 'failed' && (
                      <Button size="sm" variant="ghost" onClick={() => retryStory(story)} disabled={retryingId != null}>
                        {retryingId === story.id ? 'Retrying…' : 'Retry'}
                      </Button>
                    )}
                    <Button
                      className="story-card__icon-btn"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(story)}
                      aria-label="Delete story"
                      title="Delete story"
                    >
                      <TrashIcon />
                    </Button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ← Prev
          </Button>
          <span className="pagination__info">
            Page {page} of {totalPages}
          </span>
          <Button variant="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next →
          </Button>
        </div>
      )}

      <StoryComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        activePage={activePage}
        onCreated={() => {
          setComposerOpen(false);
          setPage(1);
          reload();
        }}
      />

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        title="Delete story"
        onClose={() => setDeleting(null)}
        dismissable={!deletingBusy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deletingBusy}>
              {deletingBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        {deleting?.platform === 'facebook' && deleting?.status === 'posted' && !isExpired(deleting) ? (
          <>Delete story <strong>#{deleting?.id}</strong>? It will also be removed from Facebook.</>
        ) : deleting?.platform === 'instagram' && deleting?.status === 'posted' && !isExpired(deleting) ? (
          <>
            Delete story <strong>#{deleting?.id}</strong> from this list? Instagram doesn't allow deleting a live story
            through the API — it stays visible there until it expires.
          </>
        ) : (
          <>Delete story <strong>#{deleting?.id}</strong>? This can't be undone.</>
        )}
      </Modal>
    </>
  );
}

// "Post story" dialog: pick media, pick destination platform(s), publish now.
function StoryComposer({ open, onClose, activePage, onCreated }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(null);
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: false });
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null); // 'uploading' | 'saving'
  const [progress, setProgress] = useState(0);

  const hasInstagram = !!activePage?.instagram_account_id;
  const isVideo = !!file?.type?.startsWith('video');

  // Reset per open so a reopened dialog doesn't carry the previous story.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setVideoDuration(null);
    setPlatforms({ facebook: true, instagram: false });
    setPhase(null);
    setProgress(0);
  }, [open]);

  // Read a picked video's duration (metadata only) for the soft length warning.
  useEffect(() => {
    if (!file || !file.type.startsWith('video/')) {
      setVideoDuration(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => setVideoDuration(v.duration);
    v.onerror = () => setVideoDuration(null);
    v.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = (f) => {
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) {
      toast.error('Please choose an image or video file');
      return;
    }
    setFile(f);
  };

  const togglePlatform = (key) => setPlatforms((p) => ({ ...p, [key]: !p[key] }));

  const durationWarning =
    isVideo && videoDuration != null && (videoDuration < 3 || videoDuration > 60)
      ? `This video is ${Math.round(videoDuration)}s — stories accept 3–60 seconds, so Meta may reject it.`
      : null;
  const jpegWarning =
    platforms.instagram && file && file.type.startsWith('image/') && file.type !== 'image/jpeg'
      ? 'Instagram stories require JPEG images — this file may be rejected there.'
      : null;

  const submit = async (e) => {
    e.preventDefault();
    const targets = Object.keys(platforms).filter((k) => platforms[k]);
    if (!file) {
      toast.error('Choose an image or video for the story');
      return;
    }
    if (!targets.length) {
      toast.error('Pick at least one platform');
      return;
    }

    setBusy(true);
    setProgress(0);
    try {
      setPhase('uploading');
      const pres = await upload.getPresignedUrl(file.name, file.type);
      await upload.uploadToS3(pres.uploadUrl, file, setProgress);

      // Optimized still for the grid — best-effort, the story publishes regardless.
      let thumbnail_s3_key = null;
      try {
        const thumb = await upload.uploadThumbnail(file);
        if (thumb) thumbnail_s3_key = thumb.s3Key;
      } catch {
        /* a story without a thumbnail still works */
      }

      setPhase('saving');
      await stories.create({
        s3_key: pres.s3Key,
        thumbnail_s3_key,
        media_type: isVideo ? 'video' : 'image',
        platforms: targets,
      });
      toast.success(`Publishing the story to ${targets.map((t) => PLATFORM_LABELS[t]).join(' and ')}`);
      onCreated?.();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
      setPhase(null);
      setProgress(0);
    }
  };

  return (
    <Modal
      open={open}
      title="Post a story"
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="btn--flat" onClick={submit} disabled={busy || !file}>
            {busy ? (phase === 'uploading' ? 'Uploading…' : 'Publishing…') : 'Post story'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <MediaDropzone file={file} onFile={handleFile} />
        <div className="field" style={{ marginTop: 14 }}>
          <span className="field__label">Post to</span>
          <label className="story-composer__platform">
            <input type="checkbox" checked={platforms.facebook} onChange={() => togglePlatform('facebook')} disabled={busy} />
            <span>Facebook — {activePage?.account_name || 'your Page'}</span>
          </label>
          <label className={`story-composer__platform${hasInstagram ? '' : ' is-disabled'}`}>
            <input
              type="checkbox"
              checked={platforms.instagram}
              onChange={() => togglePlatform('instagram')}
              disabled={busy || !hasInstagram}
            />
            <span>
              Instagram
              {hasInstagram
                ? ` — @${activePage?.instagram_username || activePage?.instagram_account_id}`
                : ' — no Instagram account linked to this page'}
            </span>
          </label>
          <span className="field__hint">
            Stories publish immediately, are vertical (9:16 works best), and disappear after 24 hours. No caption,
            links, or stickers — the API posts the bare media.
          </span>
        </div>
        {durationWarning && <div className="story-composer__warning">{durationWarning}</div>}
        {jpegWarning && <div className="story-composer__warning">{jpegWarning}</div>}
        {busy && phase === 'uploading' && <ProgressBar value={progress} />}
      </form>
    </Modal>
  );
}
