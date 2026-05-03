import { describe, expect, it } from "vitest";
import {
  buildScreenMateViewerRoomUrl,
  getScreenMateViewerBaseUrl,
} from "../../lib/config";

describe("viewer room url helpers", () => {
  it("uses the local viewer app as the default base url", () => {
    expect(getScreenMateViewerBaseUrl()).toBe("http://localhost:4173");
  });

  it("builds a stable viewer room url without leaking trailing markup", () => {
    expect(
      buildScreenMateViewerRoomUrl("room_demo", "http://localhost:4173/"),
    ).toBe("http://localhost:4173/rooms/room_demo");
  });

  it("can include a trimmed room password for direct viewer entry", () => {
    expect(
      buildScreenMateViewerRoomUrl("room demo", "http://localhost:4173/", {
        password: "  pass_123  ",
      }),
    ).toBe("http://localhost:4173/rooms/room%20demo?password=pass_123");
  });
});
