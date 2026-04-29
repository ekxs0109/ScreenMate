import { storage as wxtStorage } from "wxt/utils/storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createExtensionMockState, type ExtensionMockState } from "./mock-state";

type PopupUiStore = Omit<ExtensionMockState, "activeTab" | "activeSourceType"> & {
  selectedVideoId?: string | null;
  sniffScrollTop: number;
  setSelectedVideoId: (selectedVideoId: string | null) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  toggleScreenReady: () => void;
  setLocalFile: (file: { name: string; size: number; type: string } | null) => void;
  clearLocalFile: () => void;
  setPasswordDraft: (passwordDraft: string) => void;
  markPasswordSaved: () => void;
  appendLocalMessage: (text: string) => void;
  setSniffScrollTop: (scrollTop: number) => void;
};

const defaultState = createExtensionMockState();

export const usePopupUiStore = create<PopupUiStore>()(
  persist(
    (set) => ({
      ...defaultState,
      selectedVideoId: undefined,
      sniffScrollTop: 0,
      setSelectedVideoId: (selectedVideoId) => set({ selectedVideoId }),
      setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
      toggleScreenReady: () =>
        set((state) => ({ screenReady: !state.screenReady })),
      setLocalFile: (localFile) => set({ localFile, uploadReady: !!localFile }),
      clearLocalFile: () => set({ localFile: null, uploadReady: false }),
      setPasswordDraft: (passwordDraft) =>
        set({ passwordDraft, passwordSaved: false }),
      markPasswordSaved: () => set({ passwordSaved: true }),
      appendLocalMessage: (text) =>
        set((state) => ({
          messages: [
            ...state.messages,
            { id: `local-${Date.now()}`, sender: "You", text },
          ],
        })),
      setSniffScrollTop: (sniffScrollTop) => set({ sniffScrollTop }),
    }),
    {
      name: "screenmate-popup-ui",
      version: 3,
      storage: createJSONStorage(createPopupStateStorage),
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") {
          return persistedState;
        }

        const { activeTab: _tab, activeSourceType: _st, ...rest } =
          persistedState as Record<string, unknown>;
        return {
          ...rest,
          screenReady: false,
        };
      },
      partialize: (state) => ({
        uploadReady: state.uploadReady,
        localFile: state.localFile,
        passwordDraft: state.passwordDraft,
        passwordSaved: state.passwordSaved,
        selectedVideoId: state.selectedVideoId,
        sniffScrollTop: state.sniffScrollTop,
      }),
    },
  ),
);

function createPopupStateStorage(): StateStorage<Promise<void> | void> {
  return {
    async getItem(name) {
      try {
        return await wxtStorage.getItem<string>(`local:${name}`);
      } catch {
        return getLocalStorage()?.getItem(name) ?? null;
      }
    },
    setItem(name, value) {
      try {
        return wxtStorage.setItem(`local:${name}`, value).catch(() => {
          getLocalStorage()?.setItem(name, value);
        });
      } catch {
        getLocalStorage()?.setItem(name, value);
      }
    },
    removeItem(name) {
      try {
        return wxtStorage.removeItem(`local:${name}`).catch(() => {
          getLocalStorage()?.removeItem(name);
        });
      } catch {
        getLocalStorage()?.removeItem(name);
      }
    },
  };
}

function getLocalStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}
