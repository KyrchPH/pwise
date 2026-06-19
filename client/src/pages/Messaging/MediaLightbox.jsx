import { useEffect } from 'react';

// Fullscreen viewer for a thread photo/video. `media` is { type, url, name } or
// null (closed). Click the backdrop or press Escape to dismiss.
export default function MediaLightbox({ media, onClose }) {
  useEffect(() => {
    if (!media) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [media, onClose]);

  if (!media) return null;
  const isVideo = String(media.type || '').toLowerCase().startsWith('video');

  return (
    <div className="msg-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="msg-lightbox__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="msg-lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video className="msg-lightbox__media" src={media.url} controls playsInline />
        ) : (
          <img className="msg-lightbox__media" src={media.url} alt={media.name || ''} />
        )}
        {media.name && <div className="msg-lightbox__caption">{media.name}</div>}
      </div>
    </div>
  );
}
