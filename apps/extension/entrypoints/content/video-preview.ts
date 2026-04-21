import { createLogger } from "../../lib/logger";
import { findVisibleVideoByHandle } from "./video-detector";

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
      cancelAnimationFrame(scheduledRefreshId);
    }

    scheduledRefreshId = requestAnimationFrame(() => {
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

    if (document.hidden) {
      hidePreviewOverlay();
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
    showVideoSelectionPreview({
      frameId: currentSelection.frameId,
      label: currentSelection.label,
      video,
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
      cancelAnimationFrame(scheduledRefreshId);
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
  overlay.textContent = `Selected · ${label} · ID ${videoId}${frameId === 0 ? "" : ` · iframe #${frameId}`}`;
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
    border: "3px dashed #ffffff",
    background:
      "linear-gradient(135deg, rgba(20, 184, 166, 0.28), rgba(14, 116, 144, 0.18))",
    boxShadow: "0 0 0 2px rgba(15, 23, 42, 0.6), 0 18px 36px rgba(15, 23, 42, 0.35)",
    borderRadius: "16px",
    color: "#f8fafc",
    fontFamily: "\"IBM Plex Sans\", \"Segoe UI\", sans-serif",
    fontSize: "13px",
    fontWeight: "700",
    lineHeight: "1.35",
    padding: "12px",
    display: "none",
    overflow: "hidden",
    textShadow: "0 1px 1px rgba(15, 23, 42, 0.6)",
  });

  document.documentElement.appendChild(overlay);
  return overlay;
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
