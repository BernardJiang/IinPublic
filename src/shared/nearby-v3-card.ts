import { parseNearbyAgeProof, type NearbyAgeProof } from './nearby-v3-attestation';
import type { LinkAttestation } from './identity-linking';
import { isPublicLocation, type PublicLocation } from './public-location';
import { portableSha256Hex } from './portable-sha256';
import {
  createSignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';

/**
 * A Nearby v3 card (§3.7 "Cards"): a signed, expiring "I am around here" record. It carries the
 * public point (the centre of the privacy-floor square, public-location.ts), never an exact
 * location. Its scope is Nearby or one public Place. People build their personal nearby lists from
 * these cards, the hub samples them to introduce newcomers, and a Place's members gossip cards
 * scoped to that Place.
 */
export type NearbyCardScope = 'nearby' | `place:${string}`;

/**
 * Proof that this device and `anchorPub` deliberately linked. The lexicographically smaller key is
 * the pair's count key, so two directly linked devices independently choose the same value without
 * sharing private keys. The hub verifies both existing identity-link attestations before accepting
 * a non-self count key.
 */
export type NearbyCountIdentityProof = {
  version: 1;
  anchorPub: string;
  memberToAnchor: LinkAttestation;
  anchorToMember: LinkAttestation;
};

export type NearbyCountIdentity = {
  countKey: string;
  proof?: NearbyCountIdentityProof;
};

export function nearbyCountAnchor(firstPub: string, secondPub: string): string {
  return firstPub < secondPub ? firstPub : secondPub;
}

export type NearbyCard = {
  version: 1;
  kind: 'nearby-card';
  userId: string;
  pub: string;
  /** Unlinked: `pub`. Directly linked pair: the smaller of the two public keys. */
  countKey: string;
  /** Monotonic for count-key scope/point changes; ordinary heartbeats reuse it. */
  scopeRevision: number;
  /** Required when `countKey !== pub`. */
  countProof?: NearbyCountIdentityProof;
  /** Public display name, so a list can be shown without a lookup per person. */
  stageName?: string;
  point: PublicLocation;
  /** At a chosen map point (✈) rather than blurred GPS. Self-declared. */
  traveler: boolean;
  scope: NearbyCardScope;
  issuedAt: string;
  expiresAt: string;
  /**
   * The hub's signed "first seen on" day for this key (nearby-v3-attestation.ts). Signed into the
   * card, so a gossiper cannot strip it; whoever ranks the card verifies it separately.
   */
  age?: NearbyAgeProof;
  proof: SignedP2PEnvelopeProof;
};

export const NEARBY_CARD_MAX_FUTURE_MS = 5_000;
const PLACE_SCOPE = /^place:[A-Za-z0-9_.:-]{1,160}$/;

export function isNearbyCardScope(value: unknown): value is NearbyCardScope {
  return value === 'nearby' || (typeof value === 'string' && PLACE_SCOPE.test(value));
}

function signingPayload(card: Omit<NearbyCard, 'proof'>): unknown {
  return {
    type: 'iinpublic-nearby-card-v1',
    version: card.version,
    kind: card.kind,
    userId: card.userId,
    pub: card.pub,
    countKey: card.countKey,
    scopeRevision: card.scopeRevision,
    ...(card.countProof ? { countProof: card.countProof } : {}),
    ...(card.stageName ? { stageName: card.stageName } : {}),
    point: card.point,
    traveler: card.traveler,
    scope: card.scope,
    issuedAt: card.issuedAt,
    expiresAt: card.expiresAt,
    ...(card.age ? { age: card.age } : {}),
  };
}

export async function createNearbyCard(input: {
  userId: string;
  pair: SeaSigningPair;
  stageName?: string;
  point: PublicLocation;
  traveler?: boolean;
  scope?: NearbyCardScope;
  lifetimeMs: number;
  age?: NearbyAgeProof | null;
  countIdentity?: NearbyCountIdentity | null;
  scopeRevision?: number;
  now?: Date;
}): Promise<NearbyCard> {
  const now = input.now ?? new Date();
  const countKey = String(input.countIdentity?.countKey || input.pair.pub || '').trim();
  const scopeRevision = input.scopeRevision ?? Math.max(1, now.getTime());
  const unsigned: Omit<NearbyCard, 'proof'> = {
    version: 1,
    kind: 'nearby-card',
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    countKey,
    scopeRevision,
    ...(input.countIdentity?.proof ? { countProof: input.countIdentity.proof } : {}),
    ...(input.stageName ? { stageName: String(input.stageName).slice(0, 80) } : {}),
    point: { ...input.point },
    traveler: input.traveler === true,
    scope: input.scope ?? 'nearby',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.lifetimeMs).toISOString(),
    ...(input.age && input.age.pub === input.pair.pub ? { age: input.age } : {}),
  };
  if (!unsigned.userId || !unsigned.pub) throw new Error('a Nearby card needs userId and pub');
  if (!isNearbyCountIdentity(unsigned)) throw new Error('invalid Nearby count identity');
  if (!isPublicLocation(unsigned.point)) throw new Error('a Nearby card point must be a public grid centre');
  if (!isNearbyCardScope(unsigned.scope)) throw new Error('invalid Nearby card scope');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: signingPayload(unsigned),
    timestamp: unsigned.issuedAt,
  });
  return { ...unsigned, proof };
}

