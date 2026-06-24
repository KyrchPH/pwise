import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as upload from '../services/upload.service.js';
import * as postPool from '../services/post_pool.service.js';
import * as creatomate from '../services/creatomate.service.js';
import { apiError } from '../services/api.js';
import env from '../config/env.js';
import { invalidateCache, useCachedResource } from '../hooks/useCachedResource.js';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Button, Field, Modal, Toggle, TimeSelect, ProgressBar, Dropdown, Spinner } from './ui.jsx';
import MediaDropzone from './MediaDropzone.jsx';

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => dateStr(new Date());

// Default schedule: today + the next :00/:30 slot after now (rounds the current
// time up to the next half-hour; rolls to tomorrow if it's past 23:30).
function nextSlot() {
  const d = new Date();
  if (d.getMinutes() < 30) d.setMinutes(30, 0, 0);
  else d.setHours(d.getHours() + 1, 0, 0, 0);
  return { date: dateStr(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll a render job to completion. Resolves with the finished job on success, or
// null if `isActive()` goes false (the form unmounted) so we stop touching state.
// Throws on a failed render, or if it never finishes within the budget.
async function waitForRender(jobId, isActive) {
  const POLL_MS = 3000;
  const deadline = Date.now() + 8 * 60 * 1000; // generous headroom over a typical render
  while (Date.now() < deadline) {
    if (!isActive()) return null;
    const job = await creatomate.getRender(jobId);
    if (job.status === 'succeeded') {
      if (!job.url) throw new Error('The render finished but no video came back. Please try again.');
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(job.errorMessage || 'The render failed. Please try again.');
    }
    await sleep(POLL_MS);
  }
  throw new Error('The render is taking longer than expected — please check back shortly.');
}

/**
 * The Upload-post form, shared by the Upload page and the calendar's
 * "Create Post" dialog.
 * - `defaultDate` ('YYYY-MM-DD'): pre-fills the schedule date (e.g. the calendar
 *   cell that opened the dialog).
 * - `showPreview`: render the side-by-side media preview card (page layout only).
 * - `onCreated(post)`: called after a post is saved (page → navigate; modal →
 *   close + refresh). When omitted, nothing happens after the success toast.
 */
export default function UploadPostForm({ defaultDate = null, showPreview = false, embedded = false, onCreated }) {
  const toast = useToast();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [caption, setCaption] = useState('');
  const [scheduled, setScheduled] = useState(true);
  const [schedule, setSchedule] = useState(() =>
    defaultDate ? { date: defaultDate, time: nextSlot().time } : nextSlot(),
  );
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null); // 'preparing' | 'uploading' | 'ingesting' | 'saving'
  const [progress, setProgress] = useState(0); // 0..100 for the S3 upload
  const [errorDialog, setErrorDialog] = useState(null);
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [templateVideo, setTemplateVideo] = useState(null); // input video, uploaded only on Generate
  const [generating, setGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState(null); // 'uploading' | 'rendering'
  const [genProgress, setGenProgress] = useState(0); // 0..100 for the input-video upload
  const [renderModal, setRenderModal] = useState(null); // { url } — the result dialog
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null); // Creatomate URL accepted via "Upload output"
  const [templateVideoKey, setTemplateVideoKey] = useState(null); // tmp/ S3 key of the uploaded input clip

  // Stop the render poll from touching state once the form unmounts.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Templates load lazily — only once "Use template" is switched on (a null key
  // tells useCachedResource to skip fetching), then stay cached for the session.
  const { data: templates = [], loading: tplLoading } = useCachedResource(
    useTemplate ? 'creatomate-templates' : null,
    creatomate.list,
  );
  const templateOptions = templates.map((t) => ({ value: String(t.id), label: t.name }));
  const selectedTemplate = templates.find((t) => String(t.id) === templateId) || null;

  // Default to the first template so the dropdown never sits on an empty value.
  useEffect(() => {
    if (useTemplate && templates.length && !templateId) setTemplateId(String(templates[0].id));
  }, [useTemplate, templates, templateId]);

  // Switching template invalidates any video generated from the previous one.
  const onSelectTemplate = (v) => {
    setTemplateId(v);
    setGeneratedVideoUrl(null);
  };

  const handleTemplateVideo = (f) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      toast.error('Please choose a video file');
      return;
    }
    setTemplateVideo(f);
    setGeneratedVideoUrl(null); // a new input video → previous render is stale
  };

  // "Generate with Template": upload the input video now, then trigger the n8n
  // webhook. n8n runs the Creatomate render and responds with the output video
  // URL, which we show in the barrier result dialog.
  const generate = async () => {
    if (!templateId) {
      toast.error('Pick a template first');
      return;
    }
    if (!templateVideo) {
      toast.error('Choose an input video');
      return;
    }
    setGenerating(true);
    setGenProgress(0);
    try {
      // Input clip goes to tmp/ — kept only until the user drops/accepts the
      // result (and an S3 lifecycle rule expires any that slip through).
      setGenPhase('uploading');
      const pres = await upload.getPresignedUrl(templateVideo.name, templateVideo.type, { temporary: true });
      await upload.uploadToS3(pres.uploadUrl, templateVideo, setGenProgress);
      setTemplateVideoKey(pres.s3Key);

      // Kick off the async render, then poll until Creatomate (via n8n) reports back.
      setGenPhase('rendering');
      const { renderJobId } = await creatomate.startRender({
        template_id: Number(templateId),
        video_s3_key: pres.s3Key,
        caption,
      });
      const job = await waitForRender(renderJobId, () => mountedRef.current);
      if (!job) return; // form unmounted mid-render — nothing to show
      setRenderModal({ url: job.url });
    } catch (err) {
      setErrorDialog(apiError(err));
    } finally {
      setGenerating(false);
      setGenPhase(null);
      setGenProgress(0);
    }
  };

  // Result dialog — "Upload output": keep the rendered URL for this post. The
  // actual download into S3 happens later, when the post is submitted. The temp
  // input clip is left for the S3 lifecycle rule to expire.
  const acceptOutput = () => {
    if (!renderModal) return;
    setGeneratedVideoUrl(renderModal.url);
    setTemplateVideoKey(null);
    setRenderModal(null);
    toast.success('Generated video selected — add it to the pool');
  };

  // Result dialog — "Drop & close": discard the render and delete the temp input.
  const dropOutput = () => {
    if (templateVideoKey) {
      upload.discard(templateVideoKey).catch(() => {}); // best-effort
      setTemplateVideoKey(null);
    }
    setRenderModal(null);
  };

  const setSched = (key) => (e) => setSchedule((s) => ({ ...s, [key]: e.target.value }));

  const handleFile = useCallback(
    (f) => {
      if (!f) return;
      if (!/^(image|video)\//.test(f.type)) {
        toast.error('Please choose an image or video file');
        return;
      }
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });
      setFile(f);
    },
    [toast],
  );

  const submit = async (e) => {
    e.preventDefault();
    if (useTemplate) {
      if (!templateId) {
        toast.error('Pick a template to use');
        return;
      }
      if (!generatedVideoUrl) {
        toast.error('Generate the video with your template first');
        return;
      }
    }
    // A post needs at least one of media or a caption (caption alone = text post).
    const hasMedia = useTemplate ? !!generatedVideoUrl : !!file;
    if (!hasMedia && !caption.trim()) {
      toast.error('Add a caption or some media before posting');
      return;
    }
    let scheduled_at = null;
    if (scheduled) {
      if (!schedule.date || !schedule.time) {
        toast.error('Pick a date and time for this post');
        return;
      }
      scheduled_at = new Date(`${schedule.date}T${schedule.time}`).toISOString();
    }

    setBusy(true);
    setProgress(0);
    try {
      // Pre-flight: when scheduling, confirm the slot is free BEFORE uploading any
      // media — otherwise a taken slot would orphan the file in S3.
      if (scheduled && scheduled_at) {
        setPhase('preparing');
        const free = await postPool.slotAvailable(scheduled_at);
        if (!free) {
          setErrorDialog('A post is already scheduled for that date and time. Please pick a different slot.');
          return; // the `finally` block resets the busy/progress state
        }
      }

      let media_url = null;
      let s3_key = null;
      let media_type = null;
      let thumbnail_s3_key = null;

      if (useTemplate && generatedVideoUrl) {
        // Download the rendered video from Creatomate into our S3 now (at submit).
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

        // Generate + upload an optimized still (first video frame / downscaled
        // image) so grids and the viewer show a lightweight preview instead of
        // fetching the full media. Best-effort — the post saves regardless.
        setPhase('thumbnail');
        try {
          const thumb = await upload.uploadThumbnail(file);
          if (thumb) thumbnail_s3_key = thumb.s3Key;
        } catch {
          /* a post without a thumbnail still works */
        }
      }

      setPhase('saving');
      const post = await postPool.create({
        caption,
        target_platform: 'facebook', // single platform for now
        status: 'ready',
        media_url,
        s3_key,
        thumbnail_s3_key,
        media_type,
        ...(useTemplate ? { creatomate_template_id: Number(templateId) } : {}),
        ...(scheduled ? { scheduled_at } : { immediate: true }),
      });

      // New post → the pool list and dashboard counts are now stale.
      invalidateCache('post-pool');
      invalidateCache('dashboard');

      toast.success(scheduled ? 'Post added to the pool' : 'Posting now — sending it to Facebook');
      onCreated?.(post);
    } catch (err) {
      setErrorDialog(apiError(err)); // e.g. "A post is already scheduled for that date and time"
    } finally {
      setBusy(false);
      setPhase(null);
      setProgress(0);
    }
  };

  const isVideo = file?.type?.startsWith('video');

  const fieldsEl = (
    <>
      {env.templatesEnabled && (
        <div className="field">
          <div className="row row--between" style={{ gap: 12 }}>
            <div>
              <span className="field__label" style={{ display: 'block', marginBottom: 2 }}>
                Use template
              </span>
              <span className="text-sm text-muted">
                Build this post from a saved Creatomate template instead of uploading media.
              </span>
            </div>
            <Toggle checked={useTemplate} onChange={setUseTemplate} />
          </div>
        </div>
      )}

      {useTemplate ? (
        <>
          <div className="field">
            <span className="field__label">
              Template <span className="field__req">*</span>
            </span>
            {tplLoading ? (
              <Spinner label="Loading templates…" />
            ) : templateOptions.length === 0 ? (
              <div className="text-sm text-muted">
                No templates yet — add one in <Link to="/settings">Settings → Creatomate templates</Link>.
              </div>
            ) : (
              <Dropdown
                className="dropdown--block"
                ariaLabel="Creatomate template"
                value={templateId}
                options={templateOptions}
                onChange={onSelectTemplate}
              />
            )}
            <span className="field__hint">Managed in Settings → Creatomate templates.</span>
          </div>

          {templateId && (
            <>
              <div className="field">
                <span className="field__label">
                  Input video <span className="field__req">*</span>
                </span>
                <MediaDropzone accept="video/*" file={templateVideo} onFile={handleTemplateVideo} />
                <span className="field__hint">
                  Uploaded only when you generate, then fed into the template’s video slot.
                </span>
              </div>

              {generatedVideoUrl ? (
                <div className="field">
                  <div className="row row--between" style={{ gap: 12 }}>
                    <span className="text-sm" style={{ color: '#1f8f43', fontWeight: 600 }}>
                      ✓ Generated video selected
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={generate} disabled={generating}>
                      Regenerate
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="field" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="button" variant="accent" onClick={generate} disabled={generating || !templateVideo}>
                    {generating
                      ? genPhase === 'uploading'
                        ? `Uploading… ${genProgress}%`
                        : 'Generating…'
                      : 'Generate with Template'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="field">
          <span className="field__label">Media (image or video)</span>
          <MediaDropzone file={file} onFile={handleFile} />
          <span className="field__hint">Optional — text-only posts are allowed</span>
        </div>
      )}

      <Field label="Caption" hint="Optional — a caption or media is required">
        <textarea
          className="textarea"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write your caption…"
        />
      </Field>

      <div className="field">
        <div className="row row--between" style={{ gap: 12 }}>
          <div>
            <span className="field__label" style={{ display: 'block', marginBottom: 2 }}>
              Scheduled posting
            </span>
            <span className="text-sm text-muted">
              {scheduled ? 'Publishes at the date & time you set.' : 'Publishes right away on the next posting run.'}
            </span>
          </div>
          <Toggle checked={scheduled} onChange={setScheduled} />
        </div>
      </div>

      {scheduled && (
        <div className="field">
          <span className="field__label">
            Schedule <span className="field__req">*</span>
          </span>
          <div className="grid-2">
            <input className="input" type="date" min={todayStr()} value={schedule.date} onChange={setSched('date')} required />
            <TimeSelect value={schedule.time} onChange={setSched('time')} date={schedule.date} />
          </div>
          <span className="field__hint">
            Posts at this exact date and time (one post per slot). Times snap to :00 / :30.
          </span>
        </div>
      )}

    </>
  );

  const submitBtnEl = (
    <Button
      type="submit"
      size="lg"
      className="btn--block upload-submit-btn"
      disabled={busy || (useTemplate && (!templateId || !generatedVideoUrl))}
    >
      {!busy
        ? scheduled
          ? 'Add to pool'
          : 'Post now'
        : phase === 'preparing'
          ? 'Preparing…'
          : phase === 'uploading'
            ? `Uploading… ${progress}%`
            : phase === 'thumbnail'
              ? 'Optimizing…'
              : phase === 'ingesting'
                ? 'Finalizing…'
                : 'Saving…'}
    </Button>
  );

  // Page layout keeps the button inline; the modal (embedded) splits the form
  // into a scrolling body + a fixed footer so the header/footer stay put.
  const formEl = (
    <form onSubmit={submit}>
      {fieldsEl}
      {submitBtnEl}
    </form>
  );

  const embeddedFormEl = (
    <form className="upf" onSubmit={submit}>
      <div className="upf__scroll">{fieldsEl}</div>
      <div className="upf__foot">{submitBtnEl}</div>
    </form>
  );

  const previewEl = useTemplate ? (
    generatedVideoUrl ? (
      <>
        <video src={generatedVideoUrl} controls style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />
        <p className="text-sm text-muted mt-lg">
          Generated video{selectedTemplate ? ` from “${selectedTemplate.name}”` : ''}
        </p>
      </>
    ) : (
      <>
        <div className="thumb" style={{ height: 220, borderRadius: 'var(--r-sm)' }}>
          <span className="thumb__placeholder">🎬</span>
        </div>
        <p className="text-sm text-muted mt-lg">
          {selectedTemplate ? `Template: ${selectedTemplate.name}` : 'No template selected.'}
        </p>
      </>
    )
  ) : (
    <>
      {preview ? (
        isVideo ? (
          <video src={preview} controls style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />
        ) : (
          <img src={preview} alt="preview" style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />
        )
      ) : (
        <div className="thumb" style={{ height: 220, borderRadius: 'var(--r-sm)' }}>
          <span className="thumb__placeholder">🖼️</span>
        </div>
      )}
      <p className="text-sm text-muted mt-lg">
        {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'No file selected.'}
      </p>
    </>
  );

  return (
    <>
      {embedded ? (
        embeddedFormEl
      ) : showPreview ? (
        <div className="grid-2">
          <Card className="card--pad">{formEl}</Card>
          <Card className="card--pad">
            <div className="field__label">Preview</div>
            {previewEl}
          </Card>
        </div>
      ) : (
        formEl
      )}

      {/* Blocking progress dialog — no ✕ and no click-outside-to-close
          (dismissable={false}), so it bars all other actions until the upload
          finishes. */}
      <Modal
        open={busy}
        dismissable={false}
        title={
          phase === 'saving'
            ? 'Saving post…'
            : phase === 'preparing'
              ? 'Preparing upload…'
              : phase === 'thumbnail'
                ? 'Optimizing preview…'
                : phase === 'ingesting'
                  ? 'Finalizing video…'
                  : 'Uploading…'
        }
      >
        <ProgressBar
          value={progress}
          indeterminate={phase !== 'uploading'}
          label={
            phase === 'preparing'
              ? 'Getting a secure upload link…'
              : phase === 'uploading'
                ? `Uploading ${isVideo ? 'video' : 'media'}…`
                : phase === 'thumbnail'
                  ? `Generating an optimized ${isVideo ? 'thumbnail' : 'preview'}…`
                  : phase === 'ingesting'
                    ? 'Downloading the generated video to storage…'
                    : 'Saving your post…'
          }
        />
        {file && (
          <p className="text-sm text-muted mt-lg">
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        )}
        <p className="text-sm text-muted">Please keep this tab open until it finishes.</p>
      </Modal>

      {/* Generation progress — barrier while the input video uploads and the
          template renders on Creatomate. */}
      <Modal
        open={generating}
        dismissable={false}
        title={genPhase === 'uploading' ? 'Uploading video…' : 'Generating with template…'}
      >
        <ProgressBar
          value={genProgress}
          indeterminate={genPhase !== 'uploading'}
          label={
            genPhase === 'uploading'
              ? `Uploading your video… ${genProgress}%`
              : 'Rendering with Creatomate — this can take a minute…'
          }
        />
        <p className="text-sm text-muted">Please keep this tab open until it finishes.</p>
      </Modal>

      {/* Result dialog — barrier showing the rendered video; Upload it or drop it. */}
      <Modal
        open={!!renderModal}
        dismissable={false}
        title="Generated video"
        footer={
          <>
            <Button variant="ghost" onClick={dropOutput}>
              Drop &amp; close
            </Button>
            <Button onClick={acceptOutput}>Upload output</Button>
          </>
        }
      >
        {renderModal?.url && (
          <video src={renderModal.url} controls autoPlay style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />
        )}
        <p className="text-sm text-muted mt-lg">
          “Upload output” uses this video for the post — it’s saved to storage when you add the post.
          “Drop &amp; close” discards it.
        </p>
      </Modal>

      <Modal
        open={!!errorDialog}
        title="Couldn't add post"
        onClose={() => setErrorDialog(null)}
        footer={<Button onClick={() => setErrorDialog(null)}>OK</Button>}
      >
        {errorDialog}
      </Modal>
    </>
  );
}
