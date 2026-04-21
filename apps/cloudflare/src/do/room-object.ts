type SessionRole = "host" | "viewer";

export class RoomObject {
  private hostSessionId: string | null = null;
  private viewers = new Set<string>();
  private state: "idle" | "hosting" | "streaming" | "degraded" | "closed" =
    "idle";

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
