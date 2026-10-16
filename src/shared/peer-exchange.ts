import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';

/** One direct-neighbor exchange stays intentionally smaller than a room roster. */
export const PEER_EXCHANGE_MAX_RECORDS = 16;
export const PEER_EXCHANGE_RECORD_TTL_MS = 10 * 60_000;
export const PEER_EXCHANGE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
export const PEER_EXCHANGE_CACHE_MAX_RECORDS_PER_ROOM = 48;

export type PeerExchangeRecord = {
  version: 1;
  kind: 'peer-exchange-record';
  userId: string;
  seaPub: string;
  roomId: string;
  issuedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

export type PeerExchangePayload = {
  version: 1;
  kind: 'peer-exchange';
  records: PeerExchangeRecord[];
};

export type PeerExchangeCacheEntry = {
  record: PeerExchangeRecord;
  verifiedAt: string;
  lastConnectedAt?: string;
  cacheExpiresAt: string;
};

export function peerExchangeRecordSigningPayload(
  record: Omit<PeerExchangeRecord, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-peer-exchange-record-v1',
    version: record.version,
    kind: record.kind,
    userId: record.userId,
    seaPub: record.seaPub,
    roomId: record.roomId,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

export async function issuePeerExchangeRecord(input: {
  pair: SeaSigningPair;
  userId: string;
  roomId: string;
  now?: Date;
}): Promise<PeerExchangeRecord> {
  const now = input.now ?? new Date();
  const unsigned: Omit<PeerExchangeRecord, 'proof'> = {
    version: 1,
    kind: 'peer-exchange-record',
    userId: String(input.userId || '').trim(),
    seaPub: String(input.pair.pub || '').trim(),
    roomId: String(input.roomId || '').trim(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PEER_EXCHANGE_RECORD_TTL_MS).toISOString(),
  };
  if (!isPeerExchangeRecordShape({ ...unsigned, proof: { pub: unsigned.seaPub } })) {
    throw new Error('peer exchange record is invalid');
  }
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: peerExchangeRecordSigningPayload(unsigned),
    timestamp: unsigned.issuedAt,
  });
  return { ...unsigned, proof };
}

export async function verifyPeerExchangeRecord(
  value: unknown,
  input: { expectedRoomId: string; now?: Date },
): Promise<{ ok: true; record: PeerExchangeRecord } | { ok: false; reason: string }> {
  if (!isPeerExchangeRecordShape(value)) return { ok: false, reason: 'malformed peer exchange record' };
  const record = value;
  const now = input.now ?? new Date();
  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (record.roomId !== input.expectedRoomId) return { ok: false, reason: 'peer exchange room mismatch' };
  if (record.proof.pub !== record.seaPub) return { ok: false, reason: 'peer exchange SEA pub mismatch' };
  if (expiresAt <= now.getTime()
    || issuedAt > now.getTime() + 30_000
    || expiresAt !== issuedAt + PEER_EXCHANGE_RECORD_TTL_MS) {
    return { ok: false, reason: 'peer exchange record lifetime is invalid' };
  }
  const { proof: _proof, ...unsigned } = record;
  const verified = await verifySignedP2PEnvelopeProof({
    proof: record.proof,
    payload: peerExchangeRecordSigningPayload(unsigned),
    now,
    maxSkewMs: PEER_EXCHANGE_RECORD_TTL_MS,
  });
  return verified.ok ? { ok: true, record } : verified;
}

/**
 * Cache bootstrap validation is deliberately different from network acceptance: an expired
 * discovery advertisement may remain a local hint for seven days, but it is never re-gossiped.
 * The first authenticated mesh frame still has to match the remembered SEA key.
 */
export async function verifyCachedPeerExchangeEntry(
  value: unknown,
  input: { expectedRoomId: string; now?: Date },
): Promise<{ ok: true; entry: PeerExchangeCacheEntry } | { ok: false; reason: string }> {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'malformed peer cache entry' };
  const entry = value as Partial<PeerExchangeCacheEntry>;
  if (!isPeerExchangeRecordShape(entry.record)
    || typeof entry.verifiedAt !== 'string'
    || !Number.isFinite(Date.parse(entry.verifiedAt))
    || typeof entry.cacheExpiresAt !== 'string'
    || !Number.isFinite(Date.parse(entry.cacheExpiresAt))
    || (entry.lastConnectedAt !== undefined && !Number.isFinite(Date.parse(entry.lastConnectedAt)))) {
    return { ok: false, reason: 'malformed peer cache entry' };
  }
  const now = input.now ?? new Date();
  const issuedAt = Date.parse(entry.record.issuedAt);
  const recordExpiresAt = Date.parse(entry.record.expiresAt);
  const verifiedAt = Date.parse(entry.verifiedAt);
  if (entry.record.roomId !== input.expectedRoomId) return { ok: false, reason: 'peer cache room mismatch' };
  if (Date.parse(entry.cacheExpiresAt) <= now.getTime()) return { ok: false, reason: 'peer cache entry expired' };
  if (recordExpiresAt !== issuedAt + PEER_EXCHANGE_RECORD_TTL_MS
    || verifiedAt < issuedAt || verifiedAt > recordExpiresAt
    || Date.parse(entry.cacheExpiresAt) - verifiedAt > PEER_EXCHANGE_CACHE_TTL_MS) {
    return { ok: false, reason: 'peer cache lifetime is invalid' };
  }
  if (entry.record.proof.pub !== entry.record.seaPub) return { ok: false, reason: 'peer cache SEA pub mismatch' };
  const { proof: _proof, ...unsigned } = entry.record;
  const verified = await verifySignedP2PEnvelopeProof({
    proof: entry.record.proof,
    payload: peerExchangeRecordSigningPayload(unsigned),
    now: new Date(entry.record.issuedAt),
    maxSkewMs: PEER_EXCHANGE_RECORD_TTL_MS,
  });
  return verified.ok
    ? { ok: true, entry: entry as PeerExchangeCacheEntry }
    : verified;
}

export function parsePeerExchangePayload(value: unknown): PeerExchangePayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<PeerExchangePayload>;
  if (payload.version !== 1
    || payload.kind !== 'peer-exchange'
    || !Array.isArray(payload.records)
    || payload.records.length > PEER_EXCHANGE_MAX_RECORDS
    || payload.records.some((record) => !isPeerExchangeRecordShape(record))) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 128 * 1024) return null;
  } catch {
    return null;
  }
  return payload as PeerExchangePayload;
}

export function isPeerExchangeRecordShape(value: unknown): value is PeerExchangeRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PeerExchangeRecord>;
  return record.version === 1
    && record.kind === 'peer-exchange-record'
    && typeof record.userId === 'string' && record.userId.length > 0 && record.userId.length <= 256
    && typeof record.seaPub === 'string' && record.seaPub.length > 0 && record.seaPub.length <= 2048
    && typeof record.roomId === 'string' && record.roomId.length > 0 && record.roomId.length <= 256
    && typeof record.issuedAt === 'string' && Number.isFinite(Date.parse(record.issuedAt))
    && typeof record.expiresAt === 'string' && Number.isFinite(Date.parse(record.expiresAt))
    && !!record.proof && typeof record.proof === 'object';
}
