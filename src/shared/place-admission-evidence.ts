import {
  createSignedP2PEnvelopeProof,
  ROOM_MEMBERSHIP_TTL_SECONDS,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';
import { portableSha256Hex } from './portable-sha256';
import { isPlaceRoomId } from './place-rooms';

export const PLACE_ADMISSION_EVIDENCE_VERSION = 1;
export const PLACE_ADMISSION_MAX_CAPACITY = 4_096;
export const PLACE_ADMISSION_MAX_EVIDENCE_CLAIMS = PLACE_ADMISSION_MAX_CAPACITY * 4;
export const PLACE_ADMISSION_FUTURE_SKEW_MS = 60_000;

export type PlaceAdmissionClaim = {
  version: 1;
  kind: 'place-admission-claim';
  roomId: string;
  userId: string;
  pub: string;
  capacity: number;
  /** Stable throughout one stay, so heartbeat refreshes do not reorder the participant. */
  enteredAt: string;
  observedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

export type VerifiedPlaceAdmissionClaim = PlaceAdmissionClaim & {
  readonly __verifiedPlaceAdmissionClaim: true;
};

export type PlaceAdmissionEvidence = {
  version: 1;
  kind: 'place-admission-evidence';
  roomId: string;
  capacity: number;
  claims: PlaceAdmissionClaim[];
};

export function placeAdmissionClaimSigningPayload(
  claim: Omit<PlaceAdmissionClaim, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-place-admission-claim-v1',
    version: claim.version,
    kind: claim.kind,
    roomId: claim.roomId,
    userId: claim.userId,
    pub: claim.pub,
    capacity: claim.capacity,
    enteredAt: claim.enteredAt,
    observedAt: claim.observedAt,
    expiresAt: claim.expiresAt,
  };
}

export async function createPlaceAdmissionClaim(input: {
  roomId: string;
  userId: string;
  pair: SeaSigningPair;
  capacity: number;
  enteredAt?: string;
  now?: Date;
}): Promise<PlaceAdmissionClaim> {
  const now = input.now ?? new Date();
  const unsigned: Omit<PlaceAdmissionClaim, 'proof'> = {
    version: PLACE_ADMISSION_EVIDENCE_VERSION,
    kind: 'place-admission-claim',
    roomId: input.roomId,
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    capacity: input.capacity,
    enteredAt: input.enteredAt ?? now.toISOString(),
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ROOM_MEMBERSHIP_TTL_SECONDS * 1000).toISOString(),
  };
  if (!isPlaceRoomId(unsigned.roomId) || !unsigned.userId || !unsigned.pub) {
    throw new Error('Place admission claim requires a Place, user id, and public key');
  }
  if (!Number.isSafeInteger(unsigned.capacity) || unsigned.capacity < 1
    || unsigned.capacity > PLACE_ADMISSION_MAX_CAPACITY) {
    throw new Error('Place admission claim capacity is invalid');
  }
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: placeAdmissionClaimSigningPayload(unsigned),
    timestamp: unsigned.observedAt,
  });
  return { ...unsigned, proof };
}

function parsePlaceAdmissionClaim(value: unknown): PlaceAdmissionClaim | null {
  if (!value || typeof value !== 'object') return null;
  const claim = value as Partial<PlaceAdmissionClaim>;
  if (claim.version !== PLACE_ADMISSION_EVIDENCE_VERSION
    || claim.kind !== 'place-admission-claim'
    || typeof claim.roomId !== 'string'
    || !isPlaceRoomId(claim.roomId)
    || typeof claim.userId !== 'string' || !claim.userId || claim.userId.length > 256
    || typeof claim.pub !== 'string' || !claim.pub || claim.pub.length > 2_048
    || !Number.isSafeInteger(claim.capacity) || Number(claim.capacity) < 1
    || Number(claim.capacity) > PLACE_ADMISSION_MAX_CAPACITY
    || typeof claim.enteredAt !== 'string' || !Number.isFinite(Date.parse(claim.enteredAt))
    || typeof claim.observedAt !== 'string' || !Number.isFinite(Date.parse(claim.observedAt))
    || typeof claim.expiresAt !== 'string' || !Number.isFinite(Date.parse(claim.expiresAt))
    || !claim.proof || claim.proof.pub !== claim.pub) return null;
  return claim as PlaceAdmissionClaim;
}

