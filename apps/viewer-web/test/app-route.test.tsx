// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerI18nProvider } from "../src/i18n";
import type { ViewerSessionState } from "../src/lib/session-state";

const constructorSpy = vi.fn();
const destroySpy = vi.fn();
const joinSpy = vi.fn<(_: string, password?: string) => Promise<void>>();
let snapshot: ViewerSessionState;

vi.mock("../src/viewer-session", async () => {
  const { initialViewerSessionState } = await import("../src/lib/session-state");

  return {
    ViewerSession: class ViewerSession {
      constructor(options: { apiBaseUrl: string; initialDisplayName: string }) {
        constructorSpy(options);
      }

      subscribe(listener: (nextSnapshot: ViewerSessionState) => void) {
        listener(snapshot ?? initialViewerSessionState);
        return () => undefined;
      }

      destroy() {
        destroySpy();
      }

      getSnapshot() {
        return snapshot ?? initialViewerSessionState;
      }

      join(roomId: string, password?: string) {
        return joinSpy(roomId, password);
      }
    },
  };
});

import App from "../src/App";
import { initialViewerSessionState } from "../src/lib/session-state";

describe("App room routing", () => {
  beforeEach(() => {
    cleanup();
    constructorSpy.mockClear();
    destroySpy.mockClear();
    joinSpy.mockReset();
    joinSpy.mockResolvedValue(undefined);
    snapshot = initialViewerSessionState;
    window.history.replaceState({}, "", "/");
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the local Cloudflare worker as the default API base URL", async () => {
    render(
      <ViewerI18nProvider initialLocale="en">
        <App />
      </ViewerI18nProvider>,
    );

    await waitFor(() => {
      expect(constructorSpy).toHaveBeenCalledWith({
        apiBaseUrl: "http://127.0.0.1:8787",
        initialDisplayName: expect.any(String),
      });
    });
  });

  it("auto-joins the room from the /rooms/:roomId path", async () => {
    window.history.replaceState({}, "", "/rooms/room_demo");

    render(
      <ViewerI18nProvider initialLocale="en">
        <App />
      </ViewerI18nProvider>,
    );

    await waitFor(() => {
      expect(joinSpy).toHaveBeenCalledWith("room_demo", "");
    });
  });

  it("retries route auto-join after React StrictMode remount cleanup", async () => {
    window.history.replaceState({}, "", "/rooms/room_demo");

    render(
      <StrictMode>
        <ViewerI18nProvider initialLocale="en">
          <App />
        </ViewerI18nProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(joinSpy.mock.calls.filter(([roomId]) => roomId === "room_demo").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("updates the location to /rooms/:roomId after joining from the form", async () => {
    render(
      <ViewerI18nProvider initialLocale="en">
        <App />
      </ViewerI18nProvider>,
    );

    const roomCodeInput = screen.getByTestId("viewer-room-code-input");
    fireEvent.change(roomCodeInput, { target: { value: "room_form_join" } });
    fireEvent.click(screen.getByTestId("viewer-join-submit"));

    await waitFor(() => {
      expect(joinSpy).toHaveBeenCalledWith("room_form_join", "");
      expect(window.location.pathname).toBe("/rooms/room_form_join");
    });
  });
});
