import {
  isNearbyCardLive,
  nearbyCardIssuedAtMs,
  nearbyCardShortId,
  type NearbyCard,
  type NearbyCardScope,
} from './nearby-v3-card';
import {
  compareNearbyRankKeys,
  nearbyRankKey,
  type NearbyRankKey,
} from './nearby-v3-ranking';

/**
 * One person's nearby list (§3.7 "Model" and "Gossip"): at most C cards, best first by the owner's
 * own ranking, freshest copy of each person, expired cards dropped. Pure and synchronous: it holds
 * only cards whose signatures the caller already checked. `useful()` says which incoming cards
 * would change the list, so a phone verifies only those.
 *
 * Inside a Place everyone is "at" the Place, so a Place list ranks by the owner's hash order alone.
 */
export type NearbyListOwner = {
  pub: string;
  point: { latitude: number; longitude: number };
  scope: NearbyCardScope;
  beacon: string;
  /**
   * Whether a card's key existed before today's beacon (its age proof verified). The list is pure
   * and synchronous, so the caller verifies proofs and answers here; absent, everyone is new.
   */
  isEstablished?: (card: NearbyCard) => boolean;
  /**
   * Group boundary (§3.7 "Meeting new people in groups"): the rank key of the last person of my
   * previous group. Only cards ranked after it belong on the list; absent, this is group 1.
   */
  after?: NearbyRankKey;
  /**
   * People already shown in an earlier group. The rank boundary is still used for efficient
   * paging, but a signed beacon or identity-age proof can arrive after a group was rendered and
   * change its rank keys. Exact exclusions keep that late re-ranking from showing someone twice.
   */
  excludedPubs?: readonly string[];
};

export type NearbyListEntry = {
  card: NearbyCard;
  key: NearbyRankKey;
  issuedAtMs: number;
  shortId: string;
};

/**
 * What I hold, so a partner sends only what I lack: per card, 8 hex chars of its short id and its
 * age in minutes (base 36, two chars). About 5 KB for 498 cards.
 */
export type NearbyDigest = { version: 1; at: number; entries: string };

const DIGEST_ID_CHARS = 8;
const DIGEST_AGE_CHARS = 2;
const DIGEST_MAX_AGE_MINUTES = 36 * 36 - 1;

export class NearbyList {
  private owner: NearbyListOwner;
  private readonly capacity: number;
  private byPub = new Map<string, NearbyListEntry>();
  private sorted: NearbyListEntry[] = [];

  constructor(owner: NearbyListOwner, options: { capacity: number }) {
    this.owner = { ...owner };
    this.capacity = Math.max(1, Math.floor(options.capacity));
  }

  get size(): number {
    return this.sorted.length;
  }

  get ownerInfo(): Readonly<NearbyListOwner> {
    return this.owner;
  }

  entries(): readonly NearbyListEntry[] {
    return this.sorted;
  }

  get(pub: string): NearbyListEntry | undefined {
    return this.byPub.get(pub);
  }

  has(pub: string): boolean {
    return this.byPub.has(pub);
  }

  rankOf(card: NearbyCard): NearbyRankKey {
    const placeScoped = this.owner.scope !== 'nearby';
    return nearbyRankKey({
      viewerPub: this.owner.pub,
      viewerPoint: this.owner.point,
      memberPub: card.pub,
      memberPoint: placeScoped ? this.owner.point : card.point,
      beacon: this.owner.beacon,
      memberEstablished: this.owner.isEstablished?.(card) === true,
    });
  }

  /**
   * The owner moved, changed scope, moved to another group, or a new day's beacon began: re-rank
   * everything. A scope change empties the list, since cards from another scope do not belong on
   * it; a group boundary drops everyone at or before it.
   */
  setOwner(owner: NearbyListOwner): void {
    if (owner.scope !== this.owner.scope) {
      this.byPub.clear();
      this.sorted = [];
    }
    this.owner = { ...owner };
    const hasExactExclusions = (this.owner.excludedPubs?.length ?? 0) > 0;
    for (const [pub, entry] of this.byPub) {
      entry.key = this.rankOf(entry.card);
      if (this.owner.excludedPubs?.includes(pub)
        || (!hasExactExclusions && !this.pastBoundary(entry.key))) this.byPub.delete(pub);
    }
    this.resort();
  }

  /** The rank key of the last person on the list (the next group's boundary), or null when empty. */
  lastKey(): NearbyRankKey | null {
    return this.sorted.at(-1)?.key ?? null;
  }

  /** The cards in `cards` that would enter the list or refresh a copy on it. */
  useful(cards: readonly NearbyCard[], nowMs: number): NearbyCard[] {
    const worst = this.sorted.length >= this.capacity ? this.sorted[this.sorted.length - 1] : undefined;
    const best = new Map<string, NearbyCard>();
    for (const card of cards) {
      if (!this.accepts(card, nowMs)) continue;
      const held = this.byPub.get(card.pub);
      const issuedAtMs = nearbyCardIssuedAtMs(card);
      if (held) {
        if (issuedAtMs <= held.issuedAtMs) continue;
      } else if (worst && compareNearbyRankKeys(this.rankOf(card), worst.key) >= 0) {
        continue;
      }
      const seen = best.get(card.pub);
      if (!seen || nearbyCardIssuedAtMs(seen) < issuedAtMs) best.set(card.pub, card);
    }
    return [...best.values()];
  }

