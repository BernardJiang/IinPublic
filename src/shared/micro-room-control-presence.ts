import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  microRoomControlScopeId,
  microRoomLaneIndex,
  microRoomRoomIdForLane,
} from './micro-room-assignment';
import {
  createSignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';

export const MICRO_ROOM_CONTROL_PRESENCE_TTL_MS = 45_000;
export const MICRO_ROOM_CONTROL_PRESENCE_MAX_FUTURE_MS = 5_000;

export type MicroRoomControlPresence = {
  version: 1;
  kind: 'micro-room-control-presence';
  userId: string;
  pub: string;
  controlScopeId: string;
  roomId: string;
  splitGeneration: number;
  laneIndex: number;
  checkpoint: RoomProtocolCheckpoint;
  observedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

export function microRoomControlPresenceSigningPayload(
  record: Omit<MicroRoomControlPresence, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-micro-room-control-presence-v1',
    version: record.version,
    kind: record.kind,
    userId: record.userId,
    pub: record.pub,
    controlScopeId: record.controlScopeId,
    roomId: record.roomId,
    splitGeneration: record.splitGeneration,
    laneIndex: record.laneIndex,
    checkpoint: record.checkpoint,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
  };
}

export async function createMicroRoomControlPresence(input: {
  userId: string;
  pair: SeaSigningPair;
  baseGridRoomId: string;
  splitGeneration: number;
  laneIndex: number;
  checkpoint: RoomProtocolCheckpoint;
  now?: Date;
}): Promise<MicroRoomControlPresence> {
  const now = input.now ?? new Date();
  const unsigned: Omit<MicroRoomControlPresence, 'proof'> = {
    version: 1,
    kind: 'micro-room-control-presence',
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    controlScopeId: microRoomControlScopeId(input.baseGridRoomId),
    roomId: microRoomRoomIdForLane(
      input.baseGridRoomId,
      input.splitGeneration,
      input.laneIndex,
    ),
    splitGeneration: input.splitGeneration,
    laneIndex: input.laneIndex,
    checkpoint: { ...input.checkpoint },
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MICRO_ROOM_CONTROL_PRESENCE_TTL_MS).toISOString(),
  };
  if (!unsigned.userId || !unsigned.pub) throw new Error('control presence userId and pub are required');
  if (microRoomLaneIndex(unsigned.pub, input.baseGridRoomId, 2 ** input.splitGeneration)
    !== input.laneIndex) throw new Error('control presence identity belongs to another lane');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: microRoomControlPresenceSigningPayload(unsigned),
    timestamp: unsigned.observedAt,
  });
  return { ...unsigned, proof };
}

export function parseMicroRoomControlPresence(value: unknown): MicroRoomControlPresence | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<MicroRoomControlPresence>;
  if (record.version !== 1
    || record.kind !== 'micro-room-control-presence'
    || typeof record.userId !== 'string'
    || record.userId.length < 1
    || record.userId.length > 256
    || typeof record.pub !== 'string'
    || record.pub.length < 1
    || record.pub.length > 2_048
    || typeof record.controlScopeId !== 'string'
    || record.controlScopeId.length < 1
    || record.controlScopeId.length > 128
    || typeof record.roomId !== 'string'
    || record.roomId.length < 1
    || record.roomId.length > 256
    || !Number.isSafeInteger(record.splitGeneration)
    || !Number.isSafeInteger(record.laneIndex)
    || typeof record.observedAt !== 'string'
    || typeof record.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(record.observedAt))
    || !Number.isFinite(Date.parse(record.expiresAt))
    || !record.checkpoint
    || !record.proof
    || record.proof.pub !== record.pub) return null;
  return record as MicroRoomControlPresence;
}

export async function verifyMicroRoomControlPresence(
  value: unknown,
  input: {
    baseGridRoomId: string;
    expectedCheckpoint: RoomProtocolCheckpoint;
    at?: Date;
  },
): Promise<{ ok: true; record: MicroRoomControlPresence } | { ok: false; reason: string }> {
  const record = parseMicroRoomControlPresence(value);
  if (!record) return { ok: false, reason: 'malformed micro-room control presence' };
  const at = input.at ?? new Date();
  const observedAt = Date.parse(record.observedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (observedAt > at.getTime() + MICRO_ROOM_CONTROL_PRESENCE_MAX_FUTURE_MS) {
    return { ok: false, reason: 'micro-room control presence is from the future' };
  }
  if (expiresAt <= at.getTime() || expiresAt !== observedAt + MICRO_ROOM_CONTROL_PRESENCE_TTL_MS) {
    return { ok: false, reason: 'expired or invalid micro-room control presence lifetime' };
  }
  if (!sameCheckpoint(record.checkpoint, input.expectedCheckpoint)) {
    return { ok: false, reason: 'micro-room control presence checkpoint mismatch' };
  }
  if (record.controlScopeId !== microRoomControlScopeId(input.baseGridRoomId)) {
    return { ok: false, reason: 'wrong micro-room control scope' };
  }
  if (!Number.isSafeInteger(record.splitGeneration)
    || record.splitGeneration < 0
    || record.splitGeneration > 20) {
    return { ok: false, reason: 'invalid micro-room control generation' };
  }
  const laneCount = 2 ** record.splitGeneration;
  if (!Number.isSafeInteger(record.laneIndex)
    || record.laneIndex < 0
    || record.laneIndex >= laneCount
    || record.roomId !== microRoomRoomIdForLane(
      input.baseGridRoomId,
      record.splitGeneration,
      record.laneIndex,
    )) return { ok: false, reason: 'invalid micro-room control lane' };
  if (microRoomLaneIndex(record.pub, input.baseGridRoomId, laneCount) !== record.laneIndex) {
    return { ok: false, reason: 'micro-room control identity belongs to another lane' };
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: record.proof,
    payload: microRoomControlPresenceSigningPayload(record),
    now: at,
    maxSkewMs: MICRO_ROOM_CONTROL_PRESENCE_TTL_MS,
  });
  return verification.ok ? { ok: true, record } : verification;
}
