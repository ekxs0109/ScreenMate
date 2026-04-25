import { z } from "zod";
import { roomSourceStateSchema, roomStateSchema } from "./room.js";

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
  state: roomStateSchema,
  sourceState: roomSourceStateSchema,
  viewerCount: z.number().int().nonnegative(),
});

export const roomConnectionTypeSchema = z.enum(["direct", "relay", "unknown"]);

export const viewerRosterEntrySchema = z.object({
  viewerSessionId: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
  online: z.boolean(),
  connectionType: roomConnectionTypeSchema,
  pingMs: z.number().int().nonnegative().nullable(),
  joinedAt: z.number().int().nonnegative(),
  profileUpdatedAt: z.number().int().nonnegative().nullable(),
  metricsUpdatedAt: z.number().int().nonnegative().nullable(),
});

export const roomChatMessageSchema = z.object({
  messageId: z.string().min(1),
  senderSessionId: z.string().min(1),
  senderRole: signalingRoleSchema,
  senderName: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(500),
  sentAt: z.number().int().nonnegative(),
});

const viewerProfilePayloadSchema = z.object({
  viewerSessionId: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
});

const viewerMetricsPayloadSchema = z.object({
  viewerSessionId: z.string().min(1),
  connectionType: roomConnectionTypeSchema,
  pingMs: z.number().int().nonnegative().nullable().optional(),
});

const chatMessagePayloadSchema = z.object({
  clientMessageId: z.string().min(1).max(120).optional(),
  text: z.string().trim().min(1).max(500),
});

const chatMessageCreatedPayloadSchema = roomChatMessageSchema;

const viewerRosterPayloadSchema = z.object({
  viewers: z.array(viewerRosterEntrySchema),
});

const chatHistoryPayloadSchema = z.object({
  messages: z.array(roomChatMessageSchema).max(100),
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
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("viewer-profile"),
    payload: viewerProfilePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("viewer-metrics"),
    payload: viewerMetricsPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("chat-message"),
    payload: chatMessagePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("chat-message-created"),
    payload: chatMessageCreatedPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("viewer-roster"),
    payload: viewerRosterPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("chat-history"),
    payload: chatHistoryPayloadSchema,
  }),
]);

export type RoomConnectionType = z.infer<typeof roomConnectionTypeSchema>;
export type ViewerRosterEntry = z.infer<typeof viewerRosterEntrySchema>;
export type RoomChatMessage = z.infer<typeof roomChatMessageSchema>;
export type SignalEnvelope = z.infer<typeof signalEnvelopeSchema>;
