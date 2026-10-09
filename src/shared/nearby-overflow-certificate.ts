import type { RoomProtocolCheckpoint } from './active-exchange-room';
import type { GPSCoordinate } from './types';
import {
  deriveNearbyRoomAssignment,
  NEARBY_MAX_SPLIT_GENERATION,
  type NearbyPrivacyMode,
  type NearbyPublicMode,
  type NearbyRoomAssignment,
} from './nearby-rooms';
import {
  nearbyControlScopeId,
  type NearbyControlPresence,
  verifyNearbyControlPresence,
} from './nearby-control-presence';

export const NEARBY_OVERFLOW_CERTIFICATE_VERSION = 1;
export const NEARBY_MAX_CERTIFICATE_CAPACITY = 4_096;
export const NEARBY_MAX_CERTIFICATE_CHAIN = 20;
export const NEARBY_MAX_CERTIFICATES_PER_ROOM = 8;
export const NEARBY_CERTIFICATE_MAX_FUTURE_MS = 5 * 60_000;

export type NearbyOverflowCertificate = {
  version: 1;
  kind: 'nearby-overflow';
  controlScopeId: string;
  rootRoomId: string;
  fromRoomId: string;
  fromRequestedSplitGeneration: number;
  toRequestedSplitGeneration: number;
  checkpoint: RoomProtocolCheckpoint;
  createdAt: string;
  witnesses: NearbyControlPresence[];
};

export type VerifiedNearbyOverflowCertificate = NearbyOverflowCertificate & {
  readonly __verifiedNearbyOverflowCertificate: true;
};

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

function parseCertificate(value: unknown): NearbyOverflowCertificate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<NearbyOverflowCertificate>;
  if (record.version !== NEARBY_OVERFLOW_CERTIFICATE_VERSION
    || record.kind !== 'nearby-overflow'
    || typeof record.controlScopeId !== 'string'
    || typeof record.rootRoomId !== 'string'
    || typeof record.fromRoomId !== 'string'
    || !Number.isSafeInteger(record.fromRequestedSplitGeneration)
    || !Number.isSafeInteger(record.toRequestedSplitGeneration)
    || typeof record.createdAt !== 'string'
    || !Number.isFinite(Date.parse(record.createdAt))
    || !record.checkpoint
    || !Array.isArray(record.witnesses)) return null;
  return record as NearbyOverflowCertificate;
}

export function createNearbyOverflowCertificate(input: {
  rootRoomId: string;
  fromRoomId: string;
  fromRequestedSplitGeneration: number;
  checkpoint: RoomProtocolCheckpoint;
  witnesses: NearbyControlPresence[];
  createdAt?: string;
}): NearbyOverflowCertificate {
  const generation = Math.floor(input.fromRequestedSplitGeneration);
  return {
    version: NEARBY_OVERFLOW_CERTIFICATE_VERSION,
    kind: 'nearby-overflow',
    controlScopeId: nearbyControlScopeId(input.rootRoomId),
    rootRoomId: input.rootRoomId,
    fromRoomId: input.fromRoomId,
    fromRequestedSplitGeneration: generation,
    toRequestedSplitGeneration: generation + 1,
    checkpoint: { ...input.checkpoint },
    createdAt: input.createdAt ?? new Date().toISOString(),
    witnesses: [...input.witnesses],
  };
}

/** Verify C+1 simultaneous signed claims for one opaque Nearby room. Coordinates stay local. */
export async function verifyNearbyOverflowCertificate(
  value: unknown,
  input: { expectedCheckpoint: RoomProtocolCheckpoint; now?: Date },
): Promise<
  | { ok: true; certificate: VerifiedNearbyOverflowCertificate }
  | { ok: false; reason: string }