export async function verifyPlaceAdmissionClaim(
  value: unknown,
  input: { roomId: string; capacity: number; now?: Date },
): Promise<{ ok: true; claim: VerifiedPlaceAdmissionClaim } | { ok: false; reason: string }> {
  const claim = parsePlaceAdmissionClaim(value);
  if (!claim) return { ok: false, reason: 'malformed Place admission claim' };
  const now = input.now ?? new Date();
  if (claim.roomId !== input.roomId || claim.capacity !== input.capacity) {
    return { ok: false, reason: 'Place admission scope or capacity mismatch' };
  }
  if (Date.parse(claim.expiresAt) <= now.getTime()) return { ok: false, reason: 'expired Place admission claim' };
  if (Date.parse(claim.enteredAt) > Date.parse(claim.observedAt)) {
    return { ok: false, reason: 'Place admission entry is after its observation' };
  }
  if (Date.parse(claim.observedAt) > now.getTime() + PLACE_ADMISSION_FUTURE_SKEW_MS
    || Date.parse(claim.enteredAt) > now.getTime() + PLACE_ADMISSION_FUTURE_SKEW_MS) {
    return { ok: false, reason: 'Place admission claim is from the future' };
  }
  if (Date.parse(claim.expiresAt) - Date.parse(claim.observedAt)
    > ROOM_MEMBERSHIP_TTL_SECONDS * 1000 + 1_000) {
    return { ok: false, reason: 'Place admission claim lifetime is too long' };
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: claim.proof,
    payload: placeAdmissionClaimSigningPayload(claim),
    now,
    maxSkewMs: ROOM_MEMBERSHIP_TTL_SECONDS * 1000 + PLACE_ADMISSION_FUTURE_SKEW_MS,
  });
  return verification.ok
    ? { ok: true, claim: { ...claim, __verifiedPlaceAdmissionClaim: true } }
    : verification;
}

/**
 * Merge claims from any number of disconnected indexes. Earliest stay wins; a room/pub hash is
 * the deterministic tie-breaker. Every honest index therefore converges on the same C identities
 * regardless of arrival/merge order, without an owner or moderator key.
 */
export async function reconcilePlaceAdmissionEvidence(input: {
  roomId: string;
  capacity: number;
  evidence: unknown[];
  now?: Date;
}): Promise<{
  evidence: PlaceAdmissionEvidence;
  winners: VerifiedPlaceAdmissionClaim[];
  losers: VerifiedPlaceAdmissionClaim[];
  rejected: number;
}> {
  const now = input.now ?? new Date();
  const candidates = input.evidence.flatMap((value) => {
    if (value && typeof value === 'object' && Array.isArray((value as Partial<PlaceAdmissionEvidence>).claims)) {
      return (value as PlaceAdmissionEvidence).claims;
    }
    return [value];
  // A partitioned arena can temporarily contribute far more than C claims (the product's scale
  // gate is 10,000 people). Do not truncate at a C-derived count: doing so made merge order choose
  // different subsets before signature verification. The control-store read itself is bounded to
  // the same 16,384-record protocol ceiling, which covers that gate while limiting abuse cost.
  }).slice(0, PLACE_ADMISSION_MAX_EVIDENCE_CLAIMS);
  const verified = await Promise.all(candidates.map((candidate) =>
    verifyPlaceAdmissionClaim(candidate, { roomId: input.roomId, capacity: input.capacity, now })));
  // A stable signing identity can occupy at most one seat. User ids are presentation/routing
  // handles and must not let one key consume C seats merely by choosing several handles. This is
  // deliberately not Sybil resistance: one person can still mint multiple independent keys.
  const byIdentity = new Map<string, VerifiedPlaceAdmissionClaim>();
  let rejected = 0;
  for (const result of verified) {
    if (!result.ok) { rejected += 1; continue; }
    const existing = byIdentity.get(result.claim.pub);
    if (!existing || Date.parse(result.claim.observedAt) > Date.parse(existing.observedAt)) {
      byIdentity.set(result.claim.pub, result.claim);
    }
  }
  const ordered = [...byIdentity.values()].sort((left, right) => {
    const timeOrder = Date.parse(left.enteredAt) - Date.parse(right.enteredAt);
    if (timeOrder !== 0) return timeOrder;
    const leftKey = portableSha256Hex(`${input.roomId}\n${left.pub}`);
    const rightKey = portableSha256Hex(`${input.roomId}\n${right.pub}`);
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (left.userId === right.userId) return 0;
    return left.userId < right.userId ? -1 : 1;
  });
  const winners = ordered.slice(0, input.capacity);
  const losers = ordered.slice(input.capacity);
  return {
    evidence: {
      version: PLACE_ADMISSION_EVIDENCE_VERSION,
      kind: 'place-admission-evidence',
      roomId: input.roomId,
      capacity: input.capacity,
      claims: ordered,
    },
    winners,
    losers,
    rejected,
  };
}
