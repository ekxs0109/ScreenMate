import { z } from "zod";

export const signalingRoleSchema = z.enum(["host", "viewer"]);
const envelopeBaseSchema = {
  roomId: z.string().min(1),
  sessionId: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
};

const hostConnectedPayloadSchema = z.object({
  viewerCount: z.number().int().nonnegative(),
});

const viewerPresencePayloadSchema = z.object({
  viewerSessionId: z.string().min(1),
});

const hostLeftPayloadSchema = z.object({
  reason: z.string().min(1),
});

const roomClosedPayloadSchema = z.object({
  reason: z.enum(["host-left", "expired", "closed"]),
});

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

const negotiationFailedPayloadSchema = z.object({
  targetSessionId: z.string().min(1),
  code: z.string().min(1),
});

const heartbeatPayloadSchema = z.object({
  sequence: z.number().int().nonnegative(),
});

const reconnectPayloadSchema = z.object({
  previousSessionId: z.string().min(1),
});

const roomStatePayloadSchema = z.object({
  state: z.enum(["idle", "hosting", "streaming", "degraded", "closed"]),
});

export const signalEnvelopeSchema = z.discriminatedUnion("messageType", [
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("host-connected"),
    payload: hostConnectedPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("viewer-joined"),
    payload: viewerPresencePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("viewer-left"),
    payload: viewerPresencePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("host-left"),
    payload: hostLeftPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("room-closed"),
    payload: roomClosedPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("offer"),
    payload: offerPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("answer"),
    payload: answerPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("ice-candidate"),
    payload: iceCandidatePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("negotiation-failed"),
    payload: negotiationFailedPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("heartbeat"),
    payload: heartbeatPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("reconnect"),
    payload: reconnectPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("room-state"),
    payload: roomStatePayloadSchema,
  }),
]);
