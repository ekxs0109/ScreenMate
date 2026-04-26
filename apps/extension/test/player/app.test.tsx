// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dplayerCalls: Array<{ options: { container: HTMLElement; video?: { url?: string } } }> = [];

vi.mock("dplayer", () => {
  class MockDPlayer {
    public readonly destroy = vi.fn();

    constructor(options: { container: HTMLElement; video?: { url?: string } }) {
      dplayerCalls.push({ options });
    }
  }

  return { default: MockDPlayer };
});

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: string) => key,
  },
}));

import { ThemeProvider } from "../../components/theme-provider";
import PlayerApp from "../../entrypoints/player/App";

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
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: vi.fn(() => "blob:demo-video"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  dplayerCalls.length = 0;
});

describe("PlayerApp", () => {
  it("renders a DPlayer surface after loading a local video file", () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <PlayerApp />
      </ThemeProvider>,
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["demo"], "demo.mp4", { type: "video/mp4" });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    expect(screen.getByText("demo.mp4")).toBeTruthy();
    expect(dplayerCalls).toHaveLength(1);
    expect(dplayerCalls[0]?.options.video?.url).toBe("blob:demo-video");
  });
});
