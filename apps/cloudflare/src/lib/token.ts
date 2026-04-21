import { nanoid } from "nanoid";

export function issueScopedToken(roomId: string, role: "host" | "viewer") {
  return `${role}_${roomId}_${nanoid(24)}`;
}
