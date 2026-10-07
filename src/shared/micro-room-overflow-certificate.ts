import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  microRoomControlScopeId,
  microRoomRoomIdForLane,
  type MicroRoomAssignment,
  assignMicroRoomForGeneration,
} from './micro-room-assignment';
import {
  type MicroRoomControlPresence,
  verifyMicroRoomControlPresence,
} from './micro-room-control-presence';

export const MICRO_ROOM_OVERFLOW_CERTIFICATE_VERSION = 1;
export const MICRO_ROOM_MAX_SPLIT_GENERATION = 20;
export const MICRO_ROOM_MAX_CERTIFICATE_CAPACITY = 4_096;
export const MICRO_ROOM_MAX_CERTIFICATE_CHAIN = 20;
export const MICRO_ROOM_MAX_CERTIFICATES_PER_GENERATION = 8;
export const MICRO_ROOM_CERTIFICATE_MAX_FUTURE_MS = 5 * 60_000;

export type MicroRoomOverflowCertificate = {
  version: 1;
  kind: 'micro-room-overflow';
  controlScopeId: string;
  fromRoomId: string;
  fromSplitGeneration: number;
  fromLaneIndex: number;
  toSplitGeneration: number;
  checkpoint: RoomProtocolCheckpoint;
  createdAt: string;
  witnesses: MicroRoomControlPresence[];
};

export type VerifiedMicroRoomOverflowCertificate = MicroRoomOverflowCertificate & {
  readonly __verifiedMicroRoomOverflowCertificate: true;
};

export type MicroRoomCertificateVerification =
  | { ok: true; certificate: VerifiedMicroRoomOverflowCertificate }
  | { ok: false; reason: string };

function expectedRoomId(
  baseGridRoomId: string,
  splitGeneration: number,
  laneIndex: number,
): string {
  return microRoomRoomIdForLane(baseGridRoomId, splitGeneration, laneIndex);
}

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

function parseCertificate(value: unknown): MicroRoomOverflowCertificate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<MicroRoomOverflowCertificate>;
  if (record.version !== MICRO_ROOM_OVERFLOW_CERTIFICATE_VERSION
    || record.kind !== 'micro-room-overflow'
    || typeof record.controlScopeId !== 'string'
    || record.controlScopeId.length < 1
    || record.controlScopeId.length > 128
    || typeof record.fromRoomId !== 'string'
    || record.fromRoomId.length < 1
    || record.fromRoomId.length > 256
    || !Number.isSafeInteger(record.fromSplitGeneration)
    || !Number.isSafeInteger(record.fromLaneIndex)
    || !Number.isSafeInteger(record.toSplitGeneration)
    || typeof record.createdAt !== 'string'
    || !Number.isFinite(Date.parse(record.createdAt))
    || !record.checkpoint
    || !Array.isArray(record.witnesses)) return null;
  return record as MicroRoomOverflowCertificate;
}

/**
 * Build a portable certificate. The verifier, not the builder, decides whether every embedded
 * presence is authentic. The bundle is exactly C+1 and therefore bounded by protocol capacity.
 */
export function createMicroRoomOverflowCertificate(input: {
  baseGridRoomId: string;
  fromSplitGeneration: number;
  fromLaneIndex: number;
  checkpoint: RoomProtocolCheckpoint;
  witnesses: MicroRoomControlPresence[];
  createdAt?: string;
}): MicroRoomOverflowCertificate {
  const fromSplitGeneration = Math.floor(input.fromSplitGeneration);
  const fromLaneIndex = Math.floor(input.fromLaneIndex);
  return {
    version: MICRO_ROOM_OVERFLOW_CERTIFICATE_VERSION,
    kind: 'micro-room-overflow',
    controlScopeId: microRoomControlScopeId(input.baseGridRoomId),
    fromRoomId: expectedRoomId(input.baseGridRoomId, fromSplitGeneration, fromLaneIndex),
    fromSplitGeneration,
    fromLaneIndex,
    toSplitGeneration: fromSplitGeneration + 1,
    checkpoint: { ...input.checkpoint },
    createdAt: input.createdAt ?? new Date().toISOString(),
    witnesses: [...input.witnesses],
  };
}

/**
 * Proves one lane was over capacity using C+1 distinct signed identities that were simultaneously
 * live in that lane. No room owner, coordinator signature, server count, or claimed headcount is
 * trusted. Historical certificates remain valid because each witness is checked at createdAt.
 */
