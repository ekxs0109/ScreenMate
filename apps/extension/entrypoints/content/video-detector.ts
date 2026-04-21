const videoHandles = new WeakMap<HTMLVideoElement, string>();

let nextVideoHandle = 1;

export type VideoSource = {
  id: string;
  label: string;
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
  return collectPageVideos().map((video, index) => ({
    id: getVideoHandle(video),
    label: formatVideoLabel(video, index),
  }));
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

function formatVideoSample(video: HTMLVideoElement, index: number): string {
  const parts = [
    `#${index + 1}`,
    video.id ? `id=${video.id}` : null,
    video.className ? `class=${video.className}` : null,
    video.currentSrc || video.src ? `src=${video.currentSrc || video.src}` : null,
  ].filter(Boolean);

  return parts.join(" | ");
}
