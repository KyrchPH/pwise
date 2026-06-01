import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as upload from '../../services/upload.service.js';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Button, Field } from '../../components/ui.jsx';

const PLATFORMS = ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'];

export default function UploadPostPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ caption: '', target_platform: 'facebook', priority: 0, status: 'draft' });
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file && !form.caption.trim()) {
      toast.error('Add a caption or a media file');
      return;
    }
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
        caption: form.caption,
        target_platform: form.target_platform,
        priority: Number(form.priority) || 0,
        status: form.status,
        media_url,
        s3_key,
        media_type,
      });

      toast.success('Post added to the pool');
      navigate('/post-pool');
    } catch (err) {
      toast.error(apiError(err));
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
            <Field label="Media (image or video)" hint="Optional — text-only posts are allowed">
              <input className="input" type="file" accept="image/*,video/*" onChange={onFile} />
            </Field>
            <Field label="Caption">
              <textarea
                className="textarea"
                value={form.caption}
                onChange={set('caption')}
                placeholder="Write your caption…"
              />
            </Field>
            <div className="grid-2">
              <Field label="Target platform">
                <select className="select" value={form.target_platform} onChange={set('target_platform')}>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority" hint="Higher posts first">
                <input className="input" type="number" value={form.priority} onChange={set('priority')} />
              </Field>
            </div>
            <Field label="Status">
              <select className="select" value={form.status} onChange={set('status')}>
                <option value="draft">Draft — not ready to post</option>
                <option value="ready">Ready — eligible for auto-posting</option>
              </select>
            </Field>
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
    </>
  );
}
