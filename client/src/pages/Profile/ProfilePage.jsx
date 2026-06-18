import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import * as uploadService from '../../services/upload.service.js';
import { Button, Card, Field, Modal, UserAvatar } from '../../components/ui.jsx';

const CROP_FRAME = 280;
const AVATAR_OUTPUT = 512;

const fmt = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const fileBaseName = (name = 'profile-photo') =>
  String(name)
    .replace(/\.[^./\\]+$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_') || 'profile-photo';

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function AvatarCropDialog({ draft, saving, progress, onClose, onSave }) {
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [imageSize, setImageSize] = useState(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    setImageSize(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setError('');
  }, [draft?.url]);

  const cropMetrics = (nextScale = scale, size = imageSize) => {
    if (!size) return { displayWidth: CROP_FRAME, displayHeight: CROP_FRAME };
    const baseScale = CROP_FRAME / Math.min(size.width, size.height);
    return {
      displayWidth: size.width * baseScale * nextScale,
      displayHeight: size.height * baseScale * nextScale,
    };
  };

  const clampOffset = (next, nextScale = scale, size = imageSize) => {
    const { displayWidth, displayHeight } = cropMetrics(nextScale, size);
    const maxX = Math.max(0, (displayWidth - CROP_FRAME) / 2);
    const maxY = Math.max(0, (displayHeight - CROP_FRAME) / 2);
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  };

  const onImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setImageSize(size);
    setScale(1);
    setOffset(clampOffset({ x: 0, y: 0 }, 1, size));
  };

  const updateScale = (event) => {
    const nextScale = Number(event.target.value);
    setScale(nextScale);
    setOffset((current) => clampOffset(current, nextScale));
  };

  const startDrag = (event) => {
    if (saving || !imageSize) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
    };
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    setOffset(
      clampOffset({
        x: drag.origin.x + event.clientX - drag.startX,
        y: drag.origin.y + event.clientY - drag.startY,
      }),
    );
  };

  const stopDrag = (event) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
  };

  const renderCrop = () =>
    new Promise((resolve) => {
      const img = imgRef.current;
      if (!img || !imageSize) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_OUTPUT;
      canvas.height = AVATAR_OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      const ratio = AVATAR_OUTPUT / CROP_FRAME;
      const { displayWidth, displayHeight } = cropMetrics();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, AVATAR_OUTPUT, AVATAR_OUTPUT);
      ctx.translate(AVATAR_OUTPUT / 2 + offset.x * ratio, AVATAR_OUTPUT / 2 + offset.y * ratio);
      ctx.drawImage(img, (-displayWidth * ratio) / 2, (-displayHeight * ratio) / 2, displayWidth * ratio, displayHeight * ratio);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });

  const save = async () => {
    setError('');
    const blob = await renderCrop();
    if (!blob) {
      setError('Could not prepare this image. Try another photo.');
      return;
    }
    try {
      await onSave(blob);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const { displayWidth, displayHeight } = cropMetrics();

  return (
    <Modal
      open={!!draft}
      title="Adjust profile photo"
      onClose={saving ? undefined : onClose}
      dismissable={!saving}
      className="modal--avatar-crop"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !imageSize}>
            {saving ? 'Uploading...' : 'Save photo'}
          </Button>
        </>
      }
    >
      <div className="avatar-crop">
        <div
          className="avatar-crop__frame"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          role="presentation"
        >
          {draft?.url && (
            <img
              ref={imgRef}
              src={draft.url}
              alt=""
              draggable="false"
              onLoad={onImageLoad}
              className="avatar-crop__image"
              style={{
                width: `${displayWidth}px`,
                height: `${displayHeight}px`,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <span className="avatar-crop__mask" aria-hidden="true" />
        </div>

        <div className="avatar-crop__hint">Drag the photo to position it. Use the slider to scale the crop.</div>
        <Field label="Scale">
          <input
            className="avatar-crop__range"
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={scale}
            onChange={updateScale}
            disabled={saving || !imageSize}
          />
        </Field>
        <button type="button" className="link avatar-crop__reset" onClick={() => { setScale(1); setOffset(clampOffset({ x: 0, y: 0 }, 1)); }} disabled={saving || !imageSize}>
          Reset position
        </button>
        {saving && <div className="field__hint">Uploading photo{progress ? ` (${progress}%)` : '...'}</div>}
        {error && <div className="error-text">{error}</div>}
      </div>
    </Modal>
  );
}

export default function ProfilePage() {
  const toast = useToast();
  const { user, updateProfile, updateAvatar } = useAuth();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({ name: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarDraft, setAvatarDraft] = useState(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState(0);

  useEffect(() => {
    setForm({
      name: user?.name || '',
      email: user?.email || '',
    });
  }, [user]);

  useEffect(() => {
    const url = avatarDraft?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [avatarDraft]);

  const set = (key) => (event) => {
    setError('');
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Profile updated');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const unchanged = form.name.trim() === (user?.name || '') && form.email.trim() === (user?.email || '');

  const openAvatarPicker = () => {
    if (!avatarSaving) fileInputRef.current?.click();
  };

  const pickAvatar = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Choose an image file for your profile photo.');
      return;
    }
    setAvatarDraft({ file, url: URL.createObjectURL(file) });
  };

  const closeAvatarDialog = () => {
    if (!avatarSaving) setAvatarDraft(null);
  };

  const saveAvatar = async (blob) => {
    if (!avatarDraft?.file) return;
    setAvatarSaving(true);
    setAvatarProgress(0);
    try {
      const name = `${fileBaseName(avatarDraft.file.name)}-avatar.jpg`;
      const croppedFile = new File([blob], name, { type: 'image/jpeg' });
      const presigned = await uploadService.getPresignedUrl(croppedFile.name, croppedFile.type, { avatar: true });
      await uploadService.uploadToS3(presigned.uploadUrl, croppedFile, setAvatarProgress);
      await uploadService.confirm(presigned.s3Key);
      await updateAvatar({ s3Key: presigned.s3Key });
      toast.success('Profile photo updated');
      setAvatarDraft(null);
    } catch (err) {
      toast.error(apiError(err));
      throw err;
    } finally {
      setAvatarSaving(false);
      setAvatarProgress(0);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">User Profile</h1>
          <div className="page-head__sub">View and update your account information.</div>
        </div>
      </div>

      <div className="profile-layout">
        <Card className="card--pad profile-card profile-card--hero">
          <button type="button" className="profile-avatar-btn" onClick={openAvatarPicker} aria-label="Change profile photo">
            <UserAvatar user={user} className="profile-avatar" />
            <span className="profile-avatar-camera" aria-hidden="true">
              <CameraIcon />
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={pickAvatar} hidden />
          <div className="profile-identity">
            <div className="profile-name">{user?.name || 'Account'}</div>
            <div className="profile-email">{user?.email}</div>
            <span className="badge badge--ready profile-role">{user?.role || 'user'}</span>
          </div>
        </Card>

        <Card className="card--pad profile-card">
          <form onSubmit={submit}>
            <div className="profile-section-title">Account details</div>
            <div className="grid-2">
              <Field label="Name">
                <input className="input" value={form.name} onChange={set('name')} maxLength={255} required />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={set('email')} required />
              </Field>
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="profile-actions">
              <Button type="submit" className="profile-save-btn" disabled={saving || unchanged}>
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
              <Button as={Link} to="/profile/change-password" variant="ghost" className="profile-password-btn">
                Change password
              </Button>
            </div>
          </form>
        </Card>

        <Card className="card--pad profile-card profile-card--meta">
          <div className="profile-section-title">Account status</div>
          <dl className="profile-meta">
            <div>
              <dt>Role</dt>
              <dd>{user?.role || '-'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{user?.is_active === false ? 'Inactive' : 'Active'}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{fmt(user?.created_at)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{fmt(user?.updated_at)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <AvatarCropDialog
        draft={avatarDraft}
        saving={avatarSaving}
        progress={avatarProgress}
        onClose={closeAvatarDialog}
        onSave={saveAvatar}
      />
    </>
  );
}
