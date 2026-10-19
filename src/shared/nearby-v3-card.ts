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
 * public point (the centre of the privacy-floor square, public-location.ts), never a room id or an
 * exact location. People build their personal nearby lists from these cards, the hub samples them
 * to introduce newcomers, and a Place's members gossip cards scoped to that Place.
 */
export type NearbyCardScope = 'nearby' | `place:${string}`;

export type NearbyCard = {
  version: 1;
  kind: 'nearby-card';
  userId: string;
  pub: string;
  /** Public display name, so a list can be shown without a lookup per person. */
  stageName?: string;
  point: PublicLocation;
  /** At a chosen map point (✈) rather than blurred GPS. Self-declared. */
  traveler: boolean;
  scope: NearbyCardScope;
  issuedAt: string;
  expiresAt: string;
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
    ...(card.stageName ? { stageName: card.stageName } : {}),
    point: card.point,
    traveler: card.traveler,
    scope: card.scope,
    issuedAt: card.issuedAt,
    expiresAt: card.expiresAt,
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
  now?: Date;
}): Promise<NearbyCard> {
  const now = input.now ?? new Date();
  const unsigned: Omit<NearbyCard, 'proof'> = {
    version: 1,
    kind: 'nearby-card',
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    ...(input.stageName ? { stageName: String(input.stageName).slice(0, 80) } : {}),
    point: { ...input.point },
    traveler: input.traveler === true,
    scope: input.scope ?? 'nearby',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.lifetimeMs).toISOString(),
  };
  if (!unsigned.userId || !unsigned.pub) throw new Error('a Nearby card needs userId and pub');
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
    || (card.stageName !== undefined && (typeof card.stageName !== 'string' || card.stageName.length > 80))
    || !isPublicLocation(card.point)
    || typeof card.traveler !== 'boolean'
    || !isNearbyCardScope(card.scope)
    || typeof card.issuedAt !== 'string' || !Number.isFinite(Date.parse(card.issuedAt))
    || typeof card.expiresAt !== 'string' || !Number.isFinite(Date.parse(card.expiresAt))
    || !card.proof || typeof card.proof !== 'object'
    || card.proof.pub !== card.pub
    || card.proof.timestamp !== card.issuedAt) return null;
  return card as NearbyCard;
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
