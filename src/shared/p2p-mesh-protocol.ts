import type { SignedP2PEnvelopeProof } from './p2p-runtime';
import type { SignedProtocolManifest } from './protocol-manifest';

export type P2PMeshMessageKind =
  | 'mesh-ping'
  | 'mesh-pong'
  | 'talk-announce'
  | 'talk-body-request'
  | 'talk-body'
  | 'talk-response'
  | 'talk-retracted'
  | 'protocol-manifest-summary'
  | 'protocol-manifest-request'
  | 'protocol-manifest-chain'
  | 'ack';

export type P2PProtocolManifestCheckpoint = {
  networkId: string;
  sequence: number;
  manifestHash: string;
};

export type P2PProtocolManifestSummaryPayload = P2PProtocolManifestCheckpoint & {
  manifestEngineVersion: number;
  roomProtocolVersion: number;
  capabilities: string[];
};

export type P2PProtocolManifestRequestPayload = P2PProtocolManifestCheckpoint;

export type P2PProtocolManifestChainPayload = {
  networkId: string;
  afterSequence: number;
  afterManifestHash: string;
  manifests: SignedProtocolManifest[];
};

const MAX_PROTOCOL_MANIFEST_CHAIN_PAYLOAD_BYTES = 512 * 1024;

export type P2PMeshTalkAnnouncePayload = {
  /** Origin room is repeated inside the payload because mailbox fallback has no mesh frame. */
  roomId: string;
  /** Reject after a receiver leaves and later re-enters this room; rebroadcast is deliberate. */
  broadcastAt: string;
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
  roomId: string;
  broadcastAt: string;
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
  | P2PProtocolManifestSummaryPayload
  | P2PProtocolManifestRequestPayload
  | P2PProtocolManifestChainPayload
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
  protocolManifest?: P2PProtocolManifestCheckpoint;
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
    ...(frame.protocolManifest ? { protocolManifest: frame.protocolManifest } : {}),
    payload: frame.payload,
  };
}

export function isP2PMeshFrame(value: unknown): value is P2PMeshFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<P2PMeshFrame>;
  return frame.version === 1
    && ['mesh-ping', 'mesh-pong', 'talk-announce', 'talk-body-request', 'talk-body', 'talk-response', 'talk-retracted', 'protocol-manifest-summary', 'protocol-manifest-request', 'protocol-manifest-chain', 'ack'].includes(String(frame.kind))
    && typeof frame.msgId === 'string' && frame.msgId.length > 0 && frame.msgId.length <= 256
    && typeof frame.roomId === 'string' && frame.roomId.length <= 256
    && typeof frame.originUserId === 'string' && frame.originUserId.length <= 256
    && typeof frame.originPub === 'string' && frame.originPub.length <= 2048
    && typeof frame.createdAt === 'string' && Number.isFinite(Date.parse(frame.createdAt))
    && Number.isSafeInteger(frame.ttlHops) && Number(frame.ttlHops) >= 0 && Number(frame.ttlHops) <= 16
    && (frame.protocolManifest === undefined || isP2PProtocolManifestCheckpoint(frame.protocolManifest))
    && !!frame.payload && typeof frame.payload === 'object';
}

export function isP2PProtocolManifestCheckpoint(value: unknown): value is P2PProtocolManifestCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Partial<P2PProtocolManifestCheckpoint>;
  return typeof checkpoint.networkId === 'string'
    && checkpoint.networkId.length > 0
    && checkpoint.networkId.length <= 128
    && Number.isSafeInteger(checkpoint.sequence)
    && Number(checkpoint.sequence) >= 1
    && typeof checkpoint.manifestHash === 'string'
    && /^[a-f0-9]{64}$/.test(checkpoint.manifestHash);
}

export function isP2PProtocolManifestSummaryPayload(value: unknown): value is P2PProtocolManifestSummaryPayload {
  if (!isP2PProtocolManifestCheckpoint(value)) return false;
  const summary = value as Partial<P2PProtocolManifestSummaryPayload>;
  return Number.isSafeInteger(summary.manifestEngineVersion)
    && Number(summary.manifestEngineVersion) >= 1
    && Number.isSafeInteger(summary.roomProtocolVersion)
    && Number(summary.roomProtocolVersion) >= 1
    && Array.isArray(summary.capabilities)
    && summary.capabilities.length <= 64
    && summary.capabilities.every((capability) => typeof capability === 'string' && capability.length > 0 && capability.length <= 128);
}

export function isP2PProtocolManifestRequestPayload(value: unknown): value is P2PProtocolManifestRequestPayload {
  return isP2PProtocolManifestCheckpoint(value);
}

export function isP2PProtocolManifestChainPayload(value: unknown): value is P2PProtocolManifestChainPayload {
  if (!value || typeof value !== 'object') return false;
  const chain = value as Partial<P2PProtocolManifestChainPayload>;
  const structurallyValid = typeof chain.networkId === 'string'
    && chain.networkId.length > 0
    && chain.networkId.length <= 128
    && Number.isSafeInteger(chain.afterSequence)
    && Number(chain.afterSequence) >= 1
    && typeof chain.afterManifestHash === 'string'
    && /^[a-f0-9]{64}$/.test(chain.afterManifestHash)
    && Array.isArray(chain.manifests)
    && chain.manifests.length <= 128;
  if (!structurallyValid) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PROTOCOL_MANIFEST_CHAIN_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

export function isProtocolManifestControlKind(kind: P2PMeshMessageKind): boolean {
  return kind === 'protocol-manifest-summary'
    || kind === 'protocol-manifest-request'
    || kind === 'protocol-manifest-chain';
}

export function isP2PMeshTalkBodyPayload(
  payload: P2PMeshFramePayload,
): payload is P2PMeshTalkBodyPayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'roomId' in payload &&
    'broadcastAt' in payload &&
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
