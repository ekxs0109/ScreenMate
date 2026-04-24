import { storage as wxtStorage } from "wxt/utils/storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createExtensionMockState, type ExtensionMockState } from "./mock-state";
import type { PopupTab, SourceType } from "./scene-model";

type PopupUiStore = ExtensionMockState & {
  selectedVideoId?: string | null;
  sniffScrollTop: number;
  setActiveTab: (tab: PopupTab) => void;
  setActiveSourceType: (sourceType: SourceType) => void;
  setSelectedVideoId: (selectedVideoId: string | null) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  toggleScreenReady: () => void;
  setPasswordDraft: (passwordDraft: string) => void;
  markPasswordSaved: () => void;
  setActiveRoomTab: () => void;
  setSourceTab: () => void;
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
      setActiveTab: (activeTab) => set({ activeTab }),
      setActiveSourceType: (activeSourceType) => set({ activeSourceType }),
      setSelectedVideoId: (selectedVideoId) => set({ selectedVideoId }),
      setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
      toggleScreenReady: () =>
        set((state) => ({ screenReady: !state.screenReady })),
      setPasswordDraft: (passwordDraft) =>
        set({ passwordDraft, passwordSaved: false }),
      markPasswordSaved: () => set({ passwordSaved: true }),
      setActiveRoomTab: () => set({ activeTab: "room" }),
      setSourceTab: () => set({ activeTab: "source" }),
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
      version: 1,
      storage: createJSONStorage(createPopupStateStorage),
      partialize: (state) => ({
        activeTab: state.activeTab,
        activeSourceType: state.activeSourceType,
        screenReady: state.screenReady,
        uploadReady: state.uploadReady,
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
