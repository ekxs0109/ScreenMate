// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentChatWidget } from "../../entrypoints/popup/chat-pane";

describe("ContentChatWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("only shows the minimized indicator for unread messages", async () => {
    const systemMessage = {
      id: "system-1",
      sender: "System",
      text: "Room created.",
    };
    const viewerMessage = {
      id: "viewer-1",
      sender: "Viewer",
      text: "hello",
    };
    const props = {
      onSend: vi.fn(),
      onToggleMinimized: vi.fn(),
      placeholder: "Say something...",
      title: "Room Chat",
    };
    const { rerender } = render(
      <ContentChatWidget
        {...props}
        messages={[systemMessage]}
        minimized={true}
      />,
    );

    expect(screen.queryByLabelText("New chat messages")).toBeNull();

    rerender(
      <ContentChatWidget
        {...props}
        messages={[systemMessage, viewerMessage]}
        minimized={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("New chat messages")).toBeTruthy();
    });

    rerender(
      <ContentChatWidget
        {...props}
        messages={[systemMessage, viewerMessage]}
        minimized={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("New chat messages")).toBeNull();
    });

    rerender(
      <ContentChatWidget
        {...props}
        messages={[systemMessage, viewerMessage]}
        minimized={true}
      />,
    );

    expect(screen.queryByLabelText("New chat messages")).toBeNull();
  });
});
