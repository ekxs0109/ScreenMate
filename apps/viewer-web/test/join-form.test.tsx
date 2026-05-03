// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JoinForm } from "../src/components/JoinForm";
import { ViewerI18nProvider } from "../src/i18n";

describe("JoinForm", () => {
  it("submits the room code and password entered by the viewer", () => {
    const onJoin = vi.fn();
    render(
      <ViewerI18nProvider initialLocale="ja">
        <JoinForm
          initialPassword="pass_prefilled"
          initialRoomCode="room_prefilled"
          isBusy={false}
          onJoin={onJoin}
        />
      </ViewerI18nProvider>,
    );

    expect((screen.getByLabelText("ルームコード") as HTMLInputElement).value).toBe(
      "room_prefilled",
    );
    expect((screen.getByLabelText("パスワード") as HTMLInputElement).value).toBe(
      "pass_prefilled",
    );
    fireEvent.change(screen.getByLabelText("ルームコード"), {
      target: { value: "room_123" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "letmein" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "ルームに参加" }).closest("form")!);

    expect(onJoin).toHaveBeenCalledWith("room_123", "letmein");
  });
});
