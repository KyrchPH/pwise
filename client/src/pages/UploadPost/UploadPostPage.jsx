import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as upload from '../../services/upload.service.js';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Button, Field, Modal } from '../../components/ui.jsx';
import MediaDropzone from '../../components/MediaDropzone.jsx';

const todayStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function UploadPostPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [caption, setCaption] = useState('');
  const [schedule, setSchedule] = useState({ date: '', time: '' });
  const [busy, setBusy] = useState(false);
  const [errorDialog, setErrorDialog] = useState(null);

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
    if (!file && !caption.trim()) {
      toast.error('Add a caption or a media file');
      return;
    }
    if ((schedule.date && !schedule.time) || (!schedule.date && schedule.time)) {
      toast.error('Pick both a date and a time to schedule (or leave both blank)');
      return;
    }
    const scheduled_at = schedule.date && schedule.time ? new Date(`${schedule.date}T${schedule.time}`).toISOString() : null;

    setBusy(true);
    try {
      let media_url = null;
      let s3_key = null;
      let media_type = null;

      if (file) {
        const pres = await upload.getPresignedUrl(file.name, file.type);
        await upload.uploadToS3(pres.uploadUrl, file);
        media_url = pres.mediaUrl;
        s3_key = pres.s3Key;
        media_type = file.type.startsWith('video') ? 'video' : 'image';
      }

      await postPool.create({
        caption,
        target_platform: 'facebook', // single platform for now
        status: 'ready',
        media_url,
        s3_key,
        media_type,
        scheduled_at,
      });

      toast.success('Post added to the pool');
      navigate('/post-pool');
    } catch (err) {
      setErrorDialog(apiError(err)); // e.g. "A post is already scheduled for that date and time"
    } finally {
      setBusy(false);
    }
  };

  const isVideo = file?.type?.startsWith('video');

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Upload Post</h1>
          <div className="page-head__sub">Add content to the pool. Media goes straight to S3.</div>
        </div>
      </div>

      <div className="grid-2">
        <Card className="card--pad">
          <form onSubmit={submit}>
            <div className="field">
              <span className="field__label">Media (image or video)</span>
              <MediaDropzone file={file} onFile={handleFile} />
              <span className="field__hint">Optional — text-only posts are allowed</span>
            </div>

            <Field label="Caption">
              <textarea
                className="textarea"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write your caption…"
              />
            </Field>

            <div className="field">
              <span className="field__label">Schedule (optional)</span>
              <div className="grid-2">
                <input className="input" type="date" min={todayStr()} value={schedule.date} onChange={setSched('date')} />
                <input className="input" type="time" step="1800" value={schedule.time} onChange={setSched('time')} />
              </div>
              <span className="field__hint">
                Posts at this exact date/time (one post per slot). Times snap to :00 / :30. Leave blank to use the interval.
              </span>
            </div>

            <Button type="submit" size="lg" className="btn--block" disabled={busy}>
              {busy ? 'Uploading…' : 'Add to pool'}
            </Button>
          </form>
        </Card>

        <Card className="card--pad">
          <div className="field__label">Preview</div>
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
        </Card>
      </div>

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
