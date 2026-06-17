import type { Message } from '../../shared/types';
import type { LedgerState } from '../../shared/types';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { WebGunService } from './web-gun-service';
import { getOrCreateP2PSession, getP2PSession } from './p2p-webrtc-session';
import type { P2PConnectionState } from './p2p-webrtc-session';
import { GunMessageStore, type ConversationMessageWire } from './gun-message-store';
import { buildConversationDigest, computeMissingForPeer } from '../../shared/conversation-reconcile';
import { getSEA, type GunPair } from '../sea-gun';

export class DirectP2PConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'direct-p2p';

  private readonly apiBase: string;
  /** Authoritative store — WebRTC is notify/sync only (spec §19.4, P2P-H). */
  private readonly gunStore: GunMessageStore;
  private readonly participantCache = new Map<string, string>();
  private readonly liveMessagesByConversation = new Map<string, Message[]>();
  private readonly listenersByConversation = new Map<string, Set<(messages: Message[]) => void>>();
  /**
   * Fired when a message is persisted to local Gun but could NOT be delivered over
   * the WebRTC DataChannel (peer offline / channel not connected). The app uses this
   * to queue the message into the recipient's encrypted offline mailbox so removing
   * the hub archive (P2P-messaging Phase 3) never drops an offline message (Phase 4).
   */
  private onUndeliverable?: (
    wire: ConversationMessageWire,
    conversationId: string,
    recipientUserId: string,
  ) => void;
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
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
      return `http://127.0.0.1:${Number.isFinite(envPort) ? envPort : 8080}`;
    }
    const { hostname, protocol, port } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      const webPort = Number(port);
      if (Number.isFinite(webPort) && webPort >= 3001) {
        const gunPort = webPort - 3001 + 8080;
        return `${protocol}//${hostname}:${gunPort}`;
      }
      return `${protocol}//${hostname}:8080`;
    }
    return `${protocol}//${hostname}`;
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
  }): void {
    this.ledgerHooks = hooks;
  }

  /** Wire the offline-mailbox fallback (Phase 4); see `onUndeliverable`. */
  setUndeliverableHandler(
    handler: (wire: ConversationMessageWire, conversationId: string, recipientUserId: string) => void,
  ): void {
    this.onUndeliverable = handler;
  }

  async ensureSessionConnected(conversationId: string, localUserId: string): Promise<void> {
    const session = await this.sessionFor(conversationId, localUserId);
    await session.ensureConnected();
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

  private async getUserPub(userId: string, attempts = 20): Promise<string> {
    for (let i = 0; i < attempts; i++) {
      const user = await this.gunService.getPublicUser(userId);
      if (user.pub) return String(user.pub);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`User ${userId} has no pub`);
  }

  private async decryptWireText(wire: { senderId: string; text: string; encryption?: string }, peerId: string): Promise<string> {
    if (wire.encryption !== 'sea-ecdh-v1') return wire.text;
    const pair = this.gunService.getStoredPair();
    if (!pair) return wire.text;
    const user = await this.gunService.getPublicUser(peerId);
    if (!user.epub) return wire.text;
    try {
      const secret = await getSEA().secret(user.epub, pair as GunPair);
      const decrypted = await getSEA().decrypt(wire.text, secret);
      return decrypted ? String(decrypted) : wire.text;
    } catch {
      return wire.text;
    }
  }

  private pushLiveMessage(conversationId: string, message: Message): void {
    const bucket = this.liveMessagesByConversation.get(conversationId) || [];
    if (!bucket.some((existing) => existing.id === message.id)) {
      bucket.push(message);
      bucket.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      this.liveMessagesByConversation.set(conversationId, bucket);
    }
    const snapshot = [...(this.liveMessagesByConversation.get(conversationId) || [])];
    for (const listener of this.listenersByConversation.get(conversationId) || []) {
      listener(snapshot);
    }
  }

  private async sessionFor(
    conversationId: string,
    localUserId: string,
    otherUserId?: string,
  ) {
    const otherId = await this.resolveOtherUserId(conversationId, localUserId, otherUserId);
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv) throw new Error('No SEA signing keypair');
    const localPub = await this.getLocalPub();
    const otherPub = await this.getUserPub(otherId);
    const isInitiator = localUserId.localeCompare(otherId) < 0;
    const session = getOrCreateP2PSession({
      apiBase: this.apiBase,
      conversationId,
      localUserId,
      localPub,
      localPair: pair,
      otherUserId: otherId,
      otherPub,
      isInitiator,
      ...this.ledgerHooks,
      // Phase 5: peer↔peer reconciliation — advertise our local digest on connect and
      // backfill whatever the peer is missing, straight over the DataChannel (no hub).
      getLocalMessageDigest: async () =>
        buildConversationDigest(
          conversationId,
          await this.gunStore.listLocalWires(conversationId, localUserId, otherId),
        ).messageIds,
      getMessagesForBackfill: async (remoteMessageIds: string[]) =>
        computeMissingForPeer(
          conversationId,
          await this.gunStore.listLocalWires(conversationId, localUserId, otherId),
          { conversationId, messageIds: remoteMessageIds },
        ),
    });
    session.setLedgerHooks(this.ledgerHooks);
    session.setOnRemoteDm((wire) => {
      if (wire.senderId === localUserId) return;
      this.gunStore.putMessageRecord(conversationId, {
        id: wire.id,
        senderId: wire.senderId,
        text: wire.text,
        timestamp: wire.timestamp,
        channel: wire.channel,
        transport: wire.transport ?? this.mode,
        ...(wire.encryption ? { encryption: wire.encryption as 'sea-ecdh-v1' } : {}),
        ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
        ...(wire.isFromChatbot ? { isFromChatbot: true } : {}),
      }, { otherUserId: otherId });
      void this.decryptWireText(wire, wire.senderId).then((text) => {
        this.pushLiveMessage(conversationId, {
          id: wire.id,
          senderId: wire.senderId,
          text,
          timestamp: new Date(wire.timestamp),
          channel: (wire.channel as Message['channel']) || 'public',
          readBy: [],
          isFromChatbot: !!wire.isFromChatbot,
          ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
        });
      });
    });
    return session;
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const wire = await this.gunStore.buildAndPersistMessage(conversationId, senderId, text, {
      ...opts,
      transport: this.mode,
    });

    // Echo locally regardless of WebRTC outcome — Gun is authoritative (P2P-H).
    this.pushLiveMessage(conversationId, {
      id: wire.id,
      senderId,
      text,
      timestamp: new Date(wire.timestamp),
      channel: (channel as Message['channel']) || 'public',
      readBy: [],
      isFromChatbot: !!wire.isFromChatbot,
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
    });

    try {
      const session = await this.sessionFor(conversationId, senderId, opts?.otherUserId);
      await session.sendDm(senderId, text, channel, wire);
    } catch (err) {
      console.warn(
        `Direct P2P WebRTC notify failed for ${conversationId}; Gun record is authoritative, queueing to mailbox:`,
        err,
      );
      // Phase 4: peer unreachable over WebRTC → queue the (already-encrypted) wire to
      // the recipient's offline mailbox so it survives even without a hub archive.
      if (this.onUndeliverable) {
        try {
          const recipientUserId = opts?.otherUserId ?? (await this.resolveOtherUserId(conversationId, senderId));
          if (recipientUserId) this.onUndeliverable(wire, conversationId, recipientUserId);
        } catch (resolveErr) {
          console.warn(`Direct P2P mailbox fallback skipped (no recipient) for ${conversationId}:`, resolveErr);
        }
      }
    }
    console.log(`📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})`);
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
    let unsubscribeGun: (() => void) = () => undefined;
    const listeners = this.listenersByConversation.get(conversationId) || new Set<(messages: Message[]) => void>();
    listeners.add(callback);
    this.listenersByConversation.set(conversationId, listeners);
    callback([...(this.liveMessagesByConversation.get(conversationId) || [])]);

    void this.sessionFor(conversationId, myUserId)
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
      .then((otherUserId) => {
        if (disposed) return;
        unsubscribeGun = this.gunStore.subscribeToMessages(conversationId, callback, myUserId, otherUserId);
      })
      .catch((err) => {
        console.warn(`Direct P2P message subscription setup failed for ${conversationId}:`, err);
        if (!disposed) unsubscribeGun = this.gunStore.subscribeToMessages(conversationId, callback, myUserId);
      });

    return () => {
      disposed = true;
      listeners.delete(callback);
      unsubscribeGun();
      console.log(`👋 Unsubscribed from conversation ${conversationId} messages (${this.mode})`);
    };
  }
}
