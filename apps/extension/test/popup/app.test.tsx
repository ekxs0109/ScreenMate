// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const messages = {
  appName: "SyncPlay",
  tabSource: "Origen",
  tabRoom: "Sala Ajustes",
  tabChat: "Chat",
  sourceAuto: "Auto",
  sourceAutoDescription: "Sigue la pestaña activa del anfitrión automáticamente.",
  autoEnable: "Activar toma",
  autoDisable: "Desactivar toma",
  sourceSniff: "Reconocer",
  sourceScreen: "Compartir Pantalla",
  sourceUpload: "Subir Archivo",
  detected: "Medios detectados",
  followAuto: "Auto",
  followAutoDescription: "Sigue la pestaña que está viendo el anfitrión",
  currentPlayback: "Reproduciendo",
  waitingPlayback: "Esperando video",
  webVideoStream: "Stream de video web",
  autoMode: "Seguimiento auto",
  manualMode: "Selección manual",
  autoFollowEmptyTitle: "Seguimiento automático activado",
  autoFollowEmptyDescription: "La sala seguirá la pestaña activa del anfitrión.",
  mockOrigin: "Pestaña",
  refreshSniff: "Refrescar",
  noVideo: "No se detectó video en esta página.",
  captureTitle: "Capturar pantalla o ventana",
  captureDescription: "Comparte una pestaña, una ventana de app o todo el escritorio.",
  captureButton: "Seleccionar contenido",
  screenReady: "Pantalla lista",
  screenReadyDescription: "Fuente capturada. Haz clic abajo para iniciar la sala.",
  reselect: "Volver a elegir",
  openPlayer: "Abrir reproductor local",
  playerDesc: "Reproducción estable para archivos locales grandes.",
  uploadDropzone: "Haz clic o arrastra archivos de video",
  roomId: "ID Sala",
  openRoom: "Entrar",
  passwordPlaceholder: "Dejar en blanco para sin contraseña",
  save: "Guardar",
  saved: "Guardado",
  viewerList: "Conexiones de Espectadores",
  viewerName: "Nombre",
  connType: "Método",
  connPing: "Ping",
  notSharedYet: "No compartido",
  cancel: "Cancelar",
  changeSource: "Cambiar Fuente",
  generateShare: "Crear Sala",
  endShare: "Finalizar",
  roomChat: "Chat",
  chatPlaceholder: "Di algo...",
  popout: "Ventana",
  themeLabel: "Tema",
  themeLight: "Claro",
  themeDark: "Oscuro",
  themeSystem: "Sistema",
  sourceGateTitle: "Crea una sala primero",
  sourceGateDescription: "Crea una sala de sincronización antes de elegir recursos.",
  switchSource: "Cambiar",
  activeSource: "Activo",
  roomStatusIdle: "Sin sala",
  roomStatusOpen: "Sala creada",
  roomStatusStreaming: "Reproduciendo",
  roomStatusWaiting: "Esperando recurso",
  sourceShareBrowserTab: "Pestaña compartida",
  sourceShareScreen: "Pantalla compartida",
  sourceShareWindow: "Ventana compartida",
  closeBrowserTabShare: "Cerrar pestaña compartida",
  closeScreenShare: "Cerrar pantalla compartida",
  closeWindowShare: "Cerrar ventana compartida",
  closeDisplayShare: "Cerrar pantalla compartida",
  closeLocalPlayback: "Cerrar reproducción local",
};

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: keyof typeof messages) => messages[key] ?? `missing:${key}`,
  },
}));

import { ExtensionPopupPresenter } from "../../entrypoints/popup/presenter";
import { getExtensionDictionary } from "../../entrypoints/popup/i18n";
import { buildExtensionSceneModel } from "../../entrypoints/popup/scene-adapter";
import { createExtensionMockState } from "../../entrypoints/popup/mock-state";
import { createHostRoomSnapshot } from "../../entrypoints/background/host-room-snapshot";