/** Shape check only; `verifyNearbyCard` also checks lifetime and signature. */
export function parseNearbyCard(value: unknown): NearbyCard | null {
  if (!value || typeof value !== 'object') return null;
  const card = value as Partial<NearbyCard>;
  if (card.version !== 1
    || card.kind !== 'nearby-card'
    || typeof card.userId !== 'string' || card.userId.length < 1 || card.userId.length > 256
    || typeof card.pub !== 'string' || card.pub.length < 1 || card.pub.length > 2_048
    || !isNearbyCountIdentity(card)
    || (card.stageName !== undefined && (typeof card.stageName !== 'string' || card.stageName.length > 80))
    || !isPublicLocation(card.point)
    || typeof card.traveler !== 'boolean'
    || !isNearbyCardScope(card.scope)
    || typeof card.issuedAt !== 'string' || !Number.isFinite(Date.parse(card.issuedAt))
    || typeof card.expiresAt !== 'string' || !Number.isFinite(Date.parse(card.expiresAt))
    || (card.age !== undefined && (!parseNearbyAgeProof(card.age) || card.age.pub !== card.pub))
    || !card.proof || typeof card.proof !== 'object'
    || card.proof.pub !== card.pub
    || card.proof.timestamp !== card.issuedAt) return null;
  return card as NearbyCard;
}

/** Structural validation only; the hub additionally verifies both attestation signatures. */
export function isNearbyCountIdentity(value: {
  pub?: unknown;
  countKey?: unknown;
  scopeRevision?: unknown;
  countProof?: unknown;
}): boolean {
  if (typeof value.pub !== 'string' || !value.pub || value.pub.length > 2_048
    || typeof value.countKey !== 'string' || !value.countKey || value.countKey.length > 2_048
    || !Number.isSafeInteger(value.scopeRevision) || Number(value.scopeRevision) < 1) return false;
  if (value.countKey === value.pub) return value.countProof === undefined;
  if (value.countKey !== nearbyCountAnchor(value.pub, value.countKey)) return false;
  if (!value.countProof || typeof value.countProof !== 'object') return false;
  const proof = value.countProof as Partial<NearbyCountIdentityProof>;
  if (proof.version !== 1 || proof.anchorPub !== value.countKey) return false;
  const forward = proof.memberToAnchor;
  const reverse = proof.anchorToMember;
  return !!forward && !!reverse
    && forward.fromPub === value.pub && forward.toPub === value.countKey
    && reverse.fromPub === value.countKey && reverse.toPub === value.pub
    && typeof forward.secretHash === 'string' && !!forward.secretHash
    && forward.secretHash === reverse.secretHash
    && Number.isSafeInteger(forward.issuedAt) && Number.isSafeInteger(reverse.issuedAt)
    && typeof forward.sig === 'string' && !!forward.sig
    && typeof reverse.sig === 'string' && !!reverse.sig;
}

export function nearbyCardIssuedAtMs(card: Pick<NearbyCard, 'issuedAt'>): number {
  return Date.parse(card.issuedAt);
}

export function isNearbyCardLive(card: Pick<NearbyCard, 'expiresAt'>, nowMs: number): boolean {
  return Date.parse(card.expiresAt) > nowMs;
}

export async function verifyNearbyCard(
  value: unknown,
  input: { maxLifetimeMs: number; now?: Date },
): Promise<{ ok: true; card: NearbyCard } | { ok: false; reason: string }> {
  const card = parseNearbyCard(value);
  if (!card) return { ok: false, reason: 'malformed Nearby card' };
  const now = input.now ?? new Date();
  const issuedAt = Date.parse(card.issuedAt);
  const expiresAt = Date.parse(card.expiresAt);
  if (issuedAt > now.getTime() + NEARBY_CARD_MAX_FUTURE_MS) return { ok: false, reason: 'Nearby card is from the future' };
  if (expiresAt <= now.getTime()) return { ok: false, reason: 'Nearby card expired' };
  if (expiresAt <= issuedAt || expiresAt - issuedAt > input.maxLifetimeMs) {
    return { ok: false, reason: 'Nearby card lifetime is invalid' };
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: card.proof,
    payload: signingPayload(card),
    now,
    maxSkewMs: input.maxLifetimeMs + NEARBY_CARD_MAX_FUTURE_MS,
  });
  return verification.ok ? { ok: true, card } : verification;
}

/** A short public id for digests (not secret: anyone holding the card can compute it). */
export function nearbyCardShortId(pub: string): string {
  return portableSha256Hex(`iinpublic:nearby-card-id:v1:${pub}`).slice(0, 12);
}
