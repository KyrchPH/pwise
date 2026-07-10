import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as upload from '../services/upload.service.js';
import * as postPool from '../services/post_pool.service.js';
import * as creatomate from '../services/creatomate.service.js';
import { apiError } from '../services/api.js';
import env from '../config/env.js';
import { invalidateCache, useCachedResource } from '../hooks/useCachedResource.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Modal, Toggle, TimeSelect, ProgressBar, Dropdown, Spinner } from './ui.jsx';
import MediaDropzone from './MediaDropzone.jsx';
import { readVideoMetadata } from '../services/thumbnail.service.js';
import { useActiveRender } from '../context/ActiveRenderContext.jsx';

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => dateStr(new Date());

// The three content kinds the composer produces (post_kind). A "post" is text or a
// photo (media optional); "video" and "reel" both need a video, and a reel must
// also clear the vertical/length gate below before it can publish.
const TYPES = [
  { key: 'post', label: 'Post' },
  { key: 'video', label: 'Video' },
  { key: 'reel', label: 'Reel' },
];
const TYPE_META = {
  post: { accept: 'image/*', requiresVideo: false, mediaLabel: 'Photo', sub: 'Text or a photo — media is optional.' },
  video: { accept: 'video/*', requiresVideo: true, mediaLabel: 'Video', sub: 'A feed video — media is required.' },
  reel: { accept: 'video/*', requiresVideo: true, mediaLabel: 'Reel video', sub: 'A vertical short video (3–90s) — media is required.' },
};

// Facebook Reel eligibility. Meta tweaks these over time, so they're intentionally
// simple constants — re-check the /video_reels spec if reels start getting rejected.
const REEL_MIN_S = 3;
const REEL_MAX_S = 90;
// Given decoded video metadata, decide whether it can publish as a Reel. `ok:false`
// hard-blocks (length / orientation); `ok:true` + a warning is a soft heads-up.
function reelEligibility(meta) {
  if (!meta || meta.duration == null) return { ok: true, warning: null }; // not decoded yet — don't block prematurely
  if (meta.duration < REEL_MIN_S) return { ok: false, warning: `This video is ${Math.round(meta.duration)}s — Reels must be at least ${REEL_MIN_S}s.` };
  if (meta.duration > REEL_MAX_S) return { ok: false, warning: `This video is ${Math.round(meta.duration)}s — Reels can be at most ${REEL_MAX_S}s.` };
  if (meta.width && meta.height && meta.height <= meta.width) return { ok: false, warning: 'Reels must be a vertical (portrait) video.' };
  const ratio = meta.width && meta.height ? meta.width / meta.height : null;
  if (ratio != null && (ratio < 0.5 || ratio > 0.62)) return { ok: true, warning: 'Reels look best at a 9:16 ratio — this one may be cropped.' };
  return { ok: true, warning: null };
}

