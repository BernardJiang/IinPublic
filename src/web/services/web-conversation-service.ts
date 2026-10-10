import { WebGunService } from './web-gun-service';
import { Message, type InteractionEvent } from '../../shared/types';
import type { ConversationTransportMode, P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { LedgerState } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { StarGunConversationTransport } from './star-gun-conversation-transport';
import type { ConversationMessageWire } from './star-gun-conversation-transport';
import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';
import { TechSupportConversationTransport } from './techsupport-conversation-transport';
import { getSEA, type GunPair } from '../sea-gun';
import {
  LocalPrivateConversationMetadataRepository,
  type LocalConversationMetadata,
} from './local-private-conversation-metadata-repository';
import {
  createConversationWakeup,
  verifyConversationWakeup,
} from '../../shared/conversation-wakeup';

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
    getLedgerDelta?: (remoteState: LedgerState) => Promise<InteractionEvent[]>;
    onRemoteLedgerEvents?: (otherUserId: string, events: InteractionEvent[]) => void | Promise<void>;
  }): void;
  setUndeliverableHandler?(
    handler: (wire: ConversationMessageWire, conversationId: string, recipientUserId: string) => void,
  ): void;
  setAttachmentHooks?(hooks: {
    // KNOWN RESIDUAL GAP: this hook is invoked with only a bare cid, never the requesting
    // peer's identity, so the block-enforcement work covering attachment share messages
    // (app.ts's resolveBlockStatusEitherWay, used by autoShareMatchedTalkAttachments /
    // shareConversationMedia / maybeFetchSharedAttachmentBytes / ingestAttachmentShareFromMailbox)
    // cannot reach this path. See web-content-node-service.ts's readLocalBlock doc comment for
    // the full explanation and why this narrows but doesn't eliminate the gap.
    getAttachmentBytesForCid?: (cid: string) => Promise<Uint8Array | null>;
    onAttachmentBytes?: (cid: string, bytes: Uint8Array) => void;
  }): void;
  setConversationControlHooks?(hooks: {
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
  }): void;
  syncConversationControl?(
    conversationId: string,
    localUserId: string,
    otherUserId: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
  requestAttachment?(conversationId: string, localUserId: string, otherUserId: string, cid: string): Promise<void>;
  /** Scenario 2 (§16) — see direct-p2p-conversation-transport.ts's own doc comment. */
  setBuildTrustHooks?(hooks: {
    getBuildTrustCredential?: () => import('../../shared/official-build-credential').OfficialBuildCredential | undefined;
    officialApplicationId?: string;
    officialSigningIdentityHash?: string;
    lookupVerifierKey?: (verifierKeyId: string) => string | undefined;
  }): void;
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
  private readonly metadataRepository: LocalPrivateConversationMetadataRepository;
  private localUserId = '';
  private localUserName = '';
  private ledgerHooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
    getLedgerDelta?: (remoteState: LedgerState) => Promise<InteractionEvent[]>;
    onRemoteLedgerEvents?: (otherUserId: string, events: InteractionEvent[]) => void | Promise<void>;
  } = {};

  constructor(private gunService: WebGunService, transport?: ConversationTransport) {
    this.gunMessageStore = new StarGunConversationTransport(gunService);
    this.supportTransport = new TechSupportConversationTransport(gunService);
    this.metadataRepository = new LocalPrivateConversationMetadataRepository(gunService);
    // Ordinary-peer DMs use direct-p2p ONLY (spec §19.4): WebRTC + Gun-on-device.
    // No star-gun or server-relay fallback. TechSupport keeps its own transport.
    this.transport = transport ?? this.createOrdinaryTransport();
  }

  /** Must be called once the app has resolved the device-local user record. */
  setLocalUser(userId: string, stageName = ''): void {
    this.localUserId = String(userId || '').trim();
    this.localUserName = String(stageName || '').trim();
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
    getLedgerDelta?: (remoteState: LedgerState) => Promise<InteractionEvent[]>;
    onRemoteLedgerEvents?: (otherUserId: string, events: InteractionEvent[]) => void | Promise<void>;
  }): void {
    this.ledgerHooks = hooks;
    (this.transport as DirectCapableTransport).setLedgerHandshakeHooks?.(hooks);
  }

  /** Scenario 2 (§16): wire this device's build-trust credential + evaluation context onto the
   * direct-p2p transport — see direct-p2p-conversation-transport.ts's own doc comment. */
  setBuildTrustHooks(hooks: {
    getBuildTrustCredential?: () => import('../../shared/official-build-credential').OfficialBuildCredential | undefined;
    officialApplicationId?: string;
    officialSigningIdentityHash?: string;
    lookupVerifierKey?: (verifierKeyId: string) => string | undefined;
  }): void {
    (this.transport as DirectCapableTransport).setBuildTrustHooks?.(hooks);
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
    direct.setConversationControlHooks({
      getConversationControlSnapshot: async (conversationId, localUserId, otherUserId) => {
        const metadata = await this.metadataRepository.get(localUserId, conversationId);
        return metadata ? this.outboundConversationControl(metadata, localUserId, otherUserId) : null;
      },
      onRemoteConversationControl: (conversationId, otherUserId, metadata) =>
        this.ingestDirectConversationControl(conversationId, otherUserId, metadata),
    });
    return direct;
  }

  private outboundConversationControl(
    metadata: LocalConversationMetadata,
    localUserId: string,
    otherUserId: string,
  ): Record<string, unknown> {
    return {
      version: 1,
      kind: 'conversation-metadata',
      conversationId: metadata.conversationId,
      senderUserId: localUserId,
      senderUserName: this.localUserName || localUserId,
      recipientUserId: otherUserId,
      talkId: metadata.talkId || '',
      relatedTalkIdsJson: metadata.relatedTalkIdsJson || '[]',
      createdAt: metadata.createdAt || new Date().toISOString(),
      updatedAt: metadata.updatedAt || new Date().toISOString(),
      transportMode: metadata.transportMode || this.transport?.mode || 'direct-p2p',
      dealEligible: metadata.dealEligible === true,
      dealConfirmedByJson: metadata.dealConfirmedByJson || '[]',
      ...(metadata.matchScore !== undefined ? { matchScore: metadata.matchScore } : {}),
      ...(metadata.matchTotal !== undefined ? { matchTotal: metadata.matchTotal } : {}),
    };
  }

  private async ingestDirectConversationControl(
    conversationId: string,
    otherUserId: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const ownerUserId = this.localUserId;
    if (!ownerUserId
      || value.version !== 1
      || value.kind !== 'conversation-metadata'
      || value.conversationId !== conversationId
      || value.senderUserId !== otherUserId
      || value.recipientUserId !== ownerUserId) return;
    const existing = await this.metadataRepository.get(ownerUserId, conversationId);
    await this.metadataRepository.upsert(ownerUserId, {
      ...(existing || {}),
      conversationId,
      otherUserId,
      ...(typeof value.senderUserName === 'string'
        ? { otherUserName: value.senderUserName.slice(0, 200) }
        : {}),
      ...(typeof value.talkId === 'string' ? { talkId: value.talkId } : {}),
      ...(typeof value.relatedTalkIdsJson === 'string'
        ? { relatedTalkIdsJson: value.relatedTalkIdsJson }
        : {}),
      ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      transportMode: 'direct-p2p',
      dealEligible: value.dealEligible === true || existing?.dealEligible === true,
      ...(typeof value.dealConfirmedByJson === 'string'
        ? { dealConfirmedByJson: value.dealConfirmedByJson }
        : {}),
      ...(typeof value.matchScore === 'number' ? { matchScore: value.matchScore } : {}),
      ...(typeof value.matchTotal === 'number' ? { matchTotal: value.matchTotal } : {}),
    });
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

  private readLegacyConversationData(conversationId: string): Promise<any | null> {
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

  private ownerForParticipants(userId1: string, userId2: string): string {
    if (this.localUserId === userId1 || this.localUserId === userId2) return this.localUserId;
    // Compatibility for isolated unit/E2E helpers that construct the service directly.
    return userId1;
  }

  private async readConversationData(ownerUserId: string, conversationId: string): Promise<any | null> {
    const local = await this.metadataRepository.get(ownerUserId, conversationId);
    if (local) return local;
    // Mixed-release import only. New writes never return to these public paths.
    return this.readLegacyConversationData(conversationId);
  }

  private metadataForOwner(params: {
    ownerUserId: string;
    userId1: string;
    userName1: string;
    userId2: string;
    userName2: string;
    conversationId: string;
    talkId: string;
    relatedTalkIds: string[];
    createdAt: string;
    respondedByBotForUser1?: boolean;
    respondedByBotForUser2?: boolean;
    dealEligible: boolean;
    matchScore?: number;
    matchTotal?: number;
  }): LocalConversationMetadata {
    const ownerIsUser1 = params.ownerUserId === params.userId1;
    return {
      conversationId: params.conversationId,
      otherUserId: ownerIsUser1 ? params.userId2 : params.userId1,
      otherUserName: ownerIsUser1 ? params.userName2 : params.userName1,
      talkId: params.talkId,
      relatedTalkIdsJson: JSON.stringify(params.relatedTalkIds),
      createdAt: params.createdAt,
      updatedAt: new Date().toISOString(),
      respondedByBot: ownerIsUser1
        ? !!params.respondedByBotForUser1
        : !!params.respondedByBotForUser2,
      transportMode: this.transport.mode,
      dealEligible: params.dealEligible,
      ...(params.matchScore !== undefined ? { matchScore: params.matchScore } : {}),
      ...(params.matchTotal !== undefined ? { matchTotal: params.matchTotal } : {}),
    };
  }

  private async publishConversationWakeup(
    senderUserId: string,
    recipientUserId: string,
    metadata: LocalConversationMetadata,
  ): Promise<void> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv || !pair.epub) return;
    let recipient: any = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      recipient = await this.gunService.getPublicUser(recipientUserId).catch(() => null);
      if (recipient?.pub && recipient.epub) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!recipient?.pub || !recipient.epub) return;
    const secret = await getSEA().secret(String(recipient.epub), pair as GunPair);
    if (!secret) return;
    // The public record only wakes the recipient's endpoint. Full metadata follows over the
    // authenticated DataChannel through `conversation-control`; this ciphertext intentionally
    // contains no Talk, match, name, or deal state.
    const ciphertext = await getSEA().encrypt(JSON.stringify({
      version: 1,
      kind: 'conversation-wakeup',
      conversationId: metadata.conversationId,
    }), secret);
    if (!ciphertext) return;
    const wakeup = await createConversationWakeup({
      conversationId: metadata.conversationId,
      senderUserId,
      recipientUserId,
      recipientPub: String(recipient.pub),
      ciphertext: String(ciphertext),
      pair,
    });
    this.gunService.getGun()
      .get('conversation-wakeups')
      .get(recipientUserId)
      .get(encodeURIComponent(metadata.conversationId))
      .put({ data: JSON.stringify(wakeup) });
  }

  private async ingestConversationWakeup(
    ownerUserId: string,
    value: unknown,
  ): Promise<void> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv) return;
    const verified = await verifyConversationWakeup(value, {
      recipientUserId: ownerUserId,
      recipientPub: String(pair.pub),
    });
    if (!verified.ok) return;
    const sender = await this.gunService.getPublicUser(verified.record.senderUserId).catch(() => null);
    if (!sender || String(sender.pub || '') !== verified.record.senderPub) return;
    const secret = await getSEA().secret(verified.record.senderEpub, pair as GunPair);
    if (!secret) return;
    const plaintext = await getSEA().decrypt(verified.record.ciphertext, secret);
    if (!plaintext) return;
    let wakeupPayload: { version?: number; kind?: string; conversationId?: string };
    try {
      wakeupPayload = (typeof plaintext === 'string' ? JSON.parse(plaintext) : plaintext) as typeof wakeupPayload;
    } catch {
      return;
    }
    if (wakeupPayload?.version !== 1
      || wakeupPayload.kind !== 'conversation-wakeup'
      || wakeupPayload.conversationId !== verified.record.conversationId) return;
    await this.metadataRepository.upsert(ownerUserId, {
      conversationId: verified.record.conversationId,
      otherUserId: verified.record.senderUserId,
      otherUserName: String(sender.stageName || verified.record.senderUserId),
      createdAt: verified.record.createdAt,
      updatedAt: verified.record.createdAt,
      transportMode: 'direct-p2p',
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
     * Spec §30.2: whether the talk this conversation formed from is deal-eligible (declares a
     * Pair-tag question) — written directly onto the conversation record (rather than left for
     * each side to re-derive from their own local talk cache, which may not have a matching
     * entry for whichever specific talkId this particular exchange ended up keyed to) so the
     * deal-confirmation UI can read it with zero ambiguity from either side.
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
    const conversationId = WebConversationService.buildPairConversationId(params.userId1, params.userId2);
    const ownerUserId = this.ownerForParticipants(params.userId1, params.userId2);
    const existing = await this.readConversationData(ownerUserId, conversationId);
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
    const common = {
      userId1: params.userId1,
      userName1: params.userName1,
      userId2: params.userId2,
      userName2: params.userName2,
      conversationId,
      talkId: displayTalkId,
      relatedTalkIds,
      createdAt,
      dealEligible,
      ...(params.respondedByBotForUser1 !== undefined
        ? { respondedByBotForUser1: params.respondedByBotForUser1 }
        : {}),
      ...(params.respondedByBotForUser2 !== undefined
        ? { respondedByBotForUser2: params.respondedByBotForUser2 }
        : {}),
      ...(matchScore !== undefined ? { matchScore } : {}),
      ...(matchTotal !== undefined ? { matchTotal } : {}),
    };
    const localMetadata = this.metadataForOwner({ ...common, ownerUserId });
    await this.metadataRepository.upsert(ownerUserId, localMetadata);

    const recipientUserId = ownerUserId === params.userId1 ? params.userId2 : params.userId1;
    const recipientMetadata = this.metadataForOwner({ ...common, ownerUserId: recipientUserId });
    void this.publishConversationWakeup(ownerUserId, recipientUserId, recipientMetadata).catch((error) => {
      console.warn(`Conversation wake-up publish failed for ${conversationId}:`, error);
    });

    console.log(`✅ Conversation created: ${conversationId}`);
    return conversationId;
  }

  /**
   * Bidirectional deal confirmation: appends `userId` to the conversation's `dealConfirmedBy`
   * list, idempotently. Only meaningful for a conversation whose talk is deal-eligible (spec
   * §30.2 — declares a Pair-tag question) — a match isn't exclusive on its own when several
   * compatible buyers/sellers exist, so a deal is only "done" once BOTH participants have
   * confirmed here. Returns the updated list so the caller can check for both-confirmed
   * without a second read.
   */
  async confirmDeal(conversationId: string, userId: string): Promise<string[]> {
    const existing = await this.readConversationData(userId, conversationId);
    const alreadyConfirmedBy: string[] = (() => {
      if (Array.isArray(existing?.dealConfirmedBy)) return existing.dealConfirmedBy;
      try {
        const parsed = JSON.parse(String(existing?.dealConfirmedByJson || '[]'));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    const dealConfirmedBy = alreadyConfirmedBy.includes(userId)
      ? alreadyConfirmedBy
      : [...alreadyConfirmedBy, userId];

    if (existing?.otherUserId) {
      await this.metadataRepository.upsert(userId, {
        ...existing,
        conversationId,
        otherUserId: existing.otherUserId,
        dealConfirmedByJson: JSON.stringify(dealConfirmedBy),
        updatedAt: new Date().toISOString(),
      });
      const updated = await this.metadataRepository.get(userId, conversationId);
      if (updated) {
        void (this.transport as DirectCapableTransport).syncConversationControl?.(
          conversationId,
          userId,
          existing.otherUserId,
          this.outboundConversationControl(updated, userId, existing.otherUserId),
        ).catch(() => {
          // Wake-up makes the peer open/reopen the direct session; the on-open snapshot retries.
          void this.publishConversationWakeup(userId, existing.otherUserId, updated).catch(() => undefined);
        });
      }
    }

    return dealConfirmedBy;
  }

  /** Encrypted-mailbox wake-up fallback when the short-lived public control record was missed. */
  async ensureIncomingConversation(params: {
    ownerUserId: string;
    conversationId: string;
    senderUserId: string;
    senderUserName?: string;
    createdAt?: string;
  }): Promise<void> {
    if (!params.ownerUserId || !params.conversationId || !params.senderUserId
      || params.ownerUserId === params.senderUserId) return;
    await this.metadataRepository.upsert(params.ownerUserId, {
      conversationId: params.conversationId,
      otherUserId: params.senderUserId,
      ...(params.senderUserName ? { otherUserName: params.senderUserName.slice(0, 200) } : {}),
      createdAt: params.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transportMode: 'direct-p2p',
    });
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
  ): Promise<void> {
    return this.gunMessageStore.putMessageRecord(conversationId, wire, opts);
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
  private async getLegacyUserConversationsSnapshot(userId: string): Promise<any[]> {
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

  async getUserConversationsSnapshot(userId: string): Promise<any[]> {
    const legacy = await this.getLegacyUserConversationsSnapshot(userId);
    await this.metadataRepository.importLegacyOnce(userId, legacy);
    return this.metadataRepository.list(userId);
  }

  /**
   * Subscribe to user's conversations list
   */
  subscribeToUserConversations(
    userId: string,
    callback: (conversations: any[]) => void,
  ): () => void {
    this.setLocalUser(userId, this.localUserName);
    const seenPayloadByConversation = new Map<string, string>();
    const emitChanged = (records: LocalConversationMetadata[]) => {
      const changed = records.filter((record) => {
        const signature = JSON.stringify(record);
        if (seenPayloadByConversation.get(record.conversationId) === signature) return false;
        seenPayloadByConversation.set(record.conversationId, signature);
        return true;
      });
      if (changed.length) callback(changed);
    };

    const offPrivate = this.metadataRepository.subscribe(userId, emitChanged);
    void this.getUserConversationsSnapshot(userId).then(emitChanged).catch(() => undefined);

    const wakeupChain = this.gunService.getGun()
      .get('conversation-wakeups')
      .get(userId)
      .map();
    wakeupChain.on((value: unknown) => {
      void this.ingestConversationWakeup(userId, value).catch((error) => {
        console.warn('Conversation wake-up ingest failed:', error);
      });
    });

    return () => {
      offPrivate();
      wakeupChain.off();
      console.log(`👋 Unsubscribed from user ${userId} conversations`);
    };
  }
}
