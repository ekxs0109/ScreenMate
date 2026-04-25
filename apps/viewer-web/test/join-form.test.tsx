// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JoinForm } from "../src/components/JoinForm";
import { ViewerI18nProvider } from "../src/i18n";

describe("JoinForm", () => {
  it("submits the room code entered by the viewer", () => {
    const onJoin = vi.fn();
    render(
      <ViewerI18nProvider initialLocale="ja">
        <JoinForm isBusy={false} onJoin={onJoin} />
      </ViewerI18nProvider>,
    );

    fireEvent.change(screen.getByLabelText("ルームコード"), {
      target: { value: "room_123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "ルームに参加" }).closest("form")!);

    expect(onJoin).toHaveBeenCalledWith("room_123");
  });
});
