import {
  PRESENCE_TTL_SECONDS,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';

export type PresenceRecord = {
  version: 1;
  userId: string;
  pub: string;
  epub?: string;
  lastSeen: string;
  expiresAt: string;
  encryptedLocation?: string;
  capabilities?: string[];
};

export type PeerAckMessage = {
  version: 1;
  fromUserId: string;
  fromPeerId: string;
  fromPub: string;
  toUserId: string;
  toPub: string;
  nonce: string;
  timestamp: string;
  payloadHash: string;
  signature: string;
  createdAt: string;
  expiresAt: string;
};

export type PresenceRegisterInput = {
  userId: string;
  pub: string;
  epub?: string;
  encryptedLocation?: string;
  capabilities?: string[];
  now?: Date;
};

export function createPresenceRecord(input: PresenceRegisterInput): PresenceRecord {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PRESENCE_TTL_SECONDS * 1000).toISOString();
  const record: PresenceRecord = {
    version: 1,
    userId: String(input.userId || '').trim(),
    pub: String(input.pub || '').trim(),
    lastSeen: now.toISOString(),
    expiresAt,
  };
  if (!record.userId || !record.pub) {
    throw new Error('userId and pub are required for presence registration');
  }
  if (input.epub) record.epub = String(input.epub);
  if (input.encryptedLocation) record.encryptedLocation = String(input.encryptedLocation);
  if (input.capabilities?.length) record.capabilities = input.capabilities.map(String);
  return record;
}

export function isPresenceRecordLive(record: PresenceRecord, now = new Date()): boolean {
  return new Date(record.expiresAt).getTime() > now.getTime();
}

export function prunePresenceRecords(
  records: Map<string, PresenceRecord>,
  now = new Date(),
): void {
  for (const [userId, record] of records) {
    if (!isPresenceRecordLive(record, now)) records.delete(userId);
  }
}

export function listNearbyPresence(
  records: Map<string, PresenceRecord>,
  options: {
    excludeUserId?: string;
    limit?: number;
    now?: Date;
  } = {},
): PresenceRecord[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const exclude = options.excludeUserId;
  const live = [...records.values()].filter(
    (r) => isPresenceRecordLive(r, now) && (!exclude || r.userId !== exclude),
  );
  live.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
  return live.slice(0, limit);
}

export function createPeerAckMessage(params: {
  fromUserId: string;
  fromPub: string;
  toUserId: string;
  toPub: string;
  fromPeerId?: string;
  timestamp?: string;
  payloadHash?: string;
  nonce?: string;
  signature?: string;
  now?: Date;
}): PeerAckMessage {
  const now = params.now ?? new Date();
  const fromUserId = String(params.fromUserId || '').trim();
  const toUserId = String(params.toUserId || '').trim();
  const fromPub = String(params.fromPub || '').trim();
  const toPub = String(params.toPub || '').trim();
  if (!fromUserId || !toUserId || !fromPub || !toPub) {
    throw new Error('fromUserId, toUserId, fromPub, and toPub are required for peer ack');
  }
  if (fromUserId === toUserId) {
    throw new Error('peer ack cannot target self');
  }
  const nonce = params.nonce || `ack_${fromPub}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = params.timestamp || now.toISOString();
  return {
    version: 1,
    fromUserId,
    fromPeerId: String(params.fromPeerId || '').trim(),
    fromPub,
    toUserId,
    toPub,
    nonce,
    timestamp,
    payloadHash: String(params.payloadHash || '').trim(),
    signature: String(params.signature || '').trim(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PRESENCE_TTL_SECONDS * 1000).toISOString(),
  };
}

/** Minimal validation: fields present, not expired, pub matches ack author. */
export function validatePeerAckMessage(
  ack: PeerAckMessage,
  expectedToPub: string,
  now = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (!ack?.fromPub || !ack.toPub || !ack.fromUserId || !ack.toUserId) {
    return { ok: false, reason: 'missing fields' };
  }
  if (new Date(ack.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (ack.toPub !== expectedToPub) {
    return { ok: false, reason: 'recipient pub mismatch' };
  }
  if (!ack.signature || !ack.nonce) {
    return { ok: false, reason: 'missing signature or nonce' };
  }
  if (!ack.fromPeerId || !ack.timestamp || !ack.payloadHash) {
    return { ok: false, reason: 'missing signed envelope fields' };
  }
  return { ok: true };
}

export function peerAckSigningPayload(ack: Pick<PeerAckMessage, 'fromUserId' | 'fromPub' | 'toUserId' | 'toPub'>): unknown {
  return {
    type: 'presence-ack',
    fromUserId: ack.fromUserId,
    fromPub: ack.fromPub,
    toUserId: ack.toUserId,
    toPub: ack.toPub,
  };
}

export async function verifySignedPeerAckMessage(
  ack: PeerAckMessage,
  expectedToPub: string,
  now = new Date(),
  nonceCache?: { has: (key: string) => boolean; add: (key: string) => unknown },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const validation = validatePeerAckMessage(ack, expectedToPub, now);
  if (!validation.ok) return validation;
  return verifySignedP2PEnvelopeProof({
    proof: {
      peerId: ack.fromPeerId,
      pub: ack.fromPub,
      timestamp: ack.timestamp,
      nonce: ack.nonce,
      payloadHash: ack.payloadHash,
      signature: ack.signature,
    } satisfies SignedP2PEnvelopeProof,
    payload: peerAckSigningPayload(ack),
    now,
    maxSkewMs: PRESENCE_TTL_SECONDS * 1000,
    ...(nonceCache ? { nonceCache } : {}),
  });
}
