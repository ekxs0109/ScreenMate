// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewerPlayer } from "../src/components/ViewerPlayer";

describe("ViewerPlayer", () => {
  it("renders recovery status copy while the host source is reconnecting", () => {
    render(
      <ViewerPlayer
        roomId="room_demo"
        roomState="degraded"
        sourceState="recovering"
        status="waiting"
        stream={null}
      />,
    );

    expect(
      screen.getByText("Host is reconnecting the video source"),
    ).toBeTruthy();
  });
});
