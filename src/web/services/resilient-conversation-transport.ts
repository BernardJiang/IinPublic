import type { Message } from '../../shared/types';
import type { LedgerState } from '../../shared/types';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';
import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';
import { ServerRelayConversationTransport } from './server-relay-conversation-transport';
import { StarGunConversationTransport } from './star-gun-conversation-transport';
import { reportTransportDiagnostic } from './p2p-transport-diagnostics-client';
import { P2P_WEBRTC_CONNECT_TIMEOUT_MS } from './p2p-webrtc-session';

export type TransportFallbackInfo = {
  conversationId: string;
  mode: ConversationTransportMode;
  fallbackReason: string;
};

export type ResilientConversationTransportOptions = {
  onFallback?: (info: TransportFallbackInfo) => void;
};

/**
 * Tries direct-p2p first, then encrypted server-relay, then star-gun —
 * matching createConversationTransportDiagnostics().fallback policy.
 */
export class ResilientConversationTransport implements ConversationTransport {
  private activeMode: ConversationTransportMode = 'direct-p2p';
  private readonly direct: DirectP2PConversationTransport;
  private readonly relay: ServerRelayConversationTransport;
  private readonly star: StarGunConversationTransport;
  private readonly apiBase: string;
  private options: ResilientConversationTransportOptions;

  constructor(
    gunService: WebGunService,
    starTransport: StarGunConversationTransport,
    options: ResilientConversationTransportOptions = {},
  ) {
    this.options = options;
    this.apiBase = DirectP2PConversationTransport.resolveApiBase();
    this.direct = new DirectP2PConversationTransport(gunService, this.apiBase);
    this.relay = new ServerRelayConversationTransport(gunService, this.apiBase);
    this.star = starTransport;
  }

  get mode(): ConversationTransportMode {
    return this.activeMode;
  }

  setFallbackHandler(handler: (info: TransportFallbackInfo) => void): void {
    this.options.onFallback = handler;
  }

  getDirectTransport(): DirectP2PConversationTransport {
    return this.direct;
  }

  getConnectionState(conversationId: string, localUserId: string): string {
    return this.direct.getConnectionState(conversationId, localUserId);
  }

  setLedgerHandshakeHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void {
    this.direct.setLedgerHandshakeHooks(hooks);
  }

  private activeTransport(): ConversationTransport {
    if (this.activeMode === 'server-relay') return this.relay;
    if (this.activeMode === 'star-gun') return this.star;
    return this.direct;
  }

  private async switchMode(
    mode: ConversationTransportMode,
    fallbackReason: string,
    conversationId: string,
  ): Promise<void> {
    if (this.activeMode === mode) return;
    this.activeMode = mode;
    await reportTransportDiagnostic(this.apiBase, mode, fallbackReason);
    this.options.onFallback?.({ conversationId, mode, fallbackReason });
    console.warn(`🔀 Conversation transport fallback → ${mode}: ${fallbackReason}`);
  }

  private async tryDirectConnect(conversationId: string, localUserId: string): Promise<boolean> {
    try {
      await this.direct.ensureSessionConnected(conversationId, localUserId);
      const state = this.direct.getConnectionState(conversationId, localUserId);
      return state === 'connected';
    } catch {
      return false;
    }
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    if (this.activeMode === 'direct-p2p') {
      try {
        await this.direct.sendMessage(conversationId, senderId, text, opts);
        return;
      } catch (err) {
        await this.switchMode('server-relay', (err as Error).message || 'direct send failed', conversationId);
      }
    }
    if (this.activeMode === 'server-relay') {
      try {
        await this.relay.sendMessage(conversationId, senderId, text, opts);
        return;
      } catch (err) {
        await this.switchMode('star-gun', (err as Error).message || 'relay send failed', conversationId);
      }
    }
    await this.activeTransport().sendMessage(conversationId, senderId, text, opts);
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

    let activeUnsub: (() => void) | null = null;
    let disposed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const attach = (transport: ConversationTransport) => {
      activeUnsub?.();
      activeUnsub = transport.subscribeToMessages(conversationId, callback, myUserId);
    };

    attach(this.direct);

    void this.tryDirectConnect(conversationId, myUserId).then((connected) => {
      if (disposed || connected || this.activeMode !== 'direct-p2p') return;
      fallbackTimer = setTimeout(() => {
        if (disposed || this.activeMode !== 'direct-p2p') return;
        const state = this.direct.getConnectionState(conversationId, myUserId);
        if (state === 'connected') return;
        void this.switchMode('server-relay', 'WebRTC connection timeout', conversationId).then(() => {
          if (!disposed) attach(this.relay);
        });
      }, P2P_WEBRTC_CONNECT_TIMEOUT_MS);
    });

    return () => {
      disposed = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      activeUnsub?.();
      console.log(`👋 Unsubscribed from conversation ${conversationId} messages (${this.activeMode})`);
    };
  }
}
