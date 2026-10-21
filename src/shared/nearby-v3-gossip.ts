import { parseNearbyBeacon, type NearbyBeacon } from './nearby-v3-attestation';
import { parseNearbyCard, type NearbyCard } from './nearby-v3-card';
import type { NearbyDigest } from './nearby-v3-list';
import { parseNearbyRankKey, type NearbyRankKey } from './nearby-v3-ranking';

/**
 * Wire messages of one Nearby v3 gossip swap (§3.7 "Gossip"), three in all:
 *
 *   initiator → partner   request  { card, digest }            my card and what I hold
 *   partner → initiator   reply    { card, digest, cards }     the partner's offer for me
 *   initiator → partner   push     { card, cards }             my offer for the partner
 *
 * A request and a reply may also carry the sender's signed daily beacon, so phones that cannot
 * reach the hub still agree on today's order, and the sender's group boundary (`after`), so the
 * other side offers only people past it (§3.7 "Meeting new people in groups").
 *
 * Every card inside is still checked by the receiver (signature, lifetime, scope) before it can
 * enter a list; these parsers check shape and size only.
 */
export type NearbyGossipRequest = {
  kind: 'nearby-gossip-request';
  version: 1;
  card: NearbyCard;
  digest: NearbyDigest;
  beacon?: NearbyBeacon;
  after?: NearbyRankKey;
};
export type NearbyGossipReply = {
  kind: 'nearby-gossip-reply';
  version: 1;
  card: NearbyCard;
  digest: NearbyDigest;
  cards: NearbyCard[];
  beacon?: NearbyBeacon;
  after?: NearbyRankKey;
};
export type NearbyGossipPush = { kind: 'nearby-gossip-push'; version: 1; card: NearbyCard; cards: NearbyCard[] };
/** "Not now": the partner is at its incoming limit; try someone else. */
export type NearbyGossipBusy = { kind: 'nearby-gossip-busy'; version: 1; retryAfterMs: number };
export type NearbyGossipMessage = NearbyGossipRequest | NearbyGossipReply | NearbyGossipPush | NearbyGossipBusy;

/** Most cards one message may carry, whatever the manifest says (bounds a hostile sender). */
export const NEARBY_GOSSIP_MAX_CARDS = 256;
const MAX_DIGEST_CHARS = 10 * 20_000;

function parseDigest(value: unknown): NearbyDigest | null {
  if (!value || typeof value !== 'object') return null;
  const digest = value as Partial<NearbyDigest>;
  if (digest.version !== 1 || !Number.isFinite(digest.at) || typeof digest.entries !== 'string') return null;
  if (digest.entries.length > MAX_DIGEST_CHARS) return null;
  return { version: 1, at: digest.at!, entries: digest.entries };
}

function parseCards(value: unknown): NearbyCard[] | null {
  if (!Array.isArray(value) || value.length > NEARBY_GOSSIP_MAX_CARDS) return null;
  const cards: NearbyCard[] = [];
  for (const item of value) {
    const card = parseNearbyCard(item);
    if (card) cards.push(card);
  }
  return cards;
}

export function parseNearbyGossipMessage(value: unknown): NearbyGossipMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.version !== 1) return null;
  if (message.kind === 'nearby-gossip-busy') {
    const retryAfterMs = Number(message.retryAfterMs);
    return Number.isFinite(retryAfterMs) && retryAfterMs >= 0
      ? { kind: 'nearby-gossip-busy', version: 1, retryAfterMs: Math.min(retryAfterMs, 3_600_000) }
      : null;
  }
  const card = parseNearbyCard(message.card);
  if (!card) return null;
  const beacon = parseNearbyBeacon(message.beacon);
  const after = parseNearbyRankKey(message.after);
  const withBeacon = { ...(beacon ? { beacon } : {}), ...(after ? { after } : {}) };
  if (message.kind === 'nearby-gossip-request') {
    const digest = parseDigest(message.digest);
    return digest ? { kind: 'nearby-gossip-request', version: 1, card, digest, ...withBeacon } : null;
  }
  const cards = parseCards(message.cards);
  if (!cards) return null;
  if (message.kind === 'nearby-gossip-push') return { kind: 'nearby-gossip-push', version: 1, card, cards };
  if (message.kind === 'nearby-gossip-reply') {
    const digest = parseDigest(message.digest);
    return digest ? { kind: 'nearby-gossip-reply', version: 1, card, digest, cards, ...withBeacon } : null;
  }
  return null;
}
