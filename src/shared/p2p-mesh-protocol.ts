import type { SignedP2PEnvelopeProof } from './p2p-runtime';

export type P2PMeshMessageKind =
  | 'mesh-ping'
  | 'mesh-pong'
  | 'talk-announce'
  | 'talk-body-request'
  | 'talk-body'
  | 'talk-response'
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
  responseId: string;
  talkId: string;
  authorId: string;
  responderId: string;
  submittedAt: string;
  encryption: 'sea-ecdh-v1';
  payloadCiphertext: string;
  transportMode: 'mesh-p2p';
};

export type P2PMeshPingPayload = {
  text?: string;
};

export type P2PMeshFramePayload =
  | P2PMeshPingPayload
  | P2PMeshTalkAnnouncePayload
  | P2PMeshTalkBodyRequestPayload
  | P2PMeshTalkBodyPayload
  | P2PMeshTalkResponsePayload
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
