const videoHandles = new WeakMap<HTMLVideoElement, string>();

let nextVideoHandle = 1;

function isRenderableVideo(video: HTMLVideoElement): boolean {
  if (!video.isConnected || video.hidden) {
    return false;
  }

  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const styles = window.getComputedStyle(video);
  return (
    styles.display !== "none" &&
    styles.visibility !== "hidden" &&
    styles.visibility !== "collapse" &&
    styles.opacity !== "0"
  );
}

function getVideoArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  return rect.width * rect.height;
}

export function getVideoHandle(video: HTMLVideoElement): string {
  const existingHandle = videoHandles.get(video);
  if (existingHandle) {
    return existingHandle;
  }

  const handle = `screenmate-video-${nextVideoHandle++}`;
  videoHandles.set(video, handle);
  return handle;
}

export function collectVisibleVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll("video"))
    .filter(isRenderableVideo)
    .sort((left, right) => getVideoArea(right) - getVideoArea(left));
}

export function listVisibleVideoSources(): Array<{ id: string; label: string }> {
  return collectVisibleVideos().map((video, index) => ({
    id: getVideoHandle(video),
    label: video.currentSrc || video.src || `Video ${index + 1}`,
  }));
}
