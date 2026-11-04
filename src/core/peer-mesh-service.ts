import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
} from '../shared/p2p-runtime';
import {
  isP2PProtocolManifestChainPayload,
  isP2PProtocolManifestRequestPayload,
  isP2PProtocolManifestSummaryPayload,
  isP2PNearbyGossipPayload,
  isP2PGraphGunPayload,
  isProtocolManifestControlKind,
  p2pMeshFrameSigningPayload,
  type P2PMeshFrame,
  type P2PMeshFramePayload,
  type P2PProtocolManifestChainPayload,
  type P2PProtocolManifestRequestPayload,
  type P2PProtocolManifestSummaryPayload,
  type P2PNearbyGossipPayload,
} from '../shared/p2p-mesh-protocol';
import { GRAPH_GUN_MAX_RAW } from '../shared/p2p-mesh-protocol';
import type { ProtocolManifestCompatibility } from '../shared/protocol-manifest';
import { ProtocolManifestController } from '../shared/protocol-manifest-controller';
import type { MeshIdentity } from './ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../shared/techsupport';
import {
  MeshForwardingPolicy,
  type ForwardingContext,
  type ForwardingSettings,
} from '../shared/mesh-forwarding-policy';

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

export type MeshSession = {
  ensureConnected: () => Promise<void>;
  /** Live transport state when the session exposes it (WebRTC sessions do). */
  getState?: () => string;
  sendMeshFrame: (frame: P2PMeshFrame) => Promise<void>;
  setOnRemoteMeshFrame: (hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => void;
  dispose?: () => void;
};

export type PeerMeshServiceOptions = {
  apiBase: string;
  localUserId: string;
  localStageName: string;
  sendTimeoutMs?: number;
  retryTimeoutMs?: number;
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
  onPing?: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  /** R5: fired when a mesh-pong addressed to us arrives; enables durable E2E reachability assertion. */
  onPong?: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  forwardingSettings?: Partial<ForwardingSettings>;
  getForwardingContext?: (neighborUserId: string) => ForwardingContext;
  protocolManifestController?: ProtocolManifestController;
  onProtocolManifestCompatibility?: (
    compatibility: ProtocolManifestCompatibility,
    sourceUserId: string,
  ) => void | Promise<void>;
  /** A direct link to a room neighbor just came up (WebRTC over LAN, Wi-Fi Direct or relay). */
  onNeighborConnected?: (userId: string, roomId: string) => void;
  /** A frame addressed to one person goes only over a direct link to them, never through others. */
  authoritativeDirectTalkDelivery?: boolean;
  now?: () => number;
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
  /** A Nearby v3 gossip message from a direct neighbor; the returned message is sent back. */
  onNearbyGossip?: (fromUserId: string, fromPub: string, message: Record<string, unknown>) => Promise<unknown>;
  /** A device graph Gun message from a direct neighbor (`graph-gun` frame, one hop). */
  onGraphGun?: (fromUserId: string, fromPub: string, raw: string) => void;
  /** A direct link went down or was replaced (the graph link closes with it). */
  onNeighborDisconnected?: (userId: string) => void;
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
/**
 * Outside a personal list (Contacts only: a DM warm-up, the recipients of a Talk) the mesh links to
 * the members it was given, at most this many at once.
 */
const MAX_EXPLICIT_LINKS = 64;
/** Nearby v3: a new link may fail to connect for this long while the other side answers the knock. */
const PERSONAL_CONNECT_GRACE_MS = 8_000;
/** A link opened for one reason (an answer, a direct send) stays this long; we wait this long for it. */
const PERSONAL_RESPONSE_PIN_MS = 60_000;
const PERSONAL_RESPONSE_CONNECT_MS = 15_000;
/** After giving up on a person, the broadcast loop leaves them to the mailbox for this long. */
const PERSONAL_GAVE_UP_COOLDOWN_MS = 5 * 60_000;

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
  /** A neighbor may carry room traffic only after both sides report the same verified checkpoint. */
  private readonly manifestReadyPeerIds = new Set<string>();
  private readonly manifestRejectedPeerIds = new Set<string>();
  private readonly forwardingPolicy: MeshForwardingPolicy;
  private protocolManifestController: ProtocolManifestController | undefined;
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
    private readonly gunService: MeshIdentity,
    private readonly opts: PeerMeshServiceOptions,
  ) {
    this.forwardingPolicy = new MeshForwardingPolicy(opts.forwardingSettings);
    this.protocolManifestController = opts.protocolManifestController;
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

  /** People with Talks waiting for them: my device graph log entries they have not read. */
  private pendingRecipients(): Set<string> {
    return new Set<string>(this.graphOwed);
  }

  /**
   * OPEN-106: the people my device graph log has entries for that they have not read. Like Talks
   * in the outbox, each is a reason to open a link (Nearby v3 opens links only for a reason).
   */
  private graphOwed = new Set<string>();
  setGraphOwed(userIds: string[]): void {
    const next = new Set(userIds.filter((id) => id && id !== this.opts.localUserId));
    const added = [...next].filter((id) => !this.graphOwed.has(id));
    const read = [...this.graphOwed].filter((id) => !next.has(id));
    this.graphOwed = next;
    // Each person who read what I owed them is a delivered Talk: the Nearby loop may widen.
    for (const _ of read) this.adjustPersonalConcurrency(true);
    if ((added.length || read.length) && this.currentRoomId) void this.reconcileNeighbors().then(() => this.scheduleReconcile()).catch(() => undefined);
  }

  /** The current room's members (not me). */
  roomMemberIds(): string[] {
    return [...this.currentRoomMemberIds].filter((id) => id !== this.opts.localUserId);
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
  }

  private notifyNeighborDisconnected(userId: string): void {
    try {
      this.opts.onNeighborDisconnected?.(userId);
    } catch (error) {
      console.warn('[mesh] neighbor-disconnected handler failed:', error);
    }
  }

  /**
   * Send one device graph Gun message to a direct neighbor (one hop). False when there is no live
   * link to them: nothing is queued, because nothing is exchanged while two people are apart (D2).
   */
  async sendGraphGun(toUserId: string, raw: string): Promise<boolean> {
    const neighbor = this.neighbors.get(toUserId);
    if (!neighbor || !isNeighborLive(neighbor) || !raw || raw.length > GRAPH_GUN_MAX_RAW) return false;
    const frame = await this.buildFrame('graph-gun', { raw }, { recipientUserId: toUserId, ttlHops: 1 });
    this.rememberSeen(frame.msgId);
    return this.sendFrameToNeighbor(neighbor, frame);
  }

  /** A direct neighbor's signing key, as its frames proved it. */
  neighborPub(userId: string): string | undefined {
    return this.neighbors.get(userId)?.pub || undefined;
  }

  /** Direct neighbors whose link is up and manifest-ready (graph links open for these). */
  liveNeighborIds(): string[] {
    return [...this.neighbors.values()].filter((n) => isNeighborLive(n) && this.manifestReadyPeerIds.has(n.userId)).map((n) => n.userId);
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
    if (this.neighbors.has(userId)) this.notifyNeighborDisconnected(userId);
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
      })
      .catch(() => {
        // A WebRTC reconnect can retire one promise while a coordinated replacement is already
        // connecting on the same session. Treating that expected rejection as an unreachable
        // personal peer twice dropped the neighbor and disposed the replacement underneath its
        // caller. The transport state is authoritative here: only a genuinely failed/idle session
        // should consume the personal-peer failure budget.
        const replacementState = neighbor.session.getState?.();
        if (replacementState === 'connected') {
          neighbor.connected = true;
          return;
        }
        neighbor.connected = false;
        if (replacementState === 'connecting') {
          this.scheduleReconcile(500);
          return;
        }
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
    this.manifestReadyPeerIds.clear();
    this.manifestRejectedPeerIds.clear();
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
    // The host supplies the transport: the GUI's WebRTC adapter today (src/web/services/
    // peer-mesh-service.ts), the native process's own later; libp2p and tests pass theirs.
    if (!this.opts.createSession) throw new Error('Peer mesh needs a session factory from its host');
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
    const candidateTargets = this.opts.authoritativeDirectTalkDelivery && frame.recipientUserId
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

    if (frame.kind === 'graph-gun' && isP2PGraphGunPayload(frame.payload)) {
      // One hop only, between the two ends of a direct link.
      if (frame.originUserId !== fromUserId || frame.recipientUserId !== this.opts.localUserId) return;
      this.opts.onGraphGun?.(fromUserId, frame.originPub, frame.payload.raw);
      return;
    }

    if (frame.kind === 'nearby-gossip' && isP2PNearbyGossipPayload(frame.payload)) {
      // One hop only, between the two ends of a direct link.
      if (frame.originUserId !== fromUserId || frame.recipientUserId !== this.opts.localUserId) return;
      await this.handleNearbyGossip(fromUserId, frame.originPub, frame.payload);
      return;
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

}
