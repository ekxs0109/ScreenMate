const videoHandles = new WeakMap<HTMLVideoElement, string>();

let nextVideoHandle = 1;

export type VideoSource = {
  id: string;
  label: string;
  fingerprint?: VideoCandidate["fingerprint"];
  primaryUrl?: string | null;
  posterUrl?: string | null;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  format?: string | null;
  isVisible?: boolean;
  isPlaying?: boolean;
  readyState?: number | null;
  visibleArea?: number;
};

export type VideoCandidate = {
  id: string;
  label: string;
  fingerprint: {
    primaryUrl: string | null;
    pageUrl: string | null;
    elementId: string | null;
    label: string;
    visibleIndex: number;
  };
};

export type VideoDetectionDiagnostics = {
  collectedVideoCount: number;
  directVideoCount: number;
  frameKind: "top" | "subframe";
  href: string;
  readyState: DocumentReadyState;
  samples: string[];
};

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

function isPlayingVideo(video: HTMLVideoElement): boolean {
  return !video.paused && !video.ended;
}

function collectVideosFromRoot(
  root: ParentNode,
  videos: HTMLVideoElement[],
  seen: Set<HTMLVideoElement>,
) {
  for (const child of Array.from(root.children)) {
    if (isVideoElementNode(child)) {
      addVideo(child, videos, seen);
    }

    if (child.shadowRoot) {
      for (const shadowVideo of Array.from(
        child.shadowRoot.querySelectorAll("video"),
      )) {
        addVideo(shadowVideo as HTMLVideoElement, videos, seen);
      }

      collectVideosFromRoot(child.shadowRoot, videos, seen);
    }

    collectVideosFromRoot(child, videos, seen);
  }
}

function rankVideos(left: HTMLVideoElement, right: HTMLVideoElement): number {
  const leftVisible = isRenderableVideo(left);
  const rightVisible = isRenderableVideo(right);

  if (leftVisible !== rightVisible) {
    return leftVisible ? -1 : 1;
  }

  const leftPlaying = leftVisible && isPlayingVideo(left);
  const rightPlaying = rightVisible && isPlayingVideo(right);

  if (leftPlaying !== rightPlaying) {
    return leftPlaying ? -1 : 1;
  }

  return getVideoArea(right) - getVideoArea(left);
}

function formatVideoLabel(video: HTMLVideoElement, index: number): string {
  const baseLabel =
    video.currentSrc ||
    video.src ||
    video.getAttribute("poster") ||
    video.id ||
    `Video ${index + 1}`;

  return isRenderableVideo(video)
    ? baseLabel
    : `${baseLabel} (not visible)`;
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
  return collectPageVideos().filter(isRenderableVideo);
}

export function collectPageVideos(): HTMLVideoElement[] {
  const videos: HTMLVideoElement[] = [];
  const seen = new Set<HTMLVideoElement>();

  for (const video of Array.from(document.querySelectorAll("video"))) {
    addVideo(video as HTMLVideoElement, videos, seen);
  }

  collectVideosFromRoot(document, videos, seen);

  return videos.sort(rankVideos);
}

export function findVisibleVideoByHandle(
  handle: string,
): HTMLVideoElement | null {
  return collectPageVideos().find((video) => getVideoHandle(video) === handle) ?? null;
}

export function listVisibleVideoSources(): VideoSource[] {
  return collectPageVideos().map((video, index) => {
    const label = formatVideoLabel(video, index);
    const isVisible = isRenderableVideo(video);

    return {
      id: getVideoHandle(video),
      label,
      fingerprint: getVideoFingerprint(video, label, index),
      primaryUrl: video.currentSrc || video.src || null,
      posterUrl: video.getAttribute("poster"),
      thumbnailUrl: captureVideoFrameThumbnail(video),
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      format: getVideoFormat(video),
      isVisible,
      isPlaying: isVisible && isPlayingVideo(video),
      readyState: typeof video.readyState === "number" ? video.readyState : null,
      visibleArea: isVisible ? getVideoArea(video) : 0,
    };
  });
}

export function listVisibleVideoCandidates(): VideoCandidate[] {
  return collectVisibleVideos().map((video, index) => {
    const label = formatVideoLabel(video, index);

    return {
      id: getVideoHandle(video),
      label,
      fingerprint: getVideoFingerprint(video, label, index),
    };
  });
}

/**
 * Returns fingerprint candidates for ALL videos on the page, including those
 * that are not yet renderable (zero dimensions, hidden, etc.).  This is used
 * by the recovery reattach flow where the video element may exist in the DOM
 * but is not yet visible (e.g. Bilibili's async player initialisation).
 */
export function listAllPageVideoCandidates(): VideoCandidate[] {
  return collectPageVideos().map((video, index) => {
    const label = formatVideoLabel(video, index);

    return {
      id: getVideoHandle(video),
      label,
      fingerprint: getVideoFingerprint(video, label, index),
    };
  });
}

function getVideoFingerprint(
  video: HTMLVideoElement,
  label: string,
  visibleIndex: number,
): VideoCandidate["fingerprint"] {
  return {
    primaryUrl: video.currentSrc || video.src || video.getAttribute("poster"),
    pageUrl: window.location.href,
    elementId: video.id || null,
    label,
    visibleIndex,
  };
}

export function getVideoDetectionDiagnostics(): VideoDetectionDiagnostics {
  const collectedVideos = collectPageVideos();
  const directVideos = Array.from(document.querySelectorAll("video"));

  return {
    collectedVideoCount: collectedVideos.length,
    directVideoCount: directVideos.length,
    frameKind: window.top === window ? "top" : "subframe",
    href: window.location.href,
    readyState: document.readyState,
    samples: directVideos
      .slice(0, 5)
      .map((video, index) => formatVideoSample(video as HTMLVideoElement, index)),
  };
}

function isVideoElementNode(node: Element): node is HTMLVideoElement {
  return node.tagName === "VIDEO";
}

function addVideo(
  video: HTMLVideoElement,
  videos: HTMLVideoElement[],
  seen: Set<HTMLVideoElement>,
) {
  if (seen.has(video)) {
    return;
  }

  seen.add(video);
  videos.push(video);
}

function captureVideoFrameThumbnail(video: HTMLVideoElement): string | null {
  if (!isRenderableVideo(video)) {
    return null;
  }

  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return null;
  }

  try {
    const maxWidth = 320;
    const aspectRatio = video.videoHeight / video.videoWidth;
    const width = Math.min(maxWidth, video.videoWidth);
    const height = Math.max(1, Math.round(width * aspectRatio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/webp", 0.72);
  } catch {
    return null;
  }
}

function formatVideoSample(video: HTMLVideoElement, index: number): string {
  const parts = [
    `#${index + 1}`,
    video.id ? `id=${video.id}` : null,
    video.className ? `class=${video.className}` : null,
    video.currentSrc || video.src ? `src=${video.currentSrc || video.src}` : null,
  ].filter(Boolean);

  return parts.join(" | ");
}

function getVideoFormat(video: HTMLVideoElement): string | null {
  const primaryUrl = video.currentSrc || video.src;
  if (!primaryUrl) {
    return null;
  }

  try {
    const pathname = new URL(primaryUrl, window.location.href).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    return extension && extension.length <= 5 ? extension : null;
  } catch {
    return null;
  }
}
