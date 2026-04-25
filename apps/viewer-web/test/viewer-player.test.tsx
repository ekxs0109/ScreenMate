// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewerPlayer } from "../src/components/ViewerPlayer";
import { ViewerI18nProvider } from "../src/i18n";

describe("ViewerPlayer", () => {
  it("renders recovery status copy while the host source is reconnecting", () => {
    render(
      <ViewerI18nProvider initialLocale="es">
        <ViewerPlayer
          roomId="room_demo"
          roomState="degraded"
          sourceState="recovering"
          status="waiting"
          stream={null}
        />
      </ViewerI18nProvider>,
    );

    expect(
      screen.getByText("El anfitrión está reconectando la fuente de video"),
    ).toBeTruthy();
  });
});
