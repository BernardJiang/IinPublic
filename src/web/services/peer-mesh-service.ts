import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
} from '../../shared/p2p-runtime';
import {
  isP2PProtocolManifestChainPayload,
  isP2PProtocolManifestRequestPayload,
  isP2PProtocolManifestSummaryPayload,
  isP2PMeshTalkBodyPayload,
  isP2PMeshTalkResponsePayload,
  isP2PMeshTalkRetractedPayload,
  isP2PNearbyGossipPayload,
  isProtocolManifestControlKind,
  p2pMeshFrameSigningPayload,
  type P2PMeshFrame,
  type P2PMeshFramePayload,
  type P2PProtocolManifestChainPayload,
  type P2PProtocolManifestRequestPayload,
  type P2PProtocolManifestSummaryPayload,
  type P2PMeshTalkAnnouncePayload,
  type P2PMeshTalkBodyPayload,
  type P2PMeshTalkBodyRequestPayload,
  type P2PMeshTalkResponsePayload,
  type P2PMeshTalkRetractedPayload,
  type P2PNearbyGossipPayload,
} from '../../shared/p2p-mesh-protocol';
import type { ProtocolManifestCompatibility } from '../../shared/protocol-manifest';
import { ProtocolManifestController } from '../../shared/protocol-manifest-controller';
import type { Talk } from '../../shared/types';
import { computeTalkRevisionHash } from '../../shared/talk-revision';
import type { WebGunService } from './web-gun-service';
import { getOrCreateP2PSession } from './p2p-webrtc-session';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import {
  MeshForwardingPolicy,
  type ForwardingContext,
  type ForwardingSettings,
} from '../../shared/mesh-forwarding-policy';
import { configuredMeshSyncCapabilities } from '../../shared/mesh-frame-policy';
import {
  DirectTalkDeliveryOutbox,
  type DirectTalkDeliveryEntry,
} from './direct-talk-delivery-outbox';

type RoomMember = {
  userId: string;
  stageName?: string;
  joinedAt?: string | Date;
  /** Signing pub carried in the room roster record — lets neighbor formation skip the
   *  presence/public-record lookups that fail under simultaneous-boot load. */
  pub?: string;
  /** Per-app-run id from the roster; a change means the peer restarted. */
  epoch?: string;
};

