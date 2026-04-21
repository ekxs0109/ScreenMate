// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewerSessionState } from "../src/lib/session-state";

const constructorSpy = vi.fn();
const destroySpy = vi.fn();
const joinSpy = vi.fn<(_: string) => Promise<void>>();
let snapshot: ViewerSessionState;

vi.mock("../src/viewer-session", async () => {
  const { initialViewerSessionState } = await import("../src/lib/session-state");

  return {
    ViewerSession: class ViewerSession {
      constructor(options: { apiBaseUrl: string }) {
        constructorSpy(options);
      }

      subscribe(listener: (nextSnapshot: ViewerSessionState) => void) {
        listener(snapshot ?? initialViewerSessionState);
        return () => undefined;
      }

      destroy() {
        destroySpy();
      }

      join(roomId: string) {
        return joinSpy(roomId);
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
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the local Cloudflare worker as the default API base URL", async () => {
    render(<App />);

    await waitFor(() => {
      expect(constructorSpy).toHaveBeenCalledWith({
        apiBaseUrl: "http://127.0.0.1:8787",
      });
    });
  });

  it("auto-joins the room from the /rooms/:roomId path", async () => {
    window.history.replaceState({}, "", "/rooms/room_demo");

    render(<App />);

    await waitFor(() => {
      expect(joinSpy).toHaveBeenCalledWith("room_demo");
    });
  });
});
