// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../src/components/theme-provider";
import { ViewerShell } from "../src/components/ViewerShell";
import { ViewerI18nProvider } from "../src/i18n";
import { buildViewerSceneModel } from "../src/viewer-scene-adapter";
import { createViewerMockState } from "../src/viewer-mock-state";
import { initialViewerSessionState } from "../src/lib/session-state";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

describe("ViewerShell", () => {
  it("renders the migrated viewer header, sidebar, and join overlay", () => {
    const scene = buildViewerSceneModel({
      locale: "zh",
      session: initialViewerSessionState,
      mock: createViewerMockState("zh"),
    });

    renderViewerShell(scene, { locale: "zh" });

    expect(screen.getByText("ScreenMate")).toBeTruthy();
    expect(screen.getByText("同步状态")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "加入房间" })).toBeTruthy();
    expect(screen.getByText(/随机/)).toBeTruthy();
  });

  it("commits controlled display name changes on blur and Enter", () => {
    const onDisplayNameChange = vi.fn();
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: {
        ...createViewerMockState("en"),
        username: "Mina",
      },
    });

    renderViewerShell(scene, { onDisplayNameChange });

    const nameInput = screen.getByDisplayValue("Mina") as HTMLInputElement;

    expect(nameInput.getAttribute("aria-label")).toMatch(/Name|名称/);
    expect(nameInput.value).toBe("Mina");

    fireEvent.change(nameInput, { target: { value: "Noa" } });
    fireEvent.blur(nameInput);

    expect(onDisplayNameChange).toHaveBeenCalledWith("Noa");

    nameInput.focus();
    fireEvent.change(nameInput, { target: { value: "Ira" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    expect(onDisplayNameChange).toHaveBeenCalledWith("Ira");
  });

  it("restores the current display name when a blank edit blurs", () => {
    const onDisplayNameChange = vi.fn();
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: {
        ...createViewerMockState("en"),
        username: "Mina",
      },
    });

    renderViewerShell(scene, { onDisplayNameChange });

    const nameInput = screen.getByDisplayValue("Mina") as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.blur(nameInput);

    expect(onDisplayNameChange).not.toHaveBeenCalled();
    expect(nameInput.value).toBe("Mina");
  });

  it("preserves failed chat sends and clears successful sends", () => {
    const onSendMessage = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: createViewerMockState("en"),
    });

    renderViewerShell(scene, { onSendMessage });

    const messageInput = screen.getByPlaceholderText(
      /Send a message|发送消息/,
    ) as HTMLInputElement;

    fireEvent.change(messageInput, { target: { value: "hello host" } });
    fireEvent.submit(messageInput.closest("form")!);

    expect(onSendMessage).toHaveBeenCalledWith("hello host");
    expect(messageInput.value).toBe("hello host");

    fireEvent.submit(messageInput.closest("form")!);

    expect(onSendMessage).toHaveBeenCalledWith("hello host");
    expect(messageInput.value).toBe("");
  });
});

function renderViewerShell(
  scene: Parameters<typeof ViewerShell>[0]["scene"],
  overrides: Partial<Parameters<typeof ViewerShell>[0]> & {
    locale?: "en" | "zh";
  } = {},
) {
  const { locale = "en", ...props } = overrides;

  return render(
    <ViewerI18nProvider initialLocale={locale}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <ViewerShell
          scene={scene}
          stream={null}
          onJoin={vi.fn(async () => undefined)}
          onLeaveRoom={vi.fn()}
          onJoinOtherRoom={vi.fn()}
          onRandomizeUsername={vi.fn()}
          onDisplayNameChange={vi.fn()}
          onSendMessage={vi.fn()}
          {...props}
        />
      </ThemeProvider>
    </ViewerI18nProvider>,
  );
}
