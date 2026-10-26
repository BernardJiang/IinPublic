import {
  createNearbyCard,
  nearbyCardIssuedAtMs,
  parseNearbyCard,
  verifyNearbyCard,
  type NearbyCard,
  type NearbyCountIdentity,
  type NearbyCardScope,
} from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import { parseNearbyAudienceSummary, type NearbyAudienceSummary } from '../../shared/nearby-v3-audience';
import {
  parseNearbyGossipMessage,
  type NearbyGossipMessage,
  type NearbyGossipReply,
} from '../../shared/nearby-v3-gossip';
import { NearbyList, type NearbyListEntry, type NearbyListOwner } from '../../shared/nearby-v3-list';
import { parseNearbyRankKey, type NearbyRankKey } from '../../shared/nearby-v3-ranking';
import {
  isEstablishedBefore,
  isNearbyAttestorKey,
  nearbyBeaconString,
  nearbyUtcDay,
  verifyNearbyAgeProof,
  verifyNearbyBeacon,
  type NearbyAgeProof,
  type NearbyAttestorKey,
  type NearbyBeacon,
} from '../../shared/nearby-v3-attestation';
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
/** What the hub adds to a heartbeat answer (unverified until the service checks it). */
export type NearbyHubHeartbeat = {
  beacon?: unknown;
  age?: unknown;
  attestor?: unknown;
  /** Everyone near this card's public point, excluding the card owner. */
  nearby?: unknown;
  /** Everyone whose Nearby/Place card is currently online. */
  online?: unknown;
  /** Monotonic hub count snapshot revision. */
  countRevision?: unknown;
  /** The count key's accepted scope revision. */
  scopeRevision?: unknown;
  /** The active Nearby area or Place holds more than `C` other identities (OPEN-86 E1). */
  pageable?: unknown;
};

/** The hub's page for a search: its cards and, from a current hub, which audience they come from. */
export type NearbyIntroductionsAnswer = { cards: NearbyCard[]; audience?: unknown };

/** A linked device uses this to adopt the accepted revision when it already shares the scope. */
export class NearbyHubPresenceConflictError extends Error {
  constructor(
    readonly acceptedRevision: number,
    readonly acceptedScope: NearbyCardScope,
    readonly acceptedPoint: PublicLocation,
    message = 'Nearby presence revision conflict',
  ) {
    super(message);
    this.name = 'NearbyHubPresenceConflictError';
  }
}

export type NearbyV3Hub = {
  heartbeat(card: NearbyCard): Promise<NearbyHubHeartbeat | void>;
  leave?(card: NearbyCard): Promise<unknown>;
  introductions(input: {
    point: PublicLocation;
    scope: NearbyCardScope;
    excludePub: string;
    /** My ranking beacon string, so the hub pages in my order. */
    beacon?: string;
    /** The last rank key of my previous group (a crowded area or Place only). */
    after?: NearbyRankKey;
  }): Promise<NearbyCard[] | NearbyIntroductionsAnswer>;
};

export type NearbyV3Link = {
  /** Send one gossip message to a person and wait for their answer; null when they did not answer. */
  request(to: NearbyCard, message: NearbyGossipMessage, timeoutMs: number): Promise<unknown>;
  /** Send without waiting for an answer (the swap's last message); falls back to `request`. */
  send?(to: NearbyCard, message: NearbyGossipMessage): Promise<void>;
  /**
   * False while nothing can be sent (the mesh is between rooms). A swap is then not tried at all:
   * found on real phones, an announce right after re-entering Nearby "failed" in 0 ms twice and
   * dropped a live person.
   */
  ready?(): boolean;
};

export type NearbyV3Position = { point: PublicLocation; traveler: boolean; scope: NearbyCardScope };