// Default schedule: today + the next :00/:30 slot after now (rolls to tomorrow if
// it's past 23:30).
function nextSlot() {
  const d = new Date();
  if (d.getMinutes() < 30) d.setMinutes(30, 0, 0);
  else d.setHours(d.getHours() + 1, 0, 0, 0);
  return { date: dateStr(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

const Icon = ({ children, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const ImageIcon = () => (
  <Icon><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="M21 15l-4.5-4.5L5 21" /></Icon>
);
const FilmIcon = () => (
  <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></Icon>
);
const KebabIcon = () => (
  <Icon><circle cx="12" cy="5" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="19" r="1.4" fill="currentColor" /></Icon>
);
const CloseIcon = () => (
  <Icon size={14}><path d="M18 6 6 18M6 6l12 12" /></Icon>
);

/**
 * Type-driven content composer, shared by the Compose view (layout="page") and the
 * calendar's Create-Post dialog (layout="modal"). Media lives behind a popup opened
 * by the media chip; scheduling lives behind the ⋮ menu (default is "Post now").
 *
 * Props:
 * - `type` ('post' | 'video' | 'reel'): initial content kind. Media is required for
 *   video/reel; a reel must also pass the eligibility gate.
 * - `lockType`: hide the Post/Video/Reel switcher (kind is fixed).
 * - `layout`: 'page' (standalone) | 'modal' (embedded in a dialog).
 * - `defaultDate` ('YYYY-MM-DD'): pre-fills the schedule date.
 * - `defaultScheduled`: start in "schedule" mode (the calendar does this).
 * - `onCreated(post)`: called after a post is saved.
 */
export default function ContentComposer({
  type: initialType = 'post',
  lockType = false,
  layout = 'page',
  defaultDate = null,
  defaultScheduled = false,
  onCreated,
}) {
  const toast = useToast();
  const activeRender = useActiveRender();

  const [type, setType] = useState(TYPES.some((t) => t.key === initialType) ? initialType : 'post');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null); // { duration, width, height } for a picked video
  const [caption, setCaption] = useState('');
  const [mediaOpen, setMediaOpen] = useState(false); // media popup
  const [menuOpen, setMenuOpen] = useState(false); // ⋮ schedule menu
  const [scheduled, setScheduled] = useState(defaultScheduled);
  const [schedule, setSchedule] = useState(() =>
    defaultDate ? { date: defaultDate, time: nextSlot().time } : nextSlot(),
  );
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null); // 'preparing' | 'uploading' | 'ingesting' | 'saving' | 'thumbnail'
  const [progress, setProgress] = useState(0);
  const [errorDialog, setErrorDialog] = useState(null);
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [templateVideo, setTemplateVideo] = useState(null);
  const [templateImage, setTemplateImage] = useState(null);
  const [templateText, setTemplateText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState(null);
  const [genProgress, setGenProgress] = useState(0);
  const [renderModal, setRenderModal] = useState(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
  const [templateVideoKey, setTemplateVideoKey] = useState(null);

  const menuRef = useRef(null);
  const meta = TYPE_META[type];
  const isVideoKind = type === 'video' || type === 'reel';

  // ── Active render (Creatomate) reflection — restore selection + open the accept
  // dialog when a render finishes, even if it finished on another page.
  const activeStatus = activeRender.render?.status;
  const activeUrl = activeRender.render?.url;
  const activeTemplateId = activeRender.render?.templateId;
  useEffect(() => {
    if (!activeStatus) return;
    setUseTemplate(true);
    if (activeTemplateId) setTemplateId(String(activeTemplateId));
    if (activeStatus === 'accepted' && activeUrl) setGeneratedVideoUrl(activeUrl);
    else if (activeStatus === 'ready' && activeUrl) setRenderModal({ url: activeUrl });
  }, [activeStatus, activeUrl, activeTemplateId]);

  const { data: templates = [], loading: tplLoading } = useCachedResource(
    useTemplate ? 'creatomate-templates' : null,
    creatomate.list,
  );
  const templateOptions = templates.map((t) => ({ value: String(t.id), label: t.name }));
  const selectedTemplate = templates.find((t) => String(t.id) === templateId) || null;
  useEffect(() => {
    if (useTemplate && templates.length && !templateId) setTemplateId(String(templates[0].id));
  }, [useTemplate, templates, templateId]);

  // Templates only apply to video/reel; switching to a plain post drops the flow.
  useEffect(() => {
    if (type === 'post' && useTemplate) setUseTemplate(false);
  }, [type, useTemplate]);

  // Close the ⋮ menu on outside press / Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Decode a picked video's metadata for the reel eligibility gate.
  useEffect(() => {
    if (!file || !file.type.startsWith('video/')) {
      setVideoMeta(null);
      return undefined;
    }
    let alive = true;
    readVideoMetadata(file).then((m) => {
      if (alive) setVideoMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [file]);

  const clearMedia = () => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setVideoMeta(null);
  };

  const fileMatchesType = (f, t) => (t === 'post' ? f.type.startsWith('image/') : f.type.startsWith('video/'));

  // Switching kind invalidates a mismatched file (a photo under Video, etc.).
  useEffect(() => {
    if (file && !fileMatchesType(file, type)) clearMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const handleFile = useCallback(
    (f) => {
      if (!f) return;
      if (!fileMatchesType(f, type)) {
        toast.error(type === 'post' ? 'Choose an image (or leave media empty for a text post).' : 'Choose a video file.');
        return;
      }
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });
      setFile(f);
    },
    [toast, type],
  );

  const handleTemplateVideo = (f) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      toast.error('Please choose a video file');
      return;
    }
    setTemplateVideo(f);
    setGeneratedVideoUrl(null);
    activeRender.clear();
  };
  const handleTemplateImage = (f) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setTemplateImage(f);
    setGeneratedVideoUrl(null);
    activeRender.clear();
  };

  const onSelectTemplate = (v) => {
    setTemplateId(v);
    setGeneratedVideoUrl(null);
    activeRender.clear();
  };

  const generate = async () => {
    if (!templateId) return toast.error('Pick a template first');
    if (!templateVideo) return toast.error('Choose an input video');
    setGenerating(true);
    setGenProgress(0);
    activeRender.clearError();
    activeRender.beginUpload();
    try {
      setGenPhase('uploading');
      const pres = await upload.getPresignedUrl(templateVideo.name, templateVideo.type, { temporary: true });
      await upload.uploadToS3(pres.uploadUrl, templateVideo, (p) => {
        setGenProgress(p);
        activeRender.setUploadProgress(p);
      });
      setTemplateVideoKey(pres.s3Key);

      let imageS3Key = null;
      if (templateImage) {
        const imgPres = await upload.getPresignedUrl(templateImage.name, templateImage.type, { temporary: true });
        await upload.uploadToS3(imgPres.uploadUrl, templateImage);
        imageS3Key = imgPres.s3Key;
      }

      setGenPhase('rendering');
      const { renderJobId } = await creatomate.startRender({
        template_id: Number(templateId),
        video_s3_key: pres.s3Key,
        image_s3_key: imageS3Key,
        text: templateText.trim() || null,
        caption,
      });
      activeRender.begin({ renderJobId, templateId });
    } catch (err) {
      activeRender.clear();
      setErrorDialog(apiError(err));
    } finally {
      setGenerating(false);
      setGenPhase(null);
      setGenProgress(0);
    }
  };

  const acceptOutput = () => {
    if (!renderModal) return;
    setGeneratedVideoUrl(renderModal.url);
    setTemplateVideoKey(null);
    activeRender.markAccepted({ templateId, url: renderModal.url });
    setRenderModal(null);
    toast.success('Generated video selected — add it to the pool');
  };
  const dropOutput = () => {
    if (templateVideoKey) {
      upload.discard(templateVideoKey).catch(() => {});
      setTemplateVideoKey(null);
    }
    activeRender.clear();
    setRenderModal(null);
  };

  const setSched = (key) => (e) => setSchedule((s) => ({ ...s, [key]: e.target.value }));

  const hasMedia = useTemplate ? !!generatedVideoUrl : !!file;
  const reelCheck = type === 'reel' && !useTemplate ? reelEligibility(videoMeta) : { ok: true, warning: null };
  const previewReady = useTemplate ? !!generatedVideoUrl : !!preview;
  const isVideoFile = file?.type?.startsWith('video');
  const renderBusy = activeStatus === 'uploading' || activeStatus === 'rendering';

  const canSubmit =
    !busy &&
    (type === 'post' ? hasMedia || caption.trim() : hasMedia) &&
    reelCheck.ok &&
    (!useTemplate || (templateId && generatedVideoUrl));

  const submit = async (e) => {
    e.preventDefault();
    if (useTemplate) {
      if (!templateId) return toast.error('Pick a template to use');
      if (!generatedVideoUrl) return toast.error('Generate the video with your template first');
    }
    if (isVideoKind && !hasMedia) return toast.error(`Add a video for your ${type}.`);
    if (!hasMedia && !caption.trim()) return toast.error('Add a caption or some media before posting');
    if (type === 'reel' && !reelCheck.ok) return toast.error(reelCheck.warning || 'This video can’t be published as a Reel.');

    let scheduled_at = null;
    if (scheduled) {
      if (!schedule.date || !schedule.time) return toast.error('Pick a date and time for this post');
      scheduled_at = new Date(`${schedule.date}T${schedule.time}`).toISOString();
    }

    setBusy(true);
    setProgress(0);
    try {
      if (scheduled && scheduled_at) {
        setPhase('preparing');
        const free = await postPool.slotAvailable(scheduled_at);
        if (!free) {
          setErrorDialog('A post is already scheduled for that date and time. Please pick a different slot.');
          return;
        }
      }

      let media_url = null;
      let s3_key = null;
      let media_type = null;
      let thumbnail_s3_key = null;

      if (useTemplate && generatedVideoUrl) {
        setPhase('ingesting');
        const media = await creatomate.saveRender(generatedVideoUrl);
        media_url = media.mediaUrl;
        s3_key = media.s3Key;
        media_type = media.mediaType;
      } else if (!useTemplate && file) {
        setPhase('preparing');
        const pres = await upload.getPresignedUrl(file.name, file.type);
        setPhase('uploading');
        await upload.uploadToS3(pres.uploadUrl, file, setProgress);
        media_url = pres.mediaUrl;
        s3_key = pres.s3Key;
        media_type = file.type.startsWith('video') ? 'video' : 'image';

        setPhase('thumbnail');
        try {
          const thumb = await upload.uploadThumbnail(file);
          if (thumb) thumbnail_s3_key = thumb.s3Key;
        } catch {
          /* a post without a thumbnail still works */
        }
      }

      // Reel/video always publish a video; a plain post keeps whatever media it has.
      if (isVideoKind) media_type = 'video';

      setPhase('saving');
      const post = await postPool.create({
        caption,
        post_kind: type,
        target_platform: 'facebook',
        status: 'ready',
        media_url,
        s3_key,
        thumbnail_s3_key,
        media_type,
        ...(useTemplate ? { creatomate_template_id: Number(templateId) } : {}),
        ...(scheduled ? { scheduled_at } : { immediate: true }),
      });

      invalidateCache('post-pool');
      invalidateCache('dashboard');
      toast.success(scheduled ? 'Post added to the pool' : 'Posting now — sending it to Facebook');
      activeRender.clear();
      onCreated?.(post);
    } catch (err) {
      setErrorDialog(apiError(err));
    } finally {
      setBusy(false);
      setPhase(null);
      setProgress(0);
    }
  };

  const submitLabel = () => {
    if (!busy) return scheduled ? 'Schedule post' : 'Post now';
    if (phase === 'preparing') return 'Preparing…';
    if (phase === 'uploading') return `Uploading… ${progress}%`;
    if (phase === 'thumbnail') return 'Optimizing…';
    if (phase === 'ingesting') return 'Finalizing…';
    return 'Saving…';
  };

  // ── Media popup body (dropzone + optional template flow + reel warnings) ──────
  const mediaPopup = (
    <Modal
      open={mediaOpen}
      title={`Add ${meta.mediaLabel.toLowerCase()}`}
      onClose={() => setMediaOpen(false)}
      className="modal--compose-media"
      footer={<Button className="btn--flat" onClick={() => setMediaOpen(false)}>Done</Button>}
    >
      {isVideoKind && env.templatesEnabled && (
        <div className="upload-option-row">
          <div className="upload-option-row__copy">
            <span className="upload-option-row__title">Use template</span>
            <span className="upload-option-row__text">Generate the video from a saved Creatomate template.</span>
          </div>
          <Toggle checked={useTemplate} onChange={setUseTemplate} />
        </div>
      )}

      {useTemplate ? (
        <>
          <div className="field">
            <span className="field__label">Template <span className="field__req">*</span></span>
            {tplLoading ? (
              <Spinner label="Loading templates…" />
            ) : templateOptions.length === 0 ? (
              <div className="text-sm text-muted">
                No templates yet — add one in <Link to="/settings">Settings → Creatomate templates</Link>.
              </div>
            ) : (
              <Dropdown className="dropdown--block" ariaLabel="Creatomate template" value={templateId} options={templateOptions} onChange={onSelectTemplate} />
            )}
          </div>
          {templateId && (
            <>
              <div className="field">
                <span className="field__label">Input video <span className="field__req">*</span></span>
                <MediaDropzone accept="video/*" file={templateVideo} onFile={handleTemplateVideo} />
                <span className="field__hint">Uploaded only when you generate.</span>
              </div>
              <div className="field">
                <span className="field__label">In-video text</span>
                <input
                  className="input"
                  value={templateText}
                  onChange={(e) => {
                    setTemplateText(e.target.value);
                    setGeneratedVideoUrl(null);
                    activeRender.clear();
                  }}
                  placeholder="Optional template text"
                />
              </div>
              <div className="field">
                <span className="field__label">In-video image</span>
                <MediaDropzone accept="image/*" file={templateImage} onFile={handleTemplateImage} />
                <span className="field__hint">Optional image overlay for this template.</span>
              </div>
              {generatedVideoUrl ? (
                <div className="upload-status-row">
                  <span className="upload-status-row__ok">Generated video selected</span>
                  <Button type="button" variant="ghost" size="sm" onClick={generate} disabled={generating || renderBusy}>Regenerate</Button>
                </div>
              ) : (
                <div className="upload-action-row">
                  <Button type="button" variant="accent" onClick={generate} disabled={generating || renderBusy || !templateVideo}>
                    {generating && genPhase === 'uploading' ? `Uploading… ${genProgress}%` : generating || renderBusy ? 'Generating…' : 'Generate with Template'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <MediaDropzone file={file} onFile={handleFile} accept={meta.accept} />
          {file && (
            <div className="upload-status-row">
              <Button type="button" variant="ghost" size="sm" onClick={clearMedia}>Remove media</Button>
            </div>
          )}
          {type === 'reel' && reelCheck.warning && (
            <div className={`story-composer__warning${reelCheck.ok ? '' : ' story-composer__warning--block'}`}>{reelCheck.warning}</div>
          )}
          {type === 'reel' && (
            <span className="field__hint">Reels must be vertical (9:16) and {REEL_MIN_S}–{REEL_MAX_S} seconds long.</span>
          )}
        </>
      )}
    </Modal>
  );

  // ── Composer body (type switch, media chip, caption, ⋮ menu, submit) ──────────
  const body = (
    <form className="composer" onSubmit={submit}>
      <div className="composer__top">
        {!lockType ? (
          <div className="composer__types" role="tablist" aria-label="Content type">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={type === t.key}
                className={`composer__type${type === t.key ? ' is-active' : ''}`}
                onClick={() => setType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="composer__kindlabel">{TYPES.find((t) => t.key === type)?.label}</span>
        )}

        <div className="composer__menu" ref={menuRef}>
          <button type="button" className="composer__iconbtn" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} title="Post options" aria-label="Post options">
            <KebabIcon />
          </button>
          {menuOpen && (
            <div className="composer__popover" role="menu">
              <label className="composer__pop-toggle">
                <span>Schedule for later</span>
                <Toggle checked={scheduled} onChange={setScheduled} />
              </label>
              {scheduled && (
                <div className="composer__pop-sched">
                  <input className="input" type="date" min={todayStr()} value={schedule.date} onChange={setSched('date')} />
                  <TimeSelect value={schedule.time} onChange={setSched('time')} date={schedule.date} />
                  <span className="field__hint">One post per slot. Times snap to :00 / :30.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <button type="button" className={`composer__media${previewReady ? ' has-media' : ''}`} onClick={() => setMediaOpen(true)}>
        <span className="composer__media-thumb" aria-hidden="true">
          {previewReady && !isVideoFile && preview ? (
            <img src={preview} alt="" />
          ) : previewReady ? (
            <FilmIcon />
          ) : type === 'post' ? (
            <ImageIcon />
          ) : (
            <FilmIcon />
          )}
        </span>
        <span className="composer__media-copy">
          <span className="composer__media-title">
            {previewReady ? (useTemplate ? 'Generated video' : file?.name || 'Media added') : `Add ${meta.mediaLabel.toLowerCase()}`}
          </span>
          <span className="composer__media-sub">
            {previewReady ? 'Click to change' : meta.sub}
            {meta.requiresVideo && !previewReady ? ' (required)' : ''}
          </span>
        </span>
        {type === 'reel' && !reelCheck.ok && <span className="composer__media-flag" title={reelCheck.warning}>!</span>}
      </button>

      <Field hint={type === 'post' ? 'A caption or media is required.' : 'Optional.'}>
        <textarea className="textarea composer__caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write your caption…" />
      </Field>

      <div className="composer__actions">
        <span className="composer__when">{scheduled ? `Scheduled · ${schedule.date} ${schedule.time}` : 'Posts immediately'}</span>
        <Button type="submit" size="lg" className="btn--flat composer__submit" disabled={!canSubmit}>
          {submitLabel()}
        </Button>
      </div>
    </form>
  );

  return (
    <>
      {layout === 'page' ? (
        <div className="composer-panel">
          <div className="composer-panel__head">
            <h2 className="composer-panel__title">{lockType ? `New ${type}` : 'Create content'}</h2>
            <p className="composer-panel__sub">{meta.sub}</p>
          </div>
          {body}
        </div>
      ) : (
        body
      )}

      {mediaPopup}

      <Modal
        open={busy}
        dismissable={false}
        title={
          phase === 'saving' ? 'Saving post…'
            : phase === 'preparing' ? 'Preparing upload…'
            : phase === 'thumbnail' ? 'Optimizing preview…'
            : phase === 'ingesting' ? 'Finalizing video…'
            : 'Uploading…'
        }
      >
        <ProgressBar
          value={progress}
          indeterminate={phase !== 'uploading'}
          label={
            phase === 'preparing' ? 'Getting a secure upload link…'
              : phase === 'uploading' ? `Uploading ${isVideoFile ? 'video' : 'media'}…`
              : phase === 'thumbnail' ? `Generating an optimized ${isVideoFile ? 'thumbnail' : 'preview'}…`
              : phase === 'ingesting' ? 'Downloading the generated video to storage…'
              : 'Saving your post…'
          }
        />
        <p className="text-sm text-muted">Please keep this tab open until it finishes.</p>
      </Modal>

      <Modal
        open={!!renderModal}
        dismissable={false}
        title="Generated video"
        footer={
          <>
            <Button variant="ghost" onClick={dropOutput}>Drop &amp; close</Button>
            <Button onClick={acceptOutput}>Upload output</Button>
          </>
        }
      >
        {renderModal?.url && <video src={renderModal.url} controls autoPlay style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />}
        <p className="text-sm text-muted mt-lg">“Upload output” uses this video for the post — it’s saved to storage when you add the post.</p>
      </Modal>

      <Modal open={!!errorDialog} title="Couldn't add post" onClose={() => setErrorDialog(null)} footer={<Button onClick={() => setErrorDialog(null)}>OK</Button>}>
        {errorDialog}
      </Modal>
    </>
  );
}
