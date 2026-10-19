import {
  createNearbyCard,
  nearbyCardIssuedAtMs,
  parseNearbyCard,
  verifyNearbyCard,
  type NearbyCard,
  type NearbyCardScope,
} from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import {
  parseNearbyGossipMessage,
  type NearbyGossipMessage,
  type NearbyGossipReply,
} from '../../shared/nearby-v3-gossip';
import { NearbyList, type NearbyListEntry, type NearbyListOwner } from '../../shared/nearby-v3-list';
import { nearbyDailyBeacon } from '../../shared/nearby-v3-ranking';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { PublicLocation } from '../../shared/public-location';

/**
 * One phone's Nearby v3 list (docs/design/nearby-and-place-chatrooms.md §3.7): it signs the user's
 * own card, reports it to the hub (counts and introductions), asks the hub for introductions only
 * when the list must start over (first start, a new public point or scope, an empty list), and keeps
 * the list current by one gossip swap per period with a random person on it. A person who does not
 * answer leaves the list at once.
 *
 * Everything outside the list logic is injected: the hub client, the peer link, signing, storage and
 * the clock, so the whole cycle runs in unit tests.
 */
export type NearbyV3Hub = {
  heartbeat(card: NearbyCard): Promise<void>;
  introductions(input: { point: { latitude: number; longitude: number }; scope: NearbyCardScope; excludePub: string }): Promise<NearbyCard[]>;
};

export type NearbyV3Link = {
  /** Send one gossip message to a person and wait for their answer; null when they did not answer. */
  request(to: NearbyCard, message: NearbyGossipMessage, timeoutMs: number): Promise<unknown>;
  /** Send without waiting for an answer (the swap's last message); falls back to `request`. */
  send?(to: NearbyCard, message: NearbyGossipMessage): Promise<void>;
};

export type NearbyV3Position = { point: PublicLocation; traveler: boolean; scope: NearbyCardScope };

export type NearbyV3ServiceDeps = {
  config: () => NearbyV3Config;
  identity: () => { userId: string; pair: SeaSigningPair; stageName?: string } | null;
  /** The public point to publish and the active scope; null publishes nothing (no point chosen yet). */
  position: () => NearbyV3Position | null;
  hub: NearbyV3Hub;
  link: NearbyV3Link;
  verify?: (card: unknown, maxLifetimeMs: number, now: Date) => Promise<boolean>;
  sign?: typeof createNearbyCard;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  random?: () => number;
  /** True while the app is in the background: gossip slows down (cards are still reissued). */
  isPaused?: () => boolean;
  onChange?: (entries: readonly NearbyListEntry[]) => void;
  log?: (message: string) => void;
};

export const NEARBY_V3_STORAGE_KEY = 'iinpublic_nearby_v3_list_v1';
const PAUSED_GOSSIP_FACTOR = 4;
/** Covers opening a new link (WebRTC gives up after 10 s) plus the answer. */
const SWAP_TIMEOUT_MS = 15_000;
/**
 * A newcomer (or a changed card) swaps with this many of the nearest people at once, so a small
 * group sees a new arrival right away instead of one gossip period later for all but one of them.
 */
const ANNOUNCE_SWAPS = 3;
const MAX_VERIFIED_CACHE = 4_096;
/** While the list is empty, ask the hub again after this long, doubling up to one gossip period. */
const EMPTY_RETRY_MIN_MS = 5_000;

export class NearbyV3Service {
  private list: NearbyList | null = null;
  private ownCard: NearbyCard | null = null;
  private searchedKey = '';
  private lastGossipAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private ticking: Promise<void> | null = null;
  private incoming = 0;
  private readonly counters = { swaps: 0, failedSwaps: 0, busy: 0, answered: 0 };
  private listCapacity = 0;
  private persistedSignature: string | null = null;
  /** The last hub search found nobody: the next one that finds someone announces us. */
  private searchedEmpty = false;
  private emptyRetryMs = EMPTY_RETRY_MIN_MS;
  private readonly verified = new Map<string, boolean>();
  /** People who did not answer, with the card they had: only a newer card brings them back. */
  private readonly silent = new Map<string, number>();
  private readonly deps: NearbyV3ServiceDeps;

  constructor(deps: NearbyV3ServiceDeps) {
    this.deps = deps;
  }

  entries(): readonly NearbyListEntry[] {
    return this.list?.entries() ?? [];
  }

