import {
  createSignedP2PEnvelopeProof,
  PRESENCE_TTL_SECONDS,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';
import {
  deriveRoomRendezvousToken,
  type ActiveRoomScope,
} from './active-exchange-room';

export type LegacyPresenceRecord = {
  version: 1;
  userId: string;
  pub: string;
  epub?: string;
  lastSeen: string;
  expiresAt: string;
  encryptedLocation?: string;
  capabilities?: string[];
};

export type RoomScopedPresenceRecord = {
  version: 2;
  userId: string;
  pub: string;
  epub?: string;
  lastSeen: string;
  /** Stable for one room stay; deterministic admission must not reorder on every heartbeat. */
  enteredAt: string;
  expiresAt: string;
  capabilities?: string[];
  roomScope: ActiveRoomScope;
  proof: SignedP2PEnvelopeProof;
};

export type PresenceRecord = LegacyPresenceRecord | RoomScopedPresenceRecord;

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

export function roomPresenceSigningPayload(
  record: Omit<RoomScopedPresenceRecord, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-room-presence-v2',
    version: record.version,
    userId: record.userId,
    pub: record.pub,
    epub: record.epub ?? null,
    lastSeen: record.lastSeen,
    enteredAt: record.enteredAt,
    expiresAt: record.expiresAt,
    capabilities: record.capabilities ?? [],
    roomScope: record.roomScope,
  };
}

export async function createSignedRoomPresenceRecord(input: {
  userId: string;
  pair: SeaSigningPair;
  epub?: string;
  capabilities?: string[];
  roomScope: ActiveRoomScope;
  enteredAt?: string;
  now?: Date;
}): Promise<RoomScopedPresenceRecord> {
  const now = input.now ?? new Date();
  const unsigned: Omit<RoomScopedPresenceRecord, 'proof'> = {
    version: 2,
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    lastSeen: now.toISOString(),
    enteredAt: input.enteredAt || now.toISOString(),
    expiresAt: new Date(now.getTime() + PRESENCE_TTL_SECONDS * 1000).toISOString(),
    roomScope: { ...input.roomScope },
    ...(input.epub ? { epub: String(input.epub) } : {}),
    ...(input.capabilities?.length ? { capabilities: input.capabilities.map(String) } : {}),
  };
  if (!unsigned.userId || !unsigned.pub) throw new Error('userId and pub are required for presence registration');
  if (!Number.isFinite(Date.parse(unsigned.enteredAt)) || Date.parse(unsigned.enteredAt) > now.getTime() + 60_000) {
    throw new Error('presence enteredAt is invalid');
  }
  if (!isAuthenticRoomScope(unsigned.roomScope, now)) throw new Error('room scope is invalid or expired');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: roomPresenceSigningPayload(unsigned),
    timestamp: now.toISOString(),
  });
  return { ...unsigned, proof };
}

export function isAuthenticRoomScope(scope: ActiveRoomScope, now = new Date()): boolean {
  if (!scope || typeof scope !== 'object') return false;
  if (!scope.roomId || scope.roomId.length > 256 || !scope.networkId || scope.networkId.length > 128) return false;
  if (!Number.isSafeInteger(scope.protocolEpoch) || scope.protocolEpoch < 1) return false;
  if (!Number.isSafeInteger(scope.manifestSequence) || scope.manifestSequence < 1) return false;
  if (!/^[a-f0-9]{64}$/.test(scope.manifestHash) || !/^[a-f0-9]{32}$/.test(scope.roomToken)) return false;
  const expiresAt = Date.parse(scope.tokenExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime() || expiresAt - now.getTime() > 20 * 60_000) return false;
  const expected = deriveRoomRendezvousToken({
    networkId: scope.networkId,
    protocolEpoch: scope.protocolEpoch,
  }, scope.roomId, expiresAt - 1);
  return expected.token === scope.roomToken && expected.expiresAt === scope.tokenExpiresAt;
}

export function parseRoomScopedPresenceRecord(value: unknown): RoomScopedPresenceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RoomScopedPresenceRecord>;
  if (record.version !== 2 || !record.userId || record.userId.length > 256 || !record.pub || record.pub.length > 2048) return null;
  if (!record.lastSeen || !record.enteredAt || !record.expiresAt
    || !Number.isFinite(Date.parse(record.lastSeen))
    || !Number.isFinite(Date.parse(record.enteredAt))
    || !Number.isFinite(Date.parse(record.expiresAt))) return null;
  if (!record.roomScope || !record.proof || record.proof.pub !== record.pub) return null;
  if (record.epub !== undefined && (typeof record.epub !== 'string' || record.epub.length > 2048)) return null;
  if (record.capabilities !== undefined && (!Array.isArray(record.capabilities) || record.capabilities.length > 64)) return null;
  return record as RoomScopedPresenceRecord;
}

export async function verifySignedRoomPresenceRecord(
  value: unknown,
  now = new Date(),
): Promise<{ ok: true; record: RoomScopedPresenceRecord } | { ok: false; reason: string }> {
  const record = parseRoomScopedPresenceRecord(value);
  if (!record) return { ok: false, reason: 'malformed room presence' };
  if (!isPresenceRecordLive(record, now)) return { ok: false, reason: 'expired room presence' };
  if (Date.parse(record.enteredAt) > now.getTime() + 60_000) {
    return { ok: false, reason: 'room presence enteredAt is in the future' };
  }
  if (!isAuthenticRoomScope(record.roomScope, now)) return { ok: false, reason: 'invalid or expired room scope' };
  const verification = await verifySignedP2PEnvelopeProof({
    proof: record.proof,
    payload: roomPresenceSigningPayload(record),
    now,
    maxSkewMs: PRESENCE_TTL_SECONDS * 1000,
  });
  return verification.ok ? { ok: true, record } : verification;
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
    roomScope?: ActiveRoomScope;
  } = {},
): PresenceRecord[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const exclude = options.excludeUserId;
  const live = [...records.values()].filter(
    (r) => isPresenceRecordLive(r, now)
      && (!exclude || r.userId !== exclude)
      && (!options.roomScope
        || (r.version === 2
          && r.roomScope.roomId === options.roomScope.roomId
          && r.roomScope.roomToken === options.roomScope.roomToken
          && r.roomScope.networkId === options.roomScope.networkId
          && r.roomScope.protocolEpoch === options.roomScope.protocolEpoch)),
  );
  // The oldest active entrant leaves first when the room is over capacity, so retain the newest
  // deterministic C. Legacy development records have no enteredAt and sort behind signed v2.
  live.sort((a, b) => {
    const aEntered = a.version === 2 ? Date.parse(a.enteredAt) : Number.NEGATIVE_INFINITY;
    const bEntered = b.version === 2 ? Date.parse(b.enteredAt) : Number.NEGATIVE_INFINITY;
    return bEntered - aEntered || a.userId.localeCompare(b.userId);
  });
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
