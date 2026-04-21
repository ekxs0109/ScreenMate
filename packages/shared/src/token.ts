import { z } from "zod";
import { signalingRoleSchema } from "./signaling.js";

export const tokenPayloadSchema = z.object({
  roomId: z.string().min(1),
  role: signalingRoleSchema,
  sessionId: z.string().min(1),
  exp: z.number().int().positive(),
});
