// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../src/components/theme-provider";
import { ViewerShell } from "../src/components/ViewerShell";
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
      session: initialViewerSessionState,
      mock: createViewerMockState(),
    });

    render(
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <ViewerShell
          scene={scene}
          stream={null}
          language="en"
          onLanguageChange={vi.fn()}
          onJoin={vi.fn(async () => undefined)}
          onLeaveRoom={vi.fn()}
          onJoinOtherRoom={vi.fn()}
          onRandomizeUsername={vi.fn()}
          onSendMessage={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("ScreenMate")).toBeTruthy();
    expect(screen.getByText("Sync Status")).toBeTruthy();
    expect(screen.getByText("Join Room")).toBeTruthy();
    expect(screen.getByText(/Randomize/)).toBeTruthy();
  });
});
