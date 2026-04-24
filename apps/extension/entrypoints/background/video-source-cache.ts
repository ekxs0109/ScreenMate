import type { TabVideoSource } from "../background";

export type SniffTabSummary = {
  tabId: number;
  title?: string;
  url?: string;
};

export type VideoSniffStatus = "idle" | "refreshing" | "success" | "error";

export type VideoSniffState = {
  tabs: SniffTabSummary[];
  videos: TabVideoSource[];
  status: VideoSniffStatus;
  isScanning: boolean;
  updatedAt: number | null;
  startedAt: number | null;
  refreshId: string | null;
  error: string | null;
};

export type VideoSniffStateStorage = {
  getValue: () => Promise<VideoSniffState | null>;
  setValue: (state: VideoSniffState) => Promise<void>;
};

export function createEmptyVideoSniffState(): VideoSniffState {
  return {
    tabs: [],
    videos: [],
    status: "idle",
    isScanning: false,
    updatedAt: null,
    startedAt: null,
    refreshId: null,
    error: null,
  };
}

export class VideoSourceCache {
  private cache = new Map<number, TabVideoSource[]>();
  private tabs = new Map<number, SniffTabSummary>();
  private stateMeta = createEmptyVideoSniffState();
  private hasRestored = false;
  private restorePromise: Promise<void> | null = null;

  constructor(private readonly storage?: VideoSniffStateStorage) {}

  async restore() {
    if (!this.storage || this.hasRestored) {
      return;
    }

    if (this.restorePromise) {
      return this.restorePromise;
    }

    this.restorePromise = this.storage
      .getValue()
      .then((state) => {
        this.cache.clear();
        this.tabs.clear();
        const restoredState = normalizeVideoSniffState(state);
        this.stateMeta = {
          ...restoredState,
          videos: [],
        };
        for (const tab of restoredState.tabs) {
          this.tabs.set(tab.tabId, tab);
        }
        for (const video of restoredState.videos) {
          this.addToMemory(video.tabId, video);
          if (!this.tabs.has(video.tabId)) {
            this.tabs.set(video.tabId, {
              tabId: video.tabId,
              ...(video.tabTitle !== undefined && { title: video.tabTitle }),
            });
          }
        }
        this.hasRestored = true;
      })
      .finally(() => {
        this.restorePromise = null;
      });

    return this.restorePromise;
  }

  async setForTab(tabId: number, videos: TabVideoSource[]) {
    await this.restore();
    if (!this.tabs.has(tabId)) {
      const tabTitle = videos.find((video) => video.tabTitle)?.tabTitle;
      this.tabs.set(tabId, {
        tabId,
        ...(tabTitle !== undefined && { title: tabTitle }),
      });
    }
    if (videos.length === 0) {
      this.cache.delete(tabId);
    } else {
      this.cache.set(tabId, videos.map((video) => ({ ...video, tabId })));
    }
    await this.persist(null);
  }

  async setForFrame(tabId: number, frameId: number, videos: TabVideoSource[]) {
    await this.restore();
    if (!this.tabs.has(tabId)) {
      const tabTitle = videos.find((video) => video.tabTitle)?.tabTitle;
      this.tabs.set(tabId, {
        tabId,
        ...(tabTitle !== undefined && { title: tabTitle }),
      });
    }

    const otherFrameVideos = (this.cache.get(tabId) ?? []).filter(
      (video) => video.frameId !== frameId,
    );
    const nextVideos = [
      ...otherFrameVideos,
      ...videos.map((video) => ({ ...video, frameId, tabId })),
    ];

    if (nextVideos.length === 0) {
      this.cache.delete(tabId);
    } else {
      this.cache.set(tabId, nextVideos);
    }
    await this.persist(null);
  }

  async setTabs(tabs: SniffTabSummary[]) {
    await this.restore();
    this.tabs.clear();
    for (const tab of tabs) {
      this.tabs.set(tab.tabId, tab);
    }
    await this.persist(null);
  }

  async replaceScanResults(
    tabs: SniffTabSummary[],
    videosByTab: Map<number, TabVideoSource[]>,
  ) {
    await this.restore();
    this.tabs.clear();
    this.cache.clear();
    for (const tab of tabs) {
      this.tabs.set(tab.tabId, tab);
      const videos = videosByTab.get(tab.tabId) ?? [];
      if (videos.length > 0) {
        this.cache.set(
          tab.tabId,
          videos.map((video) => ({
            ...video,
            tabId: tab.tabId,
            tabTitle: video.tabTitle ?? tab.title,
          })),
        );
      }
    }
    await this.persist(null);
  }

  async removeTab(tabId: number) {
    await this.restore();
    this.cache.delete(tabId);
    this.tabs.delete(tabId);
    await this.persist(null);
  }

  getAll(): TabVideoSource[] {
    return Array.from(this.cache.values()).flat();
  }

  getTabs(): SniffTabSummary[] {
    return Array.from(this.tabs.values());
  }

  getForTab(tabId: number): TabVideoSource[] {
    return this.cache.get(tabId) ?? [];
  }

  getState(): VideoSniffState {
    return {
      ...this.stateMeta,
      tabs: this.getTabs(),
      videos: this.getAll(),
      isScanning: this.stateMeta.status === "refreshing",
    };
  }

  async markScanning(tabs: SniffTabSummary[] = []) {
    await this.restore();
    for (const tab of tabs) {
      this.tabs.set(tab.tabId, tab);
    }
    const now = Date.now();
    this.stateMeta = {
      ...this.stateMeta,
      tabs: [],
      videos: [],
      status: "refreshing",
      isScanning: true,
      updatedAt: now,
      startedAt: now,
      refreshId: createRefreshId(),
      error: null,
    };
    await this.storage?.setValue({
      ...this.getState(),
      isScanning: true,
    });
  }

  async markScanError(error: string) {
    await this.restore();
    await this.persist(error);
  }

  async clear() {
    await this.restore();
    this.cache.clear();
    this.tabs.clear();
    await this.persist(null);
  }

  private addToMemory(tabId: number, video: TabVideoSource) {
    const existing = this.cache.get(tabId) ?? [];
    existing.push({ ...video, tabId });
    this.cache.set(tabId, existing);
  }

  private async persist(error: string | null) {
    const now = Date.now();
    this.stateMeta = {
      ...this.stateMeta,
      tabs: [],
      videos: [],
      status: error ? "error" : "success",
      isScanning: false,
      updatedAt: now,
      startedAt: null,
      error,
    };
    await this.storage?.setValue({
      ...this.getState(),
    });
  }
}

function normalizeVideoSniffState(
  state: VideoSniffState | null | undefined,
): VideoSniffState {
  const empty = createEmptyVideoSniffState();
  if (!state || typeof state !== "object") {
    return empty;
  }

  const status =
    state.status ??
    (state.isScanning ? "refreshing" : state.error ? "error" : "success");

  return {
    tabs: Array.isArray(state.tabs) ? state.tabs.filter(isSniffTabSummary) : [],
    videos: Array.isArray(state.videos) ? state.videos : [],
    status,
    isScanning: status === "refreshing",
    updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : null,
    startedAt:
      typeof state.startedAt === "number"
        ? state.startedAt
        : status === "refreshing" && typeof state.updatedAt === "number"
          ? state.updatedAt
          : null,
    refreshId: typeof state.refreshId === "string" ? state.refreshId : null,
    error: typeof state.error === "string" ? state.error : null,
  };
}

function isSniffTabSummary(value: unknown): value is SniffTabSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SniffTabSummary).tabId === "number"
  );
}

function createRefreshId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