export async function verifyMicroRoomOverflowCertificate(
  value: unknown,
  input: {
    baseGridRoomId: string;
    expectedCheckpoint: RoomProtocolCheckpoint;
    now?: Date;
  },
): Promise<MicroRoomCertificateVerification> {
  const certificate = parseCertificate(value);
  if (!certificate) return { ok: false, reason: 'malformed micro-room overflow certificate' };
  const now = input.now ?? new Date();
  const createdAtMs = Date.parse(certificate.createdAt);
  if (createdAtMs > now.getTime() + MICRO_ROOM_CERTIFICATE_MAX_FUTURE_MS) {
    return { ok: false, reason: 'micro-room overflow certificate is from the future' };
  }
  const capacity = input.expectedCheckpoint.chatroomCapacity;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MICRO_ROOM_MAX_CERTIFICATE_CAPACITY) {
    return { ok: false, reason: 'unsupported micro-room certificate capacity' };
  }
  if (!sameCheckpoint(certificate.checkpoint, input.expectedCheckpoint)) {
    return { ok: false, reason: 'micro-room checkpoint mismatch' };
  }
  if (certificate.controlScopeId !== microRoomControlScopeId(input.baseGridRoomId)) {
    return { ok: false, reason: 'wrong micro-room control scope' };
  }
  const generation = certificate.fromSplitGeneration;
  if (generation < 0 || generation >= MICRO_ROOM_MAX_SPLIT_GENERATION
    || certificate.toSplitGeneration !== generation + 1) {
    return { ok: false, reason: 'invalid micro-room generation advance' };
  }
  const laneCount = 2 ** generation;
  if (certificate.fromLaneIndex < 0 || certificate.fromLaneIndex >= laneCount) {
    return { ok: false, reason: 'invalid source lane' };
  }
  const roomId = expectedRoomId(input.baseGridRoomId, generation, certificate.fromLaneIndex);
  if (certificate.fromRoomId !== roomId) return { ok: false, reason: 'wrong source room' };
  if (certificate.witnesses.length !== capacity + 1) {
    return { ok: false, reason: 'overflow certificate must contain exactly capacity plus one witnesses' };
  }

  const certificateTime = new Date(createdAtMs);
  const verified = await Promise.all(certificate.witnesses.map((witness) =>
    verifyMicroRoomControlPresence(witness, {
      baseGridRoomId: input.baseGridRoomId,
      expectedCheckpoint: certificate.checkpoint,
      at: certificateTime,
    })));
  const pubs = new Set<string>();
  for (let index = 0; index < verified.length; index += 1) {
    const result = verified[index]!;
    if (!result.ok) return { ok: false, reason: `invalid overflow witness: ${result.reason}` };
    const witness = result.record;
    if (witness.roomId !== roomId
      || witness.splitGeneration !== generation
      || witness.laneIndex !== certificate.fromLaneIndex) {
      return { ok: false, reason: 'overflow witness belongs to another room or checkpoint' };
    }
    if (pubs.has(witness.pub)) return { ok: false, reason: 'duplicate overflow witness identity' };
    pubs.add(witness.pub);
  }

  return {
    ok: true,
    certificate: {
      ...certificate,
      __verifiedMicroRoomOverflowCertificate: true,
    },
  };
}

export type MicroRoomCertificateChainResult = {
  assignment: MicroRoomAssignment;
  accepted: VerifiedMicroRoomOverflowCertificate[];
};

/**
 * Apply only a contiguous, verifiable certificate chain. A release at generation 0 cannot jump
 * directly to generation 5, and partitions converge monotonically when missing certificates arrive.
 */
export async function applyMicroRoomOverflowCertificateChain(input: {
  identity: string;
  baseGridRoomId: string;
  currentSplitGeneration: number;
  checkpoint: RoomProtocolCheckpoint;
  certificates: unknown[];
  now?: Date;
}): Promise<MicroRoomCertificateChainResult> {
  let generation = input.currentSplitGeneration;
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > MICRO_ROOM_MAX_SPLIT_GENERATION) {
    throw new Error('micro-room split generation is out of range');
  }
  const accepted: VerifiedMicroRoomOverflowCertificate[] = [];
  const candidates = input.certificates.slice(0, MICRO_ROOM_MAX_CERTIFICATE_CHAIN
    * MICRO_ROOM_MAX_CERTIFICATES_PER_GENERATION);

  while (generation < MICRO_ROOM_MAX_SPLIT_GENERATION
    && accepted.length < MICRO_ROOM_MAX_CERTIFICATE_CHAIN) {
    const atGeneration = candidates
      .map(parseCertificate)
      .filter((candidate): candidate is MicroRoomOverflowCertificate =>
        candidate?.fromSplitGeneration === generation)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || left.fromLaneIndex - right.fromLaneIndex)
      .slice(0, MICRO_ROOM_MAX_CERTIFICATES_PER_GENERATION);
    let next: VerifiedMicroRoomOverflowCertificate | null = null;
    for (const candidate of atGeneration) {
      const verification = await verifyMicroRoomOverflowCertificate(candidate, {
        baseGridRoomId: input.baseGridRoomId,
        expectedCheckpoint: input.checkpoint,
        ...(input.now ? { now: input.now } : {}),
      });
      if (verification.ok) {
        next = verification.certificate;
        break;
      }
    }
    if (!next) break;
    accepted.push(next);
    generation += 1;
  }

  return {
    assignment: assignMicroRoomForGeneration(input.identity, input.baseGridRoomId, generation),
    accepted,
  };
}