  /** Add verified cards: freshest copy wins, expired cards drop, only the best C stay. */
  merge(cards: readonly NearbyCard[], nowMs: number): { added: number; refreshed: number; dropped: number } {
    let added = 0;
    let refreshed = 0;
    for (const card of cards) {
      if (!this.accepts(card, nowMs)) continue;
      const issuedAtMs = nearbyCardIssuedAtMs(card);
      const held = this.byPub.get(card.pub);
      if (held) {
        if (issuedAtMs <= held.issuedAtMs) continue;
        held.card = card;
        held.issuedAtMs = issuedAtMs;
        held.key = this.rankOf(card);
        refreshed += 1;
        continue;
      }
      this.byPub.set(card.pub, { card, key: this.rankOf(card), issuedAtMs, shortId: nearbyCardShortId(card.pub) });
      added += 1;
    }
    const before = this.byPub.size;
    this.dropExpired(nowMs);
    this.resort();
    return { added, refreshed, dropped: before - this.sorted.length };
  }

  /** Drop expired cards; returns how many went. */
  prune(nowMs: number): number {
    const before = this.byPub.size;
    this.dropExpired(nowMs);
    if (this.byPub.size !== before) this.resort();
    return before - this.byPub.size;
  }

  /** A swap or delivery to this person got no answer: they leave the list at once. */
  remove(pub: string): boolean {
    if (!this.byPub.delete(pub)) return false;
    this.sorted = this.sorted.filter((entry) => entry.card.pub !== pub);
    return true;
  }

  digest(nowMs: number): NearbyDigest {
    let entries = '';
    for (const entry of this.sorted) {
      const ageMinutes = Math.max(0, Math.min(DIGEST_MAX_AGE_MINUTES, Math.floor((nowMs - entry.issuedAtMs) / 60_000)));
      entries += entry.shortId.slice(0, DIGEST_ID_CHARS) + ageMinutes.toString(36).padStart(DIGEST_AGE_CHARS, '0');
    }
    return { version: 1, at: nowMs, entries };
  }

  /**
   * What I send a gossip partner (§3.7 "Gossip" step 3): my own fresh card, then up to
   * `swapCards − 1` cards they are missing or hold a copy at least `refreshMs` older of, best first
   * by THEIR ranking (the order is public, so I can compute it).
   */
  offerFor(input: {
    receiver: NearbyListOwner;
    digest: NearbyDigest | null;
    ownCard: NearbyCard | null;
    swapCards: number;
    refreshMs: number;
    nowMs: number;
  }): NearbyCard[] {
    const held = parseNearbyDigest(input.digest, input.nowMs);
    const view = new NearbyList(input.receiver, { capacity: Number.MAX_SAFE_INTEGER });
    const candidates: Array<{ card: NearbyCard; key: NearbyRankKey }> = [];
    for (const entry of this.sorted) {
      const card = entry.card;
      if (card.pub === input.receiver.pub || !view.accepts(card, input.nowMs)) continue;
      const theirs = held.get(entry.shortId.slice(0, DIGEST_ID_CHARS));
      if (theirs !== undefined && entry.issuedAtMs - theirs < input.refreshMs) continue;
      candidates.push({ card, key: view.rankOf(card) });
    }
    candidates.sort((a, b) => compareNearbyRankKeys(a.key, b.key));
    const offer: NearbyCard[] = [];
    if (input.ownCard && input.ownCard.pub !== input.receiver.pub) offer.push(input.ownCard);
    for (const candidate of candidates) {
      if (offer.length >= input.swapCards) break;
      offer.push(candidate.card);
    }
    return offer;
  }

  private accepts(card: NearbyCard, nowMs: number): boolean {
    const hasExactExclusions = (this.owner.excludedPubs?.length ?? 0) > 0;
    return card.pub !== this.owner.pub && card.scope === this.owner.scope && isNearbyCardLive(card, nowMs)
      && !this.owner.excludedPubs?.includes(card.pub)
      && (hasExactExclusions || !this.owner.after || this.pastBoundary(this.rankOf(card)));
  }

  private pastBoundary(key: NearbyRankKey): boolean {
    return !this.owner.after || compareNearbyRankKeys(key, this.owner.after) > 0;
  }

  private dropExpired(nowMs: number): void {
    for (const [pub, entry] of this.byPub) if (!isNearbyCardLive(entry.card, nowMs)) this.byPub.delete(pub);
  }

  private resort(): void {
    const all = [...this.byPub.values()].sort((a, b) => compareNearbyRankKeys(a.key, b.key));
    for (const entry of all.slice(this.capacity)) this.byPub.delete(entry.card.pub);
    this.sorted = all.slice(0, this.capacity);
  }
}

/** Short id → when the holder's copy was issued (ms, to the minute). Malformed input → empty. */
export function parseNearbyDigest(digest: NearbyDigest | null | undefined, nowMs: number): Map<string, number> {
  const held = new Map<string, number>();
  if (!digest || digest.version !== 1 || typeof digest.entries !== 'string' || !Number.isFinite(digest.at)) return held;
  const width = DIGEST_ID_CHARS + DIGEST_AGE_CHARS;
  if (digest.entries.length % width !== 0 || digest.entries.length > width * 20_000) return held;
  const at = Math.min(digest.at, nowMs);
  for (let i = 0; i < digest.entries.length; i += width) {
    const id = digest.entries.slice(i, i + DIGEST_ID_CHARS);
    const age = parseInt(digest.entries.slice(i + DIGEST_ID_CHARS, i + width), 36);
    if (!/^[0-9a-f]+$/.test(id) || !Number.isFinite(age)) continue;
    // The digest rounds ages down, so the copy may be up to a minute older than this.
    held.set(id, at - (age + 1) * 60_000);
  }
  return held;
}
