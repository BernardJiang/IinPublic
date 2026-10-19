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
};

export type NearbyV3Position = { point: PublicLocation; traveler: boolean; scope: NearbyCardScope };

export type NearbyV3ServiceDeps = {
  config: () => NearbyV3Config;
  identity: () => { userId: string; pair: SeaSigningPair } | null;
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
const SWAP_TIMEOUT_MS = 8_000;
const MAX_VERIFIED_CACHE = 4_096;

export class NearbyV3Service {
  private list: NearbyList | null = null;
  private ownCard: NearbyCard | null = null;
  private searchedKey = '';
  private lastGossipAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private ticking: Promise<void> | null = null;
  private incoming = 0;
  private listCapacity = 0;
  private persistedSignature: string | null = null;
  private readonly verified = new Map<string, boolean>();
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

  /** A broadcast or swap to this person got no answer: drop them now. */
  reportUnreachable(pub: string): void {
    if (this.list?.remove(pub)) this.changed();
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
      return reply;
    } finally {
      this.incoming -= 1;
    }
  }

  private async runTick(): Promise<void> {
    const position = this.deps.position();
    const identity = this.deps.identity();
    if (!position || !identity) return;
    const config = this.deps.config();
    const nowMs = this.now();
    const list = this.ensureList();
    if (!list) return;
    if (list.prune(nowMs)) this.changed();

    if (this.cardIsStale(position, identity.userId, nowMs, config)) {
      const sign = this.deps.sign ?? createNearbyCard;
      this.ownCard = await sign({
        userId: identity.userId,
        pair: identity.pair,
        point: position.point,
        traveler: position.traveler,
        scope: position.scope,
        lifetimeMs: config.cardLifetimeMs,
        now: new Date(nowMs),
      });
      await this.deps.hub.heartbeat(this.ownCard).catch((error) => this.log(`hub heartbeat failed: ${String(error)}`));
    }

    const searchKey = `${position.scope}|${position.point.latitude}|${position.point.longitude}`;
    if (searchKey !== this.searchedKey || list.size === 0) {
      try {
        const cards = await this.deps.hub.introductions({ point: position.point, scope: position.scope, excludePub: identity.pair.pub });
        this.searchedKey = searchKey;
        await this.ingest(cards);
      } catch (error) {
        this.log(`hub introductions failed: ${String(error)}`);
      }
    }

    const period = config.gossipPeriodMs * (this.deps.isPaused?.() ? PAUSED_GOSSIP_FACTOR : 1);
    if (nowMs - this.lastGossipAt >= period) {
      this.lastGossipAt = nowMs;
      await this.gossipOnce();
    }
    this.persist();
  }

  private async gossipOnce(): Promise<void> {
    const list = this.list;
    const own = this.ownCard;
    if (!list || !own || list.size === 0) return;
    const config = this.deps.config();
    const random = this.deps.random ?? Math.random;
    const partner = list.entries()[Math.floor(random() * list.size)]!.card;
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
    const reply = parseNearbyGossipMessage(answer);
    if (!reply) {
      this.reportUnreachable(partner.pub);
      return;
    }
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
    void this.deps.link.request(partner, { kind: 'nearby-gossip-push', version: 1, card: own, cards: offer }, SWAP_TIMEOUT_MS)
      .catch(() => undefined);
  }

  /** Verify only the cards that would change the list, then merge them. */
  private async ingest(cards: NearbyCard[]): Promise<void> {
    const list = this.list;
    if (!list || !cards.length) return;
    const useful = list.useful(cards, this.now());
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
        const jitter = (this.deps.random ?? Math.random)() * 0.2 * config.gossipPeriodMs;
        this.schedule(Math.min(config.gossipPeriodMs, config.cardReissueMs) + jitter);
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
