import { WebGunService } from './web-gun-service';
import { Message } from '../../shared/types';
import type { ConversationTransportMode, P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { LedgerState } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { StarGunConversationTransport } from './star-gun-conversation-transport';
import type { ConversationMessageWire } from './star-gun-conversation-transport';
import { ResilientConversationTransport } from './resilient-conversation-transport';
import { TechSupportConversationTransport } from './techsupport-conversation-transport';

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
  ): () => void;
};


export class WebConversationService {
  private transport: ConversationTransport;
  private readonly starTransport: StarGunConversationTransport;
  private readonly supportTransport: TechSupportConversationTransport;
  private onTransportFallback?: (info: {
    conversationId: string;
    mode: ConversationTransportMode;
    fallbackReason: string;
  }) => void;
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  } = {};

  constructor(private gunService: WebGunService, transport?: ConversationTransport) {
    this.starTransport = new StarGunConversationTransport(gunService);
    this.supportTransport = new TechSupportConversationTransport(gunService);
    if (transport) {
      this.transport = transport;
    } else {
      // Direct P2P is always active — star-gun transport removed.
      this.transport = this.createResilientTransport();
    }
  }

  setTransportFallbackHandler(
    handler: (info: {
      conversationId: string;
      mode: ConversationTransportMode;
      fallbackReason: string;
    }) => void,
  ): void {
    this.onTransportFallback = handler;
    if (this.transport instanceof ResilientConversationTransport) {
      this.transport.setFallbackHandler(handler);
    }
  }

  setLedgerHandshakeHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void {
    this.ledgerHooks = hooks;
    if (this.transport instanceof ResilientConversationTransport) {
      this.transport.setLedgerHandshakeHooks(hooks);
    }
  }

  private createResilientTransport(): ResilientConversationTransport {
    const resilient = new ResilientConversationTransport(this.gunService, this.starTransport, {
      onFallback: (info) => this.onTransportFallback?.(info),
    });
    resilient.setLedgerHandshakeHooks(this.ledgerHooks);
    return resilient;
  }

  getTransportMode(): ConversationTransportMode {
    return this.transport.mode;
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
    if (this.transport instanceof ResilientConversationTransport) {
      return this.transport.getConnectionState(conversationId, localUserId);
    }
    return 'idle';
  }

  /** P2P-Y: expose handshake diagnostics for E2E verification. */
  getHandshakeDiagnostics(
    conversationId: string,
    localUserId: string,
  ): import('../../shared/p2p-handshake').HandshakeDiagnostics | null {
    if (this.transport instanceof ResilientConversationTransport) {
      return this.transport.getHandshakeDiagnostics(conversationId, localUserId);
    }
    return null;
  }

  /** Align client transport with server/runtime flags (E2E webpack env + production hub). */
  applyRuntimeTransportFlags(_flags: P2PRuntimeFlags): void {
    // Direct P2P is always active — star-gun transport removed.
    const desired = this.createResilientTransport();
    if (this.transport.mode !== desired.mode) {
      this.transport = desired;
      console.log(`🔀 Conversation transport set to ${desired.mode}`);
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
