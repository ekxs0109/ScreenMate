import { z } from "zod";

export const roomStateSchema = z.enum([
  "idle",
  "hosting",
  "streaming",
  "degraded",
  "closed",
]);

export const roomSourceStateSchema = z.enum([
  "attached",
  "recovering",
  "missing",
]);

export type RoomState = z.infer<typeof roomStateSchema>;
export type RoomSourceState = z.infer<typeof roomSourceStateSchema>;
