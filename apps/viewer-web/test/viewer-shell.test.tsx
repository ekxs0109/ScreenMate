// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

describe("ViewerShell", () => {
  it("renders the migrated viewer header, sidebar, and join overlay", () => {
    const scene = buildViewerSceneModel({
      locale: "zh",
      session: initialViewerSessionState,
      mock: createViewerMockState("zh"),
    });

    render(
      <ViewerI18nProvider initialLocale="zh">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <ViewerShell
            scene={scene}
            stream={null}
            onJoin={vi.fn(async () => undefined)}
            onLeaveRoom={vi.fn()}
            onJoinOtherRoom={vi.fn()}
            onRandomizeUsername={vi.fn()}
            onSendMessage={vi.fn()}
          />
        </ThemeProvider>
      </ViewerI18nProvider>,
    );

    expect(screen.getByText("ScreenMate")).toBeTruthy();
    expect(screen.getByText("同步状态")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "加入房间" })).toBeTruthy();
    expect(screen.getByText(/随机/)).toBeTruthy();
  });
});