type MeshSession = {
  ensureConnected: () => Promise<void>;
  /** Live transport state when the session exposes it (WebRTC sessions do). */
  getState?: () => string;
  sendMeshFrame: (frame: P2PMeshFrame) => Promise<void>;
  setOnRemoteMeshFrame: (hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => void;
  dispose?: () => void;
};

type PeerMeshServiceOptions = {
  apiBase: string;
  localUserId: string;
  localStageName: string;
  sendTimeoutMs?: number;
  retryTimeoutMs?: number;
  ackTimeoutMs?: number;
  createSession?: (params: {
    conversationId: string;
    localUserId: string;
    localPub: string;
    localPair: SeaSigningPair;
    otherUserId: string;
    otherPub: string;
    isInitiator: boolean;
    onRemoteMeshFrame: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  }) => MeshSession;
  // Returns false when the receiver rejected the talk (e.g. intake/age filtering) so the
  // caller can leave it eligible for re-delivery; any other return is treated as accepted.
  onTalkBody?: (payload: P2PMeshTalkBodyPayload) => boolean | void | Promise<boolean | void>;
  onTalkResponse?: (payload: P2PMeshTalkResponsePayload) => void | Promise<void>;
  /**
   * Step 10: fired when a `talk-retracted` flood frame arrives and passes:
   *   - seen-set dedup (no duplicate delivery)
   *   - signature verify (originUserId === frame.originUserId)
   *   - only-author check: originUserId MUST equal payload.authorId (enforced here before firing)
   */
  onTalkRetracted?: (payload: P2PMeshTalkRetractedPayload) => void | Promise<void>;
  onPing?: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  /** R5: fired when a mesh-pong addressed to us arrives; enables durable E2E reachability assertion. */
  onPong?: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  /**
   * Step 2: fired when a `talk-announce` frame arrives addressed to this peer (or flood).
   * Fires before the body request is scheduled, so callers can record receipt for E2E
   * diagnostics without waiting for the full body pull to complete.
   */
  onTalkAnnounce?: (payload: P2PMeshTalkAnnouncePayload, frame: P2PMeshFrame) => boolean | void | Promise<boolean | void>;
  /**
   * R-a step 7: mailbox fallback for recipients unreachable over the DataChannel overlay.
   * Called with the talk-body payload and the list of recipient user IDs that cannot be
   * guaranteed delivery via DataChannel alone (coverage-gap or below-wanted-degree condition).
   * The caller posts per-recipient encrypted envelopes via WebMailboxClient.
   */
  onMailboxFallback?: (payload: P2PMeshTalkBodyPayload, recipientUserIds: string[]) => void | Promise<void>;
  /**
   * OPEN-38/G6: authoritative direct delivery queued a Talk for receivers that have no fresh
   * presence and/or no live direct link. The caller posts the pair-encrypted body mailbox fallback
   * for every still-pending recipient, plus a content-free wake ping only for the likely-asleep
   * subset. The body also stays in the outbox until the direct scheduler receives its ordinary ACK.
   */
  onDirectDeliveryPending?: (
    payload: P2PMeshTalkBodyPayload,
    recipientUserIds: string[],
    wakeRecipientUserIds: string[],
  ) => void | Promise<void>;
  forwardingSettings?: Partial<ForwardingSettings>;
  getForwardingContext?: (neighborUserId: string) => ForwardingContext;
  protocolManifestController?: ProtocolManifestController;
  onProtocolManifestCompatibility?: (
    compatibility: ProtocolManifestCompatibility,
    sourceUserId: string,
  ) => void | Promise<void>;
  /** A direct link to a room neighbor just came up (WebRTC over LAN, Wi-Fi Direct or relay). */
  onNeighborConnected?: (userId: string, roomId: string) => void;
  /** Keep Talk bodies in a local outbox until each recipient acknowledges them. */
  authoritativeDirectTalkDelivery?: boolean;
  now?: () => number;
  /** Fires only after the receiver durably accepted the Talk body (or proved it already had it). */
  onTalkDeliveryAck?: (payload: P2PMeshTalkBodyPayload, recipientUserId: string) => void | Promise<void>;
  /**
   * Nearby v3 (§3.7): the roster is this phone's own nearby list, not a shared room. Links open only
   * to pinned peers (a gossip partner, someone who knocked), never to a rotating K of the roster.
   */
  personalRoster?: boolean;
  /** Ask a peer to open the pair's session to us (they may not have us on their list). */
  knockPeer?: (peer: { userId: string; pub: string }) => Promise<void>;
  /**
   * Nearby v3 broadcast loop: how many people with queued Talks get a link at once. Starts at
   * `initial`, grows by one per delivered Talk up to `max`, halves when a link cannot be opened.
   */
  personalConcurrency?: () => { initial: number; max: number };
  /** Nearby v3: a link to this person could not be opened twice in a row; they leave the list. */
  onPersonalPeerUnreachable?: (userId: string, pub: string) => void;
  /** Nearby v3 receiving limit: false leaves a new Talk offer unanswered (the sender retries). */
  admitTalkOffer?: (authorUserId: string) => boolean;
  /** A Nearby v3 gossip message from a direct neighbor; the returned message is sent back. */
  onNearbyGossip?: (fromUserId: string, fromPub: string, message: Record<string, unknown>) => Promise<unknown>;
};

type PeerMeshTransportMetrics = {
  sentFrames: number;
  sentBytes: number;
  receivedFrames: number;
  receivedBytes: number;
  duplicateFramesReceived: number;
  logicalTalkBodiesAccepted: number;
  duplicateTalkBodiesReceived: number;
};

type Neighbor = {
  userId: string;
  stageName: string;
  pub: string;
  session: MeshSession;
  connected: boolean;
};

/**
 * `connected` is set when a connect succeeds but nothing clears it when the session dies later
 * (the other phone restarted, a Wi-Fi Direct link dropped). Seen on hardware: a stale `true` kept
 * reconcile from ever retrying, stranding a pair until the next send. Trust the live state too.
 */
function isNeighborLive(neighbor: Neighbor): boolean {
  if (!neighbor.connected) return false;
  const state = neighbor.session.getState?.();
  if (state === undefined || state === 'connected') return true;
  neighbor.connected = false;
  return false;
}

const DEFAULT_MESH_SEND_TIMEOUT_MS = 2_500;
const DEFAULT_MESH_RETRY_TIMEOUT_MS = 10_000;
const DEFAULT_MESH_ACK_TIMEOUT_MS = 3_000;
/**
 * Room-broadcast flood attempts before falling back to the encrypted mailbox.
 * Re-flooding is idempotent (receivers dedup by msgId) and recovers recipients
 * whose DataChannel flapped during an earlier attempt.
 */
const MESH_BROADCAST_FLOOD_ATTEMPTS = 3;
/**
 * Outside a personal list (Contacts only: a DM warm-up, the recipients of a Talk) the mesh links to
 * the members it was given, at most this many at once.
 */
const MAX_EXPLICIT_LINKS = 64;
/** Outbox entries announced at once per flush. */
const DIRECT_FLUSH_CONCURRENCY = 12;
/** Nearby v3: a new link may fail to connect for this long while the other side answers the knock. */
const PERSONAL_CONNECT_GRACE_MS = 8_000;
/** A link opened for one reason (an answer, a direct send) stays this long; we wait this long for it. */
const PERSONAL_RESPONSE_PIN_MS = 60_000;
const PERSONAL_RESPONSE_CONNECT_MS = 15_000;
/** After giving up on a person, the broadcast loop leaves them to the mailbox for this long. */
const PERSONAL_GAVE_UP_COOLDOWN_MS = 5 * 60_000;
const DIRECT_DELIVERY_RETRY_INTERVAL_MS = 5_000;

/**
 * R4: Bounded FIFO seen-set. Prevents unbounded memory growth in long sessions
 * while preserving dedup semantics (spec §23.8 "seen-set sizing").
 */
const SEEN_SET_MAX_SIZE = 10_000;

class BoundedFifoSet {
  private readonly set = new Set<string>();
  private readonly queue: string[] = [];

  constructor(private readonly maxSize: number) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.queue.push(id);
    if (this.queue.length > this.maxSize) {
      const evicted = this.queue.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
  }

  get size(): number {
    return this.set.size;
  }

  clear(): void {
    this.set.clear();
    this.queue.length = 0;
  }
}

function randomId(prefix: string): string {
  const cryptoLike = typeof crypto !== 'undefined' ? crypto : undefined;
  const uuid = cryptoLike?.randomUUID?.();
  return `${prefix}_${uuid || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
}

function meshConversationId(roomId: string, userA: string, userB: string): string {
  const [left, right] = [userA, userB].sort();
  return `mesh:${roomId}:${left}:${right}`;
}

function talkBodyDeliveryKey(talkId: string, authorId: string): string {
  return `${talkId}::${authorId}`;
}

/**
 * Delivery-tracking key for one REVISION of a talk. An author's in-place edit keeps the talkId,
 * so the announced content hash is part of the key — a revised body is a new delivery while
 * flood re-sends of the same revision still dedupe. Peers on builds that don't send
 * `contentHash` keep the old per-talk behavior.
 */
function talkRevisionDeliveryKey(talkId: string, authorId: string, contentHash?: unknown): string {
  const base = talkBodyDeliveryKey(talkId, authorId);
  return typeof contentHash === 'string' && contentHash ? `${base}::${contentHash}` : base;
}

/** `{ contentHash }` for a talk body, or `{}` when it can't be identified. */
function contentHashField(talk: unknown): { contentHash?: string } {
  try {
    // OPEN-45: the full revision, so a title/routing-only update is a new delivery too.
    const contentHash = computeTalkRevisionHash(talk);
    return contentHash ? { contentHash } : {};
  } catch {
    return {};
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async (_, workerIndex) => {
    for (let i = workerIndex; i < items.length; i += limit) {
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export class PeerMeshService {
  private currentRoomId: string | null = null;
  private currentRoomMemberIds = new Set<string>();
  private currentRoomMembers = new Map<string, RoomMember>();
  private readonly neighbors = new Map<string, Neighbor>();
  private readonly knownPeerPubs = new Map<string, string>();
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileInFlight: Promise<void> | null = null;
  private reconcileRequested = false;
  /** R4: bounded FIFO dedup cache; cleared on leaveRoom (spec §23.8). */
  private readonly seen = new BoundedFifoSet(SEEN_SET_MAX_SIZE);
  /** Frames currently undergoing async signature verification; closes the direct/relay race. */
  private readonly verifyingFrameIds = new Set<string>();
  private readonly talkBodies = new Map<string, Record<string, unknown>>();
  private readonly deliveredTalkBodyIds = new Set<string>();
  private readonly rejectedTalkOfferIds = new Set<string>();
  private readonly pendingTalkBodyRequestTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly bodyRequestWaiters = new Map<string, (payload: P2PMeshTalkBodyPayload) => void>();
  private readonly acknowledgements = new Map<string, Set<string>>();
  private readonly acknowledgementWaiters = new Map<string, Set<() => void>>();
  /** A neighbor may carry room traffic only after both sides report the same verified checkpoint. */
  private readonly manifestReadyPeerIds = new Set<string>();
  private readonly manifestRejectedPeerIds = new Set<string>();
  private readonly forwardingPolicy: MeshForwardingPolicy;
  private protocolManifestController: ProtocolManifestController | undefined;
  private readonly directTalkOutbox: DirectTalkDeliveryOutbox | null;
  private directOutboxFlush: Promise<Set<string>> | null = null;
  private readonly directOfferMsgIds = new Map<string, string>();
  /** `${recipientUserId}|${talkId}` still queued in the outbox for the current room (in-memory mirror). */
  private readonly queuedDirectTalks = new Set<string>();
  /** Nearby v3: peers a link must open to now, until the given time. */
  private readonly pinnedPeers = new Map<string, { pub: string; until: number }>();
  private readonly gossipWaiters = new Map<string, (message: Record<string, unknown>) => void>();
  /** The current room is a personal list (Nearby v3) rather than a shared room. */
  private personalMode = false;
  private personalLimit: number | null = null;
  private readonly lastKnockAt = new Map<string, number>();
  private readonly connectFailures = new Map<string, number>();
  /** When each personal link was created: the other side opens only after our knock lands. */
  private readonly personalLinkOpenedAt = new Map<string, number>();
  /**
   * When each peer signed the knock that pinned them. Within the connect grace they are opening
   * their side, so we neither knock back nor count failures; an older knock (one that waited in
   * the channel while we were away) is no reason to wait for them.
   */
  private readonly knockedAt = new Map<string, number>();
  /** When the broadcast loop last gave up on each person (two failed connects after the grace). */
  private readonly gaveUpAt = new Map<string, number>();
  /** Content-free, process-lifetime counters for OPEN-76 physical route measurements. */
  private readonly transportMetrics: PeerMeshTransportMetrics = {
    sentFrames: 0,
    sentBytes: 0,
    receivedFrames: 0,
    receivedBytes: 0,
    duplicateFramesReceived: 0,
    logicalTalkBodiesAccepted: 0,
    duplicateTalkBodiesReceived: 0,
  };

  constructor(
    private readonly gunService: WebGunService,
    private readonly opts: PeerMeshServiceOptions,
  ) {
    this.forwardingPolicy = new MeshForwardingPolicy(opts.forwardingSettings);
    this.protocolManifestController = opts.protocolManifestController;
    this.directTalkOutbox = opts.authoritativeDirectTalkDelivery
      ? new DirectTalkDeliveryOutbox(gunService)
      : null;
  }

  setProtocolManifestController(controller: ProtocolManifestController): void {
    this.protocolManifestController = controller;
    this.manifestReadyPeerIds.clear();
    this.manifestRejectedPeerIds.clear();
    void Promise.all([...this.neighbors.values()].map((neighbor) => this.sendProtocolManifestSummary(neighbor)));
  }

  updateForwardingSettings(settings: Partial<ForwardingSettings>): void {
    this.forwardingPolicy.update(settings);
  }

  getForwardingDiagnostics(): ReturnType<MeshForwardingPolicy['diagnostics']> {
    return this.forwardingPolicy.diagnostics();
  }

  getDiagnostics(): {
    roomId: string | null;
    neighborCount: number;
    connectedNeighborCount: number;
    seenCount: number;
    cachedTalkBodies: number;
    manifestReadyNeighborCount: number;
    manifestRejectedNeighborCount: number;
    transport: PeerMeshTransportMetrics;
  } {
    return {
      roomId: this.currentRoomId,
      neighborCount: this.neighbors.size,
      connectedNeighborCount: [...this.neighbors.values()].filter(isNeighborLive).length,
      seenCount: this.seen.size,
      cachedTalkBodies: this.talkBodies.size,
      manifestReadyNeighborCount: this.manifestReadyPeerIds.size,
      manifestRejectedNeighborCount: this.manifestRejectedPeerIds.size,
      transport: { ...this.transportMetrics },
    };
  }

  async waitForConnectedNeighbor(userId: string, timeoutMs = 6_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const neighbor = this.neighbors.get(userId);
      if (neighbor && isNeighborLive(neighbor)) return true;
      if (neighbor) {
        try {
          await Promise.race([
            neighbor.session.ensureConnected(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('mesh neighbor wait timeout')), 750)),
          ]);
          const newlyConnected = !neighbor.connected;
          neighbor.connected = true;
          void this.sendProtocolManifestSummary(neighbor);
          if (newlyConnected) this.notifyNeighborConnected(userId);
          return true;
        } catch {
          neighbor.connected = false;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const last = this.neighbors.get(userId);
    return !!last && isNeighborLive(last);
  }

  /**
   * Nearby v3: keep a link open to this peer until `ttlMs` from now, whether or not they are on the
   * roster (a gossip partner, someone who knocked). The link closes once the pin expires.
   */
  private isPersonal(): boolean {
    return this.personalMode || this.opts.personalRoster === true;
  }

  private personalConcurrencyLimit(): number {
    const bounds = this.opts.personalConcurrency?.() ?? { initial: 4, max: 16 };
    this.personalLimit ??= bounds.initial;
    this.personalLimit = Math.max(1, Math.min(bounds.max, this.personalLimit));
    return this.personalLimit;
  }

  private adjustPersonalConcurrency(delivered: boolean): void {
    if (!this.isPersonal()) return;
    const bounds = this.opts.personalConcurrency?.() ?? { initial: 4, max: 16 };
    const current = this.personalLimit ?? bounds.initial;
    this.personalLimit = delivered ? Math.min(bounds.max, current + 1) : Math.max(1, Math.floor(current / 2));
  }

  /** Personal mode: ask the peer to open their side, at most once per 10 s per peer. */
  private knockIfPersonal(neighbor: { userId: string; pub: string }): void {
    if (!this.isPersonal() || !this.opts.knockPeer || this.knockIsFresh(neighbor.userId)) return;
    const nowMs = Date.now();
    if (nowMs - (this.lastKnockAt.get(neighbor.userId) ?? 0) < 10_000) return;
    this.lastKnockAt.set(neighbor.userId, nowMs);
    void this.opts.knockPeer({ userId: neighbor.userId, pub: neighbor.pub }).catch(() => undefined);
  }

  /** Talks queued in the outbox per recipient for the current room. */
  private pendingRecipients(): Set<string> {
    const pending = new Set<string>();
    for (const key of this.queuedDirectTalks) pending.add(key.slice(0, key.indexOf('|')));
    return pending;
  }

  /** How many people the Nearby v3 broadcast loop links to at once now. */
  getPersonalConcurrency(): number {
    return this.personalConcurrencyLimit();
  }

  pinPeer(userId: string, pub: string, ttlMs: number, options: { fromKnock?: boolean; knockedAtMs?: number } = {}): void {
    if (!userId || !pub || userId === this.opts.localUserId) return;
    if (options.fromKnock) {
      this.knockedAt.set(userId, Number.isFinite(options.knockedAtMs) ? options.knockedAtMs! : Date.now());
      this.connectFailures.delete(userId);
      this.gaveUpAt.delete(userId);
      // A peer knocks only while opening a link it does not have, so a session of ours older than
      // the connect grace is stale even if it still reads "connected" (their page restarted; ICE has
      // not timed out yet). Start it over; a session still within the grace is the same attempt.
      const openedAt = this.personalLinkOpenedAt.get(userId) ?? 0;
      if (this.neighbors.has(userId) && Date.now() - openedAt >= PERSONAL_CONNECT_GRACE_MS) this.dropNeighbor(userId);
    }
    const until = (this.opts.now?.() ?? Date.now()) + Math.max(0, ttlMs);
    const existing = this.pinnedPeers.get(userId);
    this.pinnedPeers.set(userId, { pub, until: Math.max(until, existing?.until ?? 0) });
    this.knownPeerPubs.set(userId, pub);
    if (!this.currentRoomId) return;
    void this.reconcileNeighbors().then(() => this.scheduleReconcile()).catch(() => undefined);
  }

  unpinPeer(userId: string): void {
    if (!this.pinnedPeers.delete(userId) || !this.currentRoomId) return;
    void this.reconcileNeighbors().catch(() => undefined);
  }

  isPinned(userId: string): boolean {
    const pin = this.pinnedPeers.get(userId);
    return !!pin && pin.until > (this.opts.now?.() ?? Date.now());
  }

  /**
   * Nearby v3: send one gossip message to a peer and wait for the answer. Opens the link (asking the
   * peer to open their side with a knock) and resolves null when the peer cannot be reached or does
   * not answer within `timeoutMs`.
   */
  async requestNearbyGossip(
    peer: { userId: string; pub: string },
    message: Record<string, unknown>,
    timeoutMs: number,
    options: { expectReply?: boolean } = {},
  ): Promise<Record<string, unknown> | null> {
    if (!this.currentRoomId) return null;
    const expectReply = options.expectReply !== false;
    const deadline = Date.now() + timeoutMs;
    this.pinPeer(peer.userId, peer.pub, timeoutMs + 30_000);
    if (!(await this.waitForConnectedNeighbor(peer.userId, Math.max(0, deadline - Date.now())))) return null;
    while (this.protocolManifestController && !this.manifestReadyPeerIds.has(peer.userId)) {
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const requestId = randomId('gossip');
    if (!expectReply) {
      const frame = await this.buildFrame('nearby-gossip', { requestId, message }, { recipientUserId: peer.userId, ttlHops: 1 });
      const neighbor = this.neighbors.get(peer.userId);
      this.rememberSeen(frame.msgId);
      if (neighbor) await this.sendFrameToNeighbor(neighbor, frame);
      return null;
    }
    const answer = new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => {
        this.gossipWaiters.delete(requestId);
        resolve(null);
      }, Math.max(0, deadline - Date.now()));
      this.gossipWaiters.set(requestId, (reply) => {
        clearTimeout(timer);
        this.gossipWaiters.delete(requestId);
        resolve(reply);
      });
    });
    const payload: P2PNearbyGossipPayload = { requestId, message };
    const frame = await this.buildFrame('nearby-gossip', payload, { recipientUserId: peer.userId, ttlHops: 1 });
    const neighbor = this.neighbors.get(peer.userId);
    this.rememberSeen(frame.msgId);
    if (!neighbor || !(await this.sendFrameToNeighbor(neighbor, frame))) {
      this.gossipWaiters.delete(requestId);
      return null;
    }
    return answer;
  }

  /** Which members get a link now. */
  private selectNeighbors(members: RoomMember[], K: number): RoomMember[] {
    if (this.isPersonal()) {
      // Nearby v3: only peers with a reason to talk now. Pinned peers (a swap, a knock) first, then
      // the broadcast loop: people with queued Talks, in list order, as many as the adaptive limit.
      // Queued recipients outside the list (a contact group, a chosen audience) come after it.
      const byId = new Map(members.map((member) => [member.userId, member]));
      const pins = [...this.pinnedPeers.entries()].sort((a, b) => b[1].until - a[1].until).map(([userId]) => userId);
      const pending = this.pendingRecipients();
      const listed = [...this.currentRoomMembers.keys()].filter((userId) => pending.has(userId));
      const outside = [...pending].filter((userId) => !this.currentRoomMembers.has(userId) && userId !== this.opts.localUserId);
      const nowMs = Date.now();
      const loop = [...listed, ...outside]
        .filter((userId) => !this.pinnedPeers.has(userId) && nowMs - (this.gaveUpAt.get(userId) ?? -Infinity) >= PERSONAL_GAVE_UP_COOLDOWN_MS)
        .slice(0, this.personalConcurrencyLimit());
      return [...pins, ...loop].map((userId) => byId.get(userId) ?? (pins.includes(userId) ? undefined : { userId, stageName: userId }))
        .filter((member): member is RoomMember => !!member)
        .slice(0, Math.max(K, pins.length + loop.length));
    }
    // Contacts only: the members I was given (a DM warm-up, the recipients of a Talk).
    return members
      .filter((member) => member.userId && member.userId !== this.opts.localUserId && member.userId !== TECHSUPPORT_ROOT_USER_ID)
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .slice(0, K);
  }

  /**
   * True while this Talk sits in the direct-delivery outbox for that peer in the current room. The
   * outbox already retries it on its own schedule (and on every neighbor link), so room catch-up
   * should not send it again (OPEN-51).
   */
  hasQueuedDirectTalk(recipientUserId: string, talkId: string): boolean {
    return this.queuedDirectTalks.has(`${recipientUserId}|${talkId}`);
  }

  async joinRoom(
    roomId: string,
    members: RoomMember[],
    options: { replace?: boolean; personal?: boolean } = {},
  ): Promise<void> {
    if (options.personal !== undefined) this.personalMode = options.personal;
    const wasInactive = this.currentRoomId === null;
    const roomChanged = this.currentRoomId !== null && this.currentRoomId !== roomId;
    if (roomChanged) {
      for (const neighbor of this.neighbors.values()) neighbor.session.dispose?.();
      this.neighbors.clear();
      this.currentRoomMembers.clear();
      this.currentRoomMemberIds.clear();
      this.manifestReadyPeerIds.clear();
      this.manifestRejectedPeerIds.clear();
      this.queuedDirectTalks.clear();
      this.pinnedPeers.clear();
      this.knockedAt.clear();
      this.gaveUpAt.clear();
      this.connectFailures.clear();
    }
    this.currentRoomId = roomId;
    const remoteMembers = members.filter(
      (member) => member.userId &&
        member.userId !== this.opts.localUserId &&
        member.userId !== TECHSUPPORT_ROOT_USER_ID,
    );
    let rosterChanged = wasInactive || roomChanged;
    if (options.replace) {
      // A personal list (Nearby v3) shrinks as well as grows: forget whoever left it.
      const keep = new Set(remoteMembers.map((member) => member.userId));
      for (const userId of [...this.currentRoomMembers.keys()]) {
        if (keep.has(userId)) continue;
        this.currentRoomMembers.delete(userId);
        this.currentRoomMemberIds.delete(userId);
        rosterChanged = true;
      }
    }
    // Gun room membership arrives as a stream of partial snapshots. Replacing the
    // roster on every callback tears down healthy links whenever a callback contains
    // only the newest member. Keep the discovered same-room set until leave/room
    // change; libp2p discovery has the same eventually-consistent shape.
    for (const member of remoteMembers) {
      this.currentRoomMemberIds.add(member.userId);
      const prior = this.currentRoomMembers.get(member.userId);
      const stageName = member.stageName || prior?.stageName;
      const next = {
        ...prior,
        ...member,
        ...(stageName ? { stageName } : {}),
      };
      if (!prior || prior.stageName !== next.stageName) {
        rosterChanged = true;
      }
      if (prior?.epoch && member.epoch && prior.epoch !== member.epoch) {
        // The peer restarted: our session to it is dead even if WebRTC has not noticed yet (it
        // takes ~30–40 s), and as initiator we would not re-offer until it did. Remove the old
        // session so reconciliation creates a fresh transport, including fresh fallback state.
        const neighbor = this.neighbors.get(member.userId);
        if (neighbor) {
          neighbor.session.dispose?.();
          this.neighbors.delete(member.userId);
          this.manifestReadyPeerIds.delete(member.userId);
          this.manifestRejectedPeerIds.delete(member.userId);
        }
        rosterChanged = true;
      }
      this.currentRoomMembers.set(member.userId, next);
    }
    if (!rosterChanged) return;
    await this.reconcileNeighbors();
    this.scheduleReconcile();
  }

  private async reconcileNeighbors(): Promise<void> {
    this.reconcileRequested = true;
    if (this.reconcileInFlight) return this.reconcileInFlight;

    const reconcile = (async () => {
      while (this.reconcileRequested) {
        this.reconcileRequested = false;
        const roomId = this.currentRoomId;
        if (!roomId) return;
        await this.runNeighborReconcile(roomId);
      }
    })();
    this.reconcileInFlight = reconcile;
    try {
      await reconcile;
    } finally {
      if (this.reconcileInFlight === reconcile) this.reconcileInFlight = null;
    }
  }

  private async runNeighborReconcile(roomId: string): Promise<void> {
    if (this.currentRoomId !== roomId) return;
    const local = this.localIdentity();
    // A personal list links only to peers with a reason (pins, the loop); the loop bounds itself.
    const maxNeighbors = this.isPersonal() ? 256 : MAX_EXPLICIT_LINKS;
    const mergedMembers = new Map<string, RoomMember>(this.currentRoomMembers);
    if (this.isPersonal()) {
      const nowMs = this.opts.now?.() ?? Date.now();
      for (const [userId, pin] of this.pinnedPeers) {
        if (pin.until <= nowMs) {
          this.pinnedPeers.delete(userId);
          this.knockedAt.delete(userId);
          continue;
        }
        const member = mergedMembers.get(userId);
        mergedMembers.set(userId, { ...(member ?? { userId, stageName: userId }), pub: pin.pub });
      }
    }
    const rankedCandidates = this.selectNeighbors([...mergedMembers.values()], maxNeighbors);
    const resolvedByUserId = new Map<string, string>();
    const localPub = (member: RoomMember): string | undefined =>
      member.pub || this.neighbors.get(member.userId)?.pub || this.knownPeerPubs.get(member.userId);
    // Reconcile runs on every roster callback (about once a second while idle). Ask the hub's
    // presence list only when some candidate's key is still unknown: fetching up to 200 entries
    // on every pass kept an idle phone's embedded node busy (measured 2026-10-18, native-app/39).
    const presencePubs = rankedCandidates.some((member) => !localPub(member))
      ? await this.fetchPresencePubs()
      : new Map<string, string>();
    for (const member of rankedCandidates) {
      // Roster-carried pub first: zero-lookup, present as soon as the member record
      // replicates. Network-derived sources remain as fallbacks for older records.
      const pub = localPub(member) || presencePubs.get(member.userId);
      if (pub) resolvedByUserId.set(member.userId, pub);
    }
    if (resolvedByUserId.size < maxNeighbors) {
      const fallbackMembers = rankedCandidates
        .filter((member) => !resolvedByUserId.has(member.userId))
        .slice(0, Math.max(maxNeighbors * 2, maxNeighbors));
      const fallbackPubs = await Promise.all(fallbackMembers.map(async (member) => ({
        member,
        pub: await this.resolveUserPub(member.userId, 2),
      })));
      for (const { member, pub } of fallbackPubs) {
        if (pub) resolvedByUserId.set(member.userId, pub);
      }
    }
    for (const [userId, pub] of resolvedByUserId) {
      this.knownPeerPubs.set(userId, pub);
    }
    const candidates = rankedCandidates
      .map((member) => ({ member, pub: resolvedByUserId.get(member.userId) || '' }))
      .filter((candidate) => !!candidate.pub)
      .slice(0, maxNeighbors);

    const wanted = new Set(candidates.map(({ member }) => member.userId));
    for (const userId of [...this.neighbors.keys()]) {
      if (!wanted.has(userId)) this.dropNeighbor(userId);
    }

    await Promise.all(candidates.map(async ({ member, pub }) => {
      const existing = this.neighbors.get(member.userId);
      if (existing) {
        if (!isNeighborLive(existing)) this.connectNeighbor(existing);
        return;
      }
      if (this.currentRoomId !== roomId || !wanted.has(member.userId)) return;
      const session = this.createSession({
        roomId,
        localPub: local.pub,
        localPair: local.pair,
        otherUserId: member.userId,
        otherPub: pub,
      });
      const neighbor: Neighbor = {
        userId: member.userId,
        stageName: member.stageName || member.userId,
        pub,
        session,
        connected: false,
      };
      this.manifestReadyPeerIds.delete(member.userId);
      this.manifestRejectedPeerIds.delete(member.userId);
      this.neighbors.set(member.userId, neighbor);
      session.setOnRemoteMeshFrame((otherUserId, frame) => this.handleRemoteFrame(otherUserId, frame));
      this.personalLinkOpenedAt.set(member.userId, Date.now());
      this.knockIfPersonal(neighbor);
      this.connectNeighbor(neighbor);
    }));
    if (this.directTalkOutbox) void this.flushDirectTalkOutbox().catch(() => undefined);
  }

  /**
   * Talk frames go only to manifest-ready neighbors, and readiness usually lands a moment after the
   * link connects. A broadcast in that window reached no one, and catch-up only ran on connect, so
   * the Talk was never re-sent. Treat "newly ready" as connected for exchange purposes.
   */
  private markManifestReady(userId: string): void {
    if (this.manifestReadyPeerIds.has(userId)) return;
    this.manifestReadyPeerIds.add(userId);
    const neighbor = this.neighbors.get(userId);
    if (!neighbor || !isNeighborLive(neighbor)) return;
    this.notifyNeighborConnected(userId);
    if (this.directTalkOutbox) void this.flushDirectTalkOutbox().catch(() => undefined);
  }

  private notifyNeighborConnected(userId: string): void {
    const roomId = this.currentRoomId;
    if (!roomId) return;
    try {
      this.opts.onNeighborConnected?.(userId, roomId);
    } catch (error) {
      console.warn('[mesh] neighbor-connected handler failed:', error);
    }
  }

  private knockIsFresh(userId: string): boolean {
    const at = this.knockedAt.get(userId);
    return at !== undefined && Date.now() - at < PERSONAL_CONNECT_GRACE_MS;
  }

  /** Close this peer's link and forget its session; a later reconcile starts a fresh one. */
  private dropNeighbor(userId: string): void {
    this.neighbors.get(userId)?.session.dispose?.();
    this.neighbors.delete(userId);
    this.manifestReadyPeerIds.delete(userId);
    this.manifestRejectedPeerIds.delete(userId);
  }

  private connectNeighbor(neighbor: Neighbor): void {
    const startedAt = Date.now();
    void neighbor.session.ensureConnected()
      .then(() => {
        const newlyConnected = !neighbor.connected;
        if (newlyConnected) console.info(`[mesh] neighbor ${neighbor.userId.slice(0, 8)} connected (${Date.now() - startedAt} ms this attempt)`);
        neighbor.connected = true;
        this.connectFailures.delete(neighbor.userId);
        this.gaveUpAt.delete(neighbor.userId);
        void this.sendProtocolManifestSummary(neighbor);
        if (newlyConnected) this.notifyNeighborConnected(neighbor.userId);
        if (this.directTalkOutbox) void this.flushDirectTalkOutbox().catch(() => undefined);
      })
      .catch(() => {
        neighbor.connected = false;
        const inGrace = Date.now() - (this.personalLinkOpenedAt.get(neighbor.userId) ?? 0) < PERSONAL_CONNECT_GRACE_MS;
        if (this.isPersonal() && (inGrace || this.knockIsFresh(neighbor.userId))) {
          // Still waiting for the other side to answer our knock, or they just knocked us and are
          // opening their side: not a failure.
          this.knockIfPersonal(neighbor);
        } else if (this.isPersonal() && this.neighbors.get(neighbor.userId) === neighbor) {
          const failures = (this.connectFailures.get(neighbor.userId) ?? 0) + 1;
          this.connectFailures.set(neighbor.userId, failures);
          this.adjustPersonalConcurrency(false);
          if (failures >= 2) {
            // Nobody answers there: the person leaves the list, and their link and pin go now (a
            // swap still in flight must not keep redialing them).
            this.connectFailures.delete(neighbor.userId);
            this.pinnedPeers.delete(neighbor.userId);
            this.gaveUpAt.set(neighbor.userId, Date.now());
            this.dropNeighbor(neighbor.userId);
            this.opts.onPersonalPeerUnreachable?.(neighbor.userId, neighbor.pub);
          } else {
            this.knockIfPersonal(neighbor);
          }
        }
        this.scheduleReconcile(500);
      });
  }

  private scheduleReconcile(delayMs = 1_000): void {
    if (!this.currentRoomId || this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcileNeighbors().finally(() => {
        if (this.currentRoomId) this.scheduleReconcile();
      });
    }, delayMs);
    (this.reconcileTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  leaveRoom(): void {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    this.reconcileRequested = false;
    this.currentRoomId = null;
    this.currentRoomMemberIds.clear();
    this.currentRoomMembers.clear();
    for (const neighbor of this.neighbors.values()) neighbor.session.dispose?.();
    this.neighbors.clear();
    this.seen.clear();
    this.verifyingFrameIds.clear();
    this.deliveredTalkBodyIds.clear();
    for (const timer of this.pendingTalkBodyRequestTimers.values()) clearTimeout(timer);
    this.pendingTalkBodyRequestTimers.clear();
    this.bodyRequestWaiters.clear();
    this.acknowledgements.clear();
    this.acknowledgementWaiters.clear();
    this.directOfferMsgIds.clear();
    this.manifestReadyPeerIds.clear();
    this.manifestRejectedPeerIds.clear();
    this.queuedDirectTalks.clear();
    this.pinnedPeers.clear();
    this.knockedAt.clear();
    this.gaveUpAt.clear();
    this.connectFailures.clear();
    for (const resolve of [...this.gossipWaiters.values()]) resolve({});
    this.gossipWaiters.clear();
  }

  /**
   * Android may freeze a background WebView without delivering a timely WebRTC close event.
   * Recreate this phone's bounded neighbor set when the page becomes visible again so peers with
   * durable direct-Talk outbox entries get a fresh authenticated path and can retry immediately.
   * Room membership and dedup state stay intact; this is a transport refresh, not a room leave.
   */
  async resumeRoomConnections(): Promise<void> {
    if (!this.currentRoomId) return;
    for (const neighbor of this.neighbors.values()) neighbor.session.dispose?.();
    this.neighbors.clear();
    this.manifestReadyPeerIds.clear();
    this.manifestRejectedPeerIds.clear();
    await this.reconcileNeighbors();
    this.scheduleReconcile();
  }

  /**
   * Cache a talk body, author-qualified.
   *
   * Talk ids are content-addressed (computeTalkCIDv1, no authorId), so two authors
   * who create identical content produce the SAME talkId with different authorIds
   * (legal by design). The cache must therefore key by talkId::authorId, otherwise a
   * remote author's body (e.g. arriving via the Gun rendezvous fallback,
   * handleRendezvousTalkBody) would OVERWRITE the local author's own cached body for
   * the same talkId. That corruption breaks `handleTalkBodyRequest` (serving the wrong
   * author's data) and `getCachedTalkBody` / `resolveMeshTalkData` on the author side
   * (the match-decision path uses the wrong author's talk definition).
   *
   * The local user's own authored copy is always preserved and preferred on read.
   */
  cacheTalkBody(talkId: string, talkData: Record<string, unknown>): void {
    if (!talkId) return;
    const authorId = String((talkData as { authorId?: unknown }).authorId || '') || this.opts.localUserId;
    this.talkBodies.set(talkBodyDeliveryKey(talkId, authorId), talkData);
  }

  /**
   * Read a cached talk body for `talkId`. Prefers the local user's own authored copy
   * (talkId::localUserId) so the author-side response/match path always resolves its
   * own talk definition even when a remote author broadcast identical content. Falls
   * back to any cached author's copy for the same content id.
   */
  getCachedTalkBody(talkId: string, authorId?: string): Record<string, unknown> | null {
    if (!talkId) return null;
    if (authorId) {
      const exact = this.talkBodies.get(talkBodyDeliveryKey(talkId, authorId));
      if (exact) return exact;
    }
    const own = this.talkBodies.get(talkBodyDeliveryKey(talkId, this.opts.localUserId));
    if (own) return own;
    const prefix = `${talkId}::`;
    for (const [key, value] of this.talkBodies) {
      if (key.startsWith(prefix)) return value;
    }
    return null;
  }

  async sendPing(text = 'ping'): Promise<string> {
    const frame = await this.buildFrame('mesh-ping', { text }, { ttlHops: 8 });
    await this.rememberAndFanout(frame);
    return frame.msgId;
  }

  async broadcastTalk(
    talk: Talk | Record<string, unknown>,
    opts: { recipientUserIds?: string[]; roomBroadcast?: boolean; skipAcknowledgements?: boolean } = {},
  ): Promise<Set<string>> {
    const talkId = String((talk as { id?: unknown }).id || '');
    if (!talkId) throw new Error('mesh broadcast requires talk.id');
    const roomId = this.currentRoomId;
    if (!roomId) throw new Error('mesh broadcast requires an active room');
    const talkRecord = JSON.parse(JSON.stringify(talk || {})) as Record<string, unknown>;
    this.cacheTalkBody(talkId, talkRecord);
    const pair = this.gunService.getStoredPair();
    const payload: P2PMeshTalkAnnouncePayload = {
      roomId,
      broadcastAt: new Date().toISOString(),
      talkId,
      authorId: this.opts.localUserId,
      authorName: this.opts.localStageName,
      ...(pair?.epub ? { authorEpub: String(pair.epub) } : {}),
      title: String((talk as { title?: unknown }).title || 'Untitled Talk'),
      ...(typeof (talk as { type?: unknown }).type === 'string'
        ? { type: String((talk as { type?: unknown }).type) }
        : {}),
      questionCount: Array.isArray((talk as { questions?: unknown }).questions)
        ? ((talk as { questions: unknown[] }).questions).length
        : 0,
      ...((talk as { isAdult?: unknown }).isAdult === true ? { isAdult: true } : {}),
      ...(typeof (talk as { language?: unknown }).language === 'string' ? { language: String((talk as { language: string }).language) } : {}),
      ...(Array.isArray((talk as { tags?: unknown }).tags) ? { tags: (talk as { tags: unknown[] }).tags.map(String).slice(0, 32) } : {}),
      requestedAuthorization: 'accepted-talk-read',
      syncCapabilities: configuredMeshSyncCapabilities(process.env.IINPUBLIC_MESH_SYNC_MODE),
      ...contentHashField(talkRecord),
    };
    const bodyPayload: P2PMeshTalkBodyPayload = {
      ...payload,
      talkData: talkRecord,
    };
    if (this.directTalkOutbox && !opts.skipAcknowledgements) {
      const recipients = [...new Set(
        (opts.recipientUserIds?.length ? opts.recipientUserIds : [...this.currentRoomMemberIds])
          .filter((userId) => !!userId && userId !== this.opts.localUserId),
      )];
      const queued = await Promise.all(recipients.map((recipientUserId) =>
        this.directTalkOutbox!.enqueue(roomId, recipientUserId, bodyPayload)));
      if (roomId === this.currentRoomId) {
        for (const entry of queued) this.queuedDirectTalks.add(`${entry.recipientUserId}|${entry.talkId}`);
      }
      // Nearby v3: links open only for people with queued Talks, so open the loop's first batch.
      if (this.isPersonal()) await this.reconcileNeighbors();
      await this.flushDirectTalkOutbox();
      const remaining = new Set((await this.directTalkOutbox.list(roomId)).map((entry) => entry.key));
      if (this.opts.onDirectDeliveryPending) {
        const pending = queued.filter((entry) => remaining.has(entry.key)).map((entry) => entry.recipientUserId);
        const reachable = new Set(await this.activeExpectedRecipients(pending).catch(() => pending));
        const asleep = [...new Set(pending.filter((userId) => {
          const neighbor = this.neighbors.get(userId);
          return !reachable.has(userId) && !(neighbor && isNeighborLive(neighbor));
        }))];
        if (pending.length > 0) {
          void Promise.resolve(this.opts.onDirectDeliveryPending(bodyPayload, [...new Set(pending)], asleep)).catch(
            (err) => console.warn('[Mesh] sleeping-recipient mailbox fallback failed:', err),
          );
        }
      }
      return new Set(queued.filter((entry) => !remaining.has(entry.key)).map((entry) => entry.recipientUserId));
    }
    if (opts.skipAcknowledgements) {
      const announceFrame = await this.buildFrame('talk-announce', payload, { ttlHops: 8 });
      const bodyFrame = await this.buildFrame('talk-body', bodyPayload, { ttlHops: 8 });
      await this.rememberAndFanout(announceFrame);
      await this.rememberAndFanout(bodyFrame);
      return new Set();
    }
    const recipients = [...new Set(opts.recipientUserIds?.filter(Boolean) || [])];
    const recipientSet = new Set(recipients);
    const isWholeKnownRoom =
      recipients.length > 0 &&
      this.currentRoomMemberIds.size > 0 &&
      [...this.currentRoomMemberIds].every((userId) => recipientSet.has(userId));
    const isRoomBroadcast = recipients.length === 0
      ? opts.roomBroadcast === true
      : isWholeKnownRoom;
    if (recipients.length > 0 && !isRoomBroadcast) {
      const acceptedRecipients = new Set<string>();
      await mapWithConcurrency(recipients, 3, async (recipientUserId) => {
        const announceFrame = await this.buildFrame('talk-announce', payload, {
          recipientUserId,
          ttlHops: 8,
        });
        const bodyFrame = await this.buildFrame('talk-body', bodyPayload, {
          recipientUserId,
          ttlHops: 8,
        });
        await this.rememberAndFanout(announceFrame);
        const acknowledged = await this.sendAndWaitForAcks(bodyFrame, [recipientUserId]);
        if (acknowledged.has(recipientUserId)) acceptedRecipients.add(recipientUserId);
        console.log(`[BODY-SEND] talk=${String(payload.talkId).slice(-8)} to=${recipientUserId.slice(0, 8)} acked=${acknowledged.has(recipientUserId)}`);
        if (!acknowledged.has(recipientUserId) && this.opts.onMailboxFallback) {
          void Promise.resolve(this.opts.onMailboxFallback(bodyPayload, [recipientUserId])).catch(
            (err) => console.warn('[Mesh] mailbox fallback failed:', err),
          );
        }
      });
      return acceptedRecipients;
    }
    const announceFrame = await this.buildFrame('talk-announce', payload, { ttlHops: 8 });
    if (isRoomBroadcast) {
      // Flood first, then use signed end-recipient ACKs to identify actual gaps.
      // Overlay degree bounds direct links, not reachability; preemptively mailboxing
      // every non-neighbor defeats gossip and overloads the encrypted fallback at scale.
      const bodyFrame = await this.buildFrame('talk-body', bodyPayload, { ttlHops: 8 });
      await this.rememberAndFanout(announceFrame);
      // Two distinct recipient sets, deliberately decoupled:
      //
      //  • ackTargets — the peers we BLOCK the flood loop on, waiting for ACKs. This stays
      //    the presence/neighbor-filtered set (activeExpectedRecipients) so a freshly-joined
      //    or presence-lagged recipient does NOT stall the broadcast for the full ack budget
      //    (3 × ackTimeout). Blocking on not-yet-reachable peers needlessly slowed small/fresh
      //    rooms (e.g. a sender looping announceTalkToRoom over several talks would exceed its
      //    test budget). Such peers are still guaranteed delivery by the mailbox fallback below.
      //
      //  • guaranteedRecipients — everyone delivery must reach. For an EXPLICIT recipient list
      //    this is the full list, so a recipient whose presence-pub has not yet replicated (and
      //    who is not a direct neighbor) is covered by the non-blocking mailbox fallback rather
      //    than dropped to depend on lossy flood gossip — the saturation-delivery gap. The
      //    implicit whole-room case stays presence-filtered (guards against mailboxing ghosts).
      const ackTargets = await this.activeExpectedRecipients(recipients.length > 0
        ? recipients
        : [...this.currentRoomMemberIds]);
      const guaranteedRecipients = recipients.length > 0
        ? [...new Set(recipients.filter((userId) => userId && userId !== this.opts.localUserId))]
        : ackTargets;
      // A single flood is lossy when a neighbor link flaps at send time (the frame is
      // dropped and seen-set dedup means nothing re-delivers it). Re-flood the SAME
      // announce+body frames for un-ACKed recipients before mailbox fallback:
      // receivers that already processed them dedup by msgId, stragglers whose links
      // recovered get a fresh copy (announce included, so announce-level diagnostics
      // and body-request scheduling still fire on their side).
      this.rememberSeen(bodyFrame.msgId);
      const ackTimeoutMs = this.opts.ackTimeoutMs ?? DEFAULT_MESH_ACK_TIMEOUT_MS;
      let acknowledged = new Set<string>();
      if (ackTargets.length === 0) {
        // No prompt-ack peers (e.g. presence not yet replicated): flood once, give any
        // already-connected neighbor a brief grace to ACK (so we don't redundantly mailbox
        // a recipient the flood just reached), then let the fallback guarantee the rest.
        this.acknowledgements.set(bodyFrame.msgId, acknowledged);
        const forwarded = await this.forwardFrame(bodyFrame);
        if (forwarded > 0) {
          acknowledged = await this.waitForAcks(
            bodyFrame.msgId,
            guaranteedRecipients,
            Math.min(ackTimeoutMs, 1_000),
          );
        } else {
          this.acknowledgements.delete(bodyFrame.msgId);
          this.acknowledgementWaiters.delete(bodyFrame.msgId);
        }
      } else {
        for (let attempt = 0; attempt < MESH_BROADCAST_FLOOD_ATTEMPTS; attempt += 1) {
          if (attempt > 0) {
            await this.forwardFrame(announceFrame);
          }
          this.acknowledgements.set(bodyFrame.msgId, acknowledged);
          const forwarded = await this.forwardFrame(bodyFrame);
          if (forwarded === 0) {
            // No neighbor accepted the frame — waiting for ACKs is pointless; clean up
            // and let the mailbox fallback cover every missing recipient immediately.
            this.acknowledgements.delete(bodyFrame.msgId);
            this.acknowledgementWaiters.delete(bodyFrame.msgId);
            break;
          }
          acknowledged = await this.waitForAcks(bodyFrame.msgId, ackTargets, ackTimeoutMs);
          if (ackTargets.every((userId) => acknowledged.has(userId))) break;
        }
      }
      if (this.opts.onMailboxFallback) {
        const missingRecipients = guaranteedRecipients.filter((userId) => !acknowledged.has(userId));
        if (missingRecipients.length > 0) {
          void Promise.resolve(this.opts.onMailboxFallback(bodyPayload, missingRecipients)).catch(
            (err) => console.warn('[Mesh] mailbox fallback failed:', err),
          );
        }
      }
      return acknowledged;
    }
    const bodyFrame = await this.buildFrame('talk-body', bodyPayload, { ttlHops: 8 });
    await this.rememberAndFanout(announceFrame);
    await this.rememberAndFanout(bodyFrame);
    return new Set();
  }

  /** Nearby v3 gossip can be sent now: the mesh is in personal mode in a room. */
  isPersonalReady(): boolean {
    return this.isPersonal() && !!this.currentRoomId;
  }

  /**
   * Nearby v3: links open only for a reason. Open one to this person now (pin, knock) and wait for
   * it, as a swap does; they need not be on my list. False outside personal mode.
   */
  async openPersonalLink(userId: string, timeoutMs = PERSONAL_RESPONSE_CONNECT_MS): Promise<boolean> {
    if (!this.isPersonal() || !this.currentRoomId || !userId || userId === this.opts.localUserId) return false;
    const pub = this.knownPeerPubs.get(userId) ?? await this.resolveUserPub(userId, 2);
    if (!pub) return false;
    this.pinPeer(userId, pub, PERSONAL_RESPONSE_PIN_MS);
    return this.waitForConnectedNeighbor(userId, timeoutMs);
  }

  async sendTalkResponse(payload: P2PMeshTalkResponsePayload): Promise<boolean> {
    // An answer is a reason to open the author's link.
    if (this.isPersonal()) await this.openPersonalLink(payload.authorId);
    const frame = await this.buildFrame('talk-response', payload, {
      recipientUserId: payload.authorId,
      ttlHops: 8,
    });
    const acknowledged = await this.sendAndWaitForAcks(frame, [payload.authorId]);
    return acknowledged.has(payload.authorId);
  }

  /**
   * Step 10: flood a `talk-retracted` frame to all neighbors (no recipientUserId = gossip flood).
   * TTL 8 ensures the frame reaches offline-adjacent nodes within a few hops.
   * The author's signature on the frame body (verified at ingest) proves origin.
   */
  async sendTalkRetraction(payload: P2PMeshTalkRetractedPayload): Promise<void> {
    const frame = await this.buildFrame('talk-retracted', payload, { ttlHops: 8 });
    await this.rememberAndFanout(frame);
  }

  private localIdentity(): { pub: string; pair: SeaSigningPair } {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv) throw new Error('Peer mesh requires a SEA signing pair');
    return { pub: String(pair.pub), pair: pair as SeaSigningPair };
  }

  private createSession(params: {
    roomId: string;
    localPub: string;
    localPair: SeaSigningPair;
    otherUserId: string;
    otherPub: string;
  }): MeshSession {
    const conversationId = meshConversationId(params.roomId, this.opts.localUserId, params.otherUserId);
    const isInitiator = this.opts.localUserId.localeCompare(params.otherUserId) < 0;
    if (this.opts.createSession) {
      return this.opts.createSession({
        conversationId,
        localUserId: this.opts.localUserId,
        localPub: params.localPub,
        localPair: params.localPair,
        otherUserId: params.otherUserId,
        otherPub: params.otherPub,
        isInitiator,
        onRemoteMeshFrame: (otherUserId, frame) => this.handleRemoteFrame(otherUserId, frame),
      });
    }
    return getOrCreateP2PSession({
      apiBase: this.opts.apiBase,
      conversationId,
      localUserId: this.opts.localUserId,
      localPub: params.localPub,
      localPair: params.localPair,
      otherUserId: params.otherUserId,
      otherPub: params.otherPub,
      isInitiator,
      // S2: Gun pub/sub signaling (pure peer↔peer `.on()` push) for the mesh too. An earlier
      // attempt used a slower poll-based signaler that delayed mesh connect and burned the
      // broadcast rate-limit budget; the push-only signaler connects as fast as HTTP.
      gun: this.gunService.getGun(),
      onRemoteMeshFrame: (otherUserId, frame) => this.handleRemoteFrame(otherUserId, frame),
    });
  }

  private async resolveUserPub(userId: string, attempts = 6): Promise<string | null> {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const user = await this.withTimeout(
          this.gunService.getPublicUser(userId),
          // Confirmed live (2026-09-03): GET /api/users/:id's own server-side wait budget alone
          // could reach ~1200ms even on success (two sequential Gun-read stages), silently
          // exceeding this timeout on effectively every attempt — mesh sessions between real
          // devices could never learn each other's pub key and never formed. The server side is
          // now much faster, but a client timeout this close to a network round trip stays
          // fragile on its own; give it real headroom instead of re-coupling to an exact budget.
          2500,
          'Gun public-key lookup timeout',
        );
        if (user?.pub) return String(user.pub);
      } catch {
        /* retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + i * 100));
    }
    return null;
  }

  private async fetchPresencePubs(): Promise<Map<string, string>> {
    const pubs = new Map<string, string>();
    try {
      const params = new URLSearchParams({ limit: '200' });
      const response = await this.withTimeout(
        fetch(`${this.opts.apiBase}/api/presence/nearby?${params.toString()}`, {
          cache: 'no-store',
        }),
        1_500,
        'presence lookup timeout',
      );
      if (!response.ok) return pubs;
      const body = await response.json() as {
        peers?: Array<{ userId?: unknown; pub?: unknown }>;
      };
      for (const peer of body.peers || []) {
        const userId = String(peer.userId || '');
        const pub = typeof peer.pub === 'string' ? peer.pub.trim() : '';
        if (userId && pub) pubs.set(userId, pub);
      }
    } catch {
      /* Gun fallback remains available for the bounded candidate set. */
    }
    return pubs;
  }

  private async activeExpectedRecipients(recipientIds: string[]): Promise<string[]> {
    const unique = [...new Set(recipientIds.filter(
      (userId) => userId && userId !== this.opts.localUserId,
    ))];
    if (unique.length === 0) return unique;
    const presencePubs = await this.fetchPresencePubs();
    if (presencePubs.size === 0) return unique;
    return unique.filter((userId) =>
      presencePubs.has(userId) || this.neighbors.get(userId)?.connected === true,
    );
  }

  private async buildFrame(
    kind: P2PMeshFrame['kind'],
    payload: P2PMeshFramePayload,
    opts: { recipientUserId?: string; ttlHops?: number } = {},
  ): Promise<P2PMeshFrame> {
    if (
      this.protocolManifestController
      && !isProtocolManifestControlKind(kind)
      && !this.protocolManifestController.isRoomExchangeAllowed()
    ) {
      throw new Error('Room exchange is disabled by the active protocol manifest');
    }
    const local = this.localIdentity();
    const manifestSummary = this.protocolManifestController?.summary();
    const frame: P2PMeshFrame = {
      version: 1,
      kind,
      msgId: randomId(kind),
      roomId: this.currentRoomId || 'global',
      originUserId: this.opts.localUserId,
      originPub: local.pub,
      ...(opts.recipientUserId ? { recipientUserId: opts.recipientUserId } : {}),
      createdAt: new Date().toISOString(),
      ttlHops: opts.ttlHops ?? 6,
      ...(manifestSummary
        ? {
            protocolManifest: {
              networkId: manifestSummary.networkId,
              sequence: manifestSummary.sequence,
              manifestHash: manifestSummary.manifestHash,
            },
          }
        : {}),
      payload,
    };
    const proof = await createSignedP2PEnvelopeProof({
      pair: local.pair,
      payload: p2pMeshFrameSigningPayload(frame),
    });
    return { ...frame, proof };
  }

  private async verifyOrigin(frame: P2PMeshFrame): Promise<boolean> {
    if (!frame.proof || !frame.originPub || frame.proof.pub !== frame.originPub) return false;
    const verification = await verifySignedP2PEnvelopeProof({
      proof: frame.proof,
      payload: p2pMeshFrameSigningPayload(frame),
    });
    return verification.ok;
  }

  /** Add msgId to the bounded seen-set (single call site so the bound is always respected). */
  private rememberSeen(msgId: string): void {
    this.seen.add(msgId);
  }

  private async rememberAndFanout(frame: P2PMeshFrame, exceptUserId?: string): Promise<number> {
    this.rememberSeen(frame.msgId);
    return this.forwardFrame(frame, exceptUserId);
  }

  private async sendAndWaitForAcks(
    frame: P2PMeshFrame,
    expectedRecipientIds: string[],
  ): Promise<Set<string>> {
    const expected = [...new Set(expectedRecipientIds.filter(
      (userId) => userId && userId !== this.opts.localUserId,
    ))];
    if (expected.length === 0) {
      await this.rememberAndFanout(frame);
      return new Set();
    }

    this.acknowledgements.set(frame.msgId, new Set());
    const forwarded = await this.rememberAndFanout(frame);
    if (forwarded === 0) {
      this.acknowledgements.delete(frame.msgId);
      return new Set();
    }
    return this.waitForAcks(
      frame.msgId,
      expected,
      this.opts.ackTimeoutMs ?? DEFAULT_MESH_ACK_TIMEOUT_MS,
    );
  }

  private async waitForAcks(
    msgId: string,
    expectedRecipientIds: string[],
    timeoutMs: number,
  ): Promise<Set<string>> {
    const acknowledged = this.acknowledgements.get(msgId) ?? new Set<string>();
    const isComplete = () => expectedRecipientIds.every((userId) => acknowledged.has(userId));
    if (!isComplete()) {
      await new Promise<void>((resolve) => {
        // eslint-disable-next-line prefer-const -- assigned after `done`, which closes over it
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = (): void => {
          if (!isComplete()) return;
          if (timer !== undefined) clearTimeout(timer);
          this.acknowledgementWaiters.get(msgId)?.delete(done);
          resolve();
        };
        const waiters = this.acknowledgementWaiters.get(msgId) ?? new Set<() => void>();
        waiters.add(done);
        this.acknowledgementWaiters.set(msgId, waiters);
        timer = setTimeout(() => {
          waiters.delete(done);
          resolve();
        }, timeoutMs);
      });
    }
    this.acknowledgementWaiters.delete(msgId);
    this.acknowledgements.delete(msgId);
    return new Set(acknowledged);
  }

  private recordAck(msgId: string, fromUserId: string): void {
    const acknowledged = this.acknowledgements.get(msgId);
    if (!acknowledged) return;
    acknowledged.add(fromUserId);
    for (const notify of this.acknowledgementWaiters.get(msgId) ?? []) notify();
  }

  private async acknowledge(frame: P2PMeshFrame): Promise<void> {
    if (frame.originUserId === this.opts.localUserId) return;
    const ack = await this.buildFrame('ack', { msgId: frame.msgId }, {
      recipientUserId: frame.originUserId,
      ttlHops: 8,
    });
    await this.rememberAndFanout(ack);
  }

  private async forwardFrame(frame: P2PMeshFrame, exceptUserId?: string): Promise<number> {
    if (frame.ttlHops <= 0) return 0;
    const forwarded = { ...frame, ttlHops: frame.ttlHops - 1 };
    const directTarget = frame.recipientUserId ? this.neighbors.get(frame.recipientUserId) : undefined;
    const available = [...this.neighbors.values()]
      .filter((neighbor) => neighbor.userId !== exceptUserId)
      .filter((neighbor) => !this.protocolManifestController
        || isProtocolManifestControlKind(frame.kind)
        || this.manifestReadyPeerIds.has(neighbor.userId));
    // Authoritative Talk delivery never exposes a recipient-addressed frame to other room peers.
    // The legacy/experimental mesh path retains its former direct-first fanout behavior.
    const candidateTargets = this.directTalkOutbox && frame.recipientUserId
      ? (directTarget && directTarget.userId !== exceptUserId ? [directTarget] : [])
      : directTarget && directTarget.userId !== exceptUserId
        ? [directTarget, ...available.filter((neighbor) => neighbor.userId !== directTarget.userId)]
        : available;
    const estimatedBytes = new TextEncoder().encode(JSON.stringify(forwarded)).byteLength;
    const targets = candidateTargets.filter((neighbor) => {
      const context = this.forwardingContext(neighbor.userId);
      return this.forwardingPolicy.evaluate(forwarded, this.opts.localUserId, context, estimatedBytes).allowed;
    });
    const results = await Promise.all(
      targets.map((neighbor) => this.sendFrameToNeighbor(neighbor, forwarded)),
    );
    return results.filter(Boolean).length;
  }

  private async sendFrameToNeighbor(neighbor: Neighbor, frame: P2PMeshFrame): Promise<boolean> {
    const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
    const context = this.forwardingContext(neighbor.userId);
    // Re-check immediately before every transmission; settings/battery/network may
    // have changed since neighbor selection.
    const decision = this.forwardingPolicy.evaluate(frame, this.opts.localUserId, context, bytes);
    if (!decision.allowed) return false;
    try {
      await this.withTimeout(
        neighbor.session.sendMeshFrame(frame),
        this.opts.sendTimeoutMs ?? DEFAULT_MESH_SEND_TIMEOUT_MS,
        'mesh send timeout',
      );
      this.transportMetrics.sentFrames += 1;
      this.transportMetrics.sentBytes += bytes;
      neighbor.connected = true;
      if (decision.frameClass === 'third-party' || decision.frameClass === 'discovery-gossip') {
        this.forwardingPolicy.recordForwarded(context.routeId, bytes);
      }
      return true;
    } catch {
      neighbor.connected = false;
      return this.retryFrameAfterConnect(neighbor, frame);
    }
  }

  private async retryFrameAfterConnect(neighbor: Neighbor, frame: P2PMeshFrame): Promise<boolean> {
    try {
      await this.withTimeout(
        neighbor.session.ensureConnected(),
        this.opts.retryTimeoutMs ?? DEFAULT_MESH_RETRY_TIMEOUT_MS,
        'mesh retry connect timeout',
      );
      const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
      const context = this.forwardingContext(neighbor.userId);
      const decision = this.forwardingPolicy.evaluate(frame, this.opts.localUserId, context, bytes);
      if (!decision.allowed) return false;
      await this.withTimeout(
        neighbor.session.sendMeshFrame(frame),
        this.opts.sendTimeoutMs ?? DEFAULT_MESH_SEND_TIMEOUT_MS,
        'mesh retry send timeout',
      );
      this.transportMetrics.sentFrames += 1;
      this.transportMetrics.sentBytes += bytes;
      neighbor.connected = true;
      if (decision.frameClass === 'third-party' || decision.frameClass === 'discovery-gossip') {
        this.forwardingPolicy.recordForwarded(context.routeId, bytes);
      }
      return true;
    } catch {
      neighbor.connected = false;
      return false;
    }
  }

  private forwardingContext(neighborUserId: string): ForwardingContext {
    return this.opts.getForwardingContext?.(neighborUserId) ?? {
      routeId: `mesh:${neighborUserId}`,
      interface: 'wifi',
      lowBattery: false,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async handleNearbyGossip(fromUserId: string, fromPub: string, payload: P2PNearbyGossipPayload): Promise<void> {
    if (payload.replyTo) {
      this.gossipWaiters.get(payload.replyTo)?.(payload.message);
      return;
    }
    const reply = await this.opts.onNearbyGossip?.(fromUserId, fromPub, payload.message);
    if (!reply || typeof reply !== 'object') return;
    const neighbor = this.neighbors.get(fromUserId);
    if (!neighbor) return;
    const frame = await this.buildFrame('nearby-gossip', {
      requestId: randomId('gossip'),
      replyTo: payload.requestId,
      message: reply as Record<string, unknown>,
    }, { recipientUserId: fromUserId, ttlHops: 1 });
    this.rememberSeen(frame.msgId);
    await this.sendFrameToNeighbor(neighbor, frame);
  }

  private async handleRemoteFrame(fromUserId: string, frame: P2PMeshFrame): Promise<void> {
    if (!frame || frame.version !== 1 || !frame.msgId || !frame.roomId) return;
    // During an ordered switch `leaveRoom()` deliberately creates a no-room interval. Accepting
    // a frame in that interval made a just-left room leak into the next one on real hardware.
    if (!this.currentRoomId || frame.roomId !== this.currentRoomId) return;
    this.transportMetrics.receivedFrames += 1;
    this.transportMetrics.receivedBytes += new TextEncoder().encode(JSON.stringify(frame)).byteLength;
    if (this.seen.has(frame.msgId) || this.verifyingFrameIds.has(frame.msgId)) {
      this.transportMetrics.duplicateFramesReceived += 1;
      if (frame.kind === 'talk-body') this.transportMetrics.duplicateTalkBodiesReceived += 1;
      return;
    }
    this.verifyingFrameIds.add(frame.msgId);
    try {
      if (!(await this.verifyOrigin(frame))) return;
      const directNeighbor = this.neighbors.get(fromUserId);
      if (frame.originUserId === fromUserId && directNeighbor && frame.originPub !== directNeighbor.pub) return;
      if (isProtocolManifestControlKind(frame.kind)) {
        // Manifest exchange is deliberately one-hop. A relayed public manifest is fine, but the
        // receiver asks its direct neighbor for it and verifies the chain itself.
        if (frame.originUserId !== fromUserId || frame.recipientUserId !== this.opts.localUserId) return;
      } else if (this.protocolManifestController) {
        if (!this.protocolManifestController.isRoomExchangeAllowed()) return;
        const localManifest = this.protocolManifestController.summary();
        if (
          !frame.protocolManifest
          || frame.protocolManifest.networkId !== localManifest.networkId
          || frame.protocolManifest.sequence !== localManifest.sequence
          || frame.protocolManifest.manifestHash !== localManifest.manifestHash
          || !this.manifestReadyPeerIds.has(fromUserId)
        ) {
          const neighbor = this.neighbors.get(fromUserId);
          if (neighbor) void this.sendProtocolManifestSummary(neighbor);
          return;
        }
      }
      this.rememberSeen(frame.msgId);

      const addressedToMe = !frame.recipientUserId || frame.recipientUserId === this.opts.localUserId;
      if (addressedToMe) {
        await this.handleLocalFrame(fromUserId, frame);
      }

      if (frame.recipientUserId === this.opts.localUserId) return;
      await this.forwardFrame(frame, fromUserId);
    } finally {
      this.verifyingFrameIds.delete(frame.msgId);
    }
  }

  private async handleLocalFrame(fromUserId: string, frame: P2PMeshFrame): Promise<void> {
    if (frame.kind === 'protocol-manifest-summary' && isP2PProtocolManifestSummaryPayload(frame.payload)) {
      await this.handleProtocolManifestSummary(fromUserId, frame.payload);
      return;
    }

    if (frame.kind === 'protocol-manifest-request' && isP2PProtocolManifestRequestPayload(frame.payload)) {
      await this.handleProtocolManifestRequest(fromUserId, frame.payload);
      return;
    }

    if (frame.kind === 'protocol-manifest-chain' && isP2PProtocolManifestChainPayload(frame.payload)) {
      await this.handleProtocolManifestChain(fromUserId, frame.payload);
      return;
    }

    if (frame.kind === 'mesh-ping') {
      // Pass frame.originUserId (the cryptographically-verified ping originator) rather than
      // fromUserId (the immediate relay neighbor) so callers always see who sent the ping,
      // regardless of how many hops it took to arrive (spec §23.4 "origin identity").
      await this.opts.onPing?.(frame.originUserId, frame);
      if (frame.originUserId !== this.opts.localUserId) {
        const pong = await this.buildFrame('mesh-pong', { msgId: frame.msgId }, {
          recipientUserId: frame.originUserId,
          ttlHops: 8,
        });
        await this.rememberAndFanout(pong);
      }
      return;
    }

    if (frame.kind === 'mesh-pong') {
      // R5: surface inbound pong so the app can record reachability for durable E2E assertion.
      // Pass frame.originUserId (the pong sender, cryptographically verified) rather than
      // fromUserId (may be a relay hop in a sparse topology).
      await this.opts.onPong?.(frame.originUserId, frame);
      return;
    }

    if (frame.kind === 'ack') {
      const acknowledgedMsgId = String((frame.payload as { msgId?: unknown }).msgId || '');
      if (acknowledgedMsgId) this.recordAck(acknowledgedMsgId, frame.originUserId);
      return;
    }

    if (frame.kind === 'nearby-gossip' && isP2PNearbyGossipPayload(frame.payload)) {
      // One hop only, between the two ends of a direct link.
      if (frame.originUserId !== fromUserId || frame.recipientUserId !== this.opts.localUserId) return;
      await this.handleNearbyGossip(fromUserId, frame.originPub, frame.payload);
      return;
    }

    if (frame.kind === 'talk-announce') {
      const payload = frame.payload as P2PMeshTalkAnnouncePayload;
      if (payload.authorId === this.opts.localUserId) return;
      const offerKey = talkRevisionDeliveryKey(String(payload.talkId || ''), String(payload.authorId || ''), payload.contentHash);
      if (this.deliveredTalkBodyIds.has(offerKey)) {
        // This ACK is safe: the receiver already has a durable accepted copy. It lets an author
        // recover when the earlier body ACK was lost before the local outbox could be cleared.
        await this.acknowledge(frame);
        return;
      }
      // Over the receiving limit (Talks from strangers per minute): leave the offer unanswered,
      // not refused, so the sender's outbox offers it again later.
      if (this.opts.admitTalkOffer && !this.opts.admitTalkOffer(String(payload.authorId || ''))) return;
      // Step 2: fire announce callback before body pull so callers can record receipt
      // for durable diagnostics (e.g. E2E meshAnnounceDiagnostics) without waiting for
      // the talk-body-request/talk-body round-trip.
      const accepted = await this.opts.onTalkAnnounce?.(payload, frame);
      if (accepted === false) {
        this.rejectedTalkOfferIds.add(offerKey);
        return;
      }
      this.rejectedTalkOfferIds.delete(offerKey);
      this.scheduleTalkBodyRequest(payload);
      return;
    }

    if (frame.kind === 'talk-body-request') {
      await this.handleTalkBodyRequest(frame, frame.payload as P2PMeshTalkBodyRequestPayload);
      return;
    }

    if (frame.kind === 'talk-body' && isP2PMeshTalkBodyPayload(frame.payload)) {
      const talkId = String(frame.payload.talkId || '');
      const deliveryKey = talkRevisionDeliveryKey(talkId, String(frame.payload.authorId || ''), frame.payload.contentHash);
      if (this.rejectedTalkOfferIds.has(deliveryKey)) return;
      const pendingTimer = talkId ? this.pendingTalkBodyRequestTimers.get(deliveryKey) : undefined;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.pendingTalkBodyRequestTimers.delete(deliveryKey);
      }
      if (frame.payload.requestId) {
        const waiter = this.bodyRequestWaiters.get(frame.payload.requestId);
        if (waiter) {
          this.bodyRequestWaiters.delete(frame.payload.requestId);
          waiter(frame.payload);
        }
      }
      if (talkId && this.deliveredTalkBodyIds.has(deliveryKey)) {
        this.transportMetrics.duplicateTalkBodiesReceived += 1;
        console.log(`[BODY-RECV] talk=${talkId.slice(-8)} dup-ack (already delivered)`);
        await this.acknowledge(frame);
        return;
      }
      const accepted = await this.opts.onTalkBody?.(frame.payload);
      console.log(`[BODY-RECV] talk=${talkId.slice(-8)} accepted=${accepted !== false}`);
      if (accepted === false) {
        // Receiver did NOT accept this body — e.g. a filter/membership read that timed out under
        // saturation, or a receiver not yet fully bootstrapped. Do not acknowledge: an ACK tells
        // the sender delivery succeeded and suppresses its flood-retry + mailbox fallback, which
        // permanently drops the body (the sender reports "delivered to N" while the receiver never
        // got it — the M4 saturation gap). Staying silent lets the sender re-deliver: bounded flood
        // re-attempts, then a mailbox post the receiver drains. A transient reject thus gets another
        // chance; a permanent reject (genuine filter) is simply re-offered a bounded number of times
        // and still never stored, so filtered talks stay filtered.
        return;
      }
      if (talkId) {
        this.transportMetrics.logicalTalkBodiesAccepted += 1;
        this.deliveredTalkBodyIds.add(deliveryKey);
        this.cacheTalkBody(talkId, {
          ...frame.payload.talkData,
          id: talkId,
          authorId: frame.payload.authorId,
          authorName: frame.payload.authorName,
          ...(frame.payload.authorEpub ? { authorEpub: frame.payload.authorEpub } : {}),
        });
      }
      await this.acknowledge(frame);
      return;
    }

    if (frame.kind === 'talk-response' && isP2PMeshTalkResponsePayload(frame.payload)) {
      await this.opts.onTalkResponse?.(frame.payload);
      await this.acknowledge(frame);
      return;
    }

    if (frame.kind === 'talk-retracted' && isP2PMeshTalkRetractedPayload(frame.payload)) {
      // Step 10: only the talk's own author may retract it (guard against spoofing).
      // The frame was already signature-verified in handleRemoteFrame; the extra check
      // here ensures originUserId === authorId at the application layer.
      if (frame.originUserId !== frame.payload.authorId) {
        console.warn(
          `[Retraction] Rejected frame from ${frame.originUserId}: authorId mismatch (${frame.payload.authorId})`,
        );
        return;
      }
      await this.opts.onTalkRetracted?.(frame.payload);
    }
  }

  private async sendProtocolManifestSummary(neighbor: Neighbor): Promise<void> {
    const controller = this.protocolManifestController;
    if (!controller || !isNeighborLive(neighbor)) return;
    const payload: P2PProtocolManifestSummaryPayload = {
      ...controller.summary(),
      peerReady: this.manifestReadyPeerIds.has(neighbor.userId),
    };
    const frame = await this.buildFrame('protocol-manifest-summary', payload, {
      recipientUserId: neighbor.userId,
      ttlHops: 1,
    });
    this.rememberSeen(frame.msgId);
    await this.sendFrameToNeighbor(neighbor, frame);
  }

  private async sendProtocolManifestControl(
    neighborUserId: string,
    kind: 'protocol-manifest-request' | 'protocol-manifest-chain',
    payload: P2PProtocolManifestRequestPayload | P2PProtocolManifestChainPayload,
  ): Promise<void> {
    const neighbor = this.neighbors.get(neighborUserId);
    if (!neighbor || !isNeighborLive(neighbor)) return;
    const frame = await this.buildFrame(kind, payload, { recipientUserId: neighborUserId, ttlHops: 1 });
    this.rememberSeen(frame.msgId);
    await this.sendFrameToNeighbor(neighbor, frame);
  }

  private async handleProtocolManifestSummary(
    fromUserId: string,
    remote: P2PProtocolManifestSummaryPayload,
  ): Promise<void> {
    const controller = this.protocolManifestController;
    if (!controller) return;
    const local = controller.summary();
    if (remote.networkId !== local.networkId) {
      const firstRejection = !this.manifestRejectedPeerIds.has(fromUserId);
      this.manifestRejectedPeerIds.add(fromUserId);
      this.manifestReadyPeerIds.delete(fromUserId);
      const neighbor = this.neighbors.get(fromUserId);
      if (firstRejection && neighbor) await this.sendProtocolManifestSummary(neighbor);
      return;
    }
    if (remote.sequence === local.sequence) {
      if (remote.manifestHash === local.manifestHash) {
        this.manifestRejectedPeerIds.delete(fromUserId);
        this.markManifestReady(fromUserId);
        // Readiness is one-way: this marks the sender ready here, but the sender counts us only once
        // it hears our summary. It may never have (it announced before our link existed), or it may
        // have forgotten us (it restarted its room after accepting a manifest and cleared its ready
        // set while our link looked unchanged); either way it would hold all our room traffic (two
        // phones, 2026-10-16). Answer unless it says it already counts us. Older releases never say
        // so and never answer, so the exchange ends there too.
        const neighbor = this.neighbors.get(fromUserId);
        if (remote.peerReady !== true && neighbor) await this.sendProtocolManifestSummary(neighbor);
      } else {
        const firstRejection = !this.manifestRejectedPeerIds.has(fromUserId);
        this.manifestRejectedPeerIds.add(fromUserId);
        this.manifestReadyPeerIds.delete(fromUserId);
        const neighbor = this.neighbors.get(fromUserId);
        if (firstRejection && neighbor) await this.sendProtocolManifestSummary(neighbor);
      }
      return;
    }
    this.manifestReadyPeerIds.delete(fromUserId);
    if (remote.sequence > local.sequence) {
      await this.sendProtocolManifestControl(fromUserId, 'protocol-manifest-request', {
        networkId: local.networkId,
        sequence: local.sequence,
        manifestHash: local.manifestHash,
      });
      return;
    }
    const suffix = controller.manifestSuffixAfter(remote.sequence, remote.manifestHash);
    if (!suffix) {
      this.manifestRejectedPeerIds.add(fromUserId);
      return;
    }
    await this.sendProtocolManifestControl(fromUserId, 'protocol-manifest-chain', {
      networkId: local.networkId,
      afterSequence: remote.sequence,
      afterManifestHash: remote.manifestHash,
      manifests: suffix,
    });
  }

  private async handleProtocolManifestRequest(
    fromUserId: string,
    request: P2PProtocolManifestRequestPayload,
  ): Promise<void> {
    const controller = this.protocolManifestController;
    if (!controller || request.networkId !== controller.summary().networkId) return;
    const suffix = controller.manifestSuffixAfter(request.sequence, request.manifestHash);
    if (!suffix) {
      this.manifestRejectedPeerIds.add(fromUserId);
      return;
    }
    await this.sendProtocolManifestControl(fromUserId, 'protocol-manifest-chain', {
      networkId: request.networkId,
      afterSequence: request.sequence,
      afterManifestHash: request.manifestHash,
      manifests: suffix,
    });
  }

  private async handleProtocolManifestChain(
    fromUserId: string,
    payload: P2PProtocolManifestChainPayload,
  ): Promise<void> {
    const controller = this.protocolManifestController;
    if (!controller) return;
    const before = controller.summary();
    if (
      payload.networkId !== before.networkId
      || payload.afterSequence !== before.sequence
      || payload.afterManifestHash !== before.manifestHash
    ) {
      const neighbor = this.neighbors.get(fromUserId);
      if (neighbor) await this.sendProtocolManifestSummary(neighbor);
      return;
    }
    const result = await controller.acceptManifestSuffix(payload.manifests);
    if (!result.ok) {
      this.manifestRejectedPeerIds.add(fromUserId);
      this.manifestReadyPeerIds.delete(fromUserId);
      return;
    }
    this.manifestReadyPeerIds.clear();
    this.manifestRejectedPeerIds.delete(fromUserId);
    this.markManifestReady(fromUserId);
    const compatibility = controller.currentCompatibility();
    await this.opts.onProtocolManifestCompatibility?.(compatibility, fromUserId);
    await Promise.all([...this.neighbors.values()].map((neighbor) => this.sendProtocolManifestSummary(neighbor)));
  }

  private scheduleTalkBodyRequest(announce: P2PMeshTalkAnnouncePayload): void {
    const talkId = String(announce.talkId || '');
    const deliveryKey = talkRevisionDeliveryKey(talkId, String(announce.authorId || ''), announce.contentHash);
    if (!talkId || this.deliveredTalkBodyIds.has(deliveryKey) || this.pendingTalkBodyRequestTimers.has(deliveryKey)) return;
    const timer = setTimeout(() => {
      this.pendingTalkBodyRequestTimers.delete(deliveryKey);
      if (this.deliveredTalkBodyIds.has(deliveryKey)) return;
      void this.requestTalkBody(announce);
    }, 250);
    this.pendingTalkBodyRequestTimers.set(deliveryKey, timer);
  }

  private async requestTalkBody(announce: P2PMeshTalkAnnouncePayload): Promise<void> {
    const requestId = randomId('body_req');
    const requestPayload: P2PMeshTalkBodyRequestPayload = {
      requestId,
      roomId: announce.roomId,
      broadcastAt: announce.broadcastAt,
      talkId: announce.talkId,
      authorId: announce.authorId,
      ...(announce.contentHash ? { contentHash: announce.contentHash } : {}),
    };
    const frame = await this.buildFrame('talk-body-request', requestPayload, {
      recipientUserId: announce.authorId,
      ttlHops: 8,
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.bodyRequestWaiters.delete(requestId);
        resolve();
      }, 8_000);
      this.bodyRequestWaiters.set(requestId, () => {
        clearTimeout(timer);
        resolve();
      });
      void this.rememberAndFanout(frame).catch(() => {
        clearTimeout(timer);
        this.bodyRequestWaiters.delete(requestId);
        resolve();
      });
    });
  }

  private async handleTalkBodyRequest(
    requestFrame: P2PMeshFrame,
    request: P2PMeshTalkBodyRequestPayload,
  ): Promise<void> {
    if (request.authorId !== this.opts.localUserId) return;
    if (this.directTalkOutbox) {
      const entry = (await this.directTalkOutbox.list(request.roomId)).find((candidate) =>
        candidate.recipientUserId === requestFrame.originUserId
        && candidate.talkId === request.talkId
        && (!request.contentHash || candidate.contentHash === request.contentHash));
      if (!entry) return;
      const bodyPayload: P2PMeshTalkBodyPayload = {
        ...entry.payload,
        requestId: request.requestId,
      };
      const frame = await this.buildFrame('talk-body', bodyPayload, {
        recipientUserId: requestFrame.originUserId,
        ttlHops: 1,
      });
      const acknowledged = await this.sendAndWaitForAcks(frame, [requestFrame.originUserId]);
      if (acknowledged.has(requestFrame.originUserId)) {
        await this.completeDirectTalkDelivery(bodyPayload, requestFrame.originUserId);
      }
      return;
    }
    // Serve the local user's OWN authored copy (talkId::localUserId). A remote author's
    // identical-content body must never be served here under our authorId.
    const talkData = this.getCachedTalkBody(request.talkId, this.opts.localUserId);
    if (!talkData) return;
    const pair = this.gunService.getStoredPair();
    const bodyPayload: P2PMeshTalkBodyPayload = {
      requestId: request.requestId,
      roomId: request.roomId,
      broadcastAt: request.broadcastAt,
      talkId: request.talkId,
      authorId: this.opts.localUserId,
      authorName: this.opts.localStageName,
      ...(pair?.epub ? { authorEpub: String(pair.epub) } : {}),
      title: String(talkData.title || 'Untitled Talk'),
      ...(typeof talkData.type === 'string' ? { type: String(talkData.type) } : {}),
      questionCount: Array.isArray(talkData.questions) ? talkData.questions.length : 0,
      ...contentHashField(talkData),
      talkData,
    };
    const frame = await this.buildFrame('talk-body', bodyPayload, {
      recipientUserId: requestFrame.originUserId,
      ttlHops: 8,
    });
    await this.rememberAndFanout(frame);
  }

  private async flushDirectTalkOutbox(): Promise<Set<string>> {
    if (!this.directTalkOutbox || !this.currentRoomId) return new Set();
    if (this.directOutboxFlush) return this.directOutboxFlush;
    const run = this.flushDirectTalkOutboxNow();
    this.directOutboxFlush = run;
    try {
      return await run;
    } finally {
      if (this.directOutboxFlush === run) this.directOutboxFlush = null;
    }
  }

  private async flushDirectTalkOutboxNow(): Promise<Set<string>> {
    const outbox = this.directTalkOutbox;
    const roomId = this.currentRoomId;
    if (!outbox || !roomId) return new Set();
    const now = this.opts.now?.() ?? Date.now();
    const queuedEntries = await outbox.list(roomId);
    if (roomId === this.currentRoomId) {
      this.queuedDirectTalks.clear();
      for (const entry of queuedEntries) this.queuedDirectTalks.add(`${entry.recipientUserId}|${entry.talkId}`);
    }
    const entries = queuedEntries.filter((entry) => {
      const neighbor = this.neighbors.get(entry.recipientUserId);
      if (!neighbor || !isNeighborLive(neighbor)) return false;
      if (this.protocolManifestController && !this.manifestReadyPeerIds.has(entry.recipientUserId)) return false;
      const lastAttemptAt = Date.parse(String(entry.lastAttemptAt || ''));
      return !Number.isFinite(lastAttemptAt) || now - lastAttemptAt >= DIRECT_DELIVERY_RETRY_INTERVAL_MS;
    }).slice(0, DIRECT_FLUSH_CONCURRENCY * 4);
    const acknowledged = new Set<string>();
    await mapWithConcurrency(entries, DIRECT_FLUSH_CONCURRENCY, async (entry) => {
      try {
        await outbox.markAttempt(entry.key);
        const frame = await this.buildFrame('talk-announce', this.announceFromOutbox(entry), {
          recipientUserId: entry.recipientUserId,
          ttlHops: 1,
        });
        this.directOfferMsgIds.set(entry.key, frame.msgId);
        const acks = await this.sendAndWaitForAcks(frame, [entry.recipientUserId]);
        if (!acks.has(entry.recipientUserId)) return;
        acknowledged.add(entry.recipientUserId);
        this.adjustPersonalConcurrency(true);
        await this.completeDirectTalkDelivery(entry.payload, entry.recipientUserId);
      } catch (error) {
        console.warn('[direct-talk] queued delivery attempt failed:', error);
      } finally {
        this.directOfferMsgIds.delete(entry.key);
      }
    });
    return acknowledged;
  }

  private announceFromOutbox(entry: DirectTalkDeliveryEntry): P2PMeshTalkAnnouncePayload {
    const { talkData: _talkData, requestId: _requestId, ...announce } = entry.payload;
    return announce;
  }

  private async completeDirectTalkDelivery(
    payload: P2PMeshTalkBodyPayload,
    recipientUserId: string,
  ): Promise<void> {
    if (!this.directTalkOutbox) return;
    const removed = await this.directTalkOutbox.acknowledge({
      roomId: payload.roomId,
      recipientUserId,
      talkId: payload.talkId,
      ...(payload.contentHash ? { contentHash: payload.contentHash } : {}),
    });
    for (const entry of removed) {
      if (entry.roomId === this.currentRoomId) this.queuedDirectTalks.delete(`${entry.recipientUserId}|${entry.talkId}`);
      const offerMsgId = this.directOfferMsgIds.get(entry.key);
      if (offerMsgId) this.recordAck(offerMsgId, recipientUserId);
      await this.opts.onTalkDeliveryAck?.(entry.payload, recipientUserId);
    }
  }
}
