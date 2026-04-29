import { storage as wxtStorage } from "wxt/utils/storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { PopupTab, SourceType } from "./scene-model";

type SessionTabState = {
  activeTab: PopupTab;
  activeSourceType: SourceType;
  setActiveTab: (tab: PopupTab) => void;
  setActiveSourceType: (sourceType: SourceType) => void;
  setActiveRoomTab: () => void;
  setSourceTab: () => void;
};

export const usePopupSessionStore = create<SessionTabState>()(
  persist(
    (set) => ({
      activeTab: "source",
      activeSourceType: "auto",
      setActiveTab: (activeTab) => set({ activeTab }),
      setActiveSourceType: (activeSourceType) => set({ activeSourceType }),
      setActiveRoomTab: () => set({ activeTab: "room" }),
      setSourceTab: () => set({ activeTab: "source" }),
    }),
    {
      name: "screenmate-popup-session-tab",
      version: 1,
      storage: createJSONStorage(createSessionStorage),
    },
  ),
);

function createSessionStorage(): StateStorage<Promise<void> | void> {
  return {
    async getItem(name) {
      try {
        return await wxtStorage.getItem<string>(`session:${name}`);
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      try {
        void wxtStorage.setItem(`session:${name}`, value);
      } catch {
        // session storage unavailable — silently ignore
      }
    },
    removeItem(name) {
      try {
        void wxtStorage.removeItem(`session:${name}`);
      } catch {
        // session storage unavailable — silently ignore
      }
    },
  };
}