> {
  const certificate = parseCertificate(value);
  if (!certificate) return { ok: false, reason: 'malformed Nearby overflow certificate' };
  const now = input.now ?? new Date();
  const createdAtMs = Date.parse(certificate.createdAt);
  if (createdAtMs > now.getTime() + NEARBY_CERTIFICATE_MAX_FUTURE_MS) {
    return { ok: false, reason: 'Nearby overflow certificate is from the future' };
  }
  const capacity = input.expectedCheckpoint.chatroomCapacity;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > NEARBY_MAX_CERTIFICATE_CAPACITY) {
    return { ok: false, reason: 'unsupported Nearby certificate capacity' };
  }
  if (!sameCheckpoint(certificate.checkpoint, input.expectedCheckpoint)) {
    return { ok: false, reason: 'Nearby checkpoint mismatch' };
  }
  if (certificate.controlScopeId !== nearbyControlScopeId(certificate.rootRoomId)) {
    return { ok: false, reason: 'wrong Nearby control scope' };
  }
  const generation = certificate.fromRequestedSplitGeneration;
  if (generation < 0 || generation >= NEARBY_MAX_SPLIT_GENERATION
    || certificate.toRequestedSplitGeneration !== generation + 1) {
    return { ok: false, reason: 'invalid Nearby generation advance' };
  }
  if (certificate.witnesses.length !== capacity + 1) {
    return { ok: false, reason: 'overflow certificate must contain exactly capacity plus one witnesses' };
  }
  const certificateTime = new Date(createdAtMs);
  const verified = await Promise.all(certificate.witnesses.map((witness) =>
    verifyNearbyControlPresence(witness, {
      expectedCheckpoint: certificate.checkpoint,
      at: certificateTime,
    })));
  const pubs = new Set<string>();
  for (const result of verified) {
    if (!result.ok) return { ok: false, reason: `invalid overflow witness: ${result.reason}` };
    const witness = result.record;
    if (witness.controlScopeId !== certificate.controlScopeId
      || witness.rootRoomId !== certificate.rootRoomId
      || witness.roomId !== certificate.fromRoomId
      || witness.requestedSplitGeneration !== generation) {
      return { ok: false, reason: 'overflow witness belongs to another Nearby room or generation' };
    }
    if (pubs.has(witness.pub)) return { ok: false, reason: 'duplicate overflow witness identity' };
    pubs.add(witness.pub);
  }
  return {
    ok: true,
    certificate: { ...certificate, __verifiedNearbyOverflowCertificate: true },
  };
}

function publicMode(mode: NearbyPrivacyMode): NearbyPublicMode {
  if (mode !== 'neighborhood' && mode !== 'close-nearby') {
    throw new Error('Nearby overflow applies only to public location modes');
  }
  return mode;
}

/** Follow only certificates for the device's locally derived geographic path. */
export async function applyNearbyOverflowCertificateChain(input: {
  identity: string;
  location: GPSCoordinate;
  mode: NearbyPrivacyMode;
  rootAssignment: NearbyRoomAssignment;
  checkpoint: RoomProtocolCheckpoint;
  certificates: unknown[];
  now?: Date;
}): Promise<{
  assignment: NearbyRoomAssignment;
  accepted: VerifiedNearbyOverflowCertificate[];
}> {
  let assignment = input.rootAssignment;
  if (assignment.requestedSplitGeneration !== 0) {
    throw new Error('Nearby certificate chain must begin at generation zero');
  }
  const accepted: VerifiedNearbyOverflowCertificate[] = [];
  const candidates = input.certificates.slice(0, 160);
  while (assignment.requestedSplitGeneration < NEARBY_MAX_SPLIT_GENERATION
    && accepted.length < NEARBY_MAX_CERTIFICATE_CHAIN) {
    const matching = candidates
      .map(parseCertificate)
      .filter((candidate): candidate is NearbyOverflowCertificate => !!candidate
        && candidate.controlScopeId === nearbyControlScopeId(input.rootAssignment.roomId)
        && candidate.fromRoomId === assignment.roomId
        && candidate.fromRequestedSplitGeneration === assignment.requestedSplitGeneration)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, NEARBY_MAX_CERTIFICATES_PER_ROOM);
    let next: VerifiedNearbyOverflowCertificate | null = null;
    for (const candidate of matching) {
      const verification = await verifyNearbyOverflowCertificate(candidate, {
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
    assignment = deriveNearbyRoomAssignment({
      identity: input.identity,
      location: input.location,
      mode: publicMode(input.mode),
      requestedSplitGeneration: assignment.requestedSplitGeneration + 1,
      protocolEpoch: input.rootAssignment.protocolEpoch,
      previous: assignment,
    });
  }
  return { assignment, accepted };
}
