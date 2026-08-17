import { WebGunService } from './web-gun-service';
import { Message } from '../../shared/types';
import type { ConversationTransportMode, P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { LedgerState } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { StarGunConversationTransport } from './star-gun-conversation-transport';
import type { ConversationMessageWire } from './star-gun-conversation-transport';
import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';
import { TechSupportConversationTransport } from './techsupport-conversation-transport';

/**
 * Optional diagnostics / ledger-handshake methods that DirectP2PConversationTransport
 * exposes beyond the base ConversationTransport interface.
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
  setUndeliverableHandler?(
    handler: (wire: ConversationMessageWire, conversationId: string, recipientUserId: string) => void,
  ): void;
  setAttachmentHooks?(hooks: {
    getAttachmentBytesForCid?: (cid: string) => Promise<Uint8Array | null>;
    onAttachmentBytes?: (cid: string, bytes: Uint8Array) => void;
  }): void;
  requestAttachment?(conversationId: string, localUserId: string, otherUserId: string, cid: string): Promise<void>;
};

export type SendMessageOptions = {
  channel?: Message['channel'];
  /** If omitted, the other participant is inferred from the conversation record. */
  otherUserId?: string;
  /** Deterministic/idempotent message id override (used by auto-share links). */
  messageId?: string;
  /** Preserve chatbot marker when caller emits synthetic/system messages. */
  isFromChatbot?: boolean;
  /** Per-matched-talk thread scope (redesign §5); omit for the pair DM thread. */
  talkId?: string;
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
  private readonly supportTransport: TechSupportConversationTransport;
  /**
   * Gun-backed message store — used only for local Gun writes (e.g. offline mailbox
   * ingestion via upsertMessageRecord). NOT used as a conversation transport.
   */
  private readonly gunMessageStore: StarGunConversationTransport;
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  } = {};

  constructor(private gunService: WebGunService, transport?: ConversationTransport) {
    this.gunMessageStore = new StarGunConversationTransport(gunService);
    this.supportTransport = new TechSupportConversationTransport(gunService);
    // Ordinary-peer DMs use direct-p2p ONLY (spec §19.4): WebRTC + Gun-on-device.
    // No star-gun or server-relay fallback. TechSupport keeps its own transport.
    this.transport = transport ?? this.createOrdinaryTransport();
  }

  static buildPairConversationId(userId1: string, userId2: string): string {
    const sortedIds = [userId1, userId2].sort();
    return `conv_pair_${sortedIds[0]}_${sortedIds[1]}`;
  }

  setTransportFallbackHandler(
    _handler: (info: {
      conversationId: string;
      mode: ConversationTransportMode;
      fallbackReason: string;
    }) => void,
  ): void {
    // No-op: direct-p2p has no fallback chain so the handler is never invoked.
  }

  setLedgerHandshakeHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void {
    this.ledgerHooks = hooks;
    (this.transport as DirectCapableTransport).setLedgerHandshakeHooks?.(hooks);
  }

  /** Wire P2P media providers (serve/receive attachment bytes over the DM DataChannel). */
  setAttachmentHooks(hooks: {
    getAttachmentBytesForCid?: (cid: string) => Promise<Uint8Array | null>;
    onAttachmentBytes?: (cid: string, bytes: Uint8Array) => void;
  }): void {
    (this.transport as DirectCapableTransport).setAttachmentHooks?.(hooks);
  }

  /** Pull a shared attachment's bytes from the peer over the DM DataChannel (no server). */
  async requestAttachment(conversationId: string, localUserId: string, otherUserId: string, cid: string): Promise<void> {
    await (this.transport as DirectCapableTransport).requestAttachment?.(conversationId, localUserId, otherUserId, cid);
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
  private parseConversationData(raw: any): any | null {
    if (!raw) return null;
    const candidate = raw.data ?? raw;
    if (typeof candidate === 'string') {
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    return typeof candidate === 'object' ? candidate : null;
  }

  private readConversationData(conversationId: string): Promise<any | null> {
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const done = (value: any | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      timeout = setTimeout(() => done(null), 250);
      gun.get(`conversations/${conversationId}`).once((raw: any) => {
        done(this.parseConversationData(raw));
      });
    });
  }

  private relatedTalkIds(existing: any | null, talkId: string): string[] {
    const ids = new Set<string>();
    const add = (id: unknown) => {
      const value = String(id ?? '').trim();
      if (!value || value === 'direct') return;
      ids.add(value);
    };

    if (Array.isArray(existing?.relatedTalkIds)) {
      for (const id of existing.relatedTalkIds) add(id);
    }
    if (typeof existing?.relatedTalkIdsJson === 'string') {
      try {
        const parsed = JSON.parse(existing.relatedTalkIdsJson);
        if (Array.isArray(parsed)) {
          for (const id of parsed) add(id);
        }
      } catch {
        /* ignore malformed legacy metadata */
      }
    }

    add(existing?.talkId);
    add(talkId);
    return Array.from(ids);
  }

  async createConversation(params: {
    userId1: string;
    userName1: string;
    userId2: string;
    userName2: string;
    talkId: string;
    respondedByBotForUser1?: boolean;
    respondedByBotForUser2?: boolean;
    /**
     * Spec §30.2: whether the talk this conversation formed from declares a
     * selfTag/preferenceSet pair — written directly onto the conversation record (rather than
     * left for each side to re-derive from their own local talk cache, which may not have a
     * matching entry for whichever specific talkId this particular exchange ended up keyed to)
     * so the deal-confirmation UI can read it with zero ambiguity from either side.
     */
    dealEligible?: boolean;
    /**
     * Route `matchThreshold` scoring result (spec §30.2, `computeRouteMatchScore` in
     * talk-engine.ts) — written directly onto the conversation record, same reasoning as
     * `dealEligible`, so the talk owner's "Matched items" list can sort/display it without
     * re-deriving it from a local talk cache. Falls back to whatever's already on the record
     * when this particular call doesn't carry one (e.g. an unrelated conversation update).
     */
    matchScore?: number;
    matchTotal?: number;
  }): Promise<string> {
    const gun = this.gunService.getGun();

    const conversationId = WebConversationService.buildPairConversationId(params.userId1, params.userId2);
    const existing = await this.readConversationData(conversationId);
    const relatedTalkIds = this.relatedTalkIds(existing, params.talkId);
    const createdAt = existing?.createdAt || new Date().toISOString();
    const displayTalkId =
      params.talkId && params.talkId !== 'direct'
        ? params.talkId
        : existing?.talkId || params.talkId;
    const dealEligible = !!params.dealEligible || !!existing?.dealEligible;
    const matchScore = params.matchScore ?? existing?.matchScore;
    const matchTotal = params.matchTotal ?? existing?.matchTotal;

    console.log(`💬 Creating conversation: ${conversationId}`);

    // Gun.put is idempotent — no need to .once()-check first.
    // Skipping the existence check eliminates a Gun round-trip that can stall
    // the match notification path for several seconds on a busy graph.
    const conversationData = {
      id: conversationId,
      participants: [params.userId1, params.userId2],
      talkId: displayTalkId,
      relatedTalkIdsJson: JSON.stringify(relatedTalkIds),
      createdAt,
      status: 'active',
      transportMode: this.transport.mode,
      dealEligible,
      ...(matchScore !== undefined ? { matchScore } : {}),
      ...(matchTotal !== undefined ? { matchTotal } : {}),
    };

    gun.get(`conversations/${conversationId}`).put({
      data: JSON.stringify(conversationData),
    });

    gun.get(`users/${params.userId1}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: params.userId2,
      otherUserName: params.userName2,
      talkId: displayTalkId,
      relatedTalkIdsJson: JSON.stringify(relatedTalkIds),
      createdAt,
      respondedByBot: !!params.respondedByBotForUser1,
      transportMode: this.transport.mode,
      dealEligible,
      ...(matchScore !== undefined ? { matchScore } : {}),
      ...(matchTotal !== undefined ? { matchTotal } : {}),
    });

    gun.get(`users/${params.userId2}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: params.userId1,
      otherUserName: params.userName1,
      talkId: displayTalkId,
      relatedTalkIdsJson: JSON.stringify(relatedTalkIds),
      createdAt,
      respondedByBot: !!params.respondedByBotForUser2,
      transportMode: this.transport.mode,
      dealEligible,
      ...(matchScore !== undefined ? { matchScore } : {}),
      ...(matchTotal !== undefined ? { matchTotal } : {}),
    });

    console.log(`✅ Conversation created: ${conversationId}`);
    return conversationId;
  }

  /**
   * Bidirectional deal confirmation: appends `userId` to the conversation's `dealConfirmedBy`
   * list, idempotently. Only meaningful for a conversation whose talk declares
   * `selfTag`/`preferenceSet` (spec §30.2) — a match isn't exclusive on its own when several
   * compatible buyers/sellers exist, so a deal is only "done" once BOTH participants have
   * confirmed here. Returns the updated list so the caller can check for both-confirmed
   * without a second read.
   */
  async confirmDeal(conversationId: string, userId: string): Promise<string[]> {
    const gun = this.gunService.getGun();
    const existing = await this.readConversationData(conversationId);
    const alreadyConfirmedBy: string[] = Array.isArray(existing?.dealConfirmedBy) ? existing.dealConfirmedBy : [];
    const dealConfirmedBy = alreadyConfirmedBy.includes(userId)
      ? alreadyConfirmedBy
      : [...alreadyConfirmedBy, userId];

    const conversationData = { ...(existing || {}), dealConfirmedBy };
    gun.get(`conversations/${conversationId}`).put({
      data: JSON.stringify(conversationData),
    });

    const participants: string[] = Array.isArray(existing?.participants) ? existing.participants : [];
    for (const participantId of participants) {
      gun.get(`users/${participantId}`).get('conversations').get(conversationId).get('dealConfirmedByJson').put(JSON.stringify(dealConfirmedBy));
    }

    return dealConfirmedBy;
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
    this.gunMessageStore.putMessageRecord(conversationId, wire, opts);
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
          relatedTalkIdsJson: normalized.relatedTalkIdsJson || '',
          createdAt: normalized.createdAt || '',
          respondedByBot: !!normalized.respondedByBot,
          transportMode: normalized.transportMode || '',
          dealConfirmedByJson: normalized.dealConfirmedByJson || '',
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
