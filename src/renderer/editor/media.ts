/** How big a picture or a video is, once it has loaded enough to say. Null if it never does. */
export function probeMedia(url: string, type: 'image' | 'video' | 'animation', timeoutMs = 5000): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (size: { width: number; height: number } | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(size && size.width > 0 && size.height > 0 ? size : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    if (type !== 'video') {
      const image = new Image();
      image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish(null);
      image.src = url;
    } else {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = () => {
        finish({ width: video.videoWidth, height: video.videoHeight });
        // Let go of the decoder at once; nothing here is ever played.
        video.removeAttribute('src');
        video.load();
      };
      video.onerror = () => finish(null);
      video.src = url;
    }
  });
}

/** How long a video runs, in seconds. Null if it never says. */
export function probeVideoLength(url: string, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const finish = (length: number | null): void => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      // Let go of the decoder at once; nothing here is ever played.
      video.removeAttribute('src');
      video.load();
      resolve(length);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** "1.9 MB", "740 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The height that keeps `width` in the proportions of `size`. */
export function heightFor(width: number, size: { width: number; height: number }): number {
  return Math.max(1, Math.round((width * size.height) / size.width));
}

/** The width that keeps `height` in the proportions of `size`. */
export function widthFor(height: number, size: { width: number; height: number }): number {
  return Math.max(1, Math.round((height * size.width) / size.height));
}
