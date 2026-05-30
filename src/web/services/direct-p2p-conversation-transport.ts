import type { Message } from '../../shared/types';
import type { LedgerState } from '../../shared/types';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { WebGunService } from './web-gun-service';
import { getOrCreateP2PSession, getP2PSession } from './p2p-webrtc-session';
import type { P2PConnectionState } from './p2p-webrtc-session';
import { StarGunConversationTransport } from './star-gun-conversation-transport';

export class DirectP2PConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'direct-p2p';

  private readonly apiBase: string;
  /** Authoritative store — WebRTC is notify/sync only (spec §19.4, P2P-H). */
  private readonly gunStore: StarGunConversationTransport;
  private readonly participantCache = new Map<string, string>();
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  } = {};

  constructor(
    private gunService: WebGunService,
    apiBase?: string,
  ) {
    this.apiBase = apiBase || DirectP2PConversationTransport.resolveApiBase();
    this.gunStore = new StarGunConversationTransport(gunService);
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

  setLedgerHandshakeHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void {
    this.ledgerHooks = hooks;
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

  private async sessionFor(
    conversationId: string,
    localUserId: string,
    otherUserId?: string,
  ) {
    const otherId = await this.resolveOtherUserId(conversationId, localUserId, otherUserId);
    const localPub = await this.getLocalPub();
    const otherPub = await this.getUserPub(otherId);
    const isInitiator = localUserId.localeCompare(otherId) < 0;
    const session = getOrCreateP2PSession({
      apiBase: this.apiBase,
      conversationId,
      localUserId,
      localPub,
      otherUserId: otherId,
      otherPub,
      isInitiator,
      ...this.ledgerHooks,
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
        ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
        ...(wire.isFromChatbot ? { isFromChatbot: true } : {}),
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

    try {
      const session = await this.sessionFor(conversationId, senderId, opts?.otherUserId);
      await session.sendDm(senderId, text, channel, wire);
    } catch (err) {
      console.warn(
        `Direct P2P WebRTC notify failed for ${conversationId}; Gun record is authoritative:`,
        err,
      );
    }
    console.log(`📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})`);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
  ): () => void {
    if (!myUserId) {
      callback([]);
      return () => undefined;
    }

    let disposed = false;

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

    const unsubscribeGun = this.gunStore.subscribeToMessages(conversationId, callback, myUserId);

    return () => {
      disposed = true;
      unsubscribeGun();
      console.log(`👋 Unsubscribed from conversation ${conversationId} messages (${this.mode})`);
    };
  }
}
