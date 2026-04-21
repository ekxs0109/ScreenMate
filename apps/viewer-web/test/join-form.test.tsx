// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JoinForm } from "../src/components/JoinForm";

describe("JoinForm", () => {
  it("submits the room code entered by the viewer", () => {
    const onJoin = vi.fn();
    render(<JoinForm isBusy={false} onJoin={onJoin} />);

    fireEvent.change(screen.getByLabelText("Room code"), {
      target: { value: "room_123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Join room" }).closest("form")!);

    expect(onJoin).toHaveBeenCalledWith("room_123");
  });
});
