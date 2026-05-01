import { createLogger } from "../../lib/logger";
import { collectVisibleVideos, findVisibleVideoByHandle } from "./video-detector";

const previewLogger = createLogger("content:preview");
const PREVIEW_ATTR = "data-screenmate-preview";
const PREVIEW_ACK = { ok: true } as const;

type PreviewSelection = {
  active: boolean;
  frameId: number;
  label: string;
  videoId: string;
};

type ShowPreviewInput = {
  frameId: number;
  label: string;
  video: HTMLVideoElement;
  videoId: string;
};

export function createVideoPreviewController() {
  let currentSelection: PreviewSelection | null = null;
  let mutationObserver: MutationObserver | null = null;
  let cleanupCallbacks: Array<() => void> = [];
  let scheduledRefreshId = 0;
  let hasLoggedMissingVideo = false;

  function preview(selection: PreviewSelection) {
    if (!selection.active) {
      clear();
      return PREVIEW_ACK;
    }

    currentSelection = selection;
    hasLoggedMissingVideo = false;
    startAutoRefresh();
    refresh("preview-message");
    return PREVIEW_ACK;
  }

  function clear() {
    currentSelection = null;
    hasLoggedMissingVideo = false;
    stopAutoRefresh();
    clearVideoSelectionPreview();
    previewLogger.info("Cleared page preview.");
    return PREVIEW_ACK;
  }

  function refresh(reason = "manual-refresh") {
    if (scheduledRefreshId) {
      cancelPreviewFrame(scheduledRefreshId);
    }

    scheduledRefreshId = requestPreviewFrame(() => {
      scheduledRefreshId = 0;
      renderPreview(reason);
    });
  }

  function destroy() {
    clear();
  }

  function renderPreview(reason: string) {
    if (!currentSelection) {
      clearVideoSelectionPreview();
      return;
    }

    const video = findVisibleVideoByHandle(currentSelection.videoId);
    if (!video) {
      if (!hasLoggedMissingVideo) {
        previewLogger.warn("Selected video is no longer available.", {
          reason,
          selection: currentSelection,
        });
        hasLoggedMissingVideo = true;
      }

      clearVideoSelectionPreview();
      return;
    }

    hasLoggedMissingVideo = false;
    const targetVideo = getPreviewTargetVideo(video);
    if (!targetVideo) {
      hidePreviewOverlay();
      return;
    }

    showVideoSelectionPreview({
      frameId: currentSelection.frameId,
      label: currentSelection.label,
      video: targetVideo,
      videoId: currentSelection.videoId,
    });
  }

  function startAutoRefresh() {
    if (cleanupCallbacks.length > 0) {
      return;
    }

    const refreshOnViewportChange = () => refresh("viewport-change");
    const refreshOnVisibilityChange = () => refresh("visibility-change");

    cleanupCallbacks = [
      addWindowListener("scroll", refreshOnViewportChange, true),
      addWindowListener("resize", refreshOnViewportChange),
      addWindowListener("fullscreenchange", refreshOnViewportChange),
      addWindowListener("hashchange", () => refresh("hash-change")),
      addWindowListener("popstate", () => refresh("popstate")),
      addWindowListener("pageshow", () => refresh("pageshow")),
      addWindowListener("wxt:locationchange", () => refresh("location-change")),
      addDocumentListener("visibilitychange", refreshOnVisibilityChange),
    ];

    mutationObserver = new MutationObserver(() => {
      refresh("dom-mutation");
    });
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  }

  function stopAutoRefresh() {
    if (scheduledRefreshId) {
      cancelPreviewFrame(scheduledRefreshId);
      scheduledRefreshId = 0;
    }

    mutationObserver?.disconnect();
    mutationObserver = null;

    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }
    cleanupCallbacks = [];
  }

  return {
    clear,
    destroy,
    preview,
    refresh,
  };
}

export function showVideoSelectionPreview({
  frameId,
  label,
  video,
  videoId,
}: ShowPreviewInput) {
  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    hidePreviewOverlay();
    return;
  }

  const overlay = ensurePreviewOverlay();
  overlay.style.display = "block";
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  
  overlay.innerHTML = `
    <div style="position:absolute;top:16px;left:16px;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:6px 12px;border-radius:8px;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,0.15);box-shadow:0 4px 12px rgba(0,0,0,0.3);">
      <div style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 10px #10b981;animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></div>
      <span style="letter-spacing:0.3px;">${escapeHtml(label)}</span>
      ${frameId === 0 ? "" : `<span style="opacity:0.6;font-size:11px;margin-left:4px;border-left:1px solid rgba(255,255,255,0.2);padding-left:8px;">iframe #${frameId}</span>`}
    </div>
  `;
}

export function clearVideoSelectionPreview() {
  document
    .querySelectorAll(`[${PREVIEW_ATTR}]`)
    .forEach((node) => node.remove());
}

function hidePreviewOverlay() {
  const overlay = document.querySelector(
    `[${PREVIEW_ATTR}="overlay"]`,
  ) as HTMLDivElement | null;

  if (!overlay) {
    return;
  }

  overlay.style.display = "none";
}

function getPreviewTargetVideo(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return video;
  }

  return collectVisibleVideos()[0] ?? null;
}

function ensurePreviewOverlay() {
  const existing = document.querySelector(
    `[${PREVIEW_ATTR}="overlay"]`,
  ) as HTMLDivElement | null;

  if (existing) {
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.setAttribute(PREVIEW_ATTR, "overlay");
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "3px solid #10b981",
    background: "rgba(16, 185, 129, 0.15)",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.1), 0 8px 32px rgba(16, 185, 129, 0.2), inset 0 0 0 1px rgba(255,255,255,0.2)",
    borderRadius: "12px",
    color: "#ffffff",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    display: "none",
    overflow: "hidden",
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
  });

  document.documentElement.appendChild(overlay);
  return overlay;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function addWindowListener(
  type: string,
  listener: EventListener,
  capture = false,
) {
  window.addEventListener(type, listener, capture);
  return () => {
    window.removeEventListener(type, listener, capture);
  };
}

function addDocumentListener(type: string, listener: EventListener) {
  document.addEventListener(type, listener);
  return () => {
    document.removeEventListener(type, listener);
  };
}

function requestPreviewFrame(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }

  return globalThis.setTimeout(callback, 16) as unknown as number;
}

function cancelPreviewFrame(id: number) {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
    return;
  }

  globalThis.clearTimeout(id);
}
