import { describe, expect, it } from "vitest";
import { RoomObject } from "../src/do/room-object";

describe("RoomObject", () => {
  it("registers the host and the viewer in room state", () => {
    const room = new RoomObject({} as never, {} as never);

    room.registerSession("host_1", "host");
    room.registerSession("viewer_1", "viewer");

    expect(room.getStateSnapshot()).toEqual({
      hostSessionId: "host_1",
      viewerCount: 1,
      state: "hosting",
    });
  });
});
