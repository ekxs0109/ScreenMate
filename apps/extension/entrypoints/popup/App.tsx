import "./popup.css";
import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { browser } from "wxt/browser";
import { buildScreenMateViewerRoomUrl } from "../../lib/config";
import { cn } from "../../lib/utils";
import { getExtensionDictionary } from "./i18n";
import { ExtensionPopupPresenter } from "./presenter";
import { usePopupUiStore } from "./popup-ui-store";
import { buildExtensionSceneModel } from "./scene-adapter";
import { useHostControls } from "./useHostControls";

function App() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const activeTab = usePopupUiStore((state) => state.activeTab);
  const activeSourceType = usePopupUiStore((state) => state.activeSourceType);
  const screenReady = usePopupUiStore((state) => state.screenReady);
  const uploadReady = usePopupUiStore((state) => state.uploadReady);
  const passwordDraft = usePopupUiStore((state) => state.passwordDraft);
  const passwordSaved = usePopupUiStore((state) => state.passwordSaved);
  const messages = usePopupUiStore((state) => state.messages);
  const viewerDetails = usePopupUiStore((state) => state.viewerDetails);
  const persistedSelectedVideoId = usePopupUiStore((state) => state.selectedVideoId);
  const sniffScrollTop = usePopupUiStore((state) => state.sniffScrollTop);
  const setActiveTab = usePopupUiStore((state) => state.setActiveTab);
  const setActiveSourceType = usePopupUiStore(
    (state) => state.setActiveSourceType,
  );
  const toggleScreenReady = usePopupUiStore((state) => state.toggleScreenReady);
  const setPasswordDraft = usePopupUiStore((state) => state.setPasswordDraft);
  const markPasswordSaved = usePopupUiStore((state) => state.markPasswordSaved);
  const setActiveRoomTab = usePopupUiStore((state) => state.setActiveRoomTab);
  const setSourceTab = usePopupUiStore((state) => state.setSourceTab);
  const appendLocalMessage = usePopupUiStore((state) => state.appendLocalMessage);
  const persistSelectedVideoId = usePopupUiStore(
    (state) => state.setSelectedVideoId,
  );
  const setSniffScrollTop = usePopupUiStore((state) => state.setSniffScrollTop);
  const setLocalFile = usePopupUiStore((state) => state.setLocalFile);
  const clearLocalFile = usePopupUiStore((state) => state.clearLocalFile);
  const localFile = usePopupUiStore((state) => state.localFile);

  const [language, setLanguage] = useState("en");

  const {
    snapshot,
    sniffTabs,
    videos,
    selectedVideoId,
    setSelectedVideoId,
    refreshVideos,
    previewVideo,
    clearVideoPreview,
    startOrAttach,
    stopRoom,
    sendChatMessage,
    isBusy,
    busyAction,
    isRefreshing,
  } = useHostControls({
    persistedSelectedVideoId,
    onSelectedVideoChange: persistSelectedVideoId,
  });

  const windowMode =
    new URLSearchParams(window.location.search).get("mode") === "popout"
      ? "popout"
      : "popup";
  const copy = getExtensionDictionary();
  const viewerRoomUrl = snapshot.roomId
    ? buildScreenMateViewerRoomUrl(snapshot.roomId)
    : null;
  const scene = useMemo(
    () =>
      buildExtensionSceneModel({
        snapshot,
        sniffTabs,
        videos,
        selectedVideoId,
        isBusy,
        busyAction,
        viewerRoomUrl,
        mock: {
          activeTab,
          activeSourceType,
          screenReady,
          uploadReady,
          passwordDraft,
          passwordSaved,
          copiedLink: false,
          copiedRoomId: false,
          isRefreshing,
          messages,
          viewerDetails,
          localFile,
        },
      }),
    [
      activeSourceType,
      activeTab,
      busyAction,
      isBusy,
      isRefreshing,
      messages,
      passwordDraft,
      passwordSaved,
      screenReady,
      selectedVideoId,
      snapshot,
      sniffTabs,
      uploadReady,
      videos,
      viewerDetails,
      viewerRoomUrl,
      localFile,
      sendChatMessage,
    ],
  );

  return (
    <div
      className={cn(
        "w-full h-full",
        windowMode === "popout" &&
        "flex min-h-dvh w-screen items-start justify-center overflow-auto bg-background p-4 sm:items-center",
      )}
    >
      <ExtensionPopupPresenter
        windowMode={windowMode}
        scene={scene}
        copy={copy}
        language={language}
        onLanguageChange={setLanguage}
        themeMode={theme === "light" || theme === "dark" ? theme : "system"}
        resolvedThemeMode={resolvedTheme === "light" ? "light" : "dark"}
        sniffScrollTop={sniffScrollTop}
        onThemeToggle={() => {
          const nextTheme =
            theme === "system"
              ? "light"
              : theme === "light"
                ? "dark"
                : "system";
          setTheme(nextTheme);
        }}
        onOpenPopout={() => {
          const popoutUrl = new URL(window.location.href);
          popoutUrl.searchParams.set("mode", "popout");
          window.open(
            popoutUrl.toString(),
            "_blank",
            "popup=yes,width=420,height=640,resizable=no,menubar=no,toolbar=no,location=no,status=no",
          );
        }}
        onSelectTab={setActiveTab}
        onSelectSourceType={setActiveSourceType}
        onSelectSource={(id) => {
          setSelectedVideoId(id);
        }}
        onPreviewSource={previewVideo}
        onClearSourcePreview={clearVideoPreview}
        onRefreshSniff={async () => {
          await refreshVideos();
        }}
        onSniffScrollChange={setSniffScrollTop}
        onOpenPlayer={() => {
          browser.tabs.create({ url: browser.runtime.getURL("/player.html") });
        }}
        onCaptureScreen={async (type) => {
          try {
            const constraints: DisplayMediaStreamOptions = {
              video: {
                // displaySurface is part of modern spec but might not be in all type defs
                displaySurface: type === "window" ? "window" : type === "tab" ? "browser" : "monitor",
              },
              audio: {
                // Enable audio toggle in the picker
                echoCancellation: true,
                noiseSuppression: true,
              },
            };

            const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
            
            console.log(`Captured video stream (${type}):`, stream);
            console.log("Video tracks:", stream.getVideoTracks());
            console.log("Audio tracks:", stream.getAudioTracks());

            // Listen for the user stopping the share via the browser's "Stop sharing" bar
            stream.getVideoTracks()[0].onended = () => {
              console.log("Screen sharing ended by user/browser.");
              toggleScreenReady(); // Toggle back to initial state
            };

            toggleScreenReady();
          } catch (error) {
            if ((error as Error).name === "NotAllowedError") {
              console.warn("User cancelled screen capture picker.");
            } else {
              console.error("Failed to get display media:", error);
            }
          }
        }}
        onToggleScreenReady={toggleScreenReady}
        onSelectLocalFile={setLocalFile}
        onClearLocalFile={clearLocalFile}
        onStartOrAttach={async () => {
          await startOrAttach();
          setActiveRoomTab();
        }}
        onStopRoom={async () => {
          await stopRoom();
          setSourceTab();
        }}
        onSavePassword={markPasswordSaved}
        onPasswordChange={setPasswordDraft}
        onCopyLink={() => {
          if (viewerRoomUrl) {
            void navigator.clipboard.writeText(viewerRoomUrl);
          }
        }}
        onCopyRoomId={() => {
          if (snapshot.roomId) {
            void navigator.clipboard.writeText(snapshot.roomId);
          }
        }}
        onJumpToRoom={() => {
          if (viewerRoomUrl) {
            window.open(viewerRoomUrl, "_blank");
          }
        }}
        onSendChat={async (text) => {
          if (snapshot.roomId && snapshot.roomLifecycle !== "closed") {
            return sendChatMessage(text);
          }

          appendLocalMessage(text);
          return true;
        }}
      />
    </div>
  );
}

export default App;
