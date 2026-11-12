import type { InteractionEvent, LedgerState, Message } from '../../shared/types';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { deriveBackendApiBaseFromLocation, WebGunService } from './web-gun-service';
import { getOrCreateP2PSession, getP2PSession } from './p2p-webrtc-session';
import type { P2PConnectionState } from './p2p-webrtc-session';
import { GunMessageStore, type ConversationMessageWire } from './gun-message-store';
import { boundRecentWires, buildConversationDigest, computeMissingForPeer } from '../../shared/conversation-reconcile';
import { getSEA, type GunPair } from '../sea-gun';
import type { OfficialBuildCredential } from '../../shared/official-build-credential';

/**
 * How long an already-open direct link has to deliver before the mailbox carries the DM as well.
 * With no open link the mailbox is used at once: waiting for one to connect added 10 s to every
 * message on phones whose link would not connect.
 */
export const DM_OPEN_LINK_GRACE_MS = 1_500;

/** Encrypting needs the peer's key. If that lookup stalls the send fails, returning the text. */
export const DM_PREPARE_TIMEOUT_MS = 30_000;

export type ConversationLogMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel?: Message['channel'];
  isFromChatbot?: boolean;
  talkId?: string;
};

export type ConversationMessageLogHooks = {
  recordMessage(
    conversationId: string,
    otherUserId: string,
    message: ConversationLogMessage,
  ): Promise<void>;
  listMessages(conversationId: string, otherUserId: string, limit?: number): Promise<ConversationLogMessage[]>;
};