describe("ExtensionPopupPresenter", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders popup tabs, source cards, and room controls from the scene", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        viewerCount: 3,
      }),
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
        { id: "video-2", tabId: 73, frameId: 0, label: "React Performance in 100 Seconds" },
      ],
      selectedVideoId: "42:0:video-1",
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    expect(screen.getByText("SyncPlay")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Origen" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sala Ajustes" })).toBeTruthy();
    expect(screen.getByText("Medios detectados")).toBeTruthy();
    expect(screen.getByText("Big Buck Bunny")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByText("Room open · attached", {
        selector: ":not([data-testid='popup-room-status'])",
      }),
    ).toBeNull();
  });

  it("renders the compact header as room state, active source mode, and source detail", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        activeTabId: -1,
        activeFrameId: -1,
        sourceLabel: "Shared browser tab",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "auto",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const summary = screen.getByTestId("popup-header-summary");
    expect(summary.textContent).toBe(
      "Reproduciendo·Compartir Pantalla·Pestaña compartida",
    );
    expect(summary.textContent).not.toContain("Auto");
    expect(summary.textContent).not.toContain("Selección manual");
    expect(summary.textContent).not.toContain("Shared browser tab");
  });

  it("omits the header source mode before a source is attached", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_demo",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "auto",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const summary = screen.getByTestId("popup-header-summary");
    expect(summary.textContent).toBe("Esperando recurso");
    expect(summary.getAttribute("title")).toBe("Esperando recurso");
    expect(summary.textContent).not.toContain("Auto");
    expect(summary.textContent).not.toContain("Esperando video");
  });

  it("shows auto in the header before a source is attached when follow is on", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_demo",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      followActiveTabVideo: true,
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "auto",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const summary = screen.getByTestId("popup-header-summary");
    expect(summary.textContent).toBe("Esperando recurso·Auto");
    expect(summary.getAttribute("title")).toBe("Esperando recurso · Auto");
    expect(summary.textContent).not.toContain("Esperando video");
  });

  it("switches a sniff source from the item action in an active room", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        viewerCount: 1,
      }),
      videos: [
        { id: "screenmate-video-1", tabId: 42, frameId: 0, label: "Bilibili video" },
      ],
      selectedVideoId: "42:0:screenmate-video-1",
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });
    const onStartOrAttach = vi.fn();
    const onSelectTab = vi.fn();

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={onSelectTab}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={onStartOrAttach}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("popup-sniff-switch-42:0:screenmate-video-1"));

    expect(onStartOrAttach).toHaveBeenCalledWith("sniff", {
      selectedVideoId: "42:0:screenmate-video-1",
    });
    expect(onSelectTab).not.toHaveBeenCalledWith("room");
  });

  it("previews sniff cards on hover without selecting them", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        roomId: "room_demo",
      }),
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });
    const onPreviewSource = vi.fn();
    const onClearSourcePreview = vi.fn();
    const onSelectSource = vi.fn();

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={onSelectSource}
        onPreviewSource={onPreviewSource}
        onClearSourcePreview={onClearSourcePreview}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const card = screen.getByRole("button", { name: /Big Buck Bunny/ });
    fireEvent.pointerEnter(card);
    fireEvent.click(card);
    fireEvent.pointerLeave(card);

    expect(onPreviewSource).toHaveBeenCalledWith("42:0:video-1");
    expect(onSelectSource).not.toHaveBeenCalled();
    expect(onClearSourcePreview).toHaveBeenCalledTimes(1);
  });

  it("shows the Auto tab enable CTA when follow is off and invokes the toggle", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        roomId: "room_demo",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: createExtensionMockState(),
    });
    const onToggleFollowActiveTabVideo = vi.fn();

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={onToggleFollowActiveTabVideo}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const enableButton = screen.getByTestId("popup-auto-enable");
    expect(screen.queryByTestId("popup-start-or-attach")).toBeNull();

    fireEvent.click(enableButton);

    expect(onToggleFollowActiveTabVideo).toHaveBeenCalledWith(true);
  });

  it("does not show the green source indicator merely for the selected source tab", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        roomId: "room_demo",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "screen",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const screenButton = screen.getByRole("button", {
      name: "Compartir Pantalla",
    });

    expect(
      screenButton.querySelector("[aria-hidden='true'].bg-emerald-500"),
    ).toBeFalsy();
  });

  it("shows the green source indicator only on the currently attached source tab", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        sourceLabel: "Shared screen",
        activeTabId: -1,
        activeFrameId: -1,
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      preparedSourceState: {
        status: "prepared-source",
        kind: "screen",
        ready: true,
        label: "Shared screen",
        metadata: null,
        captureType: "screen",
        error: null,
      },
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "upload",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const screenButton = screen.getByRole("button", {
      name: "Compartir Pantalla",
    });
    const uploadButton = screen.getByRole("button", {
      name: "Subir Archivo",
    });

    expect(screenButton.dataset.sourceActive).toBe("true");
    expect(uploadButton.dataset.sourceActive).toBe("false");
  });

  it("shows the local player tab as playing when the local file is attached", () => {
    const onStopLocalPlayback = vi.fn();
    const onOpenPlayer = vi.fn();
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        sourceLabel: "demo-local-file.mkv",
        activeTabId: -1,
        activeFrameId: -1,
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      preparedSourceState: {
        status: "prepared-source",
        kind: "upload",
        ready: true,
        label: "demo-local-file.mkv",
        metadata: {
          id: "local-demo",
          name: "demo-local-file.mkv",
          size: 12,
          type: "video/x-matroska",
          updatedAt: 123,
        },
        fileId: "local-demo",
        error: null,
      },
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "upload",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={vi.fn()}
        onStopLocalPlayback={onStopLocalPlayback}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={onOpenPlayer}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const uploadPanel = screen.getByTestId("popup-upload-panel");
    expect(within(uploadPanel).getByText("Reproduciendo")).toBeTruthy();
    expect(within(uploadPanel).getByText("demo-local-file.mkv")).toBeTruthy();
    expect(within(uploadPanel).queryByText(messages.playerDesc)).toBeNull();

    fireEvent.click(
      within(uploadPanel).getByRole("button", {
        name: "Cerrar reproducción local",
      }),
    );

    expect(onStopLocalPlayback).toHaveBeenCalledTimes(1);
    expect(onOpenPlayer).not.toHaveBeenCalled();
  });

  it("shows the attached browser-tab screen share when reopening the popup", () => {
    const onStopScreenShare = vi.fn();
    const onToggleScreenReady = vi.fn();
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        activeTabId: -1,
        activeFrameId: -1,
        sourceLabel: "Shared browser tab",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "screen",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={onToggleScreenReady}
        onStopScreenShare={onStopScreenShare}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    expect(screen.getByText("Pantalla lista")).toBeTruthy();
    const closeButton = screen.getByRole("button", {
      name: "Cerrar pestaña compartida",
    });
    expect(closeButton).toBeTruthy();
    expect(screen.queryByText("Transmission")).toBeNull();
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(screen.queryByText("Toda la pantalla")).toBeNull();
    expect(screen.queryByText("Ventana")).toBeNull();
    expect(screen.queryByText("Pestaña")).toBeNull();

    fireEvent.click(closeButton);

    expect(onStopScreenShare).toHaveBeenCalledTimes(1);
    expect(onToggleScreenReady).not.toHaveBeenCalled();
  });

  it("shows the Auto tab status card without a footer when follow is on", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        sourceLabel: "blob:https://www.bilibili.com/source",
        viewerCount: 1,
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      followActiveTabVideo: true,
      mock: createExtensionMockState(),
    });
    const onToggleFollowActiveTabVideo = vi.fn();
    const onStopRoom = vi.fn();

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={onToggleFollowActiveTabVideo}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={onStopRoom}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    expect(screen.getByText("Seguimiento automático activado")).toBeTruthy();
    expect(screen.getAllByText("Stream de video web").length).toBeGreaterThan(0);

    const disableButton = screen.getByTestId("popup-auto-disable");
    fireEvent.click(disableButton);
    expect(onToggleFollowActiveTabVideo).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("popup-stop-room")).toBeNull();
  });

  it("creates a room directly from the gate when no room exists", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      followActiveTabVideo: true,
      mock: createExtensionMockState(),
    });
    const onCreateRoom = vi.fn();

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onToggleFollowActiveTabVideo={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onCreateRoom={onCreateRoom}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    expect(screen.getByText("Crea una sala primero")).toBeTruthy();
    expect(screen.queryByTestId("popup-start-or-attach")).toBeNull();
    fireEvent.click(screen.getByTestId("popup-create-room"));
    expect(onCreateRoom).toHaveBeenCalledTimes(1);
  });

  it("shows a neutral placeholder instead of a generated image when a video has no poster", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        roomId: "room_demo",
      }),
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    expect(screen.queryByRole("img", { name: "Big Buck Bunny" })).toBeNull();
  });

  it("collapses and expands sniff tab groups", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        roomId: "room_demo",
      }),
      sniffTabs: [
        { tabId: 42, title: "Bilibili" },
        { tabId: 84, title: "No video tab" },
      ],
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const bilibiliToggle = screen.getByRole("button", {
      name: /标签 1 - Bilibili/,
    });

    expect(screen.getByRole("button", { name: /Big Buck Bunny/ })).toBeTruthy();
    fireEvent.click(bilibiliToggle);
    expect(screen.queryByRole("button", { name: /Big Buck Bunny/ })).toBeNull();
    expect(bilibiliToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(bilibiliToggle);
    expect(screen.getByRole("button", { name: /Big Buck Bunny/ })).toBeTruthy();
    expect(bilibiliToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("No se detectó video en esta página.")).toBeTruthy();
  });

  it("keeps the detected resources header outside the scrollable list", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        roomId: "room_demo",
      }),
      sniffTabs: [
        { tabId: 42, title: "Bilibili" },
        { tabId: 84, title: "No video tab" },
      ],
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Medios detectados").closest(".popup-scroll-area"),
    ).toBeNull();
    expect(
      screen.getByText("标签 1 - Bilibili").closest(".popup-scroll-area"),
    ).toBeTruthy();
  });

  it("shows the online viewer count and offline presence state from the room scene", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        viewerCount: 1,
        viewerRoster: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: true,
            connectionType: "direct",
            pingMs: 24,
            joinedAt: 1,
            profileUpdatedAt: 2,
            metricsUpdatedAt: 3,
          },
          {
            viewerSessionId: "viewer_2",
            displayName: "Noor",
            online: false,
            connectionType: "relay",
            pingMs: null,
            joinedAt: 4,
            profileUpdatedAt: null,
            metricsUpdatedAt: null,
          },
        ],
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: {
        ...createExtensionMockState(),
        activeTab: "room",
      },
    });

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={vi.fn()}
      />,
    );

    const viewerListHeader = screen
      .getByText("Conexiones de Espectadores")
      .closest("div")?.parentElement;
    const offlineRow = screen.getByText("Noor").closest("div.group");

    expect(viewerListHeader).toBeTruthy();
    expect(offlineRow).toBeTruthy();
    expect(within(viewerListHeader as HTMLElement).getByText("1")).toBeTruthy();
    expect(offlineRow?.innerHTML).toContain("bg-zinc-300");
    expect(offlineRow?.innerHTML).not.toContain("bg-green-500");
  });

  it("preserves the chat draft when async send returns false", async () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: {
        ...createExtensionMockState(),
        activeTab: "chat",
      },
    });
    const onSendChat = vi.fn().mockResolvedValue(false);

    render(
      <ExtensionPopupPresenter
        windowMode="popup"
        scene={scene}
        copy={getExtensionDictionary()}
        themeMode="dark"
        resolvedThemeMode="dark"
        sniffScrollTop={0}
        onThemeToggle={vi.fn()}
        onOpenPopout={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectSourceType={vi.fn()}
        onSelectSource={vi.fn()}
        onPreviewSource={vi.fn()}
        onClearSourcePreview={vi.fn()}
        onRefreshSniff={vi.fn()}
        onSniffScrollChange={vi.fn()}
        onToggleScreenReady={vi.fn()}
        onCaptureScreen={vi.fn()}
        onOpenPlayer={vi.fn()}
        onStartOrAttach={vi.fn()}
        onStopRoom={vi.fn()}
        onSavePassword={vi.fn()}
        onPasswordChange={vi.fn()}
        onCopyLink={vi.fn()}
        onCopyRoomId={vi.fn()}
        onJumpToRoom={vi.fn()}
        onSendChat={onSendChat}
      />,
    );

    const messageInput = screen.getByPlaceholderText("Di algo...") as HTMLInputElement;

    fireEvent.change(messageInput, { target: { value: "hello room" } });
    fireEvent.submit(messageInput.closest("form")!);

    await waitFor(() => {
      expect(onSendChat).toHaveBeenCalledWith("hello room");
    });
    expect(messageInput.value).toBe("hello room");
  });
});