  card(): NearbyCard | null {
    return this.ownCard;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The public point or scope changed: reissue the card and search again now. */
  refresh(): Promise<void> {
    return this.tick();
  }

  /**
   * The link to this person could not be opened (a delivery gave up). That alone is no proof they
   * left — under load or behind a strict NAT a live phone can fail to connect — so ask them with a
   * swap now; only a swap that stays silent (twice) drops them.
   */
  probe(pub: string): Promise<void> {
    const entry = this.list?.get(pub);
    return entry ? this.gossipOnce(entry.card) : Promise.resolve();
  }

  /** Swaps to this person got no answer: drop them now. */
  reportUnreachable(pub: string): void {
    const entry = this.list?.get(pub);
    if (entry) {
      this.silent.set(pub, entry.issuedAtMs);
      if (this.silent.size > MAX_VERIFIED_CACHE) this.silent.delete(this.silent.keys().next().value as string);
    }
    if (this.list?.remove(pub)) this.changed();
  }

  /**
   * A card that reached me outside gossip (a knock carries the knocker's own card): merge it like a
   * swapped one, so the person who knocked is on my list before our link is even up.
   */
  offerCard(card: NearbyCard): Promise<void> {
    return this.ingest([card]);
  }

  /** Swaps started, failed (partner dropped), refused busy, and swaps this phone answered. */
  stats(): { swaps: number; failedSwaps: number; busy: number; answered: number; size: number } {
    return { ...this.counters, size: this.list?.size ?? 0 };
  }

  /** Run one swap now, whatever the period (diagnostics and tests). */
  gossipNow(): Promise<void> {
    return this.gossipOnce();
  }

  /** One pass of due work. Safe to call at any time; overlapping calls share one pass. */
  tick(): Promise<void> {
    this.ticking ??= this.runTick().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  /**
   * The receiving side of a swap: `fromPub` is the key the link authenticated. Returns the answer to
   * send back, or null to send nothing.
   */
  async handleMessage(fromPub: string, value: unknown): Promise<NearbyGossipMessage | null> {
    const message = parseNearbyGossipMessage(value);
    if (!message || message.kind === 'nearby-gossip-busy' || message.kind === 'nearby-gossip-reply') return null;
    if (message.card.pub !== fromPub) return null;
    const list = this.ensureList();
    const config = this.deps.config();
    if (!list || !this.ownCard) return null;
    if (message.card.scope !== list.ownerInfo.scope) return null;
    if (message.kind === 'nearby-gossip-push') {
      await this.ingest([message.card, ...message.cards]);
      return null;
    }
    if (this.incoming >= config.incomingConnections) {
      return { kind: 'nearby-gossip-busy', version: 1, retryAfterMs: config.gossipPeriodMs };
    }
    this.incoming += 1;
    try {
      if (!await this.isValid(message.card)) return null;
      const nowMs = this.now();
      const offer = list.offerFor({
        receiver: this.ownerFor(message.card),
        digest: message.digest,
        ownCard: this.ownCard,
        swapCards: config.swapCards,
        refreshMs: config.cardRefreshMs,
        nowMs,
      });
      const reply: NearbyGossipReply = {
        kind: 'nearby-gossip-reply',
        version: 1,
        card: this.ownCard,
        digest: list.digest(nowMs),
        cards: offer.filter((card) => card !== this.ownCard),
      };
      await this.ingest([message.card]);
      this.counters.answered += 1;
      return reply;
    } finally {
      this.incoming -= 1;
    }
  }

  private async runTick(): Promise<void> {
    const position = this.deps.position();
    const identity = this.deps.identity();
    if (!position || !identity) {
      // Not in Nearby (in a Place, or no point chosen): publish nothing. Coming back searches again
      // and announces with a newly signed card (people who found us silent take only a newer one).
      this.searchedKey = '';
      this.ownCard = null;
      return;
    }
    const config = this.deps.config();
    const nowMs = this.now();
    const list = this.ensureList();
    if (!list) return;
    if (list.prune(nowMs)) this.changed();

    // A changed name, point or traveler flag reaches the nearest person at once (below); a plain
    // reissue before expiry travels with the next regular swap.
    let changedCard = false;
    if (this.cardIsStale(position, identity.userId, nowMs, config)) {
      const previous = this.ownCard;
      const sign = this.deps.sign ?? createNearbyCard;
      this.ownCard = await sign({
        userId: identity.userId,
        pair: identity.pair,
        ...(identity.stageName ? { stageName: identity.stageName } : {}),
        point: position.point,
        traveler: position.traveler,
        scope: position.scope,
        lifetimeMs: config.cardLifetimeMs,
        now: new Date(nowMs),
      });
      changedCard = !!previous && (previous.stageName !== this.ownCard.stageName
        || previous.traveler !== this.ownCard.traveler
        || previous.point.latitude !== this.ownCard.point.latitude
        || previous.point.longitude !== this.ownCard.point.longitude);
      await this.deps.hub.heartbeat(this.ownCard).catch((error) => this.log(`hub heartbeat failed: ${String(error)}`));
    }

    const searchKey = `${position.scope}|${position.point.latitude}|${position.point.longitude}`;
    let announce = false;
    if (searchKey !== this.searchedKey || list.size === 0) {
      try {
        const cards = await this.deps.hub.introductions({ point: position.point, scope: position.scope, excludePub: identity.pair.pub });
        // A newcomer (or someone who just moved) swaps with the nearest few people at once, so the
        // people around learn of them now rather than at their next period.
        announce = searchKey !== this.searchedKey || this.searchedEmpty;
        this.searchedKey = searchKey;
        await this.ingest(cards);
        this.searchedEmpty = list.size === 0;
      } catch (error) {
        this.log(`hub introductions failed: ${String(error)}`);
      }
    }

    const period = config.gossipPeriodMs * (this.deps.isPaused?.() ? PAUSED_GOSSIP_FACTOR : 1);
    if ((announce || changedCard) && list.size > 0) {
      this.lastGossipAt = nowMs;
      await Promise.all(list.entries().slice(0, ANNOUNCE_SWAPS).map((entry) => this.gossipOnce(entry.card)));
    } else if (nowMs - this.lastGossipAt >= period) {
      this.lastGossipAt = nowMs;
      await this.gossipOnce();
    }
    this.persist();
  }

  private async gossipOnce(chosen?: NearbyCard, retry = false): Promise<void> {
    const list = this.list;
    const own = this.ownCard;
    if (!list || !own || list.size === 0) return;
    const config = this.deps.config();
    const random = this.deps.random ?? Math.random;
    const partner = chosen ?? list.entries()[Math.floor(random() * list.size)]!.card;
    let answer: unknown;
    try {
      answer = await this.deps.link.request(partner, {
        kind: 'nearby-gossip-request',
        version: 1,
        card: own,
        digest: list.digest(this.now()),
      }, SWAP_TIMEOUT_MS);
    } catch {
      answer = null;
    }
    this.counters.swaps += 1;
    const reply = parseNearbyGossipMessage(answer);
    if (!reply) {
      this.counters.failedSwaps += 1;
      // One silent swap can be a link that was still opening (or a busy phone under load); ask
      // once more now, and only a second silence drops them. A person who left is still gone
      // within two swap timeouts.
      if (!retry && this.list?.get(partner.pub)) return this.gossipOnce(partner, true);
      this.reportUnreachable(partner.pub);
      return;
    }
    if (reply.kind === 'nearby-gossip-busy') this.counters.busy += 1;
    if (reply.kind !== 'nearby-gossip-reply' || reply.card.pub !== partner.pub) return;
    await this.ingest([reply.card, ...reply.cards]);
    const nowMs = this.now();
    const offer = list.offerFor({
      receiver: this.ownerFor(reply.card),
      digest: reply.digest,
      ownCard: null,
      swapCards: config.swapCards - 1,
      refreshMs: config.cardRefreshMs,
      nowMs,
    });
    const push: NearbyGossipMessage = { kind: 'nearby-gossip-push', version: 1, card: own, cards: offer };
    void (this.deps.link.send ? this.deps.link.send(partner, push) : this.deps.link.request(partner, push, SWAP_TIMEOUT_MS))
      .catch(() => undefined);
  }

  /** Verify only the cards that would change the list, then merge them. */
  private async ingest(cards: NearbyCard[]): Promise<void> {
    const list = this.list;
    if (!list || !cards.length) return;
    const fresh = cards.filter((card) => {
      const silentSince = this.silent.get(card.pub);
      if (silentSince === undefined) return true;
      if (nearbyCardIssuedAtMs(card) <= silentSince) return false;
      this.silent.delete(card.pub);
      return true;
    });
    const useful = list.useful(fresh, this.now());
    const valid: NearbyCard[] = [];
    for (const card of useful) if (await this.isValid(card)) valid.push(card);
    if (!valid.length) return;
    const result = list.merge(valid, this.now());
    if (result.added || result.refreshed || result.dropped) this.changed();
  }

  private async isValid(card: NearbyCard): Promise<boolean> {
    const key = `${card.pub}|${card.issuedAt}`;
    const known = this.verified.get(key);
    if (known !== undefined) return known;
    const maxLifetimeMs = this.deps.config().cardLifetimeMs;
    const now = new Date(this.now());
    const ok = this.deps.verify
      ? await this.deps.verify(card, maxLifetimeMs, now)
      : (await verifyNearbyCard(card, { maxLifetimeMs, now })).ok;
    this.verified.set(key, ok);
    if (this.verified.size > MAX_VERIFIED_CACHE) this.verified.delete(this.verified.keys().next().value as string);
    return ok;
  }

  private cardIsStale(position: NearbyV3Position, userId: string, nowMs: number, config: NearbyV3Config): boolean {
    const card = this.ownCard;
    if (!card) return true;
    return card.userId !== userId
      || (card.stageName ?? '') !== (this.deps.identity()?.stageName ?? '')
      || card.scope !== position.scope
      || card.traveler !== position.traveler
      || card.point.latitude !== position.point.latitude
      || card.point.longitude !== position.point.longitude
      || card.point.precisionMeters !== position.point.precisionMeters
      || nowMs - nearbyCardIssuedAtMs(card) >= config.cardReissueMs;
  }

  private ownerFor(card: NearbyCard): NearbyListOwner {
    return { pub: card.pub, point: card.point, scope: card.scope, beacon: nearbyDailyBeacon(this.now()) };
  }

  /** The list for the current position, created or re-ranked when the owner, scope or day changed. */
  private ensureList(): NearbyList | null {
    const position = this.deps.position();
    const identity = this.deps.identity();
    if (!position || !identity) return null;
    const owner: NearbyListOwner = {
      pub: identity.pair.pub,
      point: position.point,
      scope: position.scope,
      beacon: nearbyDailyBeacon(this.now()),
    };
    const capacity = this.deps.config().capacity;
    if (!this.list || this.list.ownerInfo.pub !== owner.pub || this.listCapacity !== capacity) {
      const previous = this.list?.ownerInfo.pub === owner.pub ? this.list.entries().map((entry) => entry.card) : this.load(owner.pub);
      this.list = new NearbyList(owner, { capacity });
      this.listCapacity = capacity;
      if (previous.length) this.list.merge(previous, this.now());
      this.changed();
      return this.list;
    }
    const current = this.list.ownerInfo;
    if (current.scope !== owner.scope
      || current.beacon !== owner.beacon
      || current.point.latitude !== owner.point.latitude
      || current.point.longitude !== owner.point.longitude) {
      this.list.setOwner(owner);
      this.changed();
    }
    return this.list;
  }


  private load(ownerPub: string): NearbyCard[] {
    try {
      const raw = this.deps.storage?.getItem(NEARBY_V3_STORAGE_KEY);
      if (!raw) return [];
      const saved = JSON.parse(raw) as { owner?: unknown; cards?: unknown };
      if (saved.owner !== ownerPub || !Array.isArray(saved.cards)) return [];
      return saved.cards.map(parseNearbyCard).filter((card): card is NearbyCard => !!card);
    } catch {
      return [];
    }
  }


  private persist(): void {
    const list = this.list;
    if (!list || !this.deps.storage) return;
    const cards = list.entries().map((entry) => entry.card);
    const signature = cards.map((card) => `${card.pub}|${card.issuedAt}`).join(',');
    if (signature === this.persistedSignature) return;
    try {
      this.deps.storage.setItem(NEARBY_V3_STORAGE_KEY, JSON.stringify({ owner: list.ownerInfo.pub, cards }));
      this.persistedSignature = signature;
    } catch {
      // Storage full or unavailable: the list rebuilds from the hub and gossip after a restart.
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick().catch((error) => this.log(`tick failed: ${String(error)}`)).finally(() => {
        const config = this.deps.config();
        const regular = Math.min(config.gossipPeriodMs, config.cardReissueMs);
        if ((this.list?.size ?? 0) === 0) {
          this.schedule(Math.min(regular, this.emptyRetryMs));
          this.emptyRetryMs = Math.min(regular, this.emptyRetryMs * 2);
          return;
        }
        this.emptyRetryMs = EMPTY_RETRY_MIN_MS;
        const jitter = (this.deps.random ?? Math.random)() * 0.2 * config.gossipPeriodMs;
        this.schedule(regular + jitter);
      });
    }, delayMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private changed(): void {
    this.deps.onChange?.(this.entries());
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private log(message: string): void {
    (this.deps.log ?? ((text: string) => console.info(`[nearby-v3] ${text}`)))(message);
  }
}