const within = <T>(work: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preparing the message timed out')), timeoutMs);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

export class DirectP2PConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'direct-p2p';

  private readonly apiBase: string;
  /** Wire codec only. Durable ordinary-DM history belongs to the device graph. */
  private readonly gunStore: GunMessageStore;
  private messageLogHooks?: ConversationMessageLogHooks;
  private readonly participantCache = new Map<string, string>();
  private readonly liveMessagesByConversation = new Map<string, Message[]>();
  private readonly listenersByConversation = new Map<string, Set<(messages: Message[]) => void>>();
  private readonly lastSeenFromOther = new Map<string, string>();
  /**
   * Fired when a message is persisted to the graph but could NOT be delivered over
   * the WebRTC DataChannel (peer offline / channel not connected). The app uses this
   * to queue the message into the recipient's encrypted offline mailbox so removing
   * the hub archive (P2P-messaging Phase 3) never drops an offline message (Phase 4).
   */
  private onUndeliverable?: (
    wire: ConversationMessageWire,
    conversationId: string,
    recipientUserId: string,
    recipientEpub?: string,
  ) => boolean | void | Promise<boolean | void>;
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
    getLedgerDelta?: (remoteState: LedgerState) => Promise<InteractionEvent[]>;
    onRemoteLedgerEvents?: (otherUserId: string, events: InteractionEvent[]) => void | Promise<void>;
  } = {};
  private conversationControlHooks: {
    getConversationControlSnapshot?: (
      conversationId: string,
      localUserId: string,
      otherUserId: string,
    ) => Promise<Record<string, unknown> | null>;
    onRemoteConversationControl?: (
      conversationId: string,
      otherUserId: string,
      metadata: Record<string, unknown>,
    ) => void | Promise<void>;
  } = {};

  /** P2P media providers: serve local attachment bytes, and receive streamed bytes. */
  private attachmentHooks: {
    getAttachmentBytesForCid?: (cid: string) => Promise<Uint8Array | null>;
    onAttachmentBytes?: (cid: string, bytes: Uint8Array) => void;
  } = {};

  /** Scenario 2 (§16). Unset by default — every call site that hasn't wired this yet correctly
   * gets 'unverified-build' for every peer, never an error. */
  private buildTrustHooks: {
    getBuildTrustCredential?: () => OfficialBuildCredential | undefined;
    officialApplicationId?: string;
    officialSigningIdentityHash?: string;
    lookupVerifierKey?: (verifierKeyId: string) => string | undefined;
  } = {};

  constructor(
    private gunService: WebGunService,
    apiBase?: string,
  ) {
    this.apiBase = apiBase || DirectP2PConversationTransport.resolveApiBase();
    this.gunStore = new GunMessageStore(gunService);
  }

  /** Same port mapping as IinPublicApp.getBackendApiBase(). */
  static resolveApiBase(): string {
    if (typeof window === 'undefined') {
      const envPort =
        typeof process !== 'undefined' && process.env?.PORT
          ? parseInt(process.env.PORT, 10)
          : 8080;
      return `https://127.0.0.1:${Number.isFinite(envPort) ? envPort : 8080}`;
    }
    const { hostname, protocol, port } = window.location;
    return deriveBackendApiBaseFromLocation(protocol, hostname, port);
  }

  getConnectionState(conversationId: string, localUserId: string): P2PConnectionState {
    return getP2PSession(conversationId, localUserId)?.getState() ?? 'idle';
  }

  /** P2P-Y: expose handshake diagnostics for E2E verification. */
  getHandshakeDiagnostics(
    conversationId: string,
    localUserId: string,
  ): import('../../shared/p2p-handshake').HandshakeDiagnostics | null {
    return getP2PSession(conversationId, localUserId)?.getHandshakeDiagnostics() ?? null;
  }

  setLedgerHandshakeHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
    getLedgerDelta?: (remoteState: LedgerState) => Promise<InteractionEvent[]>;
    onRemoteLedgerEvents?: (otherUserId: string, events: InteractionEvent[]) => void | Promise<void>;
  }): void {
    this.ledgerHooks = hooks;
  }

  setConversationControlHooks(hooks: {
    getConversationControlSnapshot?: (
      conversationId: string,
      localUserId: string,
      otherUserId: string,
    ) => Promise<Record<string, unknown> | null>;
    onRemoteConversationControl?: (
      conversationId: string,
      otherUserId: string,
      metadata: Record<string, unknown>,
    ) => void | Promise<void>;
  }): void {
    this.conversationControlHooks = hooks;
  }

  /** Wire the offline-mailbox fallback (Phase 4); see `onUndeliverable`. */
  setUndeliverableHandler(
    handler: (
      wire: ConversationMessageWire,
      conversationId: string,
      recipientUserId: string,
      recipientEpub?: string,
    ) => boolean | void | Promise<boolean | void>,
  ): void {
    this.onUndeliverable = handler;
  }

  /** OPEN-110: the event log owns durable DM writes, reads, and reconnect backfill. */
  setMessageLogHooks(hooks: ConversationMessageLogHooks): void {
    this.messageLogHooks = hooks;
  }

  /** Wire P2P media providers (serve/receive attachment bytes over the DataChannel). */
  setAttachmentHooks(hooks: {
    getAttachmentBytesForCid?: (cid: string) => Promise<Uint8Array | null>;
    onAttachmentBytes?: (cid: string, bytes: Uint8Array) => void;
  }): void {
    this.attachmentHooks = hooks;
  }

  /** Scenario 2 (§16): wire this device's own build-trust credential + how to evaluate a
   * remote peer's — see WebAttestationService, wired from app.ts. */
  setBuildTrustHooks(hooks: {
    getBuildTrustCredential?: () => OfficialBuildCredential | undefined;
    officialApplicationId?: string;
    officialSigningIdentityHash?: string;
    lookupVerifierKey?: (verifierKeyId: string) => string | undefined;
  }): void {
    this.buildTrustHooks = hooks;
  }

  /** Pull a shared attachment's bytes from the peer over the DM DataChannel (no server). */
  async requestAttachment(
    conversationId: string,
    localUserId: string,
    otherUserId: string,
    cid: string,
  ): Promise<void> {
    const session = await this.sessionFor(conversationId, localUserId, otherUserId);
    await session.ensureConnected().catch(() => undefined);
    await session.requestAttachment(cid);
  }

  async syncConversationControl(
    conversationId: string,
    localUserId: string,
    otherUserId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.sessionFor(conversationId, localUserId, otherUserId);
    await session.sendConversationControl(metadata);
  }

  async ensureSessionConnected(
    conversationId: string,
    localUserId: string,
    timeoutMs?: number,
    otherUserId?: string,
  ): Promise<void> {
    const session = await this.sessionFor(conversationId, localUserId, otherUserId);
    await session.ensureConnected(timeoutMs);
  }

  private async getLocalPub(): Promise<string> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) throw new Error('No SEA keypair');
    return String(pair.pub);
  }

  private async resolveOtherUserId(
    conversationId: string,
    myId: string,
    hint?: string,
  ): Promise<string> {
    if (hint) return hint;
    const cached = this.participantCache.get(`${conversationId}:${myId}`);
    if (cached) return cached;
    // Ordinary pair ids are self-describing. Prefer this local derivation now that generic
    // conversation metadata no longer lives on the peered Gun graph.
    if (conversationId.startsWith('conv_pair_')) {
      const participants = conversationId.slice('conv_pair_'.length).split('_');
      const other = participants.length === 2 ? participants.find((participant) => participant !== myId) : undefined;
      if (other) {
        this.participantCache.set(`${conversationId}:${myId}`, other);
        return other;
      }
    }
    // Mixed-release fallback only. New clients never write this public record.
    const gun = this.gunService.getGun();
    const otherId = await new Promise<string | undefined>((resolve) => {
      gun.get(`conversations/${conversationId}`).once((d: { data?: string }) => {
        if (!d?.data) {
          resolve(undefined);
          return;
        }
        try {
          const c = JSON.parse(d.data) as { participants?: string[] };
          resolve((c.participants || []).find((p) => p !== myId));
        } catch {
          resolve(undefined);
        }
      });
    });
    if (!otherId) throw new Error('Could not resolve other participant');
    this.participantCache.set(`${conversationId}:${myId}`, otherId);
    return otherId;
  }

  /** A user's pub and epub are immutable (gun-message-store caches epub the same way). Without
   *  this every DM paid one public-record lookup before sending and another before decrypting:
   *  ~1.7 s each over mobile data (native-app/29, 2026-10-17). Opening the conversation runs
   *  sessionFor, which fills the cache before the first send or receive. */
  private readonly peerKeysByUserId = new Map<string, { pub?: string; epub?: string }>();
  private readonly peerKeyLookups = new Map<string, Promise<{ pub?: string; epub?: string }>>();

  private lookupPeerKeys(userId: string): Promise<{ pub?: string; epub?: string }> {
    const inFlight = this.peerKeyLookups.get(userId);
    if (inFlight) return inFlight;
    const lookup = this.gunService.getPublicUser(userId)
      .then((user) => {
        const keys = { ...this.peerKeysByUserId.get(userId) };
        if (user.pub) keys.pub = String(user.pub);
        if (user.epub) keys.epub = String(user.epub);
        this.peerKeysByUserId.set(userId, keys);
        return keys;
      })
      .finally(() => this.peerKeyLookups.delete(userId));
    this.peerKeyLookups.set(userId, lookup);
    return lookup;
  }

  private async getUserPub(userId: string, attempts = 20): Promise<string> {
    for (let i = 0; i < attempts; i++) {
      const cached = this.peerKeysByUserId.get(userId)?.pub;
      if (cached) return cached;
      try {
        const { pub } = await this.lookupPeerKeys(userId);
        if (pub) return pub;
      } catch {
        // The other phone may still be publishing this record to the hub.
      }
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`User ${userId} has no pub`);
  }

  private async decryptWireText(wire: { senderId: string; text: string; encryption?: string }, peerId: string): Promise<string> {
    if (wire.encryption !== 'sea-ecdh-v1') return wire.text;
    const pair = this.gunService.getStoredPair();
    if (!pair) return wire.text;
    // Retry the epub read: a received message can arrive before the sender's epub has synced
    // to this device, and without a retry the message stays as raw SEA ciphertext on screen.
    const epub = await this.getUserEpub(peerId);
    if (!epub) return wire.text;
    try {
      const secret = await getSEA().secret(epub, pair as GunPair);
      const decrypted = await getSEA().decrypt(wire.text, secret);
      return decrypted ? String(decrypted) : wire.text;
    } catch {
      return wire.text;
    }
  }

  private async getUserEpub(userId: string, attempts = 8): Promise<string | undefined> {
    for (let i = 0; i < attempts; i += 1) {
      const cached = this.peerKeysByUserId.get(userId)?.epub;
      if (cached) return cached;
      try {
        const { epub } = await this.lookupPeerKeys(userId);
        if (epub) return epub;
      } catch {
        /* transient — retry below */
      }
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return undefined;
  }

  private pushLiveMessage(conversationId: string, message: Message): void {
    this.mergeLiveMessages(conversationId, [message]);
  }

  private requireMessageLog(): ConversationMessageLogHooks {
    if (!this.messageLogHooks) throw new Error('Device graph message log is unavailable');
    return this.messageLogHooks;
  }

  private async recordPlaintextMessage(
    conversationId: string,
    otherUserId: string,
    message: ConversationLogMessage,
  ): Promise<void> {
    await this.requireMessageLog().recordMessage(conversationId, otherUserId, message);
  }

  private async loggedMessages(
    conversationId: string,
    otherUserId: string,
    limit = 500,
  ): Promise<ConversationLogMessage[]> {
    return boundRecentWires(
      await this.requireMessageLog().listMessages(conversationId, otherUserId, limit),
      limit,
    );
  }

  private logMessageToUi(message: ConversationLogMessage): Message {
    return {
      id: message.id,
      senderId: message.senderId,
      text: message.text,
      timestamp: new Date(message.timestamp),
      channel: message.channel ?? 'public',
      readBy: [],
      isFromChatbot: message.isFromChatbot === true,
      ...(message.talkId ? { talkId: message.talkId } : {}),
    };
  }

  private removeLiveMessage(conversationId: string, messageId: string): void {
    const bucket = this.liveMessagesByConversation.get(conversationId) ?? [];
    const remaining = bucket.filter((message) => message.id !== messageId);
    this.liveMessagesByConversation.set(conversationId, remaining);
    for (const listener of this.listenersByConversation.get(conversationId) ?? []) listener([...remaining]);
  }

  private updateLiveMessage(
    conversationId: string,
    messageId: string,
    patch: Partial<Message>,
  ): void {
    const bucket = this.liveMessagesByConversation.get(conversationId) ?? [];
    const index = bucket.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    bucket[index] = { ...bucket[index], ...patch };
    this.liveMessagesByConversation.set(conversationId, bucket);
    for (const listener of this.listenersByConversation.get(conversationId) ?? []) listener([...bucket]);
  }

  /** Delivery state is device-local session UI, never immutable message history. */
  private recordDeliveryState(
    conversationId: string,
    wire: ConversationMessageWire,
    state: 'sent' | 'queued' | 'failed',
  ): void {
    this.updateLiveMessage(conversationId, wire.id, { deliveryState: state });
  }

  /**
   * An inbound DM: its private-history write starts first, the message is shown as soon as it is
   * decrypted, and this resolves only once the write is durable. Showing it only after the write
   * (2026-11-02, OPEN-94) made arrival wait for the device core's private-write queue, about 8 s
   * on the phone path against the 2 s arrival budget (journeys/dm-speed-journey.ts, the instant-DM
   * fix of 1.0.216). The write is already under way when the message appears, and callers that
   * need durability await this.
   */
  private async persistAndPublishRemoteMessage(
    conversationId: string,
    localUserId: string,
    otherUserId: string,
    wire: ConversationMessageWire,
  ): Promise<void> {
    const text = await this.decryptWireText(wire, wire.senderId);
    if (wire.encryption === 'sea-ecdh-v1' && text === wire.text) {
      throw new Error(`Could not decrypt message ${wire.id}`);
    }
    const persisted = this.recordPlaintextMessage(conversationId, otherUserId, {
      id: wire.id,
      senderId: wire.senderId,
      text,
      timestamp: wire.timestamp,
      ...(wire.channel ? { channel: wire.channel as Message['channel'] } : {}),
      ...(wire.isFromChatbot ? { isFromChatbot: true } : {}),
      ...(wire.talkId ? { talkId: wire.talkId } : {}),
    });
    if (wire.senderId !== localUserId) {
      this.lastSeenFromOther.set(`${conversationId}:${localUserId}`, wire.id);
    }

    this.pushLiveMessage(conversationId, {
      id: wire.id,
      senderId: wire.senderId,
      text,
      timestamp: new Date(wire.timestamp),
      channel: (wire.channel as Message['channel']) || 'public',
      readBy: [],
      isFromChatbot: !!wire.isFromChatbot,
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
      ...(wire.talkId ? { talkId: wire.talkId } : {}),
    });
    await persisted;
  }

  /** Mailbox delivery enters the same graph-first receive path as a live DataChannel frame. */
  async ingestMessageWire(
    conversationId: string,
    localUserId: string,
    otherUserId: string,
    wire: ConversationMessageWire,
  ): Promise<void> {
    await this.persistAndPublishRemoteMessage(conversationId, localUserId, otherUserId, wire);
  }

  /**
   * Merge an eventually-consistent Gun snapshot into messages already observed live.
   * A subscription can emit its initial (older) snapshot after a local echo or WebRTC
   * delivery. Treating that snapshot as a replacement makes the accepted message briefly—or
   * permanently under load—disappear from consumers. Conversation messages are immutable, so
   * a monotonic id-based merge is the correct model for the active session.
   */
  private mergeLiveMessages(conversationId: string, messages: Message[]): void {
    const bucket = this.liveMessagesByConversation.get(conversationId) || [];
    const indexById = new Map(bucket.map((existing, index) => [existing.id, index]));
    for (const message of messages) {
      const index = indexById.get(message.id);
      if (index === undefined) {
        indexById.set(message.id, bucket.length);
        bucket.push(message);
      } else if (bucket[index].text !== message.text) {
        // A record rewritten under the same id (the TechSupport welcome re-rendered after a
        // rename) must replace the cached copy; keeping the first one put the old text back
        // into the conversation preview on the next emit. Fields only the cache knows survive.
        bucket[index] = { ...bucket[index], ...message };
      }
    }
    if (messages.length > 0) {
      // Same (timestamp, id) ordering as the graph read path: without the id
      // tie-break, two peers sending within the same millisecond sort in peer-local
      // ARRIVAL order (stable sort keeps insertion order on ties), so the two sides'
      // live views can converge to different message orders.
      bucket.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || String(a.id).localeCompare(String(b.id)),
      );
    }
    this.liveMessagesByConversation.set(conversationId, bucket);
    const snapshot = [...(this.liveMessagesByConversation.get(conversationId) || [])];
    for (const listener of this.listenersByConversation.get(conversationId) || []) {
      listener(snapshot);
    }
  }

  private async sessionFor(
    conversationId: string,
    localUserId: string,
    otherUserId?: string,
    onStage?: (stage: string) => void,
  ) {
    onStage?.('other user');
    const otherId = await this.resolveOtherUserId(conversationId, localUserId, otherUserId);
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv) throw new Error('No SEA signing keypair');
    onStage?.('own key');
    const localPub = await this.getLocalPub();
    onStage?.('their key');
    const otherPub = await this.getUserPub(otherId);
    const otherEpub = this.peerKeysByUserId.get(otherId)?.epub;
    if (otherEpub) this.gunStore.rememberEpub(otherId, otherEpub);
    onStage?.('connect');
    const isInitiator = localUserId.localeCompare(otherId) < 0;
    const readLogged = () => this.loggedMessages(conversationId, otherId);
    const session = getOrCreateP2PSession({
      apiBase: this.apiBase,
      conversationId,
      localUserId,
      localPub,
      localPair: pair,
      otherUserId: otherId,
      otherPub,
      isInitiator,
      // DM send path: fail fast for a window after a failed connect instead of paying the
      // full connect timeout on every send to an unreachable peer (Gun + mailbox cover
      // delivery). Mesh sessions must NOT set this — see P2P_WEBRTC_RETRY_COOLDOWN_MS.
      failFastAfterFailure: true,
      // S2: default to Gun pub/sub signaling (the Gun WebSocket is already open for presence).
      gun: this.gunService.getGun(),
      ...this.ledgerHooks,
      ...this.buildTrustHooks,
      // Phase 5: peer↔peer reconciliation — advertise our local digest on connect and
      // backfill whatever the peer is missing, straight over the DataChannel (no hub).
      getLocalMessageDigest: async () => buildConversationDigest(
        conversationId,
        await readLogged(),
      ).messageIds,
      getMessagesForBackfill: async (remoteMessageIds: string[]) => {
        const missing = computeMissingForPeer(
          conversationId,
          (await readLogged()).map((message) => ({
            ...message,
            channel: message.channel ?? 'public',
            transport: this.mode,
          })),
          { conversationId, messageIds: remoteMessageIds },
        );
        return Promise.all(missing.map(async (message) => ({
          ...await this.gunStore.buildMessage(
            conversationId,
            message.senderId,
            message.text,
            {
              otherUserId: otherId,
              messageId: message.id,
              sentAt: new Date(message.timestamp),
              channel: message.channel as Message['channel'],
              transport: this.mode,
              ...(message.isFromChatbot ? { isFromChatbot: true } : {}),
              ...(message.talkId ? { talkId: message.talkId } : {}),
            },
          ),
          channel: message.channel,
          transport: this.mode,
        })));
      },
      getConversationControlSnapshot: () =>
        this.conversationControlHooks.getConversationControlSnapshot?.(
          conversationId,
          localUserId,
          otherId,
        ) ?? Promise.resolve(null),
      onRemoteConversationControl: (_peerId, metadata) =>
        this.conversationControlHooks.onRemoteConversationControl?.(
          conversationId,
          otherId,
          metadata,
        ),
    });
    session.setLedgerHooks(this.ledgerHooks);
    session.setAttachmentHooks(this.attachmentHooks);
    session.setConversationControlHooks({
      getConversationControlSnapshot: () =>
        this.conversationControlHooks.getConversationControlSnapshot?.(
          conversationId,
          localUserId,
          otherId,
        ) ?? Promise.resolve(null),
      onRemoteConversationControl: (_peerId, metadata) =>
        this.conversationControlHooks.onRemoteConversationControl?.(
          conversationId,
          otherId,
          metadata,
        ),
    });
    session.setBuildTrustHooks(this.buildTrustHooks);
    session.setOnRemoteDm(async (wire) => {
      if (wire.senderId === localUserId) return;
      await this.persistAndPublishRemoteMessage(conversationId, localUserId, otherId, wire);
    });
    return session;
  }

  private hasOpenLink(conversationId: string, localUserId: string): boolean {
    return getP2PSession(conversationId, localUserId)?.getState() === 'connected';
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const messageId = opts?.messageId ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Shown at once: saving and delivery happen behind it, and a slow one must not hold the
    // sender's own message back. A failed save takes it away again and reports to the caller.
    const sentAt = new Date();
    this.pushLiveMessage(conversationId, {
      id: messageId,
      senderId,
      text,
      timestamp: sentAt,
      channel: (channel as Message['channel']) || 'public',
      deliveryState: 'sending',
      readBy: [],
      isFromChatbot: !!opts?.isFromChatbot,
      ...(opts?.talkId && opts.talkId !== 'direct' ? { talkId: opts.talkId } : {}),
    });

    let wire: ConversationMessageWire;
    let saved: Promise<void>;
    try {
      wire = await within(
        this.gunStore.buildMessage(conversationId, senderId, text, { ...opts, messageId, transport: this.mode, sentAt }),
        DM_PREPARE_TIMEOUT_MS,
      );
      const prevSeen = this.lastSeenFromOther.get(`${conversationId}:${senderId}`);
      if (prevSeen) wire.prevSeen = prevSeen;
      const otherUserId = opts?.otherUserId ?? await this.resolveOtherUserId(conversationId, senderId);
      // Start the immutable event write before delivery, but do not make a fast link wait for the
      // device-core queue. If it fails, sendMessage still rejects and removes the optimistic echo.
      saved = this.recordPlaintextMessage(conversationId, otherUserId, {
        id: wire.id,
        senderId,
        text,
        timestamp: wire.timestamp,
        channel: channel as Message['channel'],
        ...(opts?.isFromChatbot ? { isFromChatbot: true } : {}),
        ...(opts?.talkId && opts.talkId !== 'direct' ? { talkId: opts.talkId } : {}),
      });
    } catch (error) {
      this.removeLiveMessage(conversationId, messageId);
      throw error;
    }

    this.deliver(wire, conversationId, senderId, text, channel, opts);

    try {
      await saved;
    } catch (error) {
      this.removeLiveMessage(conversationId, messageId);
      throw error;
    }
  }

  /** Delivery runs on its own, so neither a slow link nor a slow save holds up the other. */
  private deliver(
    wire: ConversationMessageWire,
    conversationId: string,
    senderId: string,
    text: string,
    channel: string,
    opts?: SendMessageOptions,
  ): void {
    console.log(`📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})`);
    void (async () => {
      // Where a delivery is, if it is slow: the WebView cannot otherwise tell a stalled key
      // lookup from a link that never connects (native-app/37 on real phones, 2026-10-26).
      const startedAt = Date.now();
      let stage = 'session';
      const slow = setTimeout(() => console.warn(`[dm-notify] ${wire.id} still at "${stage}" after 15 s`), 15_000);
      // Queued once: when the grace period runs out, or at once if the direct link fails. The
      // recipient keys messages by id, so one that also arrives directly still shows once.
      let directSent = false;
      let mailbox: Promise<boolean> | null = null;
      const queueToMailbox = (): Promise<boolean> => {
        if (mailbox) return mailbox;
        mailbox = (async () => {
          if (!this.onUndeliverable) return false;
          try {
            const recipientUserId = opts?.otherUserId ?? (await this.resolveOtherUserId(conversationId, senderId));
            if (!recipientUserId) return false;
            const accepted = await this.onUndeliverable(
              wire,
              conversationId,
              recipientUserId,
              this.gunStore.knownEpub(recipientUserId),
            );
            return accepted !== false;
          } catch (resolveErr) {
            console.warn(`Direct P2P mailbox fallback skipped (no recipient) for ${conversationId}:`, resolveErr);
            return false;
          }
        })();
        void mailbox.then((accepted) => {
          if (!directSent) this.recordDeliveryState(conversationId, wire, accepted ? 'queued' : 'failed');
        });
        return mailbox;
      };
      const grace = this.hasOpenLink(conversationId, senderId)
        ? setTimeout(() => void queueToMailbox(), DM_OPEN_LINK_GRACE_MS)
        : void queueToMailbox();
      try {
        const session = await this.sessionFor(conversationId, senderId, opts?.otherUserId, (next) => { stage = next; });
        stage = 'send';
        await session.sendDm(senderId, text, channel as Message['channel'], wire);
        directSent = true;
        this.recordDeliveryState(conversationId, wire, 'sent');
        console.info(`[dm-notify] ${wire.id} delivered over WebRTC in ${Date.now() - startedAt} ms`);
      } catch (err) {
        console.warn(
          `Direct P2P WebRTC notify failed for ${conversationId}; graph event is authoritative, queueing to mailbox:`,
          err,
        );
        // Phase 4: peer unreachable over WebRTC → queue the (already-encrypted) wire to
        // the recipient's offline mailbox so it survives even without a hub archive.
        await queueToMailbox();
      } finally {
        if (grace) clearTimeout(grace);
        clearTimeout(slow);
      }
    })();
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserIdHint?: string,
  ): () => void {
    if (!myUserId) {
      callback([]);
      return () => undefined;
    }

    let disposed = false;
    const listeners = this.listenersByConversation.get(conversationId) || new Set<(messages: Message[]) => void>();
    listeners.add(callback);
    this.listenersByConversation.set(conversationId, listeners);
    callback([...(this.liveMessagesByConversation.get(conversationId) || [])]);

    void this.sessionFor(conversationId, myUserId, otherUserIdHint)
      .then((session) => {
        if (disposed) return;
        void session.ensureConnected().catch((err) => {
          console.warn(`Direct P2P connect failed for ${conversationId}:`, err);
        });
      })
      .catch((err) => {
        console.warn(`Direct P2P session setup failed for ${conversationId}:`, err);
      });

    void (otherUserIdHint
      ? Promise.resolve(otherUserIdHint)
      : this.resolveOtherUserId(conversationId, myUserId))
      .then(async (otherUserId) => {
        const messages = await this.loggedMessages(conversationId, otherUserId, 500);
        if (disposed) return;
        const latestFromOther = [...messages].reverse().find((message) => message.senderId !== myUserId);
        if (latestFromOther) this.lastSeenFromOther.set(`${conversationId}:${myUserId}`, latestFromOther.id);
        this.mergeLiveMessages(conversationId, messages.map((message) => this.logMessageToUi(message)));
      })
      .catch((err) => {
        console.warn(`Direct P2P graph history read failed for ${conversationId}:`, err);
      });

    return () => {
      disposed = true;
      listeners.delete(callback);
      console.log(`👋 Unsubscribed from conversation ${conversationId} messages (${this.mode})`);
    };
  }
}
