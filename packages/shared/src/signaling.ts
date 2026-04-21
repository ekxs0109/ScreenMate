import { z } from "zod";

export const signalingRoleSchema = z.enum(["host", "viewer"]);

const offerPayloadSchema = z.object({
  targetSessionId: z.string().min(1),
  sdp: z.string().min(1),
});

const answerPayloadSchema = z.object({
  targetSessionId: z.string().min(1),
  sdp: z.string().min(1),
});

const iceCandidatePayloadSchema = z.object({
  targetSessionId: z.string().min(1),
  candidate: z.string().min(1),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().int().nullable().optional(),
});

const roomStatePayloadSchema = z.object({
  state: z.enum(["idle", "hosting", "streaming", "degraded", "closed"]),
});

export const signalEnvelopeSchema = z.discriminatedUnion("messageType", [
  z.object({
    roomId: z.string().min(1),
    sessionId: z.string().min(1),
    role: z.literal("host"),
    messageType: z.literal("offer"),
    timestamp: z.number().int().nonnegative(),
    payload: offerPayloadSchema,
  }),
  z.object({
    roomId: z.string().min(1),
    sessionId: z.string().min(1),
    role: z.literal("viewer"),
    messageType: z.literal("answer"),
    timestamp: z.number().int().nonnegative(),
    payload: answerPayloadSchema,
  }),
  z.object({
    roomId: z.string().min(1),
    sessionId: z.string().min(1),
    role: signalingRoleSchema,
    messageType: z.literal("ice-candidate"),
    timestamp: z.number().int().nonnegative(),
    payload: iceCandidatePayloadSchema,
  }),
  z.object({
    roomId: z.string().min(1),
    sessionId: z.string().min(1),
    role: signalingRoleSchema,
    messageType: z.literal("room-state"),
    timestamp: z.number().int().nonnegative(),
    payload: roomStatePayloadSchema,
  }),
]);
