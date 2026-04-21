import type { CloudflareBindings } from "../env.js";

type SessionRole = "host" | "viewer";
type RoomLifecycleState =
  | "idle"
  | "hosting"
  | "streaming"
  | "degraded"
  | "closed";

export class RoomState {
  private hostSessionId: string | null = null;
  private viewers = new Set<string>();
  private state: RoomLifecycleState = "idle";

  registerSession(sessionId: string, role: SessionRole) {
    if (role === "host") {
      this.hostSessionId = sessionId;
      this.state = "hosting";
      return;
    }

    this.viewers.add(sessionId);
    if (this.hostSessionId) {
      this.state = "hosting";
    }
  }

  getStateSnapshot() {
    return {
      hostSessionId: this.hostSessionId,
      viewerCount: this.viewers.size,
      state: this.state,
    };
  }
}

export class RoomObject {
  private readonly roomState = new RoomState();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareBindings,
  ) {}

  registerSession(sessionId: string, role: SessionRole) {
    this.roomState.registerSession(sessionId, role);
  }

  getStateSnapshot() {
    return this.roomState.getStateSnapshot();
  }
}
