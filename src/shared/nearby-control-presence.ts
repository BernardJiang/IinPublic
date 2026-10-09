import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  NEARBY_MAX_SPLIT_GENERATION,
  isNearbyRoomId,
  type NearbyRoomAssignment,
} from './nearby-rooms';
import { portableSha256Hex } from './portable-sha256';
import {
  createSignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';

export const NEARBY_CONTROL_PRESENCE_TTL_MS = 45_000;
export const NEARBY_CONTROL_PRESENCE_MAX_FUTURE_MS = 5_000;

export type NearbyControlPresence = {
  version: 1;
  kind: 'nearby-control-presence';
  userId: string;
  pub: string;
  controlScopeId: string;
  rootRoomId: string;
  roomId: string;
  requestedSplitGeneration: number;
  checkpoint: RoomProtocolCheckpoint;
  observedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

export function nearbyControlScopeId(rootRoomId: string): string {
  if (!isNearbyRoomId(rootRoomId)) throw new Error('Nearby control root must be a Nearby room');
  const digest = portableSha256Hex(`iinpublic:nearby-control:v1:${rootRoomId}`).slice(0, 24);
  return `nearby_${digest}_control_v1`;
}

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

export function nearbyControlPresenceSigningPayload(
  record: Omit<NearbyControlPresence, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-nearby-control-presence-v1',
    version: record.version,
    kind: record.kind,
    userId: record.userId,
    pub: record.pub,
    controlScopeId: record.controlScopeId,
    rootRoomId: record.rootRoomId,
    roomId: record.roomId,
    requestedSplitGeneration: record.requestedSplitGeneration,
    checkpoint: record.checkpoint,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
  };
}

export async function createNearbyControlPresence(input: {
  userId: string;
  pair: SeaSigningPair;
  rootRoomId: string;
  assignment: NearbyRoomAssignment;
  checkpoint: RoomProtocolCheckpoint;
  now?: Date;
}): Promise<NearbyControlPresence> {
  const now = input.now ?? new Date();
  const unsigned: Omit<NearbyControlPresence, 'proof'> = {
    version: 1,
    kind: 'nearby-control-presence',
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    controlScopeId: nearbyControlScopeId(input.rootRoomId),
    rootRoomId: input.rootRoomId,
    roomId: input.assignment.roomId,
    requestedSplitGeneration: input.assignment.requestedSplitGeneration,
    checkpoint: { ...input.checkpoint },
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + NEARBY_CONTROL_PRESENCE_TTL_MS).toISOString(),
  };
  if (!unsigned.userId || !unsigned.pub) throw new Error('Nearby control userId and pub are required');
  if (!isNearbyRoomId(unsigned.roomId)) throw new Error('Nearby control room is invalid');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: nearbyControlPresenceSigningPayload(unsigned),
    timestamp: unsigned.observedAt,
  });
  return { ...unsigned, proof };
}

export function parseNearbyControlPresence(value: unknown): NearbyControlPresence | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<NearbyControlPresence>;
  if (record.version !== 1
    || record.kind !== 'nearby-control-presence'
    || typeof record.userId !== 'string'
    || record.userId.length < 1
    || record.userId.length > 256
    || typeof record.pub !== 'string'
    || record.pub.length < 1
    || record.pub.length > 2_048
    || typeof record.controlScopeId !== 'string'
    || record.controlScopeId.length < 1
    || record.controlScopeId.length > 128
    || typeof record.rootRoomId !== 'string'
    || !isNearbyRoomId(record.rootRoomId)
    || typeof record.roomId !== 'string'
    || !isNearbyRoomId(record.roomId)
    || !Number.isSafeInteger(record.requestedSplitGeneration)
    || typeof record.observedAt !== 'string'
    || typeof record.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(record.observedAt))
    || !Number.isFinite(Date.parse(record.expiresAt))
    || !record.checkpoint
    || !record.proof
    || record.proof.pub !== record.pub) return null;
  return record as NearbyControlPresence;
}

export async function verifyNearbyControlPresence(
  value: unknown,
  input: { expectedCheckpoint: RoomProtocolCheckpoint; at?: Date },
): Promise<{ ok: true; record: NearbyControlPresence } | { ok: false; reason: string }> {
  const record = parseNearbyControlPresence(value);
  if (!record) return { ok: false, reason: 'malformed Nearby control presence' };
  const at = input.at ?? new Date();
  const observedAt = Date.parse(record.observedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (observedAt > at.getTime() + NEARBY_CONTROL_PRESENCE_MAX_FUTURE_MS) {
    return { ok: false, reason: 'Nearby control presence is from the future' };
  }
  if (expiresAt <= at.getTime() || expiresAt !== observedAt + NEARBY_CONTROL_PRESENCE_TTL_MS) {
    return { ok: false, reason: 'expired or invalid Nearby control presence lifetime' };
  }
  if (!sameCheckpoint(record.checkpoint, input.expectedCheckpoint)) {
    return { ok: false, reason: 'Nearby control presence checkpoint mismatch' };
  }
  if (record.controlScopeId !== nearbyControlScopeId(record.rootRoomId)) {
    return { ok: false, reason: 'wrong Nearby control scope' };
  }
  if (!Number.isSafeInteger(record.requestedSplitGeneration)
    || record.requestedSplitGeneration < 0
    || record.requestedSplitGeneration > NEARBY_MAX_SPLIT_GENERATION) {
    return { ok: false, reason: 'invalid Nearby control generation' };
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: record.proof,
    payload: nearbyControlPresenceSigningPayload(record),
    now: at,
    maxSkewMs: NEARBY_CONTROL_PRESENCE_TTL_MS,
  });
  return verification.ok ? { ok: true, record } : verification;
}
