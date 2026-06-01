import { useEffect, useRef, useState } from 'react';

// Simple image/media glyph.
const PicIcon = ({ size = 44 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.7" />
    <path d="M21 15l-4.5-4.5L5 21" />
  </svg>
);

/**
 * Click-or-drop file field plus a full-window drag overlay.
 * Dropping a file ANYWHERE on the page (while the overlay shows) selects it.
 */
export default function MediaDropzone({ file, onFile, accept = 'image/*,video/*' }) {
  const inputRef = useRef(null);
  const dragCount = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

    const onEnter = (e) => {
      e.preventDefault();
      if (!hasFiles(e)) return;
      dragCount.current += 1;
      setDragging(true);
    };
    const onOver = (e) => e.preventDefault(); // required so the page is a valid drop target
    const onLeave = (e) => {
      e.preventDefault();
      dragCount.current -= 1;
      if (dragCount.current <= 0) {
        dragCount.current = 0;
        setDragging(false);
      }
    };
    const onDrop = (e) => {
      e.preventDefault();
      dragCount.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) onFile(f);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFile]);

  const openPicker = () => inputRef.current?.click();

  return (
    <>
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
        <span className="dropzone__icon">
          <PicIcon size={44} />
        </span>
        {file ? (
          <>
            <span className="dropzone__label">{file.name}</span>
            <span className="dropzone__hint">Click to choose a different file</span>
          </>
        ) : (
          <>
            <span className="dropzone__label">Drag or choose a file</span>
            <span className="dropzone__hint">Images or videos — or drop anywhere on the page</span>
          </>
        )}
      </div>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay__box">
            <span className="drop-overlay__icon">
              <PicIcon size={64} />
            </span>
            <span className="drop-overlay__text">Drop your file anywhere in this container</span>
          </div>
        </div>
      )}
    </>
  );
}
