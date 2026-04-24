// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const messages = {
  appName: "SyncPlay",
  tabSource: "Origen",
  tabRoom: "Sala Ajustes",
  tabChat: "Chat",
  sourceSniff: "Reconocer",
  sourceScreen: "Compartir Pantalla",
  sourceUpload: "Subir Archivo",
  detected: "Medios detectados",
  mockOrigin: "Pestaña",
  refreshSniff: "Refrescar",
  noVideo: "No se detectó video en esta página.",
  captureTitle: "Capturar pantalla o ventana",
  captureDescription: "Comparte una pestaña, una ventana de app o todo el escritorio.",
  captureButton: "Seleccionar contenido",
  screenReady: "Pantalla lista",
  screenReadyDescription: "Fuente capturada. Haz clic abajo para iniciar la sala.",
  reselect: "Volver a elegir",
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
      mock: createExtensionMockState(),
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
    expect(screen.queryByText("Room open · attached")).toBeNull();
  });

  it("previews sniff cards on hover without selecting them", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
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
    expect(onSelectSource).toHaveBeenCalledWith("42:0:video-1");
    expect(onClearSourcePreview).toHaveBeenCalledTimes(1);
  });

  it("shows a neutral placeholder instead of a generated image when a video has no poster", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      videos: [
        { id: "video-1", tabId: 42, frameId: 0, label: "Big Buck Bunny" },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
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
      snapshot: createHostRoomSnapshot(),
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
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
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
      snapshot: createHostRoomSnapshot(),
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
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
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
});
