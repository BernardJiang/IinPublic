import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
} from '../../shared/p2p-runtime';
import {
  isP2PMeshTalkBodyPayload,
  isP2PMeshTalkResponsePayload,
  p2pMeshFrameSigningPayload,
  type P2PMeshFrame,
  type P2PMeshFramePayload,
  type P2PMeshTalkAnnouncePayload,
  type P2PMeshTalkBodyPayload,
  type P2PMeshTalkBodyRequestPayload,
  type P2PMeshTalkResponsePayload,
} from '../../shared/p2p-mesh-protocol';
import type { Talk } from '../../shared/types';
import type { WebGunService } from './web-gun-service';
import { getOrCreateP2PSession } from './p2p-webrtc-session';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';

type RoomMember = {
  userId: string;
  stageName?: string;
};

type MeshSession = {
  ensureConnected: () => Promise<void>;
  sendMeshFrame: (frame: P2PMeshFrame) => Promise<void>;
  setOnRemoteMeshFrame: (hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => void;
};

type PeerMeshServiceOptions = {
  apiBase: string;
  localUserId: string;
  localStageName: string;
  maxNeighbors?: number;
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
  // Returns false when the receiver rejected the talk (e.g. intake/age filtering) so the
  // caller can leave it eligible for re-delivery; any other return is treated as accepted.
  onTalkBody?: (payload: P2PMeshTalkBodyPayload) => boolean | void | Promise<boolean | void>;
  onTalkResponse?: (payload: P2PMeshTalkResponsePayload) => void | Promise<void>;
  onPing?: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  /** R5: fired when a mesh-pong addressed to us arrives; enables durable E2E reachability assertion. */
  onPong?: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  /**
   * Step 2: fired when a `talk-announce` frame arrives addressed to this peer (or flood).
   * Fires before the body request is scheduled, so callers can record receipt for E2E
   * diagnostics without waiting for the full body pull to complete.
   */
  onTalkAnnounce?: (payload: P2PMeshTalkAnnouncePayload, frame: P2PMeshFrame) => void | Promise<void>;
};

type Neighbor = {
  userId: string;
  stageName: string;
  pub: string;
  session: MeshSession;
  connected: boolean;
};

const DEFAULT_MESH_SEND_TIMEOUT_MS = 2_500;
const DEFAULT_MESH_RETRY_TIMEOUT_MS = 10_000;
const MESH_TALK_BODY_RENDEZVOUS_ROOT = 'p2pMeshTalkBodies';

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
  private readonly neighbors = new Map<string, Neighbor>();
  /** R4: bounded FIFO dedup cache; cleared on leaveRoom (spec §23.8). */
  private readonly seen = new BoundedFifoSet(SEEN_SET_MAX_SIZE);
  private readonly talkBodies = new Map<string, Record<string, unknown>>();
  private readonly deliveredTalkBodyIds = new Set<string>();
  private readonly pendingTalkBodyRequestTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly bodyRequestWaiters = new Map<string, (payload: P2PMeshTalkBodyPayload) => void>();
  private roomTalkBodySubscriptionRoomId: string | null = null;
  private roomTalkBodySubscriptionOff: (() => void) | null = null;

  constructor(
    private readonly gunService: WebGunService,
    private readonly opts: PeerMeshServiceOptions,
  ) {}

  getDiagnostics(): {
    roomId: string | null;
    neighborCount: number;
    connectedNeighborCount: number;
    seenCount: number;
    cachedTalkBodies: number;
  } {
    return {
      roomId: this.currentRoomId,
      neighborCount: this.neighbors.size,
      connectedNeighborCount: [...this.neighbors.values()].filter((n) => n.connected).length,
      seenCount: this.seen.size,
      cachedTalkBodies: this.talkBodies.size,
    };
  }

  async waitForConnectedNeighbor(userId: string, timeoutMs = 6_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const neighbor = this.neighbors.get(userId);
      if (neighbor?.connected) return true;
      if (neighbor) {
        try {
          await Promise.race([
            neighbor.session.ensureConnected(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('mesh neighbor wait timeout')), 750)),
          ]);
          neighbor.connected = true;
          return true;
        } catch {
          neighbor.connected = false;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return this.neighbors.get(userId)?.connected === true;
  }

  /**
   * R2: Extract neighbor selection into its own method so step ≥2 can swap in
   * `scoreP2PNeighbor`-based ranking without touching gossip/dedup/forwarding.
   * For v1 keeps deterministic `localeCompare` sort (reproducible E2E).
   */
  private selectNeighbors(members: RoomMember[], K: number): RoomMember[] {
    return members
      .filter((member) => member.userId && member.userId !== this.opts.localUserId && member.userId !== TECHSUPPORT_ROOT_USER_ID)
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .slice(0, K);
    // TODO step ≥2: swap body for scoreP2PNeighbor-based ranking (spec §23.7)
  }

  async joinRoom(roomId: string, members: RoomMember[]): Promise<void> {
    this.currentRoomId = roomId;
    this.subscribeToRoomTalkBodyRendezvous(roomId);
    this.currentRoomMemberIds = new Set(
      members
        .map((member) => member.userId)
        .filter((userId) => userId && userId !== this.opts.localUserId && userId !== TECHSUPPORT_ROOT_USER_ID),
    );
    const local = this.localIdentity();
    const maxNeighbors = this.opts.maxNeighbors ?? 12;
    const candidates = this.selectNeighbors(members, maxNeighbors);

    const wanted = new Set(candidates.map((member) => member.userId));
    for (const userId of [...this.neighbors.keys()]) {
      if (!wanted.has(userId)) this.neighbors.delete(userId);
    }

    await Promise.all(candidates.map(async (member) => {
      if (this.neighbors.has(member.userId)) return;
      const pub = await this.resolveUserPub(member.userId);
      if (!pub) return;
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
      this.neighbors.set(member.userId, neighbor);
      session.setOnRemoteMeshFrame((otherUserId, frame) => this.handleRemoteFrame(otherUserId, frame));
      void session.ensureConnected()
        .then(() => {
          neighbor.connected = true;
        })
        .catch(() => {
          neighbor.connected = false;
          // R3: attempt replacement pick on connect failure
          this.onNeighborClosed(member.userId);
        });
    }));
  }

  /**
   * R3: Called when a neighbor's DataChannel closes unexpectedly.
   * Re-runs candidate selection against the current room member list
   * and connects to any newly eligible peer up to maxNeighbors.
   */
  private onNeighborClosed(closedUserId: string): void {
    const roomId = this.currentRoomId;
    if (!roomId) return;
    const neighbor = this.neighbors.get(closedUserId);
    if (neighbor) neighbor.connected = false;
    // Build a synthetic members list from the known room member IDs
    const allMembers: RoomMember[] = [...this.currentRoomMemberIds].map((userId) => ({ userId }));
    const maxNeighbors = this.opts.maxNeighbors ?? 12;
    const candidates = this.selectNeighbors(allMembers, maxNeighbors);
    const wanted = new Set(candidates.map((m) => m.userId));
    // Connect to any candidate we do not currently have a neighbor slot for
    for (const member of candidates) {
      if (this.neighbors.has(member.userId)) continue;
      if (!wanted.has(member.userId)) continue;
      void (async () => {
        const local = this.localIdentity();
        const pub = await this.resolveUserPub(member.userId);
        if (!pub || !this.currentRoomId) return;
        const session = this.createSession({
          roomId: this.currentRoomId,
          localPub: local.pub,
          localPair: local.pair,
          otherUserId: member.userId,
          otherPub: pub,
        });
        const newNeighbor: Neighbor = {
          userId: member.userId,
          stageName: member.stageName || member.userId,
          pub,
          session,
          connected: false,
        };
        this.neighbors.set(member.userId, newNeighbor);
        session.setOnRemoteMeshFrame((otherUserId, frame) => this.handleRemoteFrame(otherUserId, frame));
        void session.ensureConnected()
          .then(() => { newNeighbor.connected = true; })
          .catch(() => { newNeighbor.connected = false; });
      })().catch(() => { /* best-effort re-pick */ });
    }
  }

  leaveRoom(): void {
    this.currentRoomId = null;
    this.currentRoomMemberIds.clear();
    this.neighbors.clear();
    this.seen.clear();
    this.deliveredTalkBodyIds.clear();
    for (const timer of this.pendingTalkBodyRequestTimers.values()) clearTimeout(timer);
    this.pendingTalkBodyRequestTimers.clear();
    this.bodyRequestWaiters.clear();
    this.roomTalkBodySubscriptionOff?.();
    this.roomTalkBodySubscriptionOff = null;
    this.roomTalkBodySubscriptionRoomId = null;
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

  async syncRoomTalkBodyRendezvous(waitMs = 500, roomIdOverride?: string): Promise<void> {
    const roomId = roomIdOverride || this.currentRoomId;
    const gun = this.getGunOrNull();
    if (!roomId || !gun) return;
    const ref = gun.get(MESH_TALK_BODY_RENDEZVOUS_ROOT).get(roomId).map();
    const bodies: unknown[] = [];
    await new Promise<void>((resolve) => {
      ref.once((raw: unknown, key: string) => {
        if (!raw || !key || key.startsWith('_')) return;
        bodies.push(raw);
      });
      setTimeout(resolve, waitMs);
    });
    try {
      ref.off();
    } catch {
      /* ignore */
    }
    await mapWithConcurrency(bodies, 4, async (raw) => {
      await this.handleRendezvousTalkBody(raw);
    });
  }

  async sendPing(text = 'ping'): Promise<string> {
    const frame = await this.buildFrame('mesh-ping', { text }, { ttlHops: 8 });
    await this.rememberAndFanout(frame);
    return frame.msgId;
  }

  async broadcastTalk(
    talk: Talk | Record<string, unknown>,
    opts: { recipientUserIds?: string[]; roomBroadcast?: boolean } = {},
  ): Promise<void> {
    const talkId = String((talk as { id?: unknown }).id || '');
    if (!talkId) throw new Error('mesh broadcast requires talk.id');
    const talkRecord = JSON.parse(JSON.stringify(talk || {})) as Record<string, unknown>;
    this.cacheTalkBody(talkId, talkRecord);
    const pair = this.gunService.getStoredPair();
    const payload: P2PMeshTalkAnnouncePayload = {
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
    };
    const bodyPayload: P2PMeshTalkBodyPayload = {
      ...payload,
      talkData: talkRecord,
    };
    const recipients = [...new Set(opts.recipientUserIds?.filter(Boolean) || [])];
    const recipientSet = new Set(recipients);
    const isWholeKnownRoom =
      recipients.length > 0 &&
      this.currentRoomMemberIds.size > 0 &&
      [...this.currentRoomMemberIds].every((userId) => recipientSet.has(userId));
    const isRoomBroadcast = opts.roomBroadcast === true || isWholeKnownRoom;
    if (recipients.length > 0 && !isRoomBroadcast) {
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
        await this.rememberAndFanout(bodyFrame);
      });
      return;
    }
    const announceFrame = await this.buildFrame('talk-announce', payload, { ttlHops: 8 });
    if (isRoomBroadcast) {
      // Step 2: primary path — flood announce + body over mesh DataChannel overlay.
      // Conditional fallback (interim step-6/7 debt, tracked in R-a): fall back to the Gun
      // p2pMeshTalkBodies/* rendezvous write whenever the broadcast cannot be *guaranteed*
      // to reach every intended room recipient over the DataChannel overlay alone. Two
      // conditions trigger it:
      //
      //   1. Below wanted degree: some wanted neighbors are still connecting (WebRTC
      //      handshake in flight; chatbot/super-user contexts that never call
      //      syncPeerMeshRoom; sequential broadcast sessions where joinRoom fires but
      //      DataChannels are not all ready) — connectedCount < neighbors.size.
      //
      //   2. Sparse overlay can't directly cover the recipient set AND the recipient set is
      //      larger than the degree bound: with a bounded degree K (e.g. e2e K=3) over many
      //      recipients, delivery to the non-neighbor recipients depends on *relay
      //      forwarding* across a sparse, possibly partitioned overlay, which can silently
      //      miss a peer behind a non-bridged link (observed: find-similar-people delivering
      //      exactly 8/9 — one recipient sat in a relay-unreachable component even though the
      //      sender's own K neighbors were all connected, so condition 1 alone did NOT fire).
      //      We only treat this as a coverage gap when the recipient set EXCEEDS the degree
      //      bound (recipients > maxNeighbors): below the bound the overlay can directly hold
      //      every recipient as a neighbor, so a plain relay flood is reliable.
      //
      // Spec 02 is unaffected: it broadcasts over a deliberately sparse K=1 path (Tom→relay→peer)
      // to a 2-member room to PROVE relay forwarding works with zero Gun writes. There
      // maxNeighbors === 1 and recipients are the whole room (size 2), but recipients are NOT
      // passed explicitly (recipientUserIds omitted), so the coverage check uses the room
      // member count only when recipients were given; with no explicit recipients we keep the
      // original below-wanted-degree gate, and Tom waits for his single neighbor to connect
      // (connectedCount === neighbors.size === 1), so neither condition fires and
      // p2pMeshTalkBodies/* == 0 holds.
      //
      // TODO (step 6/7): remove the fallback once all callers gate on a fully connected
      // mesh overlay before broadcasting (or the offline mailbox lands).
      const connectedCount = [...this.neighbors.values()].filter((n) => n.connected).length;
      const maxNeighbors = this.opts.maxNeighbors ?? 12;
      const explicitRecipientCount = recipients.length;
      const belowWantedDegree = connectedCount === 0 || connectedCount < this.neighbors.size;
      // Coverage gap only when the caller named more recipients than the overlay degree bound
      // can hold AND the connected overlay does not already cover them directly. Spec 02 omits
      // recipientUserIds, so explicitRecipientCount === 0 and this branch is skipped there.
      const cannotCoverRecipients =
        explicitRecipientCount > maxNeighbors && connectedCount < explicitRecipientCount;
      if (belowWantedDegree || cannotCoverRecipients) {
        // Fallback: Gun rendezvous write for receivers who cannot be reached over DataChannel.
        this.publishRoomTalkBodyRendezvous(bodyPayload);
        // Still flood the mesh frames in case some neighbor connects shortly after:
        // the retryFrameAfterConnect path will re-attempt delivery to any neighbor
        // whose DataChannel was not yet open when the frame was first forwarded.
        const bodyFrame = await this.buildFrame('talk-body', bodyPayload, { ttlHops: 8 });
        await this.rememberAndFanout(announceFrame);
        await this.rememberAndFanout(bodyFrame);
        return;
      }
      // Primary path: all-mesh, no Gun write (spec 02 invariant preserved).
      const bodyFrame = await this.buildFrame('talk-body', bodyPayload, { ttlHops: 8 });
      await this.rememberAndFanout(announceFrame);
      await this.rememberAndFanout(bodyFrame);
      return;
    }
    const bodyFrame = await this.buildFrame('talk-body', bodyPayload, { ttlHops: 8 });
    await this.rememberAndFanout(announceFrame);
    await this.rememberAndFanout(bodyFrame);
  }

  async sendTalkResponse(payload: P2PMeshTalkResponsePayload): Promise<void> {
    const frame = await this.buildFrame('talk-response', payload, {
      recipientUserId: payload.authorId,
      ttlHops: 8,
    });
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
      onRemoteMeshFrame: (otherUserId, frame) => this.handleRemoteFrame(otherUserId, frame),
    });
  }

  private async resolveUserPub(userId: string, attempts = 8): Promise<string | null> {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const user = await this.gunService.getPublicUser(userId);
        if (user?.pub) return String(user.pub);
      } catch {
        /* retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  private async buildFrame(
    kind: P2PMeshFrame['kind'],
    payload: P2PMeshFramePayload,
    opts: { recipientUserId?: string; ttlHops?: number } = {},
  ): Promise<P2PMeshFrame> {
    const local = this.localIdentity();
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

  private async rememberAndFanout(frame: P2PMeshFrame, exceptUserId?: string): Promise<void> {
    this.rememberSeen(frame.msgId);
    await this.forwardFrame(frame, exceptUserId);
  }

  private async forwardFrame(frame: P2PMeshFrame, exceptUserId?: string): Promise<void> {
    if (frame.ttlHops <= 0) return;
    const forwarded = { ...frame, ttlHops: frame.ttlHops - 1 };
    const directTarget = frame.recipientUserId ? this.neighbors.get(frame.recipientUserId) : undefined;
    const targets = directTarget && directTarget.userId !== exceptUserId
      ? [directTarget]
      : [...this.neighbors.values()]
          .filter((neighbor) => neighbor.userId !== exceptUserId)
          .filter((neighbor) => !frame.recipientUserId || frame.originUserId !== neighbor.userId);
    await mapWithConcurrency(targets, 4, async (neighbor) => {
      await this.sendFrameToNeighbor(neighbor, forwarded);
    });
  }

  private async sendFrameToNeighbor(neighbor: Neighbor, frame: P2PMeshFrame): Promise<void> {
    try {
      await this.withTimeout(
        neighbor.session.sendMeshFrame(frame),
        this.opts.sendTimeoutMs ?? DEFAULT_MESH_SEND_TIMEOUT_MS,
        'mesh send timeout',
      );
      neighbor.connected = true;
    } catch {
      neighbor.connected = false;
      void this.retryFrameAfterConnect(neighbor, frame);
    }
  }

  private async retryFrameAfterConnect(neighbor: Neighbor, frame: P2PMeshFrame): Promise<void> {
    try {
      await this.withTimeout(
        neighbor.session.ensureConnected(),
        this.opts.retryTimeoutMs ?? DEFAULT_MESH_RETRY_TIMEOUT_MS,
        'mesh retry connect timeout',
      );
      await this.withTimeout(
        neighbor.session.sendMeshFrame(frame),
        this.opts.sendTimeoutMs ?? DEFAULT_MESH_SEND_TIMEOUT_MS,
        'mesh retry send timeout',
      );
      neighbor.connected = true;
    } catch {
      neighbor.connected = false;
    }
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

  private async handleRemoteFrame(fromUserId: string, frame: P2PMeshFrame): Promise<void> {
    if (!frame || frame.version !== 1 || !frame.msgId || !frame.roomId) return;
    if (this.currentRoomId && frame.roomId !== this.currentRoomId) return;
    if (this.seen.has(frame.msgId)) return;
    if (!(await this.verifyOrigin(frame))) return;
    this.rememberSeen(frame.msgId);

    const addressedToMe = !frame.recipientUserId || frame.recipientUserId === this.opts.localUserId;
    if (addressedToMe) {
      await this.handleLocalFrame(fromUserId, frame);
    }

    if (frame.recipientUserId === this.opts.localUserId) return;
    await this.forwardFrame(frame, fromUserId);
  }

  private async handleLocalFrame(_fromUserId: string, frame: P2PMeshFrame): Promise<void> {
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

    if (frame.kind === 'talk-announce') {
      const payload = frame.payload as P2PMeshTalkAnnouncePayload;
      if (payload.authorId === this.opts.localUserId) return;
      // Step 2: fire announce callback before body pull so callers can record receipt
      // for durable diagnostics (e.g. E2E meshAnnounceDiagnostics) without waiting for
      // the talk-body-request/talk-body round-trip.
      await this.opts.onTalkAnnounce?.(payload, frame);
      this.scheduleTalkBodyRequest(payload);
      return;
    }

    if (frame.kind === 'talk-body-request') {
      await this.handleTalkBodyRequest(frame, frame.payload as P2PMeshTalkBodyRequestPayload);
      return;
    }

    if (frame.kind === 'talk-body' && isP2PMeshTalkBodyPayload(frame.payload)) {
      const talkId = String(frame.payload.talkId || '');
      const deliveryKey = talkBodyDeliveryKey(talkId, String(frame.payload.authorId || ''));
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
      if (talkId && this.deliveredTalkBodyIds.has(deliveryKey)) return;
      const accepted = await this.opts.onTalkBody?.(frame.payload);
      if (talkId && accepted !== false) this.deliveredTalkBodyIds.add(deliveryKey);
      return;
    }

    if (frame.kind === 'talk-response' && isP2PMeshTalkResponsePayload(frame.payload)) {
      await this.opts.onTalkResponse?.(frame.payload);
    }
  }

  private subscribeToRoomTalkBodyRendezvous(roomId: string): void {
    if (!roomId || this.roomTalkBodySubscriptionRoomId === roomId) return;
    this.roomTalkBodySubscriptionOff?.();
    this.roomTalkBodySubscriptionOff = null;
    this.roomTalkBodySubscriptionRoomId = roomId;
    const gun = this.getGunOrNull();
    if (!gun) return;
    const ref = gun.get(MESH_TALK_BODY_RENDEZVOUS_ROOT).get(roomId).map();
    ref.on((raw: unknown) => {
      void this.handleRendezvousTalkBody(raw).catch(() => undefined);
    });
    this.roomTalkBodySubscriptionOff = () => {
      try {
        ref.off();
      } catch {
        /* ignore */
      }
    };
  }

  /**
   * Fallback Gun rendezvous write for room broadcasts where the sender has zero connected
   * mesh neighbors at broadcast time (interim step-6/7 debt; see R-a in the design note and
   * broadcastTalk inline comment).  Receivers that subscribeToRoomTalkBodyRendezvous pick
   * this up via Gun replication even when no DataChannel is established.
   *
   * NOT called when connectedNeighborCount > 0 (primary mesh path is used instead), so
   * spec 02's p2pMeshTalkBodies/* == 0 invariant is preserved for the connected case.
   */
  private publishRoomTalkBodyRendezvous(payload: P2PMeshTalkBodyPayload): void {
    const roomId = this.currentRoomId;
    const talkId = String(payload.talkId || '');
    const authorId = String(payload.authorId || '');
    const gun = this.getGunOrNull();
    if (!roomId || !talkId || !authorId || !gun) return;
    try {
      const { talkData: _talkData, ...wireBase } = payload;
      void _talkData;
      const wire = {
        ...wireBase,
        talkDataJson: JSON.stringify(payload.talkData || {}),
      };
      gun.get(MESH_TALK_BODY_RENDEZVOUS_ROOT).get(roomId).get(talkBodyDeliveryKey(talkId, authorId)).put(wire);
    } catch {
      /* best-effort recovery path */
    }
  }

  private async handleRendezvousTalkBody(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const maybeWire = raw as P2PMeshTalkBodyPayload & { talkDataJson?: unknown };
    const talkData = isP2PMeshTalkBodyPayload(maybeWire as P2PMeshFramePayload)
      ? maybeWire.talkData
      : typeof maybeWire.talkDataJson === 'string'
        ? JSON.parse(maybeWire.talkDataJson) as Record<string, unknown>
        : null;
    if (!talkData) return;
    const payload: P2PMeshTalkBodyPayload = {
      ...maybeWire,
      talkData,
    };
    if (payload.authorId === this.opts.localUserId) return;
    const talkId = String(payload.talkId || '');
    const deliveryKey = talkBodyDeliveryKey(talkId, String(payload.authorId || ''));
    if (!talkId || this.deliveredTalkBodyIds.has(deliveryKey)) return;
    const pendingTimer = this.pendingTalkBodyRequestTimers.get(deliveryKey);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingTalkBodyRequestTimers.delete(deliveryKey);
    }
    this.cacheTalkBody(talkId, payload.talkData);
    // Only mark delivered once the receiver actually accepted the talk. A talk rejected
    // by receiver-side intake (e.g. the age gate before verification) must stay eligible
    // for re-delivery once the receiver later qualifies.
    const accepted = await this.opts.onTalkBody?.(payload);
    if (accepted !== false) this.deliveredTalkBodyIds.add(deliveryKey);
  }

  private getGunOrNull(): any | null {
    try {
      return typeof this.gunService.getGun === 'function' ? this.gunService.getGun() : null;
    } catch {
      return null;
    }
  }

  private scheduleTalkBodyRequest(announce: P2PMeshTalkAnnouncePayload): void {
    const talkId = String(announce.talkId || '');
    const deliveryKey = talkBodyDeliveryKey(talkId, String(announce.authorId || ''));
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
      talkId: announce.talkId,
      authorId: announce.authorId,
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
    // Serve the local user's OWN authored copy (talkId::localUserId). A remote author's
    // identical-content body must never be served here under our authorId.
    const talkData = this.getCachedTalkBody(request.talkId, this.opts.localUserId);
    if (!talkData) return;
    const pair = this.gunService.getStoredPair();
    const bodyPayload: P2PMeshTalkBodyPayload = {
      requestId: request.requestId,
      talkId: request.talkId,
      authorId: this.opts.localUserId,
      authorName: this.opts.localStageName,
      ...(pair?.epub ? { authorEpub: String(pair.epub) } : {}),
      title: String(talkData.title || 'Untitled Talk'),
      ...(typeof talkData.type === 'string' ? { type: String(talkData.type) } : {}),
      questionCount: Array.isArray(talkData.questions) ? talkData.questions.length : 0,
      talkData,
    };
    const frame = await this.buildFrame('talk-body', bodyPayload, {
      recipientUserId: requestFrame.originUserId,
      ttlHops: 8,
    });
    await this.rememberAndFanout(frame);
  }
}
