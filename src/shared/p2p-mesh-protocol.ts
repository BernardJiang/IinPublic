import type { SignedP2PEnvelopeProof } from './p2p-runtime';

export type P2PMeshMessageKind =
  | 'mesh-ping'
  | 'mesh-pong'
  | 'talk-announce'
  | 'talk-body-request'
  | 'talk-body'
  | 'talk-response'
  | 'talk-retracted'
  | 'ack';

export type P2PMeshTalkAnnouncePayload = {
  talkId: string;
  authorId: string;
  authorName: string;
  authorEpub?: string;
  title: string;
  type?: string;
  questionCount: number;
  contentHash?: string;
  isAdult?: boolean;
  language?: string;
  tags?: string[];
  requestedAuthorization?: 'accepted-talk-read';
  syncCapabilities?: {
    protocolVersion: 1;
    gunNativeSync: boolean;
    legacyTalkBodyFrames: boolean;
  };
};

export type P2PMeshTalkBodyRequestPayload = {
  requestId: string;
  talkId: string;
  authorId: string;
};

export type P2PMeshTalkBodyPayload = P2PMeshTalkAnnouncePayload & {
  requestId?: string;
  talkData: Record<string, unknown>;
};

export type P2PMeshTalkResponsePayload = {
  responseId: string;          // R-1: CIDv1({ talkId, responderId, responseContentJson }) — REQ-LEDGER-04/12
  talkId: string;
  authorId: string;            // unicast routing target (recipientUserId)
  responderId: string;
  submittedAt: string;         // ISO
  respondedAt: string;         // R-1: ISO; == submittedAt at v1; step 9 sets changedAt on supersession
  version: number;             // R-1: monotonic per (talkId,responderId); 1 at first answer (REQ-LEDGER-04)
  encryption: 'sea-ecdh-v1';
  payloadCiphertext: string;   // pair ciphertext: { responderName, answers, isChatbotResponse, ... }
  transportMode: 'mesh-p2p';
  /**
   * The responder's public encryption key (SEA epub — public material, safe on the wire).
   * The author needs it to derive the pair secret and decrypt payloadCiphertext; without it
   * the author must network-resolve the responder's key at ingest time, which fails under
   * simultaneous-boot load and silently dropped ACKed responses (the fire-and-forget ingest
   * swallowed the decrypt throw). Mirror of Talk.authorEpub on the request direction. The
   * mailbox path already carries the equivalent wrapper senderEpub.
   */
  responderEpub?: string;
};

export type P2PMeshPingPayload = {
  text?: string;
};

/**
 * Step 10 — talk-retracted frame payload.
 * Flood (no recipientUserId) — every holder must learn of the retraction.
 * Author-qualified: talkId is content-addressed (shared across authors), so
 * authorId is mandatory to avoid tearing down another author's identical talk.
 * Only the author themselves may issue a valid retraction (originUserId === authorId).
 */
export type P2PMeshTalkRetractedPayload = {
  talkId: string;
  authorId: string;
  retractedAt: number; // ms epoch
};

export type P2PMeshFramePayload =
  | P2PMeshPingPayload
  | P2PMeshTalkAnnouncePayload
  | P2PMeshTalkBodyRequestPayload
  | P2PMeshTalkBodyPayload
  | P2PMeshTalkResponsePayload
  | P2PMeshTalkRetractedPayload
  | { msgId: string };

export type P2PMeshFrame = {
  version: 1;
  kind: P2PMeshMessageKind;
  msgId: string;
  roomId: string;
  originUserId: string;
  originPub: string;
  recipientUserId?: string;
  createdAt: string;
  ttlHops: number;
  payload: P2PMeshFramePayload;
  proof?: SignedP2PEnvelopeProof;
};

export function p2pMeshFrameSigningPayload(frame: P2PMeshFrame): unknown {
  return {
    type: 'p2p-mesh-frame',
    version: frame.version,
    kind: frame.kind,
    msgId: frame.msgId,
    roomId: frame.roomId,
    originUserId: frame.originUserId,
    originPub: frame.originPub,
    recipientUserId: frame.recipientUserId ?? null,
    createdAt: frame.createdAt,
    payload: frame.payload,
  };
}

export function isP2PMeshFrame(value: unknown): value is P2PMeshFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<P2PMeshFrame>;
  return frame.version === 1
    && ['mesh-ping', 'mesh-pong', 'talk-announce', 'talk-body-request', 'talk-body', 'talk-response', 'talk-retracted', 'ack'].includes(String(frame.kind))
    && typeof frame.msgId === 'string' && frame.msgId.length > 0 && frame.msgId.length <= 256
    && typeof frame.roomId === 'string' && frame.roomId.length <= 256
    && typeof frame.originUserId === 'string' && frame.originUserId.length <= 256
    && typeof frame.originPub === 'string' && frame.originPub.length <= 2048
    && typeof frame.createdAt === 'string' && Number.isFinite(Date.parse(frame.createdAt))
    && Number.isSafeInteger(frame.ttlHops) && Number(frame.ttlHops) >= 0 && Number(frame.ttlHops) <= 16
    && !!frame.payload && typeof frame.payload === 'object';
}

export function isP2PMeshTalkBodyPayload(
  payload: P2PMeshFramePayload,
): payload is P2PMeshTalkBodyPayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'talkId' in payload &&
    'talkData' in payload
  );
}

export function isP2PMeshTalkResponsePayload(
  payload: P2PMeshFramePayload,
): payload is P2PMeshTalkResponsePayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'responseId' in payload &&
    'payloadCiphertext' in payload &&
    (payload as { transportMode?: unknown }).transportMode === 'mesh-p2p'
  );
}

export function isP2PMeshTalkRetractedPayload(
  payload: P2PMeshFramePayload,
): payload is P2PMeshTalkRetractedPayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'talkId' in payload &&
    'authorId' in payload &&
    'retractedAt' in payload &&
    typeof (payload as { retractedAt?: unknown }).retractedAt === 'number' &&
    !('talkData' in payload) &&
    !('responseId' in payload)
  );
}
