import { WebGunService } from './web-gun-service';
import { Message } from '../../shared/types';
import type { ConversationTransportMode, P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { LedgerState } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { StarGunConversationTransport } from './star-gun-conversation-transport';
import type { ConversationMessageWire } from './star-gun-conversation-transport';
import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';
import type { TransportFallbackInfo } from './resilient-conversation-transport';
import { TechSupportConversationTransport } from './techsupport-conversation-transport';

/**
 * Methods an ordinary-peer conversation transport may optionally expose for P2P
 * diagnostics / ledger handshakes. Both DirectP2PConversationTransport and the
 * (now non-default) ResilientConversationTransport satisfy this, so the service no
 * longer special-cases the resilient wrapper.
 */
type DirectCapableTransport = ConversationTransport & {
  getConnectionState?(conversationId: string, localUserId: string): string;
  getHandshakeDiagnostics?(
    conversationId: string,
    localUserId: string,
  ): import('../../shared/p2p-handshake').HandshakeDiagnostics | null;
  setLedgerHandshakeHooks?(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void;
  setFallbackHandler?(handler: (info: TransportFallbackInfo) => void): void;
  setFailModesForE2e?(modes: ConversationTransportMode[]): void;
  setUndeliverableHandler?(
    handler: (wire: ConversationMessageWire, conversationId: string, recipientUserId: string) => void,
  ): void;
};

export type SendMessageOptions = {
  channel?: Message['channel'];
  /** If omitted, the other participant is inferred from the conversation record. */
  otherUserId?: string;
  /** Deterministic/idempotent message id override (used by auto-share links). */
  messageId?: string;
  /** Preserve chatbot marker when caller emits synthetic/system messages. */
  isFromChatbot?: boolean;
};

export type ConversationTransport = {
  mode: ConversationTransportMode;
  sendMessage(conversationId: string, senderId: string, text: string, opts?: SendMessageOptions): Promise<void>;
  /**
   * Subscribe to messages in a conversation.
   * @param myUserId — when provided, the transport tracks the latest message from
   *   the other participant so it can be attached as `prevSeen` on outgoing messages
   *   (REQ-LEDGER-08 two-writer DAG).
   */
  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): () => void;
};


export class WebConversationService {
  private transport: ConversationTransport;
  private readonly starTransport: StarGunConversationTransport;
  private readonly supportTransport: TechSupportConversationTransport;
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  } = {};

  constructor(private gunService: WebGunService, transport?: ConversationTransport) {
    this.starTransport = new StarGunConversationTransport(gunService);
    this.supportTransport = new TechSupportConversationTransport(gunService);
    // P2P-messaging Phase 1 (spec §19.4): ordinary-peer DMs use direct-p2p ONLY —
    // WebRTC delivery with Gun-on-device as the source of truth, no star/relay
    // fallback. (TechSupport keeps its own server-backed transport.)
    this.transport = transport ?? this.createOrdinaryTransport();
  }

  setTransportFallbackHandler(
    handler: (info: {
      conversationId: string;
      mode: ConversationTransportMode;
      fallbackReason: string;
    }) => void,
  ): void {
    // No-op for the direct-p2p default (no fallback chain); honored if a resilient
    // transport is injected.
    (this.transport as DirectCapableTransport).setFallbackHandler?.(handler);
  }

  setLedgerHandshakeHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void {
    this.ledgerHooks = hooks;
    (this.transport as DirectCapableTransport).setLedgerHandshakeHooks?.(hooks);
  }

  /** Ordinary-peer transport: direct-p2p (WebRTC + Gun-on-device), no star fallback. */
  private createOrdinaryTransport(): DirectP2PConversationTransport {
    const direct = new DirectP2PConversationTransport(this.gunService);
    direct.setLedgerHandshakeHooks(this.ledgerHooks);
    return direct;
  }

  getTransportMode(): ConversationTransportMode {
    return this.transport.mode;
  }

  /**
   * Phase 4: register the offline-mailbox fallback. The handler fires when an
   * ordinary DM is persisted to local Gun but can't be delivered over WebRTC (peer
   * offline); the app queues it into the recipient's encrypted mailbox. No-op for
   * transports without the hook (e.g. TechSupport / injected test transports).
   */
  setMessageUndeliverableHandler(
    handler: (wire: ConversationMessageWire, conversationId: string, recipientUserId: string) => void,
  ): void {
    (this.transport as DirectCapableTransport).setUndeliverableHandler?.(handler);
  }

  /**
   * Test-only: force the named conversation transports to fail so the resilient
   * fallback chain (`direct-p2p → server-relay → star-gun`) can be exercised
   * deterministically in E2E. No-op for the direct-p2p default (no fallback chain).
   */
  setTransportFailModesForE2e(modes: ConversationTransportMode[]): void {
    (this.transport as DirectCapableTransport).setFailModesForE2e?.(modes);
  }

  private isSupportConversation(conversationId: string, otherUserId?: string): boolean {
    if (conversationId.startsWith('conv_support_')) return true;
    return otherUserId === TECHSUPPORT_ROOT_USER_ID;
  }

  private resolveTransport(conversationId: string, otherUserId?: string): ConversationTransport {
    if (this.isSupportConversation(conversationId, otherUserId)) {
      return this.supportTransport;
    }
    return this.transport;
  }

  getDirectP2PConnectionState(conversationId: string, localUserId: string): string {
    return (this.transport as DirectCapableTransport).getConnectionState?.(conversationId, localUserId) ?? 'idle';
  }

  /** P2P-Y: expose handshake diagnostics for E2E verification. */
  getHandshakeDiagnostics(
    conversationId: string,
    localUserId: string,
  ): import('../../shared/p2p-handshake').HandshakeDiagnostics | null {
    return (this.transport as DirectCapableTransport).getHandshakeDiagnostics?.(conversationId, localUserId) ?? null;
  }

  /** Align client transport with server/runtime flags (E2E webpack env + production hub). */
  applyRuntimeTransportFlags(_flags: P2PRuntimeFlags): void {
    // Ordinary-peer DMs are direct-p2p only (spec §19.4); nothing flag-dependent to swap.
    if (this.transport.mode !== 'direct-p2p') {
      this.transport = this.createOrdinaryTransport();
      console.log(`🔀 Conversation transport set to ${this.transport.mode}`);
    }
  }

  /**
   * Create a new conversation between two users after a match
   */
  createConversation(params: {
    userId1: string;
    userName1: string;
    userId2: string;
    userName2: string;
    talkId: string;
    respondedByBotForUser1?: boolean;
    respondedByBotForUser2?: boolean;
  }): Promise<string> {
    const gun = this.gunService.getGun();

    const sortedIds = [params.userId1, params.userId2].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${params.talkId}`;

    console.log(`💬 Creating conversation: ${conversationId}`);

    // Gun.put is idempotent — no need to .once()-check first.
    // Skipping the existence check eliminates a Gun round-trip that can stall
    // the match notification path for several seconds on a busy graph.
    const conversationData = {
      id: conversationId,
      participants: [params.userId1, params.userId2],
      talkId: params.talkId,
      createdAt: new Date().toISOString(),
      status: 'active',
      transportMode: this.transport.mode,
    };

    gun.get(`conversations/${conversationId}`).put({
      data: JSON.stringify(conversationData),
    });

    gun.get(`users/${params.userId1}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: params.userId2,
      otherUserName: params.userName2,
      talkId: params.talkId,
      createdAt: new Date().toISOString(),
      respondedByBot: !!params.respondedByBotForUser1,
      transportMode: this.transport.mode,
    });

    gun.get(`users/${params.userId2}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: params.userId1,
      otherUserName: params.userName1,
      talkId: params.talkId,
      createdAt: new Date().toISOString(),
      respondedByBot: !!params.respondedByBotForUser2,
      transportMode: this.transport.mode,
    });

    console.log(`✅ Conversation created: ${conversationId}`);
    return Promise.resolve(conversationId);
  }

  /**
   * Send a message in a conversation. Non-public channels encrypt with ECDH `SEA.secret(theirEpub, myPair)`.
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    return this.resolveTransport(conversationId, opts?.otherUserId).sendMessage(
      conversationId,
      senderId,
      text,
      opts,
    );
  }

  /**
   * Subscribe to messages in a conversation.
   * @param myUserId — when provided, the transport tracks the latest message from
   *   the other participant so it can populate `prevSeen` on outgoing messages
   *   (REQ-LEDGER-08 two-writer DAG).
   */
  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): () => void {
    return this.resolveTransport(conversationId, otherUserId).subscribeToMessages(
      conversationId,
      callback,
      myUserId,
      otherUserId,
    );
  }

  /**
   * Idempotent low-level upsert for a conversation message record.
   * Used by mailbox-drained auto-share payloads to materialize deterministic
   * link messages even when the recipient was offline.
   */
  upsertMessageRecord(
    conversationId: string,
    wire: ConversationMessageWire,
    opts?: { otherUserId?: string },
  ): void {
    this.starTransport.putMessageRecord(conversationId, wire, opts);
  }

  /**
   * One-shot snapshot of user's conversations from Gun.
   *
   * Uses .map().once() so Gun resolves each child soul-reference before invoking
   * the callback. Calling .once() directly on the parent node returns a map of
   * opaque soul references ({#: '...'}), which have no otherUserId and get
   * filtered out — use .map().once() (same pattern as listKnownPeople) to get
   * the actual conversation objects.
   */
  async getUserConversationsSnapshot(userId: string): Promise<any[]> {
    const gun = this.gunService.getGun();
    const items: any[] = [];
    return new Promise((resolve) => {
      gun
        .get(`users/${userId}`)
        .get('conversations')
        .map()
        .once((conversationData: any, conversationId: string) => {
          if (!conversationId || conversationId.startsWith('_')) return;
          if (!conversationData || typeof conversationData !== 'object') return;
          if (!conversationData.otherUserId) return;
          items.push({
            ...conversationData,
            conversationId: conversationData.conversationId || conversationId,
          });
        });
      // Allow Gun time to resolve all child nodes before resolving.
      setTimeout(() => resolve(items), 500);
    });
  }

  /**
   * Subscribe to user's conversations list
   */
  subscribeToUserConversations(
    userId: string,
    callback: (conversations: any[]) => void,
  ): () => void {
    const gun = this.gunService.getGun();
    const seenPayloadByConversation = new Map<string, string>();

    gun
      .get(`users/${userId}`)
      .get('conversations')
      .map()
      .on((conversationData: any, conversationId: string) => {
        if (conversationId.startsWith('_')) return;

        // Gun can emit partial values before the full object is replicated. Ignore these and wait.
        if (!conversationData || typeof conversationData !== 'object' || !conversationData.otherUserId) {
          return;
        }

        const normalized = {
          ...conversationData,
          conversationId: conversationData.conversationId || conversationId,
        };

        const signature = JSON.stringify({
          otherUserId: normalized.otherUserId,
          otherUserName: normalized.otherUserName || '',
          talkId: normalized.talkId || '',
          createdAt: normalized.createdAt || '',
          respondedByBot: !!normalized.respondedByBot,
          transportMode: normalized.transportMode || '',
        });
        if (seenPayloadByConversation.get(conversationId) === signature) return;

        seenPayloadByConversation.set(conversationId, signature);
        console.log(`🔔 Conversation update detected: ${conversationId}`, normalized);
        callback([normalized]);
      });

    return () => {
      console.log(`👋 Unsubscribed from user ${userId} conversations`);
    };
  }
}
