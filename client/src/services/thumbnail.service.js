// Client-side thumbnail generation. Uploads go browser → S3 directly and the
// server has no media tooling (ffmpeg/sharp), so previews are produced here, in
// the browser, from the file the user just picked: a video's first frame, or a
// downscaled copy of an image. The result is a small, optimized JPEG used wherever
// the app shows a still — so grids never fetch a whole clip just to show a poster.

// Longest-edge cap (px). Small enough to be cheap to fetch/cache in a grid, large
// enough to stay crisp on a retina card.
const DEFAULT_MAX_SIZE = 640;
// JPEG quality — a good size/clarity trade-off for photos and video frames.
const DEFAULT_QUALITY = 0.72;
// Seek a hair past 0 rather than exactly the first frame: the very start of a clip
// is often a black/blank frame before the first keyframe paints.
const VIDEO_SEEK_TIME = 0.1;
// Never let a video that won't decode/seek hang the upload.
const VIDEO_TIMEOUT_MS = 10_000;

const isVideo = (file) => /^video\//.test(file?.type || '');
const isImage = (file) => /^image\//.test(file?.type || '');

// Scale (w, h) down to fit maxSize on the longest edge; never upscales.
function fitWithin(w, h, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(w, h || 1));
  return {
    width: Math.max(1, Math.round((w || 1) * scale)),
    height: Math.max(1, Math.round((h || 1) * scale)),
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (!canvas.toBlob) {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

// Draw any drawable source (HTMLImageElement / HTMLVideoElement) into a downscaled
// canvas and export it as an optimized JPEG blob.
async function drawToThumbnail(source, srcW, srcH, maxSize, quality) {
  if (!srcW || !srcH) return null;
  const { width, height } = fitWithin(srcW, srcH, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return canvasToBlob(canvas, 'image/jpeg', quality);
}

function thumbnailFromImage(file, maxSize, quality) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        resolve(await drawToThumbnail(img, img.naturalWidth, img.naturalHeight, maxSize, quality));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function thumbnailFromVideo(file, maxSize, quality) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load?.();
      resolve(blob);
    };

    // Muted + inline so the browser will decode without a user gesture.
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    video.onloadeddata = () => {
      // Seek slightly in to grab a real (non-black) frame.
      try {
        video.currentTime = Math.min(VIDEO_SEEK_TIME, (video.duration || 1) / 2);
      } catch {
        finish(null); // seeking unsupported
      }
    };
    video.onseeked = async () => {
      try {
        finish(await drawToThumbnail(video, video.videoWidth, video.videoHeight, maxSize, quality));
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    const timer = setTimeout(() => finish(null), VIDEO_TIMEOUT_MS);

    video.src = url;
  });
}

/**
 * Read intrinsic metadata (duration in seconds + pixel dimensions) from a video
 * File, entirely in the browser. Resolves `{ duration, width, height }` — with any
 * field null if it can't be decoded — so callers can gate reel eligibility
 * (length / aspect ratio) without a server round-trip. Non-video files resolve to
 * all-null; a decode that stalls is bounded by the same timeout as thumbnailing.
 */
export function readVideoMetadata(file) {
  const EMPTY = { duration: null, width: null, height: null };
  return new Promise((resolve) => {
    if (!isVideo(file)) {
      resolve(EMPTY);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (meta) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load?.();
      resolve(meta);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () =>
      finish({
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    video.onerror = () => finish(EMPTY);
    const timer = setTimeout(() => finish(EMPTY), VIDEO_TIMEOUT_MS);
    video.src = url;
  });
}

/**
 * Build an optimized (downscaled, JPEG) thumbnail Blob for an image or video File,
 * entirely in the browser. For videos the frame is captured just after the start
 * (the "first frame"). Returns null for unsupported types or on any failure, so
 * callers can carry on without a thumbnail.
 */
export async function generateThumbnail(file, { maxSize = DEFAULT_MAX_SIZE, quality = DEFAULT_QUALITY } = {}) {
  if (!file) return null;
  try {
    if (isVideo(file)) return await thumbnailFromVideo(file, maxSize, quality);
    if (isImage(file)) return await thumbnailFromImage(file, maxSize, quality);
  } catch {
    return null;
  }
  return null;
}