export type NearbyV3ServiceDeps = {
  config: () => NearbyV3Config;
  identity: () => {
    userId: string;
    pair: SeaSigningPair;
    stageName?: string;
    /** Omitted for an unlinked device, whose count key is its own public key. */
    countIdentity?: NearbyCountIdentity;
  } | null;
  /** The public point to publish and the active scope; null publishes nothing (no point chosen yet). */
  position: () => NearbyV3Position | null;
  hub: NearbyV3Hub;
  link: NearbyV3Link;
  /**
   * Offline Nearby (`nearby-v3-local.ts`): post my card while the hub is unreachable; read the cards
   * posted around my point (they come back through `localCard`).
   */
  localBoard?: { post(card: NearbyCard): void; watch(point: { latitude: number; longitude: number }): void };
  verify?: (card: unknown, maxLifetimeMs: number, now: Date) => Promise<boolean>;
  /**
   * Attestor keys a signed manifest pins (`extensions['nearby-v3'].attestorKeys`). Empty or absent:
   * the key the hub announces is trusted and kept.
   */
  pinnedAttestorKeys?: () => readonly NearbyAttestorKey[];
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
/** Last accepted local scope fingerprint/revision; ordinary card refreshes reuse the revision. */
export const NEARBY_V3_PRESENCE_STORAGE_KEY = 'iinpublic_nearby_v3_presence_v1';
/** Group number and boundary per scope, for the day (§3.7 "Meeting new people in groups"). */
export const NEARBY_V3_GROUPS_STORAGE_KEY = 'iinpublic_nearby_v3_groups_v1';

/**
 * Which group of my order I am meeting; `exhausted`: searches past the boundary found nobody.
 * `pageable`/`hasMore` come from the hub (OPEN-86 E1): "Meet new people" exists only when the
 * active crowded area or Place has another page, never for a sparse nearest-`C` fallback.
 */
export type NearbyGroupInfo = { group: number; exhausted: boolean; pageable: boolean; hasMore: boolean };

type NearbyGroupState = { day: string; group: number; after: NearbyRankKey; met: string[] };
type NearbyPresenceState = { countKey: string; fingerprint: string; scopeRevision: number };
/** The hub's attestor key, today's beacon and my own age proof (§3.7 "Ranking"). */
export const NEARBY_V3_ATTESTATION_STORAGE_KEY = 'iinpublic_nearby_v3_attestation_v1';
const MAX_ATTESTOR_KEYS = 4;
const PAUSED_GOSSIP_FACTOR = 4;
/** Covers opening a new link (WebRTC gives up after 10 s) plus the answer. */
const SWAP_TIMEOUT_MS = 15_000;
/**
 * A newcomer (or a changed card) swaps with this many of the nearest people at once, so a small
 * group sees a new arrival right away instead of one gossip period later for all but one of them.
 */
const ANNOUNCE_SWAPS = 3;
/** How soon a tick that found the mesh between rooms tries again. */
const LINK_WAIT_RETRY_MS = 1_000;
const MAX_VERIFIED_CACHE = 4_096;
/** While the list is empty, ask the hub again after this long, doubling up to one gossip period. */
const EMPTY_RETRY_MIN_MS = 5_000;
/** Searches past a group boundary that found nobody before the group counts as "met everyone". */
const EXHAUSTED_AFTER_EMPTY_SEARCHES = 2;
const MAX_GROUP_SCOPES = 32;

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
  /** scope key → my group there today (absent: group 1). */
  private groups: Map<string, NearbyGroupState> | null = null;
  /** Hub searches since the last group switch that left the list empty. */
  private emptySearches = 0;
  private lastGroupSearchAt = 0;
  private waitingForLink = false;
  /**
   * The list of the scope I left (Nearby while I visit a Place, or a Place's), so returning restores
   * it at once instead of starting over; cards that expired meanwhile drop on merge.
   */
  private stashedByScope = new Map<string, NearbyCard[]>();
  /** The hub answered the last heartbeat or search; false = offline, so the local board is used. */
  private hubReachable = true;
  /** The hub just became reachable again: reissue and announce on the next pass. */
  private backOnline = false;
  private lastLocalPostAt = 0;
  private readonly verified = new Map<string, boolean>();
  /** `pub|issuedAt` → the verified first-seen day of that card's key, or null (none or invalid). */
  private readonly ageSince = new Map<string, string | null>();
  private attestorKeys: NearbyAttestorKey[] = [];
  private beacon: NearbyBeacon | null = null;
  private ownAge: NearbyAgeProof | null = null;
  private attestationLoaded = false;
  /** People who did not answer, with the card they had: only a newer card brings them back. */
  private readonly silent = new Map<string, number>();
  private presenceState: NearbyPresenceState | null | undefined;
  /** The hub's audience for `audienceKey` (my scope, point and area size); null until it answers. */
  private audience: NearbyAudienceSummary | null = null;
  private audienceKey = '';
  /**
   * Someone new reached a non-pageable list by gossip: the crowd may have grown past `C` since the
   * search, so ask the hub again (at most once per gossip period).
   */
  private audienceStale = false;
  /** The group scope this session is in; leaving it forgets its boundary (§3.7 "Beyond C"). */
  private activeGroupKey = '';
  private lastAudienceSearchAt = 0;
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

  /**
   * Stop the periodic work. By default this also leaves the hub at once (logout, app stop);
   * `leave: false` only freezes gossip and reissues, and the lease expires on its own.
   */
  stop(options: { leave?: boolean } = {}): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (options.leave !== false && this.ownCard && this.deps.hub.leave) {
      void this.deps.hub.leave(this.ownCard).catch(() => undefined);
    }
  }

  /** My card is for a scope or point I am no longer at (or I left Nearby and still have one). */
  cardIsOutOfPlace(): boolean {
    const card = this.ownCard;
    if (!card) return false;
    const position = this.deps.position();
    const identity = this.deps.identity();
    if (!position) return true;
    const countKey = identity?.countIdentity?.countKey || identity?.pair.pub;
    return card.countKey !== countKey
      || card.scope !== position.scope || card.traveler !== position.traveler
      || card.point.latitude !== position.point.latitude || card.point.longitude !== position.point.longitude;
  }

  /**
   * Sends my card for where I am now, at once, if the one the hub has is out of place. Never waits
   * for a running tick: one can be stuck on slow swaps (two 15 s timeouts to someone who left), and
   * meanwhile the hub would keep introducing me in the Place I left (phone-path J-PLACE-11).
   */
  async reissueIfOutOfPlace(): Promise<void> {
    const position = this.deps.position();
    const identity = this.deps.identity();
    if (position && identity && this.cardIsOutOfPlace()) await this.reissueCard(position, identity, this.now(), this.deps.config());
  }

  /** The public point or scope changed: reissue the card and search again now. */
  async refresh(): Promise<void> {
    if (this.ticking) {
      await this.reissueIfOutOfPlace();
      // Then a fresh tick for the new position, not the one already running for the old.
      await this.ticking?.catch(() => undefined);
    }
    return this.tick().then(() => {
      if (this.waitingForLink) this.schedule(LINK_WAIT_RETRY_MS);
    });
  }

  /**
   * The hub's counts changed (a newer count revision from the map/online poll): send my current
   * card again so its answer refreshes my Nearby count and pageability now, not at the next
   * reissue (OPEN-86 E4 bounded staleness). Same card, same scope revision: no move, no new lease.
   */
  async refreshCounts(): Promise<void> {
    const card = this.ownCard;
    const position = this.deps.position();
    if (!card || !position || this.cardIsOutOfPlace() || !this.hubReachable) return;
    if (Date.parse(card.expiresAt) <= this.now()) return;
    try {
      const answer = await this.deps.hub.heartbeat(card);
      if (answer) this.absorbPageable(answer, position);
    } catch (error) {
      this.log(`count refresh failed: ${String(error)}`);
    }
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
    return this.ingest([card], card.pub);
  }

  /** The group I am meeting in the current scope (1 when nothing was switched today). */
  groupInfo(): NearbyGroupInfo {
    const position = this.deps.position();
    const state = position ? this.groupState(position) : null;
    const group = state?.group ?? 1;
    const audience = position ? this.currentAudience(position) : null;
    const pageable = audience?.pageable === true;
    const exhausted = group > 1 && (this.list?.size ?? 0) === 0 && this.emptySearches >= EXHAUSTED_AFTER_EMPTY_SEARCHES;
    return { group, exhausted, pageable, hasMore: pageable && audience!.hasMore && !exhausted };
  }

  /** The hub's audience for where I am now, or null when it has not answered for this position. */
  audienceInfo(): NearbyAudienceSummary | null {
    const position = this.deps.position();
    return position ? this.currentAudience(position) : null;
  }

  private currentAudience(position: NearbyV3Position): NearbyAudienceSummary | null {
    return this.audienceKey === this.searchKeyFor(position) ? this.audience : null;
  }

  /** Scope, public point and selected area size: any change is a new audience and resets paging. */
  private searchKeyFor(position: NearbyV3Position): string {
    return `${position.scope}|${position.point.latitude}|${position.point.longitude}|${position.point.precisionMeters}`;
  }

  private setAudience(position: NearbyV3Position, audience: NearbyAudienceSummary | null): void {
    const key = this.searchKeyFor(position);
    const before = this.currentAudience(position);
    this.audience = audience;
    this.audienceKey = key;
    // A crowd that thinned below a page is no longer pageable: back to group 1 (§3.7 "Beyond C").
    if (audience && !audience.pageable && this.groupState(position)) {
      this.setGroupState(position, null);
      this.searchedKey = '';
      this.log('the audience no longer pages: back to group 1');
    }
    // Re-owns the list with the new area filter (it reports the change itself).
    this.ensureList();
    if (before?.mode !== audience?.mode || before?.pageable !== audience?.pageable || before?.hasMore !== audience?.hasMore) {
      this.changed();
    }
  }

  /**
   * "Meet new people" (§3.7 "Meeting new people in groups"): swap my whole group for the next `C`
   * people in my order. The last person's rank key becomes the boundary; the list empties and
   * searches again past it. False when there is no group to move on from.
   */
  async meetNewPeople(): Promise<boolean> {
    const position = this.deps.position();
    const list = this.ensureList();
    const last = list?.lastKey();
    if (!position || !list || !last) return false;
    // Only a crowded area or Place with another page pages; a sparse fallback never does.
    if (!this.groupInfo().hasMore) return false;
    const current = this.groupState(position);
    const met = [...new Set([
      ...(current?.met ?? []),
      ...list.entries().map((entry) => entry.card.pub),
    ])];
    this.setGroupState(position, {
      day: this.beaconString(),
      group: (current?.group ?? 1) + 1,
      after: last,
      met,
    });
    this.log(`meeting new people: group ${(current?.group ?? 1) + 1}`);
    await this.restartSearch();
    return true;
  }

  /** "Back to group 1": forget today's boundary here and search from the start of my order. */
  async backToFirstGroup(): Promise<void> {
    const position = this.deps.position();
    if (!position || !this.groupState(position)) return;
    this.setGroupState(position, null);
    this.log('back to group 1');
    await this.restartSearch();
  }

  private async restartSearch(): Promise<void> {
    this.emptySearches = 0;
    this.lastGroupSearchAt = 0;
    this.searchedKey = '';
    this.ensureList();
    this.changed();
    await this.refresh();
  }

  /**
   * A card from the local board (offline Nearby): merged like an introduction (not proof its owner
   * is alive, so a tombstone stays). Someone new is asked for a swap at once, so they get my card
   * even if only one of us is offline (and so posting).
   */
  async localCard(value: unknown): Promise<void> {
    const list = this.list;
    const own = this.ownCard;
    const card = value as NearbyCard;
    if (!list || !own || !card || typeof card !== 'object' || card.pub === own.pub || card.scope !== own.scope) return;
    const known = list.get(card.pub);
    await this.ingest([card]);
    if (!known && list.get(card.pub)) {
      this.log(`found ${card.userId.slice(0, 8)} nearby without the hub`);
      await this.gossipOnce(card);
    }
  }

  /** False while the hub is unreachable (offline Nearby uses the local board). */
  isHubReachable(): boolean {
    return this.hubReachable;
  }

  private setHubReachable(reachable: boolean): void {
    if (reachable === this.hubReachable) return;
    this.hubReachable = reachable;
    this.lastLocalPostAt = 0;
    if (reachable) {
      // Back from an outage: the people I found silent were silent because I was offline, so their
      // tombstones go. The next pass reissues my card and announces it, which lifts mine on their
      // side (they found me silent too); otherwise we rejoin only at the next reissue (3 min).
      this.silent.clear();
      this.backOnline = true;
    }
    this.log(reachable ? 'hub reachable again' : 'hub unreachable: posting my card on the local board');
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
    if (message.kind === 'nearby-gossip-request' && message.beacon) await this.adoptBeacon(message.beacon);
    if (message.kind === 'nearby-gossip-push') {
      await this.ingest([message.card, ...message.cards], fromPub);
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
        receiver: this.ownerFor(message.card, message.after),
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
        ...(this.beacon ? { beacon: this.beacon } : {}),
        ...(list.ownerInfo.after ? { after: list.ownerInfo.after } : {}),
      };
      await this.ingest([message.card], fromPub);
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
      if (this.ownCard) this.log('left Nearby (in a Place or no point): my card is withdrawn');
      // Not in Nearby (in a Place, or no point chosen): publish nothing. Coming back searches again
      // and announces with a newly signed card (people who found us silent take only a newer one).
      this.searchedKey = '';
      this.ownCard = null;
      return;
    }
    // Build (or restore) the list first: it pushes the roster that makes the app's mesh join
    // Nearby. Checking the mesh first deadlocked a reloaded page, whose mesh joins only on that
    // push (stage2/01: after a re-login the user waited for the mesh forever).
    const list = this.ensureList();
    if (!list) return;
    // The mesh is still joining Nearby: search and announce once it can send (in a second).
    const waiting = this.deps.link.ready?.() === false;
    if (waiting && !this.waitingForLink) this.log('waiting for the mesh to join Nearby before searching');
    this.waitingForLink = waiting;
    if (waiting) return;
    const config = this.deps.config();
    const nowMs = this.now();
    if (list.prune(nowMs)) this.changed();

    // A changed name, point or traveler flag reaches the nearest person at once (below); a plain
    // reissue before expiry travels with the next regular swap.
    const backOnline = this.backOnline;
    this.backOnline = false;
    const changedCard = backOnline || this.cardIsStale(position, identity.userId, nowMs, config)
      ? (await this.reissueCard(position, identity, nowMs, config)) || backOnline
      : false;

    const searchKey = this.searchKeyFor(position);
    let announce = false;
    // Past group 1 my partners' lists are not paged like mine, so a group short of C asks the hub
    // again once per gossip period (its rotating sample has people past my boundary).
    const groupShort = !!list.ownerInfo.after && list.size < config.capacity
      && nowMs - this.lastGroupSearchAt >= config.gossipPeriodMs;
    const audienceRecheck = this.audienceStale && nowMs - this.lastAudienceSearchAt >= config.gossipPeriodMs;
    if (searchKey !== this.searchedKey || list.size === 0 || groupShort || audienceRecheck) {
      if (list.ownerInfo.after) this.lastGroupSearchAt = nowMs;
      this.audienceStale = false;
      this.lastAudienceSearchAt = nowMs;
      try {
        const answer = await this.deps.hub.introductions({
          point: position.point,
          scope: position.scope,
          excludePub: identity.pair.pub,
          beacon: this.beaconString(),
          ...(list.ownerInfo.after ? { after: list.ownerInfo.after } : {}),
        });
        this.setHubReachable(true);
        const cards = Array.isArray(answer) ? answer : Array.isArray(answer?.cards) ? answer.cards : [];
        const audience = Array.isArray(answer) ? null : parseNearbyAudienceSummary(answer?.audience);
        // An older hub sends no audience: keep the last one rather than enabling paging blindly.
        if (audience) this.setAudience(position, audience);
        // A newcomer (or someone who just moved) swaps with the nearest few people at once, so the
        // people around learn of them now rather than at their next period.
        announce = searchKey !== this.searchedKey || this.searchedEmpty;
        this.searchedKey = searchKey;
        await this.ingest(cards);
        if (list.size > 0) {
          this.emptySearches = 0;
        } else if (++this.emptySearches === EXHAUSTED_AFTER_EMPTY_SEARCHES) {
          this.changed(); // the group bar can now say "met everyone here"
        }
        if (announce) this.log(`searched: the hub introduced ${cards.length}, my list has ${list.size}`);
        this.searchedEmpty = list.size === 0;
      } catch (error) {
        this.log(`hub introductions failed: ${String(error)}`);
        this.setHubReachable(false);
      }
    }

    this.deps.localBoard?.watch(position.point);
    if (!this.hubReachable && this.ownCard && (changedCard || nowMs - this.lastLocalPostAt >= config.gossipPeriodMs)) {
      this.lastLocalPostAt = nowMs;
      this.deps.localBoard?.post(this.ownCard);
    }

    const period = config.gossipPeriodMs * (this.deps.isPaused?.() ? PAUSED_GOSSIP_FACTOR : 1);
    if ((announce || changedCard) && list.size > 0) {
      this.lastGossipAt = nowMs;
      const nearest = list.entries().slice(0, ANNOUNCE_SWAPS);
      this.log(`announcing to ${nearest.map((entry) => entry.card.userId.slice(0, 8)).join(', ')}`);
      await Promise.all(nearest.map((entry) => this.gossipOnce(entry.card)));
    } else if (nowMs - this.lastGossipAt >= period) {
      this.lastGossipAt = nowMs;
      await this.gossipOnce();
    }
    this.persist();
  }

  /** Sign and post a new card; true when people should hear of the change at once. */
  private async reissueCard(
    position: NearbyV3Position,
    identity: NonNullable<ReturnType<NearbyV3ServiceDeps['identity']>>,
    nowMs: number,
    config: NearbyV3Config,
  ): Promise<boolean> {
    const previous = this.ownCard;
    const sign = this.deps.sign ?? createNearbyCard;
    const countIdentity = identity.countIdentity ?? { countKey: identity.pair.pub };
    const scopeRevision = this.scopeRevision(position, countIdentity.countKey, nowMs);
    const card = await sign({
      userId: identity.userId,
      pair: identity.pair,
      ...(identity.stageName ? { stageName: identity.stageName } : {}),
      point: position.point,
      traveler: position.traveler,
      scope: position.scope,
      countIdentity,
      scopeRevision,
      lifetimeMs: config.cardLifetimeMs,
      age: this.ownAge,
      now: new Date(nowMs),
    });
    // I moved while it was being signed (left a Place, say): this card is already out of date and
    // must not reach the hub after the newer one.
    const current = this.deps.position();
    if (!current || current.scope !== card.scope || current.traveler !== card.traveler
      || current.point.latitude !== card.point.latitude || current.point.longitude !== card.point.longitude) return false;
    // Linking/unlinking changes the count key. Retire this device's old writer before publishing the
    // new key so the short migration does not count one device in both identities.
    if (previous && previous.countKey !== card.countKey && this.deps.hub.leave) {
      await this.deps.hub.leave(previous).catch(() => undefined);
    }
    this.ownCard = card;
    try {
      const answer = await this.deps.hub.heartbeat(card);
      this.setHubReachable(true);
      if (answer) {
        await this.absorbHeartbeat(answer, card.pub);
        this.absorbPageable(answer, position);
      }
    } catch (error) {
      if (error instanceof NearbyHubPresenceConflictError
        && error.acceptedRevision > card.scopeRevision
        && error.acceptedScope === card.scope
        && error.acceptedPoint.latitude === card.point.latitude
        && error.acceptedPoint.longitude === card.point.longitude
        && error.acceptedPoint.precisionMeters === card.point.precisionMeters) {
        // A linked peer won the revision race for this same presence. Adopt it and re-sign once so
        // this device also becomes a live writer; otherwise the shared lease would disappear when
        // only the winning device logs out.
        this.savePresenceState({
          countKey: card.countKey,
          fingerprint: this.presenceFingerprint(position),
          scopeRevision: error.acceptedRevision,
        });
        return this.reissueCard(position, identity, nowMs, config);
      }
      this.log(`hub heartbeat failed: ${String(error)}`);
      // A revision conflict proves the hub is reachable; other failures may be connectivity.
      this.setHubReachable(error instanceof NearbyHubPresenceConflictError);
    }
    return !!previous && (previous.stageName !== card.stageName
      || previous.countKey !== card.countKey
      || previous.scopeRevision !== card.scopeRevision
      || previous.scope !== card.scope
      || previous.traveler !== card.traveler
      || previous.point.latitude !== card.point.latitude
      || previous.point.longitude !== card.point.longitude);
  }

  private async gossipOnce(chosen?: NearbyCard, retry = false): Promise<void> {
    const list = this.list;
    const own = this.ownCard;
    if (!list || !own || list.size === 0) return;
    if (this.deps.link.ready?.() === false) return;
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
        ...(this.beacon ? { beacon: this.beacon } : {}),
        ...(list.ownerInfo.after ? { after: list.ownerInfo.after } : {}),
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
      if (this.list?.get(partner.pub)) this.log(`dropped ${partner.userId.slice(0, 8)}: two swaps unanswered`);
      this.reportUnreachable(partner.pub);
      return;
    }
    if (reply.kind === 'nearby-gossip-busy') this.counters.busy += 1;
    if (reply.kind !== 'nearby-gossip-reply' || reply.card.pub !== partner.pub) return;
    if (reply.beacon) await this.adoptBeacon(reply.beacon);
    await this.ingest([reply.card, ...reply.cards], reply.card.pub);
    const nowMs = this.now();
    const offer = list.offerFor({
      receiver: this.ownerFor(reply.card, reply.after),
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
  /**
   * `alivePub`: the person who just reached me directly (their swap, push or knock, or their answer
   * to mine). That is proof they are alive, so it lifts their tombstone; the tombstone only keeps
   * others' gossip and the hub from bringing back someone who stopped answering.
   */
  private async ingest(cards: NearbyCard[], alivePub?: string): Promise<void> {
    const list = this.list;
    if (alivePub) this.silent.delete(alivePub);
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
    for (const card of useful) {
      if (!await this.isValid(card)) continue;
      await this.checkAge(card);
      valid.push(card);
    }
    if (!valid.length) return;
    const result = list.merge(valid, this.now());
    if (result.added && this.audience && !this.audience.pageable) this.audienceStale = true;
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
    const identity = this.deps.identity();
    const countKey = identity?.countIdentity?.countKey || identity?.pair.pub;
    return card.userId !== userId
      || card.countKey !== countKey
      || (card.stageName ?? '') !== (identity?.stageName ?? '')
      || card.scope !== position.scope
      || card.traveler !== position.traveler
      || card.point.latitude !== position.point.latitude
      || card.point.longitude !== position.point.longitude
      || card.point.precisionMeters !== position.point.precisionMeters
      || (!!this.ownAge && card.age?.since !== this.ownAge.since)
      || nowMs - nearbyCardIssuedAtMs(card) >= config.cardReissueMs;
  }

  /** Scope/point changes advance once; ordinary reissues and heartbeats reuse the revision. */
  private scopeRevision(position: NearbyV3Position, countKey: string, nowMs: number): number {
    const fingerprint = this.presenceFingerprint(position);
    const previous = this.loadPresenceState();
    if (previous?.countKey === countKey && previous.fingerprint === fingerprint) return previous.scopeRevision;
    const scopeRevision = Math.max(1, nowMs, (previous?.scopeRevision ?? 0) + 1);
    this.savePresenceState({ countKey, fingerprint, scopeRevision });
    return scopeRevision;
  }

  private presenceFingerprint(position: NearbyV3Position): string {
    return `${position.scope}|${position.point.latitude}|${position.point.longitude}|${position.point.precisionMeters}`;
  }

  private savePresenceState(state: NearbyPresenceState): void {
    this.presenceState = state;
    try {
      this.deps.storage?.setItem(NEARBY_V3_PRESENCE_STORAGE_KEY, JSON.stringify(this.presenceState));
    } catch {
      // In-memory monotonicity remains for this session when storage is unavailable.
    }
  }

  private loadPresenceState(): NearbyPresenceState | null {
    if (this.presenceState !== undefined) return this.presenceState;
    this.presenceState = null;
    try {
      const raw = this.deps.storage?.getItem(NEARBY_V3_PRESENCE_STORAGE_KEY);
      if (!raw) return this.presenceState;
      const value = JSON.parse(raw) as Partial<NearbyPresenceState>;
      if (typeof value.countKey === 'string' && typeof value.fingerprint === 'string'
        && Number.isSafeInteger(value.scopeRevision) && Number(value.scopeRevision) >= 1) {
        this.presenceState = value as NearbyPresenceState;
      }
    } catch {
      this.presenceState = null;
    }
    return this.presenceState;
  }

  /** A partner's list as they rank it, past their group boundary when they sent one. */
  private ownerFor(card: NearbyCard, after?: NearbyRankKey): NearbyListOwner {
    return {
      pub: card.pub, point: card.point, scope: card.scope, beacon: this.beaconString(), isEstablished: this.isEstablished,
      ...(after ? { after } : {}),
    };
  }

  private beaconString(): string {
    return nearbyBeaconString(this.beacon, this.now());
  }

  /** In dense ties, keys the hub saw before today rank first (§3.7 "Ranking"). */
  private readonly isEstablished = (card: NearbyCard): boolean =>
    isEstablishedBefore(this.ageSince.get(`${card.pub}|${card.issuedAt}`), nearbyUtcDay(this.now()));

  /**
   * A heartbeat says whether my audience pages now (people arrived or left since the search). In
   * group 1 that is also whether another page exists; past group 1 only a search can tell.
   */
  private absorbPageable(answer: NearbyHubHeartbeat, position: NearbyV3Position): void {
    if (typeof answer.pageable !== 'boolean') return;
    const known = this.currentAudience(position);
    if (!known || known.pageable === answer.pageable) return;
    const group = this.groupState(position)?.group ?? 1;
    this.setAudience(position, {
      ...known,
      pageable: answer.pageable,
      hasMore: answer.pageable && (group === 1 || known.hasMore),
      // A crowded area that thinned becomes the sparse fallback, and the other way round.
      ...(known.mode !== 'place' ? { mode: answer.pageable ? 'area' as const : 'nearest' as const } : {}),
    });
    this.searchedKey = '';
  }

  /** Today's beacon, the hub's key and my age proof, from a heartbeat answer. */
  private async absorbHeartbeat(answer: NearbyHubHeartbeat, ownPub: string): Promise<void> {
    this.loadAttestation();
    let changed = false;
    if (isNearbyAttestorKey(answer.attestor) && !this.attestorKeys.some((key) => key.keyId === (answer.attestor as NearbyAttestorKey).keyId)) {
      const pinned = this.deps.pinnedAttestorKeys?.() ?? [];
      if (!pinned.length || pinned.some((key) => key.keyId === (answer.attestor as NearbyAttestorKey).keyId)) {
        this.attestorKeys = [answer.attestor as NearbyAttestorKey, ...this.attestorKeys].slice(0, MAX_ATTESTOR_KEYS);
        this.log(`learned the hub's attestor key ${this.attestorKeys[0]!.keyId.slice(0, 8)}`);
        changed = true;
        // Ages that could not be checked before can be now.
        for (const [key, since] of this.ageSince) if (since === null) this.ageSince.delete(key);
      }
    }
    if (await this.adoptBeacon(answer.beacon)) changed = true;
    if (answer.age && (await verifyNearbyAgeProof(answer.age, ownPub, this.keys()))
      && (answer.age as NearbyAgeProof).since !== this.ownAge?.since) {
      this.ownAge = answer.age as NearbyAgeProof;
      changed = true;
    }
    if (changed) {
      this.saveAttestation();
      await this.recheckAges();
    }
  }

  /** Take a verified beacon for today that I do not have yet; true when it changed my order. */
  private async adoptBeacon(value: unknown): Promise<boolean> {
    if (!value) return false;
    this.loadAttestation();
    const today = nearbyUtcDay(this.now());
    if (this.beacon?.day === today) return false;
    const beacon = await verifyNearbyBeacon(value, this.keys());
    if (!beacon || beacon.day !== today) return false;
    this.beacon = beacon;
    this.saveAttestation();
    this.log(`today's beacon ${beacon.value.slice(0, 8)} (${beacon.day})`);
    return true;
  }

  private keys(): NearbyAttestorKey[] {
    const pinned = this.deps.pinnedAttestorKeys?.() ?? [];
    return pinned.length ? this.attestorKeys.filter((key) => pinned.some((pin) => pin.keyId === key.keyId)).concat(
      pinned.filter((pin) => !this.attestorKeys.some((key) => key.keyId === pin.keyId)),
    ) : this.attestorKeys;
  }

  private async checkAge(card: NearbyCard): Promise<void> {
    const key = `${card.pub}|${card.issuedAt}`;
    if (this.ageSince.has(key)) return;
    const since = card.age ? await verifyNearbyAgeProof(card.age, card.pub, this.keys()) : null;
    this.ageSince.set(key, since);
    if (this.ageSince.size > MAX_VERIFIED_CACHE) this.ageSince.delete(this.ageSince.keys().next().value as string);
  }

  /** Verify the ages of the cards on my list again (a key was learned), then re-rank. */
  private async recheckAges(): Promise<void> {
    const list = this.list;
    if (!list) return;
    for (const entry of list.entries()) await this.checkAge(entry.card);
    list.setOwner({ ...list.ownerInfo, beacon: this.beaconString(), isEstablished: this.isEstablished });
    this.changed();
  }

  private loadAttestation(): void {
    if (this.attestationLoaded) return;
    this.attestationLoaded = true;
    try {
      const raw = this.deps.storage?.getItem(NEARBY_V3_ATTESTATION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { keys?: unknown; beacon?: unknown; age?: unknown };
      if (Array.isArray(saved.keys)) this.attestorKeys = saved.keys.filter(isNearbyAttestorKey).slice(0, MAX_ATTESTOR_KEYS);
      // Trusted as stored: both were verified before they were saved, and the card that carries
      // the age proof is checked again by everyone who ranks it.
      if (saved.beacon && typeof saved.beacon === 'object') this.beacon = saved.beacon as NearbyBeacon;
      if (saved.age && typeof saved.age === 'object') this.ownAge = saved.age as NearbyAgeProof;
    } catch {
      // Unreadable: learned again from the next heartbeat.
    }
  }

  private saveAttestation(): void {
    try {
      this.deps.storage?.setItem(NEARBY_V3_ATTESTATION_STORAGE_KEY, JSON.stringify({
        keys: this.attestorKeys,
        beacon: this.beacon,
        age: this.ownAge,
      }));
    } catch {
      // Storage unavailable: kept in memory.
    }
  }

  /** The list for the current position, created or re-ranked when the owner, scope or day changed. */
  private ensureList(): NearbyList | null {
    const position = this.deps.position();
    const identity = this.deps.identity();
    if (!position || !identity) return null;
    this.loadAttestation();
    // Moving to another point or area size, or entering/leaving a Place, starts again at group 1.
    const groupKey = this.groupScopeKey(position);
    if (this.activeGroupKey && this.activeGroupKey !== groupKey) {
      this.loadGroups().delete(this.activeGroupKey);
      this.saveGroups();
    }
    this.activeGroupKey = groupKey;
    const group = this.groupState(position);
    const after = group?.after;
    const owner: NearbyListOwner = {
      pub: identity.pair.pub,
      point: position.point,
      scope: position.scope,
      beacon: this.beaconString(),
      isEstablished: this.isEstablished,
      ...(after ? { after } : {}),
      ...(group?.met.length ? { excludedPubs: group.met } : {}),
      ...(this.areaFor(position) ? { area: this.areaFor(position)! } : {}),
    };
    const capacity = this.deps.config().capacity;
    if (this.list && this.list.ownerInfo.pub === owner.pub && this.list.ownerInfo.scope !== owner.scope) {
      // A Place's members are not my Nearby list (and the other way round): one list per scope.
      this.stashedByScope.set(this.list.ownerInfo.scope, this.list.entries().map((entry) => entry.card));
      this.list = new NearbyList(owner, { capacity });
      this.listCapacity = capacity;
      const stashed = this.stashedByScope.get(owner.scope) ?? [];
      this.stashedByScope.delete(owner.scope);
      if (stashed.length) this.list.merge(stashed, this.now());
      this.changed();
      return this.list;
    }
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
      || current.after !== owner.after
      || current.area?.latitude !== owner.area?.latitude
      || current.area?.longitude !== owner.area?.longitude
      || current.area?.precisionMeters !== owner.area?.precisionMeters
      || current.point.latitude !== owner.point.latitude
      || current.point.longitude !== owner.point.longitude) {
      this.list.setOwner(owner);
      this.changed();
    }
    return this.list;
  }


  /** A crowded Nearby audience keeps only cards inside my selected area (OPEN-86 E1/E2). */
  private areaFor(position: NearbyV3Position): PublicLocation | null {
    if (position.scope !== 'nearby') return null;
    const audience = this.currentAudience(position);
    return audience?.mode === 'area' ? audience.area ?? position.point : null;
  }

  /**
   * Nearby groups belong to a public point and area size; a Place's to the Place (its pin never
   * moves). Changing either starts again at group 1.
   */
  private groupScopeKey(position: NearbyV3Position): string {
    return position.scope === 'nearby'
      ? `nearby|${position.point.latitude},${position.point.longitude},${position.point.precisionMeters}`
      : position.scope;
  }

  /** Today's group here, or null for group 1 (a new day's beacon reorders everyone). */
  private groupState(position: NearbyV3Position): NearbyGroupState | null {
    const groups = this.loadGroups();
    const key = this.groupScopeKey(position);
    const state = groups.get(key);
    if (!state) return null;
    if (state.day === this.beaconString()) return state;
    groups.delete(key);
    this.saveGroups();
    return null;
  }

  private setGroupState(position: NearbyV3Position, state: NearbyGroupState | null): void {
    const groups = this.loadGroups();
    const key = this.groupScopeKey(position);
    groups.delete(key);
    if (state) groups.set(key, state);
    while (groups.size > MAX_GROUP_SCOPES) groups.delete(groups.keys().next().value as string);
    this.saveGroups();
  }

  private loadGroups(): Map<string, NearbyGroupState> {
    if (this.groups) return this.groups;
    this.groups = new Map();
    try {
      const saved = JSON.parse(this.deps.storage?.getItem(NEARBY_V3_GROUPS_STORAGE_KEY) || '{}') as Record<string, unknown>;
      for (const [key, value] of Object.entries(saved)) {
        const row = value as Partial<NearbyGroupState> | null;
        const after = parseNearbyRankKey(row?.after);
        if (after && typeof row?.day === 'string' && Number.isInteger(row.group) && row.group! > 1) {
          const met = Array.isArray(row.met)
            ? [...new Set(row.met.filter((pub): pub is string => typeof pub === 'string' && pub.length > 0))]
            : [];
          this.groups.set(key, { day: row.day, group: row.group!, after, met });
        }
      }
    } catch {
      // Unreadable: every scope starts at group 1.
    }
    return this.groups;
  }

  private saveGroups(): void {
    try {
      this.deps.storage?.setItem(NEARBY_V3_GROUPS_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.loadGroups())));
    } catch {
      // Storage unavailable: kept in memory.
    }
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
        if (this.waitingForLink) {
          this.schedule(LINK_WAIT_RETRY_MS);
          return;
        }
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
