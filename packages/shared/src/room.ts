import { z } from "zod";

export const roomStateSchema = z.enum([
  "idle",
  "hosting",
  "streaming",
  "degraded",
  "closed",
]);
