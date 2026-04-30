import "./popup.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { browser } from "wxt/browser";
import { buildScreenMateViewerRoomUrl } from "../../lib/config";
import { cn } from "../../lib/utils";
import { getExtensionDictionary } from "./i18n";
import { ExtensionPopupPresenter } from "./presenter";
import { usePopupUiStore } from "./popup-ui-store";
import { usePopupSessionStore } from "./popup-session-store";
import { shouldShowSnapshotToast } from "./popup-toast";
import { buildExtensionSceneModel } from "./scene-adapter";
import { useHostControls } from "./useHostControls";
import { ToastViewport, useToastQueue } from "../../components/toast";

function App() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const activeTab = usePopupSessionStore((state) => state.activeTab);
  const activeSourceType = usePopupSessionStore((state) => state.activeSourceType);
  const setActiveTab = usePopupSessionStore((state) => state.setActiveTab);
  const setActiveSourceType = usePopupSessionStore(
    (state) => state.setActiveSourceType,
  );
  const setSourceTab = usePopupSessionStore((state) => state.setSourceTab);
  const screenReady = usePopupUiStore((state) => state.screenReady);
  const uploadReady = usePopupUiStore((state) => state.uploadReady);
  const passwordDraft = usePopupUiStore((state) => state.passwordDraft);
  const passwordSaved = usePopupUiStore((state) => state.passwordSaved);
  const messages = usePopupUiStore((state) => state.messages);
  const viewerDetails = usePopupUiStore((state) => state.viewerDetails);
  const persistedSelectedVideoId = usePopupUiStore((state) => state.selectedVideoId);
  const sniffScrollTop = usePopupUiStore((state) => state.sniffScrollTop);
  const setPasswordDraft = usePopupUiStore((state) => state.setPasswordDraft);
  const markPasswordSaved = usePopupUiStore((state) => state.markPasswordSaved);
  const appendLocalMessage = usePopupUiStore((state) => state.appendLocalMessage);
  const persistSelectedVideoId = usePopupUiStore(
    (state) => state.setSelectedVideoId,
  );
  const setSniffScrollTop = usePopupUiStore((state) => state.setSniffScrollTop);
  const localFile = usePopupUiStore((state) => state.localFile);
  const { dismissToast, pushToast, toasts } = useToastQueue();
  const lastToastMessageRef = useRef<string | null>(null);

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
    createRoomSession,
    startSharing,
    stopSource,
    stopRoom,
    sendChatMessage,
    saveRoomPassword,
    followActiveTabVideo,
    setFollowActiveTabVideo,
    preparedSourceState,
    prepareScreenSource,
    clearPreparedSourceState,
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
        followActiveTabVideo,
        preparedSourceState,
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
      followActiveTabVideo,
      preparedSourceState,
    ],
  );

  useEffect(() => {
    const message = snapshot.message;
    if (!message || message === lastToastMessageRef.current) {
      return;
    }

    lastToastMessageRef.current = message;
    if (
      !shouldShowSnapshotToast(
        { message },
        { activeSourceType, followActiveTabVideo },
      )
    ) {
      return;
    }

    pushToast(message, "error");
  }, [activeSourceType, followActiveTabVideo, pushToast, snapshot.message]);

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
        onCreateRoom={() => {
          void createRoomSession();
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
          if (followActiveTabVideo) {
            void setFollowActiveTabVideo(false);
          }
        }}
        onPreviewSource={previewVideo}
        onClearSourcePreview={clearVideoPreview}
        onRefreshSniff={async () => {
          await refreshVideos();
        }}
        onToggleFollowActiveTabVideo={(enabled) => {
          void (async () => {
            await setFollowActiveTabVideo(enabled);
            if (enabled) {
              await startSharing("auto", { autoAttach: true });
            }
          })();
        }}
        onSniffScrollChange={setSniffScrollTop}
        onOpenPlayer={() => {
          browser.tabs.create({ url: browser.runtime.getURL("/player.html") });
        }}
        onCaptureScreen={async (type) => {
          await prepareScreenSource(type);
        }}
        onToggleScreenReady={clearPreparedSourceState}
        onStopScreenShare={async () => {
          if (followActiveTabVideo) {
            await setFollowActiveTabVideo(false);
          }
          await stopSource();
        }}
        onStopLocalPlayback={async () => {
          if (followActiveTabVideo) {
            await setFollowActiveTabVideo(false);
          }
          await stopSource();
        }}
        onStartOrAttach={async (sourceType = activeSourceType, options = {}) => {
          if (options.selectedVideoId) {
            setSelectedVideoId(options.selectedVideoId);
            if (followActiveTabVideo) {
              void setFollowActiveTabVideo(false);
            }
          }
          await startSharing(sourceType, {
            selectedVideoId: options.selectedVideoId,
          });
        }}
        onStopRoom={async () => {
          if (followActiveTabVideo) {
            void setFollowActiveTabVideo(false);
          }
          await stopRoom();
          setSourceTab();
        }}
        onSavePassword={async () => {
          if (await saveRoomPassword(passwordDraft)) {
            markPasswordSaved();
          }
        }}
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
      <ToastViewport onDismiss={dismissToast} toasts={toasts} />
    </div>
  );
}

export default App;
