import { useState } from 'react';
import { getVaultMediaType } from '../context/VaultContext.jsx';

function Ico({ size = 26, children }) {
  return (
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
      {children}
    </svg>
  );
}

export function FolderIcon({ size }) {
  return (
    <Ico size={size}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Ico>
  );
}

function ImageIcon() {
  return (
    <Ico>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </Ico>
  );
}

function VideoIcon() {
  return (
    <Ico>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </Ico>
  );
}

function PlayOverlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3 2.25v7.5L9 6 3 2.25Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <Ico>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Ico>
  );
}

function DocFileIcon({ label, accent, textSize = 6.6 }) {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M14 5h14l8 8v23a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"
        stroke={accent}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M28 5v8h8" stroke={accent} strokeWidth="2" strokeLinejoin="round" />
      <rect x="7" y="29" width="34" height="11" rx="5.5" fill={accent} />
      <text
        x="24"
        y="36.3"
        textAnchor="middle"
        fill="#fff"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize={textSize}
        fontWeight="800"
        letterSpacing="0.5"
      >
        {label}
      </text>
    </svg>
  );
}

function PdfFileIcon() {
  return <DocFileIcon label="PDF" accent="#d64b3c" textSize={7.2} />;
}

function DocxFileIcon() {
  return <DocFileIcon label="DOCX" accent="#2a7fd1" textSize={5.7} />;
}

function fileKind(item) {
  const ext = String(item?.name || '')
    .trim()
    .split('.')
    .pop()
    .toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'doc' || ext === 'docx') return 'docx';
  return 'file';
}

export function VaultThumb({ item }) {
  const [broken, setBroken] = useState(false);
  const mediaType = getVaultMediaType(item);

  if (item.type === 'folder') {
    return (
      <span className="vault-thumb__icon vault-thumb__icon--folder">
        <FolderIcon size={30} />
      </span>
    );
  }

  // Prefer the optimized still (`thumbUrl`) for both images and videos; fall back
  // to the full media only when no thumbnail was generated.
  if (mediaType === 'image' && (item.thumbUrl || item.url) && !broken) {
    return (
      <img className="vault-thumb__img" src={item.thumbUrl || item.url} alt="" draggable={false} onError={() => setBroken(true)} />
    );
  }

  if (mediaType === 'video' && (item.thumbUrl || item.url) && !broken) {
    return (
      <>
        {item.thumbUrl ? (
          <img className="vault-thumb__img" src={item.thumbUrl} alt="" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <video
            className="vault-thumb__img"
            src={`${item.url}#t=0.1`}
            muted
            preload="metadata"
            playsInline
            draggable={false}
            onError={() => setBroken(true)}
          />
        )}
        <span className="vault-thumb__play" aria-hidden="true">
          <PlayOverlayIcon />
        </span>
      </>
    );
  }

  const kind = fileKind(item);
  const icon =
    kind === 'pdf' ? <PdfFileIcon /> : kind === 'docx' ? <DocxFileIcon /> : mediaType === 'image' ? <ImageIcon /> : mediaType === 'video' ? <VideoIcon /> : <FileIcon />;

  return <span className="vault-thumb__icon">{icon}</span>;
}
