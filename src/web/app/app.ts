import { User, GPSCoordinate, Talk, type Tag, type IpfsAttachment, InteractionKind } from '../../shared/types';
import {
  deriveBackendApiBaseFromLocation,
  KEY_CUSTODY_DEVICE_SECRET_STORAGE,
  KEY_CUSTODY_STORAGE,
  WebGunService,
} from '../services/web-gun-service';
import { WebUserService } from '../services/web-user-service';
import { WebChatroomService } from '../services/web-chatroom-service';
import { WebTalkService } from '../services/web-talk-service';
import { WebConversationService } from '../services/web-conversation-service';
import { WebContentNodeService, type WebContentNode } from '../services/web-content-node-service';
import { WebLedgerService } from '../services/web-ledger-service';
import { UIManager, type BroadcastAudiencePreview } from '../ui/ui-manager';
import { LocationPrivacy } from '../../shared/location';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { applyPublicChatroomHierarchy, getAllChatroomIds, getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import {
  isRenderableSystemAnnouncement,
  isVerifiedTechSupportIdentity,
  readVerifiedTechSupportIdentity,
  type TechSupportIdentity,
} from '../../shared/system-announcements';
import { pickLatestTalkIdFromIncomingCluster } from '../../shared/incoming-talk-ids';
import { computeTalkIdFromTalkData, computeResponseId, canonicalSerialize, computeCIDv1 } from '../../shared/cid';
import { getDevStageZeroMaxGlobalMembers, isDevStageZero } from '../dev-stage-env';
import { purgeDevStageZeroGraph } from '../dev-stage-seeds';
import {
  isTechSupportUser,
  TECHSUPPORT_PUB,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';
import { resolveP2PRuntimeFlags, usesMeshTalkDelivery, type P2PRuntimeFlags } from '../../shared/p2p-runtime';
import { intakeFilterRejectReasons, type ReceiverIntakeContext } from '../../shared/talk-intake-filters';
import { getTalkIntakeFilters } from '../ui/talk-intake-filters';
import { P2PPresenceClient } from '../services/p2p-presence-client';
import { P2PLocalNodeBridgeClient } from '../services/p2p-local-node-bridge-client';
import { PeerMeshService } from '../services/peer-mesh-service';
import { WebMailboxClient } from '../services/web-mailbox-client';
import { getOrCreateLibp2pMeshSession } from '../services/p2p-libp2p-mesh-session';
import { getOrCreateP2PSession } from '../services/p2p-webrtc-session';
import { createFallbackMeshSession } from '../services/p2p-mesh-session-fallback';
import { P2PRoomDiscoveryService } from '../services/p2p-room-discovery';
import type { P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload, P2PMeshTalkRetractedPayload } from '../../shared/p2p-mesh-protocol';
import {
  collectLocalIncomingTalkClusters,
  mirrorIncomingTalkClustersToLocalGun,
  subscribeLocalIncomingTalkClusters,
  upsertLocalIncomingTalkCluster,
} from '../services/client-incoming-talk-mirror';
import { getSEA, type GunPair } from '../sea-gun';
import {
  applyTalkLedgerEvent,
  applyEdgeGateForPeer,
  shouldSuppressForPeer,
  getTalkLedgerDoc,
  getResponderVersionForTalk,
  writeResponderExchangedEntry,
  getResponderTargetsForIdentity,
  getResponderLastResponseId,
  writeAuthorExchangedEntries,
} from '../services/web-talk-ledger-store';
import { buildTalkIdentityKey } from '../../shared/cid';
import {
  buildTagIdentityKeys,
  filterTalkForRecipient,
  setTalkLedgerQuotaUnlimited,
  applyEvent as applyLedgerEvent,
  outcomeKey as ledgerOutcomeKey,
  retractedKey as ledgerRetractedKey,
} from '../../shared/talk-ledger';

type AttachmentShareMessagePayload = {
  kind: 'ipfs-auto-share-v1';
  conversationId: string;
  talkId: string;
  authorId: string;
  cid: string;
  link: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  enc: 'sea-pair' | 'none';
  keyCiphertext: string;
  sharedAt: string;
};

type MailboxAttachmentSharePayload = {
  kind: 'ipfs-conversation-share-v1';
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  text: string;
  timestamp: string;
};

/**
 * Phase 4: an ordinary DM queued to the recipient's offline mailbox because WebRTC
 * delivery failed. The `wire` is already SEA-ECDH-encrypted between the two users
 * (the mailbox additionally wraps it); on drain the recipient writes it idempotently
 * into local Gun via `conversationService.upsertMessageRecord`.
 */
type MailboxConversationMessagePayload = {
  kind: 'conversation-message-v1';
  conversationId: string;
  senderId: string;
  recipientUserId: string;
  wire: import('../services/gun-message-store').ConversationMessageWire;
};

export class IinPublicApp {
  private gunService: WebGunService;
  private userService: WebUserService;
  private chatroomService: WebChatroomService;
  private talkService: WebTalkService;
  private conversationService: WebConversationService;
  private contentNodeService: WebContentNodeService;
  /** Interaction ledger (Phase E). Initialized lazily after SEA keypair is ready. */
  private ledgerService: WebLedgerService | null = null;
  private uiManager: UIManager;
  private currentUser?: User;
  private currentLocation?: GPSCoordinate;
  private currentChatroomId?: string;
  /** Gun .map().on may replay the same response node; avoid duplicate match UI/conversations. */
  private processedTalkResponseKeys = new Set<string>();
  /** One auto chatbot reply per announcer for the same content-hash talk id (same qa_* = same talk; keys are not author-based talk identity). */
  private chatbotAutoReplySentForPair = new Set<string>();
  /** Bounded retries for template races (announcement can arrive before manual answer persistence finishes). */
  private chatbotAutoReplyRetryCountByPair = new Map<string, number>();
  private subscribedMemberCountRoomIds = new Set<string>();
  private stageZeroLastMemberCounts = new Map<string, number>();
  private stageZeroRepairInFlight = false;
  private stageZeroWatchdogTimer: ReturnType<typeof setInterval> | undefined;
  private stageZeroBootedAt = 0;
  private incomingApiRefreshTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  private travelModeActive: boolean = false;
  private travelHomeChatroomId: string | undefined = undefined;
  private travelChatroomId: string | undefined = undefined;
  private supportBootstrapChecked = false;
  private presenceClient: P2PPresenceClient | null = null;
  private conversationPreviewUnsubscribers = new Map<string, () => void>();
  private peerEpubByUserId = new Map<string, string>();
  private talkLedgerSuppressionDisabledForE2e = false;
  private mailboxFallbackDisabledForE2e = false;
  private localNodeBridge: P2PLocalNodeBridgeClient | null = null;
  private peerMeshService: PeerMeshService | null = null;
  private mailboxClient: WebMailboxClient | null = null;
  private mailboxPollTimer: ReturnType<typeof setInterval> | undefined;
  private mailboxDrainPromise: Promise<void> | null = null;
  private attachmentShareSentIds = new Set<string>();
  private fetchedAttachmentBytesByCid = new Map<string, Uint8Array>();
  private static readonly ATTACHMENT_SHARE_SENT_KEY = 'iinpublic_ipfs_share_sent_ids';
  public initialized = false;
  /**
   * Durable mesh-ping diagnostics record updated by onPing/onPong callbacks.
   * Exposed via getApp() for E2E assertion (design §6, R5).
   */
  public meshPingDiagnostics: {
    pingedOrigins: string[];
    pongedOrigins: string[];
    lastPingFrom: string | null;
    lastPongFrom: string | null;
  } = {
    pingedOrigins: [],
    pongedOrigins: [],
    lastPingFrom: null,
    lastPongFrom: null,
  };

  /**
   * Step 2: durable mesh announce-receipt diagnostics updated by onTalkAnnounce callback.
   * Each entry records a talkId + authorId pair received via a talk-announce mesh frame.
   * Exposed via getApp() for E2E assertion without requiring the full body pull to complete.
   */
  public meshAnnounceDiagnostics: {
    /** Announcements received: each entry is { talkId, authorId } */
    received: Array<{ talkId: string; authorId: string }>;
  } = {
    received: [],
  };
  public meshDiscoveryDiagnostics: {
    roomId: string | null;
    providerPeerIds: string[];
    discoveredUserIds: string[];
    bootstrapPeers: string[];
    updatedAt: string | null;
  } = {
    roomId: null,
    providerPeerIds: [],
    discoveredUserIds: [],
    bootstrapPeers: [],
    updatedAt: null,
  };
  private readonly e2eSeededIncomingClusters: any[] = [];
  private readonly e2eSeededTagTalks = new Map<string, any>();
  private incomingTalkClusterUnsubscribe: (() => void) | null = null;
  private roomDiscoveryService: P2PRoomDiscoveryService | null = null;
  private readonly roomDiscoveredUserIds = new Map<string, Set<string>>();
  private readonly p2pRuntimeFlags: P2PRuntimeFlags = resolveP2PRuntimeFlags(
    typeof process !== 'undefined'
      ? {
          P2P_NODE_ENABLED: process.env.P2P_NODE_ENABLED,
          RELAY_ONLY_HUB: process.env.RELAY_ONLY_HUB,
          P2P_CLIENT_TALK_MIRROR: process.env.P2P_CLIENT_TALK_MIRROR,
        }
      : {},
  );

  /** Initialize the interaction ledger after the SEA keypair is available. */
  private initLedger(): void {
    if (process.env.DISABLE_HMR === 'true') return;
    try {
      const pair = this.gunService.getStoredPair();
      const userId = this.currentUser?.id || '';
      const pubkey = pair?.pub || '';
      if (!userId || !pubkey) return; // not ready yet — will re-init after user is created
      this.ledgerService = new WebLedgerService(this.gunService, userId, pubkey);
      void this.ledgerService.loadOwnFeedHead()
        .then(() => {
          this.startLedgerDeltaSync();
          this.initLedgerTransportHooks();
        })
        .catch(() => {/* non-fatal */});
    } catch {/* non-fatal */}
  }

  /** Wire P2P transport fallback UI + WebRTC LEDGER_STATE hooks (REQ-LEDGER-06). */
  private initLedgerTransportHooks(): void {
    this.conversationService.setTransportFallbackHandler(({ conversationId, mode, fallbackReason }) => {
      this.uiManager.updateConversationTransportMode(conversationId, mode, fallbackReason);
    });
    // Phase 4: queue undeliverable DMs to the recipient's offline mailbox.
    this.conversationService.setMessageUndeliverableHandler((wire, conversationId, recipientUserId) => {
      void this.postConversationMessageToMailbox(wire, conversationId, recipientUserId).catch(() => {});
    });
    if (!this.ledgerService) return;
    const ledger = this.ledgerService;
    this.conversationService.setLedgerHandshakeHooks({
      getLedgerState: () => ledger.getState(),
      onRemoteLedgerState: (otherUserId, state) => ledger.syncWithPeer(otherUserId, state),
    });
  }

  /**
   * Phase F: Start LEDGER_STATE handshake + O(Δ) delta sync (REQ-LEDGER-06).
   *
   * Broadcasts our state so peers know what to send us, subscribes to our inbox
   * for incoming delta events, and proactively pushes deltas to known contacts.
   * Also wires the Gun 'hi' event so we re-broadcast whenever a new peer connects.
   *
   * All errors are swallowed — delta sync is best-effort and must not block the app.
   */
  private startLedgerDeltaSync(): void {
    if (process.env.DISABLE_HMR === 'true') return;
    if (!this.ledgerService) return;
    const ledger = this.ledgerService;

    // Lazy getter: returns known contact userIds from the current user's knownPeople list.
    const getPeerIds = (): string[] => {
      const known = this.currentUser?.knownPeople;
      const list = Array.isArray(known) ? known : [];
      return list.map((k) => k.userId).filter(Boolean);
    };

    // Start the inbox subscription + initial proactive sync (fire-and-forget)
    void ledger.startDeltaSync(getPeerIds).catch((e) =>
      console.warn('[Ledger] startDeltaSync failed (non-fatal):', e),
    );

    // Re-broadcast our state whenever a new Gun peer connects (REQ-LEDGER-06 handshake)
    try {
      const gun = this.gunService.getGun();
      if (gun) {
        gun.on('hi', () => {
          void ledger.broadcastState().catch(() => {/* non-fatal */});
        });
      }
    } catch {/* non-fatal */}
  }

  /**
   * Fire-and-forget ledger event emission.
   * Errors are swallowed so that ledger failures never block the main flow.
   */
  private ledgerEmit(kind: InteractionKind, content: Record<string, unknown>): void {
    if (process.env.DISABLE_HMR === 'true') return;
    if (!this.ledgerService) return;
    void this.ledgerService.appendEvent(kind, content as any).catch((err) => {
      console.warn('[Ledger] appendEvent failed (non-fatal):', kind, err);
    });
  }

  private countOrdinaryRoomMembers(members: Array<{ userId: string }>): number {
    return members.filter((member) => member.userId !== TECHSUPPORT_ROOT_USER_ID).length;
  }

  private loadAttachmentShareSentIds(): void {
    this.attachmentShareSentIds.clear();
    try {
      const raw = localStorage.getItem(IinPublicApp.ATTACHMENT_SHARE_SENT_KEY);
      if (!raw) return;
      const values = JSON.parse(raw);
      if (!Array.isArray(values)) return;
      for (const value of values) {
        const id = String(value || '').trim();
        if (id) this.attachmentShareSentIds.add(id);
      }
    } catch {
      /* best-effort local idempotency cache */
    }
  }

  private persistAttachmentShareSentIds(): void {
    try {
      localStorage.setItem(
        IinPublicApp.ATTACHMENT_SHARE_SENT_KEY,
        JSON.stringify([...this.attachmentShareSentIds]),
      );
    } catch {
      /* best-effort local idempotency cache */
    }
  }

  private getTalkAttachmentsForShare(talkData: any): IpfsAttachment[] {
    return this.contentNodeService.normalizeIpfsAttachments((talkData as any)?.ipfsAttachments);
  }

  private async buildAttachmentShareMessageId(
    conversationId: string,
    talkId: string,
    authorId: string,
    cid: string,
  ): Promise<string> {
    return computeCIDv1({
      kind: 'ipfs-auto-share-v1',
      conversationId,
      talkRef: `${talkId}::${authorId}`,
      cid,
    });
  }

  private async buildAttachmentSharePayload(params: {
    conversationId: string;
    talkId: string;
    authorId: string;
    recipientId: string;
    attachment: IpfsAttachment;
  }): Promise<AttachmentShareMessagePayload> {
    const keyPayload = {
      kind: 'ipfs-share-key-v1',
      talkRef: `${params.talkId}::${params.authorId}`,
      cid: params.attachment.cid,
      enc: params.attachment.enc,
      // L5 key envelope is transport material only. File bytes stay out of Gun/mailbox.
      keyMaterial: `ipfs-share:${params.talkId}:${params.authorId}:${params.attachment.cid}`,
    };
    const keyCiphertext = await this.encryptPairTalkResponsePayload(
      params.recipientId,
      keyPayload,
    );
    return {
      kind: 'ipfs-auto-share-v1',
      conversationId: params.conversationId,
      talkId: params.talkId,
      authorId: params.authorId,
      cid: params.attachment.cid,
      link: `ipfs://${params.attachment.cid}`,
      name: params.attachment.name,
      mimeType: params.attachment.mimeType,
      sizeBytes: params.attachment.sizeBytes,
      enc: params.attachment.enc,
      keyCiphertext,
      sharedAt: new Date().toISOString(),
    };
  }

  private formatAttachmentShareMessageText(payload: AttachmentShareMessagePayload): string {
    return `IPFS_SHARE:${JSON.stringify(payload)}`;
  }

  private parseAttachmentShareMessageText(text: string): AttachmentShareMessagePayload | null {
    const raw = String(text || '');
    if (!raw.startsWith('IPFS_SHARE:')) return null;
    try {
      const payload = JSON.parse(raw.slice('IPFS_SHARE:'.length));
      if (!payload || payload.kind !== 'ipfs-auto-share-v1') return null;
      const cid = String(payload.cid || '').trim();
      const keyCiphertext = String(payload.keyCiphertext || '').trim();
      if (!cid || !keyCiphertext) return null;
      return payload as AttachmentShareMessagePayload;
    } catch {
      return null;
    }
  }

  private async maybeFetchSharedAttachmentBytes(
    sharePayload: AttachmentShareMessagePayload,
    senderUserId: string,
  ): Promise<void> {
    const cid = String(sharePayload.cid || '').trim();
    if (!cid || this.fetchedAttachmentBytesByCid.has(cid)) return;

    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return;

    const senderEpub = await this.resolvePeerEpub(senderUserId);
    if (sharePayload.enc === 'sea-pair') {
      const secret = await this.getPairTalkResponseSecret(senderUserId, senderEpub);
      const keyPayloadRaw = await getSEA().decrypt(sharePayload.keyCiphertext, secret);
      if (!keyPayloadRaw) {
        throw new Error('Attachment share key decrypt failed');
      }
    }

    const bytes = await this.contentNodeService.fetchAttachmentBytes({
      cid,
      enc: sharePayload.enc,
      senderEpub,
      recipientPair: pair as GunPair,
    });
    if (bytes) {
      this.fetchedAttachmentBytesByCid.set(cid, bytes);
    }
  }

  private async postAttachmentShareToMailbox(payload: MailboxAttachmentSharePayload): Promise<void> {
    if (!this.currentUser?.id) return;
    const mailbox = this.ensureMailboxClient();
    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return;
    try {
      const recipientEpub = await this.resolvePeerEpub(payload.recipientId);
      if (!recipientEpub) return;
      const ciphertext = await mailbox.encryptForRecipient(
        recipientEpub,
        pair as import('../sea-gun').GunPair,
        payload,
      );
      const envelopeId = `mbx_share_${payload.messageId}`;
      await mailbox.postEnvelope({
        id: envelopeId,
        recipientId: payload.recipientId,
        ciphertext,
      });
    } catch (err) {
      console.warn('[Mailbox] Failed to post attachment-share envelope:', err);
    }
  }

  private async autoShareMatchedTalkAttachments(params: {
    conversationId: string;
    talkId: string;
    authorId: string;
    responderId: string;
    responderName: string;
    talkData: any;
  }): Promise<void> {
    if (!this.currentUser?.id || this.currentUser.id !== params.authorId) return;
    const attachments = this.getTalkAttachmentsForShare(params.talkData);
    if (attachments.length === 0) return;

    for (const attachment of attachments) {
      try {
        const messageId = await this.buildAttachmentShareMessageId(
          params.conversationId,
          params.talkId,
          params.authorId,
          attachment.cid,
        );
        if (this.attachmentShareSentIds.has(messageId)) continue;

        const sharePayload = await this.buildAttachmentSharePayload({
          conversationId: params.conversationId,
          talkId: params.talkId,
          authorId: params.authorId,
          recipientId: params.responderId,
          attachment,
        });
        const messageText = this.formatAttachmentShareMessageText(sharePayload);
        const timestamp = new Date().toISOString();
        await this.conversationService.sendMessage(
          params.conversationId,
          params.authorId,
          messageText,
          {
            otherUserId: params.responderId,
            messageId,
            channel: 'known',
          },
        );
        await this.postAttachmentShareToMailbox({
          kind: 'ipfs-conversation-share-v1',
          conversationId: params.conversationId,
          messageId,
          senderId: params.authorId,
          senderName: this.currentUser.stageName,
          recipientId: params.responderId,
          recipientName: params.responderName,
          text: messageText,
          timestamp,
        });
        this.attachmentShareSentIds.add(messageId);
      } catch (err) {
        console.warn('[L5] autoShareMatchedTalkAttachments failed:', err);
      }
    }

    this.persistAttachmentShareSentIds();
  }

  private async ingestAttachmentShareFromMailbox(payload: MailboxAttachmentSharePayload): Promise<void> {
    if (!this.currentUser?.id) return;
    if (payload.kind !== 'ipfs-conversation-share-v1') return;
    const messageId = String(payload.messageId || '').trim();
    if (!messageId) return;
    if (this.attachmentShareSentIds.has(messageId)) return;

    this.conversationService.upsertMessageRecord(
      payload.conversationId,
      {
        id: messageId,
        senderId: payload.senderId,
        text: payload.text,
        timestamp: payload.timestamp,
        channel: 'pair',
        transport: this.conversationService.getTransportMode(),
      },
      { otherUserId: this.currentUser.id },
    );
    const sharePayload = this.parseAttachmentShareMessageText(payload.text);
    if (sharePayload) {
      void this.maybeFetchSharedAttachmentBytes(sharePayload, payload.senderId).catch((err) => {
        console.warn('[L5] mailbox attachment fetch failed:', err);
      });
    }
    this.attachmentShareSentIds.add(messageId);
    this.persistAttachmentShareSentIds();
  }

  private async markSharedAttachmentLinksDead(params: {
    talkId: string;
    authorId: string;
    conversationPeerId: string;
    conversationId: string;
    attachments: IpfsAttachment[];
    retractedAt: number;
  }): Promise<void> {
    if (!this.currentUser?.id || params.attachments.length === 0) return;

    for (const attachment of params.attachments) {
      try {
        const messageId = await computeCIDv1({
          kind: 'ipfs-auto-share-retracted-v1',
          conversationId: params.conversationId,
          talkRef: `${params.talkId}::${params.authorId}`,
          cid: attachment.cid,
        });
        if (this.attachmentShareSentIds.has(messageId)) continue;
        const messageText = `IPFS_SHARE_RETRACTED:${JSON.stringify({
          kind: 'ipfs-auto-share-retracted-v1',
          talkId: params.talkId,
          authorId: params.authorId,
          cid: attachment.cid,
          link: `ipfs://${attachment.cid}`,
          retractedAt: params.retractedAt,
          note: 'Link is now marked dead in this conversation. Remote copies may still exist.',
        })}`;
        await this.conversationService.sendMessage(
          params.conversationId,
          this.currentUser.id,
          messageText,
          {
            otherUserId: params.conversationPeerId,
            messageId,
            channel: 'known',
          },
        );
        this.attachmentShareSentIds.add(messageId);
      } catch (err) {
        console.warn('[L5] markSharedAttachmentLinksDead failed:', err);
      }
    }

    this.persistAttachmentShareSentIds();
  }

  constructor() {
    this.gunService = new WebGunService();
    this.userService = new WebUserService(this.gunService);
    this.chatroomService = new WebChatroomService(this.gunService);
    // Membership heartbeats must always carry the CURRENT stage name — a captured snapshot
    // clobbers renames back to the old name on every beat (see startMembershipHeartbeat).
    this.chatroomService.setMembershipStageNameResolver(() => this.currentUser?.stageName || '');
    this.talkService = new WebTalkService(this.gunService, this.getBackendApiBase(), {
      meshLocalFirst: usesMeshTalkDelivery(this.p2pRuntimeFlags),
    });
    this.conversationService = new WebConversationService(this.gunService);
    this.contentNodeService = new WebContentNodeService();
    this.uiManager = new UIManager();
    this.loadAttachmentShareSentIds();
  }

  async initialize(location: GPSCoordinate): Promise<void> {
    this.initialized = false;
    this.currentLocation = location;

    // Initialize services (stage-zero server wipe happens in index.ts before init; do not purge
    // here — clearing the graph before SEA auth breaks gun.user().auth()).
    await this.gunService.initialize();
    this.gunService.getGun().get('public').get('chatroom-hierarchy').on((raw: unknown) => {
      applyPublicChatroomHierarchy(raw);
    });
    await this.gunService.ensureKeypairAndAuth();
    await this.syncConversationTransportFromServer();
    this.initLedgerTransportHooks();

    // Phase E: initialize ledger after SEA keypair is established
    this.initLedger();

    // Initialize UI
    this.uiManager.initialize();
    this.uiManager.setApiBase(this.getBackendApiBase());
    this.uiManager.setCurrentLocation(location);
    this.uiManager.setPublicProfileFoundationReader(async (userId: string) => {
      const [data, reputation] = await Promise.all([
        this.gunService.get(`user-public-profile/${userId}`),
        this.gunService.get(`users/${userId}/reputation`).catch(() => null),
      ]);
      if (!data || typeof data !== 'object') return null;
      return { ...(data as object), ...(reputation && typeof reputation === 'object' ? { reputation } : {}) } as {
        headshot?: string | null;
        languagesJson?: string;
        profileJson?: string;
        interestsJson?: string;
      } & { reputation?: { questionsAnswered?: number; matchesFound?: number; blockCount?: number; isHidden?: boolean } };
    });
    this.uiManager.setContactPreRenderSync(async () => {
      await this.syncDirectPairTalkExchangesForContacts();
    });
    // Sync-before-erase (redesign §11.2, item J): build the handoff archive from
    // local sources, reporting per-category progress. The encrypt-to-pub P2P
    // transfer to the linked device is the remaining X7 wiring; the archive is
    // staged locally so the receiver import can pick it up.
    this.uiManager.setDeviceHandoffSync(async (progress) => {
      const { buildHandoffArchive } = await import('../../shared/device-handoff');
      const read = (key: string): any => {
        try {
          return JSON.parse(localStorage.getItem(key) || 'null') ?? undefined;
        } catch {
          return undefined;
        }
      };
      const pair = this.gunService.getStoredPair?.();
      const sources: Parameters<typeof buildHandoffArchive>[0] = { fromPub: String(pair?.pub || '') };
      const collect: Array<[import('../../shared/device-handoff').HandoffCategory, () => void]> = [
        ['profile', () => {
          if (this.currentUser) {
            sources.profile = {
              stageName: this.currentUser.stageName,
              languages: this.currentUser.languages,
              profile: this.currentUser.profile,
              interests: this.currentUser.interests,
            } as any;
          }
        }],
        ['contacts', () => {
          const people = this.currentUser?.knownPeople;
          if (Array.isArray(people)) {
            sources.contacts = people.map((p: any) => ({ ...p, id: String(p.userId || p.id || '') }));
          }
        }],
        ['talkFilters', () => { sources.talkFilters = this.currentUser?.talkFilters as any; }],
        ['answerPreferences', () => { sources.answerPreferences = read('exactChatbotMemory'); }],
        ['myTalks', () => { sources.myTalks = read('myTalks'); }],
        ['conversations', () => { sources.conversations = read('myConversations'); }],
      ];
      for (const [category, fill] of collect) {
        try {
          fill();
        } catch {
          /* category unavailable locally — still counts as collected */
        }
        progress(category);
      }
      const archive = buildHandoffArchive(sources);
      try {
        sessionStorage.setItem('iinpublic_pending_handoff_archive', JSON.stringify(archive));
      } catch {
        /* best effort staging */
      }
    });
    this.uiManager.setPeerLocationReader(async (peerId: string) => {
      const data = await new Promise<unknown>((resolve) => {
        this.gunService.getGun()
          .get('users')
          .get(peerId)
          .get('location')
          .once((locData: unknown) => resolve(locData));
      });
      return (data as any)?.trueLocation ?? (data as any) ?? undefined;
    });
    // Get or create user
    await this.initializeUser();

    // Join appropriate chatroom
    await this.initializeChatrooms();

    // Setup event handlers
    this.setupEventHandlers();

    // Show main interface
    this.uiManager.showMainInterface(this.currentUser!);
    this.subscribeToPublicAnnouncements();
    this.showLocationRoomSuggestion();

    // Subscribe to member counts for all chatrooms (real-time updates)
    this.subscribeToAllChatroomMemberCounts();
    void this.refreshCustomChatroomsFromServer().then(() => {
      // Custom rooms may introduce additional IDs not present at startup.
      this.subscribeToAllChatroomMemberCounts();
    });
    if (isDevStageZero()) {
      this.stageZeroBootedAt = Date.now();
      this.startStageZeroHeadcountWatchdog();
    }
    this.initialized = true;
  }

  private subscribeToPublicAnnouncements(): void {
    const publicGun = this.gunService.getGun().get('public');
    publicGun.get('techsupport-identity').on((raw: unknown) => {
      void isVerifiedTechSupportIdentity(raw, TECHSUPPORT_PUB).then((valid) => {
        if (raw && !valid) this.uiManager.showNotification('TechSupport identity verification failed.', 'warning');
      });
    });
    publicGun.get('announcements').map().on((raw: unknown) => {
      void isRenderableSystemAnnouncement(raw, TECHSUPPORT_PUB).then((valid) => {
        if (valid) {
          const announcement = raw as { id: string; text: string };
          this.uiManager.showSystemAnnouncement(announcement);
        }
      });
    });
  }

  /**
   * Read the self-signed TechSupport identity advertised through local Gun.
   * This deliberately does not use the compiled public-key pin: callers can
   * discover an offline/bootstrap peer's advertised identity, while normal app
   * startup continues to enforce the pin in `subscribeToPublicAnnouncements`.
   */
  public async discoverTechSupportIdentityFromGun(): Promise<TechSupportIdentity | null> {
    const raw = await new Promise<unknown>((resolve) => {
      this.gunService.getGun().get('public').get('techsupport-identity').once((value: unknown) => resolve(value));
    });
    return readVerifiedTechSupportIdentity(raw);
  }

  /** Show once per user/device after location has selected a more specific hierarchy room. */
  private showLocationRoomSuggestion(): void {
    if (!this.currentUser || !this.currentLocation) return;
    const key = `iinpublic_location_room_suggestion_shown:${this.currentUser.id}`;
    if (localStorage.getItem(key)) return;
    const path = getLocationChatroomPath(this.currentLocation);
    const roomId = path[path.length - 1];
    if (!roomId || roomId === this.currentChatroomId) return;
    const room = getFlatChatroomList().find((entry) => entry.id === roomId);
    if (!room) return;
    localStorage.setItem(key, '1');
    this.uiManager.showLocationRoomSuggestion(room.name, () => {
      this.uiManager.emit('chatroomChanged', roomId);
    });
  }

  /**
   * Subscribe to member count updates for all chatrooms in the UI list
   * This allows showing real-time headcount badges that update when users join/leave
   */
  private async refreshCustomChatroomsFromServer(): Promise<void> {
    try {
      const base = this.getBackendApiBase();
      const res = await fetch(`${base}/api/chatrooms`);
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{
        id: string;
        name: string;
        type: string;
        description?: string;
        createdBy?: string;
        capacity?: number;
        createdAt?: string;
        businessInfo?: { headline?: string };
      }>;
      if (!Array.isArray(rows)) return;
      this.uiManager.setCustomChatroomsFromServer(rows);
    } catch (e) {
      console.warn('refreshCustomChatroomsFromServer failed:', e);
    }
  }

  private subscribeToAllChatroomMemberCounts(): void {
    // Get all chatroom IDs from the hierarchy
    const chatroomIds = getAllChatroomIds();

    // Also include the current chatroom ID (location-based) if it's not in the list
    const currentChatroomId = this.chatroomService.getCurrentChatroomId();
    if (currentChatroomId && !chatroomIds.includes(currentChatroomId)) {
      chatroomIds.push(currentChatroomId);
      console.log(`📍 Also subscribing to current location-based chatroom: ${currentChatroomId}`);
    }

    for (const id of this.uiManager.getCustomChatroomIds()) {
      if (id && !chatroomIds.includes(id)) {
        chatroomIds.push(id);
      }
    }

    console.log('📊 Subscribing to member counts for all chatrooms...');
    console.log(`   Total chatrooms: ${chatroomIds.length}`);

    chatroomIds.forEach((chatroomId) => {
      if (!chatroomId || this.subscribedMemberCountRoomIds.has(chatroomId)) return;
      this.subscribedMemberCountRoomIds.add(chatroomId);
      this.chatroomService.subscribeToMemberCount(chatroomId, (count) => {
        console.log(`  - ${chatroomId}: ${count} members`);
        this.applyChatroomMemberCount(chatroomId, count);
      });
      this.chatroomService.subscribeToVisitCounts(chatroomId, (counts) => {
        this.uiManager.setChatroomVisitCounts(chatroomId, counts);
      });
    });

    console.log('✅ Subscribed to all chatroom member counts');
  }

  private async initializeUser(): Promise<void> {
    if (isDevStageZero()) {
      localStorage.removeItem('iinpublic_user_id');
      localStorage.removeItem('iinpublic_keypair');
      localStorage.removeItem(KEY_CUSTODY_STORAGE);
      localStorage.removeItem(KEY_CUSTODY_DEVICE_SECRET_STORAGE);
      localStorage.removeItem('gun/');
    }
    // Check for existing user in local storage
    const existingUserId = localStorage.getItem('iinpublic_user_id');
    let isNewUser = false;

    if (existingUserId) {
      try {
        this.currentUser = await this.userService.getUser(existingUserId);
        const pair = this.gunService.getStoredPair();
        if (pair && !this.currentUser.pub) {
          const merged: User = { ...this.currentUser, pub: pair.pub, epub: pair.epub };
          await this.userService.publishIdentityKeys(this.currentUser.id, pair);
          this.currentUser = merged;
        }
        console.log('👤 Existing user loaded:', this.currentUser.stageName);
      } catch (error) {
        console.log('🆕 Existing user not found, creating new user');
        this.currentUser = await this.createNewUser({
          rootTechSupport: existingUserId === TECHSUPPORT_ROOT_USER_ID,
        });
        isNewUser = true;
      }
    } else {
      await this.bootstrapTechSupportRootIfMissing();
      this.currentUser = await this.createNewUser();
      isNewUser = true;
    }

    // Store whether this is a new user for welcome banner
    (this as any).isNewUser = isNewUser;

    // Phase E: re-initialize ledger now that currentUser is known (userId was not available earlier)
    this.initLedger();

    // Update user location
    if (this.currentLocation) {
      await this.userService.updateUserLocation(this.currentUser.id, this.currentLocation);
    }
    const pair = this.gunService.getStoredPair();
    await this.userService.syncPublicUserForRelay({
      ...this.currentUser,
      ...(pair?.pub ? { pub: pair.pub } : {}),
      ...(pair?.epub ? { epub: pair.epub } : {}),
    });
  }

  private async createNewUser(options: { rootTechSupport?: boolean } = {}): Promise<User> {
    // Show user creation UI
    const userData = await this.uiManager.showUserCreationDialog();

    const blurredLocation = LocationPrivacy.blurLocation(this.currentLocation!);
    const pair = this.gunService.getStoredPair();

    if (options.rootTechSupport) {
      const rootUser: Partial<User> = {
        headshot: userData.headshot,
        location: blurredLocation,
        languages: userData.languages || ['en'],
        interests: userData.interests || [],
        profile: userData.profile || [],
        ...(pair?.pub ? { pub: pair.pub } : {}),
        ...(pair?.epub ? { epub: pair.epub } : {}),
      };
      const user = await this.userService.createTechSupportRoot(rootUser);
      localStorage.setItem('iinpublic_user_id', user.id);
      console.log('✨ TechSupport root user created:', user.stageName);
      return user;
    }

    const newUser: Partial<User> = {
      // stageName will be auto-generated in userService.createUser()
      headshot: userData.headshot,
      location: blurredLocation,
      languages: userData.languages || ['en'],
      interests: userData.interests || [],
      profile: [],
      ...(pair?.pub ? { pub: pair.pub } : {}),
      ...(pair?.epub ? { epub: pair.epub } : {}),
    };

    const user = await this.userService.createUser(newUser);
    localStorage.setItem('iinpublic_user_id', user.id);

    console.log('✨ New user created:', user.stageName);
    return user;
  }

  private async bootstrapTechSupportRootIfMissing(): Promise<void> {
    if (await this.userService.hasTechSupportRoot()) return;

    const rootLocation = this.currentLocation
      ? LocationPrivacy.blurLocation(this.currentLocation)
      : { region: '', chatrooms: ['global'] };
    await this.userService.createTechSupportRoot({
      location: {
        ...rootLocation,
        chatrooms: ['global'],
      },
      languages: ['en'],
      interests: [],
      profile: [],
    });
    await this.seedTechSupportGlobalMembership();
    console.log('✨ TechSupport root bootstrapped before first ordinary user');
  }

  private async seedTechSupportGlobalMembership(): Promise<void> {
    const now = new Date().toISOString();
    const memberData = {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      joinedAt: now,
      lastSeen: now,
      isActive: true,
    };
    const gun = this.gunService.getGun();
    gun.get('chatrooms').get('global').get('users').get(TECHSUPPORT_ROOT_USER_ID).put(memberData);
    gun.get('chatroomMembers').get('global').get(TECHSUPPORT_ROOT_USER_ID).put(memberData);
    gun.get('chatrooms').get('global').get('visits').get(TECHSUPPORT_ROOT_USER_ID).put({
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      enteredAt: now,
    });
    gun.get('chatrooms').get('global').get('uniqueVisitors').get(TECHSUPPORT_ROOT_USER_ID).put(true);

    const apiBase = this.getBackendApiBase();
    if (!apiBase) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      await fetch(`${apiBase}/api/chatrooms/global/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: TECHSUPPORT_ROOT_USER_ID,
          stageName: TECHSUPPORT_STAGE_NAME,
        }),
        signal: controller.signal,
      });
    } catch {
      // Local Gun bootstrap is already written; server membership sync is best-effort here.
    } finally {
      clearTimeout(timeout);
    }
  }

  private async initializeChatrooms(): Promise<void> {
    if (!this.currentUser || !this.currentLocation) return;

    // Get last chatroom from localStorage (for re-entry logic)
    const lastChatroomId = localStorage.getItem('iinpublic_last_chatroom') || undefined;
    this.loadTravelModeStateFromStorage();

    // Find optimal chatroom using hierarchical assignment
    const chatroomId = await this.chatroomService.findOptimalChatroomHierarchical(
      this.currentLocation,
      this.currentUser.id,
      lastChatroomId,
    );

    this.currentChatroomId = chatroomId; // Track current chatroom

    console.log('🎯 Assigned to chatroom:', chatroomId);
    console.log('📍 Based on location:', this.currentLocation);

    // Define a reusable eviction handler that can handle cascading evictions
    const handleEviction = async (fromChatroomId: string, toChatroomId: string) => {
      // User was moved by FIFO eviction
      console.log(`🔔 FIFO Eviction: Switching from ${fromChatroomId} to ${toChatroomId}`);

      // Update current chatroom
      this.currentChatroomId = toChatroomId;
      localStorage.setItem('iinpublic_last_chatroom', toChatroomId);

      // Re-subscribe to new chatroom (this will unsubscribe from old one automatically)
      this.chatroomService.subscribeToMembers(toChatroomId, (members) => {
        console.log('👥 Chatroom members updated:', members);
        this.harvestRosterEpubs(members);
        this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
        this.syncPeerMeshRoom(toChatroomId, members);

        // Update status bar with new chatroom info
        const chatroomName = this.getChatroomDisplayName(toChatroomId);
        this.uiManager.updateStatusBar(
          this.currentUser!.stageName,
          chatroomName,
          this.countOrdinaryRoomMembers(members),
          this.uiManager.getTotalMatches(),
        );
      });

      // Set up new eviction watcher for the new chatroom (recursive - can be evicted again)
      this.chatroomService.setupEvictionWatcher(
        this.currentUser!.id,
        toChatroomId,
        async (newerChatroomId: string) => {
          // Recursively handle further evictions by calling this handler again
          console.log(`🔔 Cascading eviction: ${toChatroomId} → ${newerChatroomId}`);
          await handleEviction(toChatroomId, newerChatroomId);
        },
      );

      // Re-subscribe to messages and talks
      this.subscribeToMessages(toChatroomId);

      // Also subscribe to the new chatroom's member count for the UI list
      this.chatroomService.subscribeToMemberCount(toChatroomId, (count) => {
        console.log(`  - ${toChatroomId}: ${count} members`);
        this.applyChatroomMemberCount(toChatroomId, count);
      });

      // Update UI
      this.uiManager.updateChatroomInfo({
        id: toChatroomId,
        name: `Chatroom: ${toChatroomId}`,
      });

      // Show notification to user
      const chatroomName = this.getChatroomDisplayName(toChatroomId);
      console.log(`📢 You've been moved to ${chatroomName} (room was at capacity)`);
    };

    // Join the assigned chatroom (FIFO logic will be enforced in joinChatroom)
    await this.chatroomService.joinChatroom(
      chatroomId,
      this.currentUser.id,
      this.currentUser.stageName,
      async (newChatroomId: string) => {
        await handleEviction(chatroomId, newChatroomId);
      },
    );

    // Store current chatroom in localStorage for next time
    localStorage.setItem('iinpublic_last_chatroom', chatroomId);

    console.log('🏠 Joined chatroom:', chatroomId);

    // Subscribe to chatroom members and update UI
    this.chatroomService.subscribeToMembers(chatroomId, (members) => {
      this.harvestRosterEpubs(members);
      console.log('👥 Chatroom members updated:', members);
      this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
      this.syncPeerMeshRoom(chatroomId, members);

      // Update status bar with current chatroom info (real-time)
      const chatroomName = this.getChatroomDisplayName(chatroomId);
      this.uiManager.updateStatusBar(
        this.currentUser!.stageName,
        chatroomName,
        this.countOrdinaryRoomMembers(members),
        this.uiManager.getTotalMatches(),
      );
    });

    // Subscribe to chatroom messages
    this.subscribeToMessages(chatroomId);

    // Subscribe to chatroom talks

    // Subscribe to user's conversations (for matches)
    this.subscribeToUserConversations();
    
    // Subscribe to backend-driven incoming talk clusters
    this.subscribeToIncomingTalks();

    // Update chatroom info
    this.uiManager.updateChatroomInfo({ id: chatroomId, name: `Chatroom: ${chatroomId}` });

    // If travel mode is active, switch once to the selected travel chatroom (single-room presence).
    if (this.travelModeActive && this.travelChatroomId && this.travelChatroomId !== chatroomId) {
      this.travelHomeChatroomId = chatroomId;
      this.persistTravelModeStateToStorage();
      this.uiManager.setTravelModeState({
        active: true,
        ...(this.travelHomeChatroomId ? { homeChatroomId: this.travelHomeChatroomId } : {}),
      });
      await this.chatroomService.switchChatroom(this.currentUser.id, this.travelChatroomId, this.currentUser.stageName);
      this.currentChatroomId = this.travelChatroomId;
      localStorage.setItem('iinpublic_last_chatroom', this.currentChatroomId);
      this.subscribeToMessages(this.currentChatroomId);
      this.uiManager.setCurrentChatroomId(this.currentChatroomId);
      this.chatroomService.subscribeToMembers(this.currentChatroomId, (members) => {
        this.harvestRosterEpubs(members);
        this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
        this.syncPeerMeshRoom(this.currentChatroomId!, members);
        const chatroomName = this.getChatroomDisplayName(this.currentChatroomId!);
        this.uiManager.updateStatusBar(
          this.currentUser!.stageName,
          chatroomName,
          this.countOrdinaryRoomMembers(members),
          this.uiManager.getTotalMatches(),
        );
      });
    } else {
      this.uiManager.setTravelModeState({
        active: this.travelModeActive,
        ...(this.travelHomeChatroomId ? { homeChatroomId: this.travelHomeChatroomId } : {}),
      });
    }

    await this.ensureSupportBootstrapForCurrentUser();
    await this.initP2PPresenceAndBridge();
    this.initDirectTalkDeliverySubscriptions();
    // Step 6: drain mailbox on app boot + retry any failed mailbox POSTs.
    void this.drainMailbox().catch(() => {});
    this.startMailboxPolling();
    void this.retryFailedMailboxPosts().catch(() => {});
  }

  /** P0: apply the same intake gates as POST /received (filters, age, block list). */
  private async resolveBlockStatusEitherWay(peerId: string): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || !peerId) return false;
    if ((me.blockedUserIds ?? []).includes(peerId)) return true;
    try {
      const base = this.getBackendApiBase();
      const res = await fetch(
        `${base}/api/users/${encodeURIComponent(me.id)}/block-status/${encodeURIComponent(peerId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return false;
      const status = (await res.json()) as { eitherBlocked?: boolean };
      return !!status.eitherBlocked;
    } catch {
      return false;
    }
  }

  private async resolveAgeVerifiedForIntake(): Promise<boolean> {
    if (this.currentUser?.reputation?.ageVerified) return true;
    if (!this.currentUser?.id) return false;
    try {
      const base = this.getBackendApiBase();
      const res = await fetch(
        `${base}/api/users/${encodeURIComponent(this.currentUser.id)}?viewerId=${encodeURIComponent(this.currentUser.id)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return false;
      const user = await res.json();
      const verified = !!user.reputation?.ageVerified;
      if (verified) {
        if (!this.currentUser.reputation) {
          this.currentUser.reputation = user.reputation;
        } else {
          this.currentUser.reputation.ageVerified = true;
        }
      }
      return verified;
    } catch {
      return false;
    }
  }

  private async shouldAcceptIncomingTalkAsync(offer: {
    senderId: string;
    talkData: Record<string, unknown>;
    deliveryChatroomId?: string;
    directPeerSend?: boolean;
  }): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || offer.senderId === me.id) return false;
    if (await this.resolveBlockStatusEitherWay(offer.senderId)) return false;
    const talkData = offer.talkData;
    // Resolve ageVerified asynchronously before calling the shared synchronous filter function.
    // Only fetch when the talk is actually adult-flagged to avoid an unnecessary API call.
    const isAdultTalk = !!talkData?.isAdult;
    const ageVerified = isAdultTalk ? await this.resolveAgeVerifiedForIntake() : true;
    const chatroomId = this.currentChatroomId;
    if (!offer.directPeerSend && chatroomId) {
      const deliveryRoom = String(offer.deliveryChatroomId || '').trim();
      if (deliveryRoom && deliveryRoom !== chatroomId) return false;
      // Broadcast offers carry deliveryChatroomId; skip sender membership poll (Gun member map lags in e2e).
      if (!deliveryRoom) {
        const serverIds = await this.chatroomService.fetchMemberIdsFromServer(chatroomId);
        if (!serverIds.includes(offer.senderId)) {
          const members = await this.chatroomService.getActiveMembers(chatroomId);
          if (!members.includes(offer.senderId)) return false;
        }
      }
    }
    const filters = getTalkIntakeFilters();
    const td = talkData;
    const authorLoc =
      td.authorLocation &&
      typeof td.authorLocation === 'object' &&
      typeof (td.authorLocation as { latitude?: unknown }).latitude === 'number' &&
      typeof (td.authorLocation as { longitude?: unknown }).longitude === 'number'
        ? (td.authorLocation as { latitude: number; longitude: number })
        : undefined;
    // Resolve expiresAt for the shared function (handles nested fullTalk wrapper from dev seeds).
    const expiresAtMs = this.resolveTalkExpiresAtMs(talkData);
    const receiverContext: ReceiverIntakeContext = { ageVerified };
    const reasons = intakeFilterRejectReasons(
      {
        title: typeof td.title === 'string' ? td.title : String(td.title ?? ''),
        type: typeof td.type === 'string' ? td.type : String(td.type ?? ''),
        language: typeof td.language === 'string' && td.language.trim() ? td.language : 'en',
        createdAt:
          td.createdAt instanceof Date
            ? td.createdAt.toISOString()
            : typeof td.createdAt === 'string' && td.createdAt
              ? td.createdAt
              : new Date().toISOString(),
        updatedAt:
          td.updatedAt instanceof Date
            ? td.updatedAt.toISOString()
            : typeof td.updatedAt === 'string' && td.updatedAt
              ? td.updatedAt
              : typeof td.createdAt === 'string' && td.createdAt
                ? td.createdAt
                : new Date().toISOString(),
        ...(Number.isFinite(expiresAtMs) ? { expiresAt: expiresAtMs } : {}),
        ...(authorLoc ? { authorLocation: authorLoc } : {}),
        questions: Array.isArray(td.questions) ? td.questions : [],
        ...(typeof td.questionsJson === 'string' ? { questionsJson: td.questionsJson } : {}),
        isAdult: isAdultTalk,
      },
      filters,
      this.currentLocation,
      receiverContext,
    );
    return reasons.length === 0;
  }

  private resolveTalkExpiresAtMs(talkData: unknown): number {
    const record = talkData && typeof talkData === 'object'
      ? talkData as Record<string, unknown>
      : {};
    const nested = record.fullTalk && typeof record.fullTalk === 'object'
      ? record.fullTalk as Record<string, unknown>
      : {};
    const expiresAtValue = record.expiresAt ?? nested.expiresAt;
    if (typeof expiresAtValue === 'number') return expiresAtValue;
    if (typeof expiresAtValue === 'string' && expiresAtValue.trim()) {
      return new Date(expiresAtValue).getTime();
    }
    return Number.NaN;
  }

  private isTalkExpiredForDelivery(talkData: unknown): boolean {
    const expiresAt = this.resolveTalkExpiresAtMs(talkData);
    return Number.isFinite(expiresAt) && Date.now() > expiresAt;
  }

  public async warmMeshConnectionToPeer(peerId: string, peerName = 'Unknown'): Promise<boolean> {
    const me = this.currentUser;
    const mesh = this.ensurePeerMeshService();
    if (!me?.id || !peerId || !mesh) return false;
    const chatroomId = this.chatroomService.getCurrentChatroomId?.() || this.currentChatroomId || 'global';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const activeIds = await this.chatroomService.getActiveMembers(chatroomId);
        const members = Array.from(new Set([...activeIds, me.id, peerId]))
          .filter(Boolean)
          .map((userId) => ({
            userId,
            stageName: userId === me.id ? me.stageName : userId === peerId ? peerName : userId,
          }));
        await mesh.joinRoom(chatroomId, members);
        if (await mesh.waitForConnectedNeighbor(peerId, 5_000)) return true;
      } catch (error) {
        console.warn('Mesh peer warm-up failed:', error);
      }
      await new Promise((resolve) => setTimeout(resolve, 300 + attempt * 250));
    }
    return false;
  }

  /** Directed peer send (Send My Talks) over the mesh-talk transport. */
  public async sendDirectTalkToPeer(
    talkId: string,
    talkData: Talk | Record<string, unknown>,
    peerId: string,
    peerName: string,
  ): Promise<void> {
    const me = this.currentUser;
    if (!me?.id) throw new Error('Not signed in');
    const talk = talkData as Talk;
    if (this.isTalkExpiredForDelivery(talk)) {
      throw new Error('Talk expired');
    }
    const mesh = this.ensurePeerMeshService();
    if (!mesh) throw new Error('Mesh talk delivery is not available');
    // R-f step 7: author-side Gun talks/* mirror removed; body cached in PeerMeshService directly.
    const ready = await this.warmMeshConnectionToPeer(peerId, peerName);
    if (!ready) {
      console.warn('Directed mesh send proceeding before peer link reported ready');
    }
    mesh.cacheTalkBody(talkId, talk as unknown as Record<string, unknown>);
    await mesh.broadcastTalk({ ...talk, id: talkId, authorId: me.id }, {
      recipientUserIds: [peerId],
    });
  }

  /** Subscribe to the receiver-owned local incoming-talk index used by mesh delivery. */
  private initDirectTalkDeliverySubscriptions(): void {
    if (!this.currentUser?.id) return;
    void this.refreshIncomingTalkClustersFromLocalGun();
  }

  /** P2P-I / P2P-O: register live presence and probe local node bridge (stack only). */
  private async initP2PPresenceAndBridge(): Promise<void> {
    if (!this.currentUser?.id || isTechSupportUser(this.currentUser)) return;
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv) return;
    const base = this.getBackendApiBase();
    try {
      const heartbeatMs = process.env.DISABLE_HMR === 'true' ? 300_000 : 30_000;
      this.presenceClient = new P2PPresenceClient({ apiBase: base, heartbeatMs });
      await this.presenceClient.startHeartbeat({
        userId: this.currentUser.id,
        pub: String(pair.pub),
        ...(pair.epub ? { epub: String(pair.epub) } : {}),
      });
      const peers = await this.presenceClient.fetchNearby(this.currentUser.id, 20);
      for (const peer of peers) {
        if (peer.epub) this.peerEpubByUserId.set(peer.userId, peer.epub);
        try {
          await this.presenceClient.acknowledgePeer({
            fromUserId: this.currentUser.id,
            fromPub: String(pair.pub),
            toUserId: peer.userId,
            toPub: peer.pub,
            pair,
          });
        } catch {
          /* best-effort peer ack */
        }
      }
    } catch (err) {
      console.warn('P2P presence init failed (non-fatal):', err);
    }
    if (this.p2pRuntimeFlags.p2pNodeEnabled) {
      this.localNodeBridge = new P2PLocalNodeBridgeClient(true);
      void this.localNodeBridge.probe(base);
    }
  }

  private ensurePeerMeshService(): PeerMeshService | null {
    if (!usesMeshTalkDelivery(this.p2pRuntimeFlags) || !this.currentUser?.id) return null;
    if (this.peerMeshService) return this.peerMeshService;
    this.peerMeshService = new PeerMeshService(this.gunService, {
      apiBase: this.getBackendApiBase(),
      localUserId: this.currentUser.id,
      localStageName: this.currentUser.stageName || this.currentUser.id,
      // Keep the E2E mesh dense enough for the 20-peer saturation scenario while
      // still using the production default cap (12) outside that harness.
      ...(process.env.DISABLE_HMR === 'true' ? { maxNeighbors: 12 } : {}),
      ...(this.p2pRuntimeFlags.p2pNodeEnabled
        ? {
            getDiscoveryUserIds: async () => this.getDiscoveryFallbackUserIdsForActiveRoom(),
            createSession: (params) =>
              createFallbackMeshSession({
                primaryFactory: () =>
                  getOrCreateLibp2pMeshSession({
                    conversationId: params.conversationId,
                    localUserId: params.localUserId,
                    localPub: params.localPub,
                    localPair: params.localPair,
                    otherUserId: params.otherUserId,
                    otherPub: params.otherPub,
                    gunService: this.gunService,
                    ensureLibp2pNode: () => this.ensureContentLibp2pInitialized(),
                    onRemoteMeshFrame: params.onRemoteMeshFrame,
                  }),
                fallbackFactory: () =>
                  getOrCreateP2PSession({
                    apiBase: this.getBackendApiBase(),
                    conversationId: params.conversationId,
                    localUserId: params.localUserId,
                    localPub: params.localPub,
                    localPair: params.localPair,
                    otherUserId: params.otherUserId,
                    otherPub: params.otherPub,
                    isInitiator: params.isInitiator,
                    // S2: Gun pub/sub signaling for the mesh fallback session too.
                    gun: this.gunService.getGun(),
                    onRemoteMeshFrame: params.onRemoteMeshFrame,
                  }),
                onFallback: (cause, error) => {
                  console.warn(`[Mesh] falling back to WebRTC session after libp2p ${cause} failure`, error);
                },
              }),
          }
        : {}),
      onTalkBody: (payload) => this.handleMeshTalkBody(payload),
      onTalkResponse: (payload) => void this.handleMeshTalkResponse(payload).catch((err) => {
        // The mesh layer has already ACKed the frame by the time this runs — a swallowed
        // throw here is a silently lost response (observed: author-side decrypt failures
        // were invisible in every log). Never let ingest failures vanish.
        console.warn('[MeshResponse] ingest failed for', payload?.responderId, err);
      }),
      onPing: (fromUserId, _frame) => {
        const diag = this.meshPingDiagnostics;
        diag.lastPingFrom = fromUserId;
        if (!diag.pingedOrigins.includes(fromUserId)) diag.pingedOrigins.push(fromUserId);
      },
      onPong: (fromUserId, _frame) => {
        const diag = this.meshPingDiagnostics;
        diag.lastPongFrom = fromUserId;
        if (!diag.pongedOrigins.includes(fromUserId)) diag.pongedOrigins.push(fromUserId);
      },
      // Step 2: record announce receipt for durable E2E assertion (meshAnnounceDiagnostics).
      // Fires before body pull, enabling the test to assert announce reachability without
      // waiting for the full talk-body-request/talk-body round-trip.
      onTalkAnnounce: (payload, _frame) => {
        const diag = this.meshAnnounceDiagnostics;
        const alreadyRecorded = diag.received.some(
          (r) => r.talkId === payload.talkId && r.authorId === payload.authorId,
        );
        if (!alreadyRecorded) {
          diag.received.push({ talkId: payload.talkId, authorId: payload.authorId });
        }
      },
      // R-a step 7: mailbox fallback — post talk-body payload per unreachable recipient
      // when the DataChannel overlay cannot guarantee full coverage (below-wanted-degree
      // or coverage-gap). Replaces the deleted Gun p2pMeshTalkBodies/* rendezvous write.
      onMailboxFallback: (payload, recipientUserIds) =>
        this.postTalkBodyToMailboxForRecipients(payload, recipientUserIds),
      // Step 10: responder side — handle incoming retraction flood frames.
      onTalkRetracted: (payload) => this.handleMeshTalkRetracted(payload),
    });
    (this as any).peerMeshService = this.peerMeshService;
    return this.peerMeshService;
  }

  private getDiscoveryFallbackUserIdsForActiveRoom(): string[] {
    const roomId = this.peerMeshService?.getDiagnostics().roomId || this.currentChatroomId;
    if (!roomId) return [];
    const found = this.roomDiscoveredUserIds.get(roomId);
    return found ? [...found] : [];
  }

  private async resolveDiscoveredUserIds(
    providerPeerIds: string[],
    members: Array<{ userId: string; stageName?: string }>,
  ): Promise<string[]> {
    if (!Array.isArray(providerPeerIds) || providerPeerIds.length === 0) return [];
    const peerSet = new Set(providerPeerIds.map((peerId) => String(peerId || '').trim()).filter(Boolean));
    if (peerSet.size === 0) return [];
    const discovered = new Set<string>();
    await Promise.all(members.map(async (member) => {
      const userId = String(member.userId || '').trim();
      if (!userId) return;
      try {
        const binding = await this.gunService.get(`p2p-peer-bindings/${userId}`) as { peerId?: unknown } | null;
        const peerId = String(binding?.peerId || '').trim();
        if (peerId && peerSet.has(peerId)) {
          discovered.add(userId);
        }
      } catch {
        // best-effort
      }
    }));
    return [...discovered];
  }

  private ensureRoomDiscoveryService(): P2PRoomDiscoveryService | null {
    if (!this.p2pRuntimeFlags.p2pNodeEnabled) return null;
    if (this.roomDiscoveryService) return this.roomDiscoveryService;
    const discoveryConfig = this.contentNodeService.getDiscoveryConfig();
    this.roomDiscoveryService = new P2PRoomDiscoveryService(
      () => this.ensureContentLibp2pInitialized(),
      discoveryConfig.bootstrapPeers,
    );
    this.meshDiscoveryDiagnostics.bootstrapPeers = this.roomDiscoveryService.getBootstrapPeers();
    return this.roomDiscoveryService;
  }

  private syncPeerMeshRoom(
    chatroomId: string,
    members: Array<{ userId: string; stageName?: string; pub?: string }>,
  ): void {
    const mesh = this.ensurePeerMeshService();
    if (!mesh || !this.currentUser?.id || !chatroomId) return;
    const withSelf = members.some((member) => member.userId === this.currentUser!.id)
      ? members
      : [
          ...members,
          { userId: this.currentUser.id, stageName: this.currentUser.stageName },
        ];
    void mesh.joinRoom(chatroomId, withSelf).catch((error) => {
      console.warn('Peer mesh room join failed:', error);
    });
    const discovery = this.ensureRoomDiscoveryService();
    if (discovery) {
      void discovery.announceRoom(chatroomId).catch((error) => {
        console.warn('Room discovery provide failed:', error);
      });
      void discovery.findRoomProviderPeerIds(chatroomId, { timeoutMs: 2_500, limit: 20 })
        .then(async (peers) => {
          const discoveredUserIds = await this.resolveDiscoveredUserIds(peers, withSelf);
          const cached = this.roomDiscoveredUserIds.get(chatroomId) || new Set<string>();
          const sameRoomUserIds = withSelf
            .map((member) => String(member.userId || '').trim())
            .filter((userId) => !!userId && userId !== this.currentUser?.id);
          for (const userId of sameRoomUserIds) cached.add(userId);
          for (const userId of discoveredUserIds) cached.add(userId);
          this.roomDiscoveredUserIds.set(chatroomId, cached);
          this.meshDiscoveryDiagnostics = {
            roomId: chatroomId,
            providerPeerIds: peers,
            discoveredUserIds: [...cached],
            bootstrapPeers: discovery.getBootstrapPeers(),
            updatedAt: new Date().toISOString(),
          };
        })
        .catch((error) => {
          console.warn('Room discovery findProviders failed:', error);
        });
    }
    // Step 6: drain the mailbox whenever roster changes (any newly-present member
    // may be a sender for whom we have queued envelopes in the mailbox).
    // Also retry failed mailbox POSTs now that network may be available.
    void this.drainMailbox().catch(() => {});
    void this.retryFailedMailboxPosts().catch(() => {});
  }

  // ─── Encrypted offline mailbox — drain-on-connect (Step 6) ───────────────
  //
  // On every roster join / app boot, fetch and decrypt all pending envelopes
  // addressed to the current user.  Each envelope carries a P2PMeshTalkResponsePayload
  // encrypted with SEA ECDH (sender's epub, recipient's keypair).  After successful
  // dispatch through handleMeshTalkResponse (which dedupes on responseId), delete
  // the envelope from the server (drain-then-delete: a crash before delete causes
  // re-delivery, which is safe because the handler is idempotent).

  private ensureMailboxClient(): WebMailboxClient {
    if (!this.mailboxClient) {
      this.mailboxClient = new WebMailboxClient(this.getBackendApiBase());
    }
    return this.mailboxClient;
  }

  private startMailboxPolling(): void {
    if (this.mailboxPollTimer) return;
    this.mailboxPollTimer = setInterval(() => {
      void this.drainMailbox().catch(() => {});
      void this.retryFailedMailboxPosts().catch(() => {});
    }, 3_000);
  }

  /**
   * Drain all envelopes addressed to the current user from the server mailbox.
   * Decrypt each and dispatch:
   *   - talk-body payloads (R-a step 7 fallback) → handleMeshTalkBody
   *   - talk-response payloads → handleMeshTalkResponse
   * Then delete each envelope (drain-then-delete; re-delivery on crash is safe — handlers dedup).
   */
  private async drainMailbox(): Promise<void> {
    if (this.mailboxDrainPromise) return this.mailboxDrainPromise;
    this.mailboxDrainPromise = this.drainMailboxOnce().finally(() => {
      this.mailboxDrainPromise = null;
    });
    return this.mailboxDrainPromise;
  }

  private async drainMailboxOnce(): Promise<void> {
    if (!this.currentUser?.id) return;
    const mailbox = this.ensureMailboxClient();
    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return; // keypair not ready

    const envelopes = await mailbox.fetchEnvelopes(this.currentUser.id);
    if (!envelopes.length) return;

    console.log(`[Mailbox] Draining ${envelopes.length} envelope(s) for user ${this.currentUser.id}`);
    for (const envelope of envelopes) {
      try {
        let senderEpubHint = '';
        try {
          const wrapper = JSON.parse(envelope.ciphertext) as { senderEpub?: unknown };
          senderEpubHint = typeof wrapper.senderEpub === 'string' ? wrapper.senderEpub.trim() : '';
        } catch {
          /* malformed wrappers are handled by decryptEnvelope below */
        }
        const payload = await mailbox.decryptEnvelope<
          | P2PMeshTalkResponsePayload
          | import('../../shared/p2p-mesh-protocol').P2PMeshTalkBodyPayload
          | MailboxAttachmentSharePayload
          | MailboxConversationMessagePayload
        >(
          envelope.ciphertext,
          pair as import('../sea-gun').GunPair,
        );
        if (senderEpubHint) {
          const senderId = String(
            (payload as MailboxConversationMessagePayload).senderId
              || (payload as P2PMeshTalkResponsePayload).responderId
              || (payload as import('../../shared/p2p-mesh-protocol').P2PMeshTalkBodyPayload).authorId
              || '',
          ).trim();
          if (senderId) this.peerEpubByUserId.set(senderId, senderEpubHint);
        }
        // Dispatch based on payload kind:
        //   - kind 'conversation-message-v1' → offline DM (Phase 4)
        //   - kind 'ipfs-conversation-share-v1' → attachment share link
        //   - has `talkData` → talk-body payload from R-a mailbox fallback
        //   - has `retractedAt` (number) → step-10 retraction envelope
        //   - has `responseId` → talk-response payload from step 6
        if ((payload as any).kind === 'conversation-message-v1') {
          await this.ingestConversationMessageFromMailbox(payload as MailboxConversationMessagePayload);
        } else if ((payload as any).kind === 'ipfs-conversation-share-v1') {
          await this.ingestAttachmentShareFromMailbox(payload as MailboxAttachmentSharePayload);
        } else if ((payload as any).talkData !== undefined) {
          await this.handleMeshTalkBody(payload as import('../../shared/p2p-mesh-protocol').P2PMeshTalkBodyPayload);
        } else if (typeof (payload as any).retractedAt === 'number') {
          await this.handleMeshTalkRetracted(payload as unknown as P2PMeshTalkRetractedPayload);
        } else {
          await this.handleMeshTalkResponse(payload as P2PMeshTalkResponsePayload);
        }
        // Delete only after handler completes without throwing.
        await mailbox.deleteEnvelope(this.currentUser.id, envelope.id);
        console.log('[Mailbox] Drained and deleted envelope', envelope.id);
      } catch (err) {
        console.warn('[Mailbox] Failed to drain envelope', envelope.id, '— will retry on next connect:', err);
        // Leave envelope on server for re-delivery.
      }
    }
  }

  /**
   * Post a talk response to the mailbox as a ciphertext-only envelope.
   * Falls back to localStorage queue only when the mailbox POST itself fails.
   */
  private async postToMailbox(payload: P2PMeshTalkResponsePayload): Promise<boolean> {
    if (this.mailboxFallbackDisabledForE2e) return true;
    if (!this.currentUser?.id) return false;
    const mailbox = this.ensureMailboxClient();
    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return false;

    const authorEpub = await this.resolvePeerEpub(payload.authorId);
    if (!authorEpub) {
      console.warn('[Mailbox] Cannot post — author epub not found for', payload.authorId);
      return false;
    }

    try {
      const ciphertext = await mailbox.encryptForRecipient(
        authorEpub,
        pair as import('../sea-gun').GunPair,
        payload,
      );
      const envelopeId = `mbx_${payload.responseId}`;
      const result = await mailbox.postEnvelope({
        id: envelopeId,
        recipientId: payload.authorId,
        ciphertext,
      });
      if (result.stored) {
        console.log('[Mailbox] Posted envelope', envelopeId, 'for author', payload.authorId);
        return true;
      }
      console.warn('[Mailbox] Server rejected envelope:', result.error);
      return false;
    } catch (err) {
      console.warn('[Mailbox] postToMailbox failed:', err);
      return false;
    }
  }

  /**
   * Phase 4: queue an undeliverable DM to the recipient's encrypted offline mailbox.
   * Fired by the direct transport when WebRTC delivery fails (peer offline). The wire
   * is already SEA-ECDH-encrypted between the two users; the mailbox wraps it again.
   * Idempotent: the envelope id is derived from the message id, and drain → upsert is
   * keyed by message id, so re-delivery is safe.
   */
  private async postConversationMessageToMailbox(
    wire: import('../services/gun-message-store').ConversationMessageWire,
    conversationId: string,
    recipientUserId: string,
  ): Promise<void> {
    if (this.mailboxFallbackDisabledForE2e) return;
    if (!this.currentUser?.id || !recipientUserId || recipientUserId === this.currentUser.id) return;
    const mailbox = this.ensureMailboxClient();
    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return;
    try {
      const recipientEpub = await this.resolvePeerEpub(recipientUserId);
      if (!recipientEpub) {
        console.warn('[Mailbox] Cannot post DM — epub not found for', recipientUserId);
        return;
      }
      const payload: MailboxConversationMessagePayload = {
        kind: 'conversation-message-v1',
        conversationId,
        senderId: wire.senderId,
        recipientUserId,
        wire,
      };
      const ciphertext = await mailbox.encryptForRecipient(recipientEpub, pair as import('../sea-gun').GunPair, payload);
      const result = await mailbox.postEnvelope({
        id: `mbx_dm_${conversationId}_${wire.id}`,
        recipientId: recipientUserId,
        ciphertext,
      });
      if (result.stored) {
        console.log('[Mailbox] Posted DM envelope', wire.id, 'for', recipientUserId);
      } else {
        console.warn('[Mailbox] Server rejected DM envelope:', result.error);
      }
    } catch (err) {
      console.warn('[Mailbox] postConversationMessageToMailbox failed:', err);
    }
  }

  /**
   * Phase 4: drain handler for an offline DM — writes the wire idempotently into the
   * recipient's local Gun (same pair-private path the live transport uses), so the UI
   * renders it via the existing conversation subscription.
   */
  private async ingestConversationMessageFromMailbox(payload: MailboxConversationMessagePayload): Promise<void> {
    if (!this.currentUser?.id) return;
    if (payload.kind !== 'conversation-message-v1' || !payload.wire?.id) return;
    this.conversationService.upsertMessageRecord(
      payload.conversationId,
      payload.wire,
      { otherUserId: payload.recipientUserId || this.currentUser.id },
    );
    console.log('[Mailbox] Ingested offline DM', payload.wire.id, 'in', payload.conversationId);
  }

  /**
   * R-a step 7: mailbox fallback for talk-body delivery when DataChannel overlay cannot
   * guarantee full room coverage. Posts an encrypted talk-body envelope per unreachable
   * recipient. Recipients drain the mailbox on reconnect → flows through the same
   * intake-filtered `handleMeshTalkBody` accept path.
   * Best-effort: failures are logged but do not propagate.
   */
  private async postTalkBodyToMailboxForRecipients(
    payload: import('../../shared/p2p-mesh-protocol').P2PMeshTalkBodyPayload,
    recipientUserIds: string[],
  ): Promise<void> {
    if (this.mailboxFallbackDisabledForE2e) return;
    if (!this.currentUser?.id || recipientUserIds.length === 0) return;
    const mailbox = this.ensureMailboxClient();
    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return;
    const recipients = [...new Set(recipientUserIds)].filter(
      (recipientId) => recipientId && recipientId !== this.currentUser?.id,
    );
    // The body mailbox post is the delivery backstop when the mesh overlay can't reach a
    // recipient. Under saturation (20-browser M4) a single epub read or POST can transiently
    // fail; unlike talk *responses* there was no retry, so that recipient was permanently
    // skipped and never received the talk. Retry per recipient with backoff. The envelope id is
    // deterministic, so re-posting is idempotent (server dedupes; receiver dedupes on drain).
    // This whole method is invoked fire-and-forget from the mesh fallback, so the retries never
    // delay the broadcast's own completion. The budget must survive a saturation boot storm:
    // with ~12 browsers starting at once (mass/ specs, busy real deployments), a receiver can
    // take 20-30s to publish its SEA keys, and the old ~8s budget (6 attempts) gave up forever
    // — receivers permanently missed the talk. ~45s of capped backoff rides out the storm.
    const MAX_POST_ATTEMPTS = 12;
    const concurrency = 5;
    for (let i = 0; i < recipients.length; i += concurrency) {
      await Promise.all(recipients.slice(i, i + concurrency).map(async (recipientId) => {
        for (let attempt = 0; attempt < MAX_POST_ATTEMPTS; attempt += 1) {
          try {
            const recipientEpub = await this.resolvePeerEpub(recipientId);
            if (recipientEpub) {
              const ciphertext = await mailbox.encryptForRecipient(
                recipientEpub,
                pair as import('../sea-gun').GunPair,
                payload,
              );
              const envelopeId = `mbx_body_${payload.talkId}_${this.currentUser?.id}_${recipientId}`;
              const result = await mailbox.postEnvelope({
                id: envelopeId,
                recipientId,
                ciphertext,
              });
              if (result.stored) {
                console.log('[Mesh/Mailbox] Posted talk-body envelope for', recipientId);
                return;
              }
              console.warn('[Mesh/Mailbox] Server rejected talk-body envelope for', recipientId, ':', result.error);
            } else {
              console.warn('[Mesh/Mailbox] epub not found for', recipientId, `(attempt ${attempt + 1})`);
            }
          } catch (err) {
            console.warn('[Mesh/Mailbox] post talk-body failed for', recipientId, `(attempt ${attempt + 1}):`, err);
          }
          if (attempt < MAX_POST_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 400 + attempt * 600)));
          }
        }
        console.warn('[Mesh/Mailbox] gave up posting talk-body for', recipientId, `after ${MAX_POST_ATTEMPTS} attempts`);
      }));
    }
  }

  // ─── localStorage fallback queue (POST-to-mailbox failure only) ──────────
  //
  // The STEP-6-REPLACE localStorage queue is now narrowed to a "mailbox POST
  // itself failed" buffer only — it retries on the next roster-change drain
  // via retryFailedMailboxPosts.  This covers transient network errors during the
  // mailbox POST without requiring a new server endpoint or Gun path.

  private static readonly PENDING_MESH_RESPONSES_KEY = 'pendingMeshTalkResponses';

  private enqueueFailedMailboxPost(payload: P2PMeshTalkResponsePayload): void {
    try {
      const raw = localStorage.getItem(IinPublicApp.PENDING_MESH_RESPONSES_KEY);
      const queue: Record<string, P2PMeshTalkResponsePayload> = raw ? JSON.parse(raw) : {};
      const queueKey = `${payload.talkId}::${payload.authorId}::${payload.responseId}`;
      queue[queueKey] = payload;
      localStorage.setItem(IinPublicApp.PENDING_MESH_RESPONSES_KEY, JSON.stringify(queue));
      console.log('[Mailbox] Queued failed-POST response for author', payload.authorId, 'key:', queueKey);
    } catch (err) {
      console.warn('[Mailbox] Failed to enqueue failed-POST response:', err);
    }
  }

  /** Retry pending mailbox POSTs on roster change (transient network error recovery). */
  private async retryFailedMailboxPosts(): Promise<void> {
    let queue: Record<string, P2PMeshTalkResponsePayload>;
    try {
      const raw = localStorage.getItem(IinPublicApp.PENDING_MESH_RESPONSES_KEY);
      if (!raw) return;
      queue = JSON.parse(raw);
    } catch {
      return;
    }
    const succeeded: string[] = [];
    for (const [queueKey, payload] of Object.entries(queue)) {
      const posted = await this.postToMailbox(payload);
      if (posted) succeeded.push(queueKey);
    }
    if (succeeded.length > 0) {
      for (const k of succeeded) delete queue[k];
      try {
        localStorage.setItem(IinPublicApp.PENDING_MESH_RESPONSES_KEY, JSON.stringify(queue));
      } catch {/* ignore */}
    }
  }

  private async resolveMeshTalkData(talkId: string): Promise<any | null> {
    const cached = this.peerMeshService?.getCachedTalkBody(talkId);
    if (cached) return cached;
    try {
      const raw = localStorage.getItem('myTalks');
      const myTalks = raw ? JSON.parse(raw) : {};
      const entry = myTalks?.[talkId];
      if (entry?.fullTalk) return entry.fullTalk;
      if (entry) return entry;
    } catch {
      /* fallback below */
    }
    return this.talkService.getTalkWithRetry(talkId, { attempts: 3, gapMs: 150 });
  }

  private async handleMeshTalkBody(payload: P2PMeshTalkBodyPayload): Promise<boolean> {
    if (!this.currentUser?.id || payload.authorId === this.currentUser.id) return false;
    if (payload.authorEpub) this.peerEpubByUserId.set(payload.authorId, payload.authorEpub);
    const talkData = {
      ...payload.talkData,
      id: payload.talkId,
      authorId: payload.authorId,
      authorName: payload.authorName,
      ...(payload.authorEpub ? { authorEpub: payload.authorEpub } : {}),
    };
    if (this.isTalkExpiredForDelivery(talkData)) return false;
    // R-f step 7: Gun talks/* mirror removed — receiver talk bodies are cached in
    // PeerMeshService.talkBodies (mesh body cache) and in the incoming-talk cluster
    // local store. The Gun mirror was the only remaining talks/* write on the receiver side.
    // Apply intake/age filtering BEFORE surfacing the talk in the UI. Mesh room
    // broadcasts reach every member, so age-gated/filtered talks must be rejected
    // here or they leak into the incoming-cluster UI (e.g. an adult talk shown to a
    // not-yet-age-verified receiver). Pass the current room as the delivery hint so
    // the receiver-side membership poll (flaky under Gun lag in e2e) is skipped.
    const accepted = await this.ingestIncomingTalkAnnouncement(
      payload.talkId,
      payload.authorId,
      payload.authorName || 'Unknown',
      talkData,
      this.currentChatroomId ? { deliveryChatroomId: this.currentChatroomId } : {},
    );
    if (!accepted) return false;
    this.peerMeshService?.cacheTalkBody(payload.talkId, talkData);
    this.talkService.cacheReceivedTalk(payload.talkId, talkData);
    const pairKey = `${payload.talkId}::${payload.authorId}`;
    const firstUi = !this.processedTalkResponseKeys.has(`mesh-talk-body::${pairKey}`);
    if (firstUi) {
      this.processedTalkResponseKeys.add(`mesh-talk-body::${pairKey}`);
      this.uiManager.displayIncomingTalk({
        id: payload.talkId,
        title: String(payload.title || (talkData as any).title || 'Talk'),
        authorName: payload.authorName || 'Unknown',
        type: (talkData as any).type,
        questionCount: Array.isArray((talkData as any).questions) ? (talkData as any).questions.length : payload.questionCount,
        timestamp: new Date().toISOString(),
        isOwnTalk: false,
        fullTalk: talkData,
      });
      this.maybeAutoChatbotReplyToAnnouncer(
        payload.talkId,
        talkData,
        payload.authorId,
        payload.authorName || 'Unknown',
      );
    }
    return true;
  }

  private async handleMeshTalkResponse(payload: P2PMeshTalkResponsePayload): Promise<void> {
    if (!this.currentUser?.id || payload.authorId !== this.currentUser.id) return;
    console.log(`[RESP-INGEST] talk=${String(payload.talkId).slice(-8)} from=${String(payload.responderId).slice(0, 8)} v=${payload.version ?? 1}`);
    const dedupeKey = `mesh-response::${payload.talkId}::${payload.responseId}::v${payload.version ?? 1}`;
    if (this.processedTalkResponseKeys.has(dedupeKey)) return;
    const talkData = await this.resolveMeshTalkData(payload.talkId);
    if (!talkData) return;
    const decrypted = await this.decryptPairTalkResponsePayload(payload);

    // Step 10: check dead-inbox tombstone before any processing.
    // If the author has retracted this talk (talkId::authorId in retracted), discard all answers.
    const ledgerDoc = getTalkLedgerDoc();
    const tombstoneKey = ledgerRetractedKey(payload.talkId, this.currentUser.id);
    if (ledgerDoc.retracted[tombstoneKey]) {
      const tombstone = ledgerDoc.retracted[tombstoneKey]!;
      const answerMs = new Date(payload.respondedAt ?? payload.submittedAt).getTime();
      if (answerMs < tombstone.retractedAt) {
        console.debug(`[Step10] Discarding answer from ${payload.responderId} — talk retracted`);
        return;
      }
    }

    // Step 9: version-gate ingest via applyEvent.
    // Read the prior outcome for this (responderId, talkId, authorId) from ledger.
    const oKey = ledgerOutcomeKey(payload.responderId, payload.talkId, this.currentUser.id);
    const priorOutcome = ledgerDoc.outcomes[oKey];
    const incomingVersion = payload.version ?? 1;
    const incomingRespondedAt = payload.respondedAt ?? payload.submittedAt;

    if (priorOutcome) {
      const identityKey = buildTalkIdentityKey(talkData);
      // Use applyEvent to determine if this update should be accepted.
      // Clone doc to avoid mutating the read copy before we know if it's accepted.
      const testDoc = JSON.parse(JSON.stringify(ledgerDoc));
      const isMatch = this.checkIfMatch(talkData, decrypted.answers);
      const ledgerOutcome = isMatch ? 'matched' as const : 'ignored' as const;
      const preApplyVersion = testDoc.outcomes[oKey]?.version ?? 0;
      applyLedgerEvent(testDoc, {
        kind: 'TALK_ANSWERED',
        responderId: payload.responderId,
        talkId: payload.talkId,
        authorId: this.currentUser.id,
        identityKey,
        outcome: ledgerOutcome,
        version: incomingVersion,
        responseId: payload.responseId,
        respondedAt: incomingRespondedAt,
        now: new Date().toISOString(),
      });
      const postApplyVersion = testDoc.outcomes[oKey]?.version ?? 0;

      // If applyEvent did not update the entry, this is stale/replay — reject.
      if (postApplyVersion <= preApplyVersion && testDoc.outcomes[oKey]?.responseId === priorOutcome.responseId) {
        console.debug(`[Step9] Rejecting stale/replay response from ${payload.responderId} version=${incomingVersion} (prior=${priorOutcome.version})`);
        return;
      }

      // Accepted: add to dedupeKey set, record exchange, and handle outcome flip.
      this.processedTalkResponseKeys.add(dedupeKey);
      this.recordLocalTalkExchange(
        payload.responderId,
        decrypted.responderName,
        payload.talkId,
        talkData,
        isMatch ? 'match' : 'mismatch',
        {
          responseId: payload.responseId,
          version: incomingVersion,
          respondedAt: incomingRespondedAt,
          answers: decrypted.answers,
        },
      );

      const wasMatch = priorOutcome.outcome === 'matched';
      const nowMatch = isMatch;
      const changedAt = incomingRespondedAt;

      if (!wasMatch && nowMatch) {
        // ignore → match: create conversation
        this.uiManager.showNotification(
          `${decrypted.responderName} changed their answer — now a match · ${new Date(changedAt).toLocaleTimeString()}`,
          'success',
        );
        const conversationId = await this.conversationService.createConversation({
          userId1: this.currentUser.id,
          userName1: this.currentUser.stageName,
          userId2: payload.responderId,
          userName2: decrypted.responderName,
          talkId: payload.talkId,
          respondedByBotForUser1: !!decrypted.isChatbotResponse,
          respondedByBotForUser2: false,
        });
        this.uiManager.addNewConversation({
          conversationId,
          otherUserId: payload.responderId,
          otherUserName: decrypted.responderName,
          talkId: payload.talkId,
          respondedByBot: !!decrypted.isChatbotResponse,
          transportMode: this.conversationService.getTransportMode(),
          changeOfMindAt: changedAt,
        });
        await this.autoShareMatchedTalkAttachments({
          conversationId,
          talkId: payload.talkId,
          authorId: this.currentUser.id,
          responderId: payload.responderId,
          responderName: decrypted.responderName,
          talkData,
        });
        this.uiManager.setMemberMatched(payload.responderId);
      } else if (wasMatch && !nowMatch) {
        // match → ignore: mark conversation ended with status 'ignored'
        this.uiManager.showNotification(
          `${decrypted.responderName} changed their answer — no longer a match · ${new Date(changedAt).toLocaleTimeString()}`,
          'info',
        );
        this.uiManager.markConversationEnded(
          payload.responderId,
          payload.talkId,
          changedAt,
        );
      } else {
        // Outcome unchanged (both match or both not-match) — version bumped but no flip
        console.debug(`[Step9] Version bump from ${payload.responderId}: v${priorOutcome.version}→v${incomingVersion}, outcome unchanged (${priorOutcome.outcome})`);
      }
      return;
    }

    // No prior entry — first receipt (original flow from step 8)
    this.processedTalkResponseKeys.add(dedupeKey);
    const isMatch = this.checkIfMatch(talkData, decrypted.answers);
    // R-2: pass responseId/version/respondedAt for forward-compat (steps 8–11)
    this.recordLocalTalkExchange(
      payload.responderId,
      decrypted.responderName,
      payload.talkId,
      talkData,
      isMatch ? 'match' : 'mismatch',
      {
        responseId: payload.responseId,
        version: incomingVersion,
        respondedAt: incomingRespondedAt,
        answers: decrypted.answers,
      },
    );
    if (!isMatch) return;
    const conversationId = await this.conversationService.createConversation({
      userId1: this.currentUser.id,
      userName1: this.currentUser.stageName,
      userId2: payload.responderId,
      userName2: decrypted.responderName,
      talkId: payload.talkId,
      respondedByBotForUser1: !!decrypted.isChatbotResponse,
      respondedByBotForUser2: false,
    });
    this.uiManager.addNewConversation({
      conversationId,
      otherUserId: payload.responderId,
      otherUserName: decrypted.responderName,
      talkId: payload.talkId,
      respondedByBot: !!decrypted.isChatbotResponse,
      transportMode: this.conversationService.getTransportMode(),
    });
    // Match! toast after the conversation exists so clicking it navigates there (rule N6).
    this.uiManager.showNotification(
      this.uiManager.formatTalkMatched(decrypted.responderName, talkData.title),
      'success',
      { conversationId },
    );
    await this.autoShareMatchedTalkAttachments({
      conversationId,
      talkId: payload.talkId,
      authorId: this.currentUser.id,
      responderId: payload.responderId,
      responderName: decrypted.responderName,
      talkData,
    });
    this.uiManager.setMemberMatched(payload.responderId);
  }

  /**
   * Step 10 (author side): hard retraction on delete or tag-uncheck.
   *
   * 1. Write local tombstone via applyEvent.
   * 2. Emit TALK_RETRACTED to the audit ledger.
   * 3. Flood the `talk-retracted` mesh frame to all connected neighbors.
   * 4. Mailbox-fanout to all known responders so offline holders are reached.
   * 5. Tear down the author's own conversation view (if matched).
   */
  private async handleRetractTalk(talkId: string, retractedAt: number): Promise<void> {
    if (!this.currentUser?.id) return;
    const authorId = this.currentUser.id;
    const talkData = await this.resolveMeshTalkData(talkId);
    const attachments = this.getTalkAttachmentsForShare(talkData);
    this.contentNodeService.unpinTalkAttachments(talkId);

    // 1. Write local tombstone (clears outcomes + exchanged for this talkId::authorId).
    applyTalkLedgerEvent({
      kind: 'TALK_RETRACTED',
      talkId,
      authorId,
      retractedAt,
    });

    // 2. Emit audit ledger event.
    this.ledgerEmit(InteractionKind.TALK_RETRACTED, { talkId, retractedAt });

    // 3. Flood the mesh frame.
    const mesh = this.ensurePeerMeshService();
    if (mesh) {
      const retractionPayload: P2PMeshTalkRetractedPayload = { talkId, authorId, retractedAt };
      try {
        await mesh.sendTalkRetraction(retractionPayload);
      } catch (err) {
        console.warn('[Retraction] Mesh flood failed (non-fatal):', err);
      }
    }

    // 4. Mailbox fanout to known responders.
    // The ledger already cleared outcomes, so we read from a pre-retraction snapshot:
    // use the conversations store to enumerate responders.
    void this.postRetractionToKnownResponders(talkId, authorId, retractedAt).catch(() => {});

    // 5. Author side: tear down any conversations derived from this talkId.
    const allConversations = this.uiManager.getMyConversations() as Record<string, any>;
    for (const [conversationId, conv] of Object.entries(allConversations)) {
      if (this.conversationReferencesTalk(conv, talkId)) {
        const otherUserId = String((conv as any).otherUserId || '');
        this.uiManager.markConversationWithdrawn(
          otherUserId,
          talkId,
          retractedAt,
        );
        if (conversationId && otherUserId && otherUserId !== authorId) {
          await this.markSharedAttachmentLinksDead({
            talkId,
            authorId,
            conversationPeerId: otherUserId,
            conversationId,
            attachments,
            retractedAt,
          });
        }
      }
    }
  }

  /**
   * Step 10 (responder side): handle an incoming `talk-retracted` mesh frame.
   *
   * 1. Write tombstone to local ledger.
   * 2. Surface "match gone" notice to UI.
   * 3. Mark any conversations for this talkId::authorId as withdrawn.
   */
  private async handleMeshTalkRetracted(payload: P2PMeshTalkRetractedPayload): Promise<void> {
    if (!this.currentUser?.id) return;
    // authorId check is already done in PeerMeshService.handleLocalFrame before firing this callback.

    // 1. Write tombstone to local ledger.
    applyTalkLedgerEvent({
      kind: 'TALK_RETRACTED',
      talkId: payload.talkId,
      authorId: payload.authorId,
      retractedAt: payload.retractedAt,
    });

    // 2. Surface notice.
    this.uiManager.showNotification(
      `${payload.authorId} removed a talk — the match is gone · ${new Date(payload.retractedAt).toLocaleTimeString()}`,
      'info',
    );
    this.contentNodeService.unpinTalkAttachments(payload.talkId);

    // 3. Mark any conversation involving this talkId as withdrawn.
    const allConversations = this.uiManager.getMyConversations() as Record<string, any>;
    for (const [, conv] of Object.entries(allConversations)) {
      if (this.conversationReferencesTalk(conv, payload.talkId) && (conv as any).otherUserId === payload.authorId) {
        this.uiManager.markConversationWithdrawn(
          payload.authorId,
          payload.talkId,
          payload.retractedAt,
        );
        break;
      }
    }
  }

  /**
   * Step 10: post encrypted retraction envelopes to known responders via the mailbox.
   * Reads the myConversations store for talkId matches — these are the peers who need
   * the tombstone but may be offline at the moment of retraction.
   */
  private async postRetractionToKnownResponders(
    talkId: string,
    authorId: string,
    retractedAt: number,
  ): Promise<void> {
    if (!this.currentUser?.id) return;
    const mailbox = this.ensureMailboxClient();
    const pair = this.gunService.getStoredPair();
    if (!pair?.priv) return;

    // Collect distinct responders from the conversations store for this talkId.
    const allConversations = this.uiManager.getMyConversations() as Record<string, any>;
    const responderIds = new Set<string>();
    for (const [, conv] of Object.entries(allConversations)) {
      const otherId = String((conv as any).otherUserId || '');
      if (this.conversationReferencesTalk(conv, talkId) && otherId && otherId !== authorId) {
        responderIds.add(otherId);
      }
    }
    if (responderIds.size === 0) return;

    const retractionPayload: P2PMeshTalkRetractedPayload = { talkId, authorId, retractedAt };
    for (const responderId of responderIds) {
      try {
        const responderEpub = await this.resolvePeerEpub(responderId);
        if (!responderEpub) continue;
        const ciphertext = await mailbox.encryptForRecipient(
          responderEpub,
          pair as import('../sea-gun').GunPair,
          retractionPayload,
        );
        const envelopeId = `mbx_retract_${talkId}_${authorId}_${responderId}`;
        await mailbox.postEnvelope({ id: envelopeId, recipientId: responderId, ciphertext });
        console.log('[Retraction] Posted mailbox envelope for responder', responderId);
      } catch (err) {
        console.warn('[Retraction] Failed to post mailbox envelope for', responderId, ':', err);
      }
    }
  }

  private conversationReferencesTalk(conversation: any, talkId: string): boolean {
    if (!conversation || !talkId) return false;
    if (String(conversation.talkId || '') === talkId) return true;
    if (Array.isArray(conversation.relatedTalkIds)) {
      if (conversation.relatedTalkIds.some((id: unknown) => String(id || '') === talkId)) return true;
    }
    if (typeof conversation.relatedTalkIdsJson === 'string') {
      try {
        const parsed = JSON.parse(conversation.relatedTalkIdsJson);
        return Array.isArray(parsed) && parsed.some((id) => String(id || '') === talkId);
      } catch {
        return false;
      }
    }
    return false;
  }

  private async ensureSupportBootstrapForCurrentUser(): Promise<void> {
    if (!this.currentUser || this.supportBootstrapChecked || isTechSupportUser(this.currentUser)) return;
    this.supportBootstrapChecked = true;

    const userId = this.currentUser.id;
    const supportStateKey = 'iinpublic_support_channels';
    const supportState = (() => {
      try {
        return JSON.parse(localStorage.getItem(supportStateKey) || '{}') as Record<string, {
          greetedAt?: string;
          conversationId?: string;
          transportMode?: string;
        }>;
      } catch {
        return {};
      }
    })();
    if (supportState[userId]?.conversationId && supportState[userId]?.greetedAt) return;

    const conversationId = `conv_support_${TECHSUPPORT_ROOT_USER_ID}_${userId}`;
    const now = new Date().toISOString();
    const welcome =
      `Welcome to IinPublic, ${this.currentUser.stageName}. ${TECHSUPPORT_STAGE_NAME} is here if you need help.`;
    const gun = this.gunService.getGun();

    gun.get(`conversations/${conversationId}`).put({
      data: JSON.stringify({
        id: conversationId,
        participants: [TECHSUPPORT_ROOT_USER_ID, userId],
        createdAt: now,
        status: 'active',
        supportChannel: true,
      }),
    });
    await this.conversationService.sendMessage(
      conversationId,
      TECHSUPPORT_ROOT_USER_ID,
      welcome,
      {
        otherUserId: userId,
        messageId: `support_welcome_${userId}`,
        isFromChatbot: true,
      },
    );
    gun.get(`users/${userId}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: TECHSUPPORT_ROOT_USER_ID,
      otherUserName: TECHSUPPORT_STAGE_NAME,
      createdAt: now,
      supportChannel: true,
      transportMode: this.conversationService.getTransportMode(),
    });

    supportState[userId] = {
      greetedAt: now,
      conversationId,
      transportMode: this.conversationService.getTransportMode(),
    };
    localStorage.setItem(supportStateKey, JSON.stringify(supportState));
    this.uiManager.addNewConversation({
      conversationId,
      otherUserId: TECHSUPPORT_ROOT_USER_ID,
      otherUserName: TECHSUPPORT_STAGE_NAME,
      supportChannel: true,
      transportMode: this.conversationService.getTransportMode(),
    });
    this.uiManager.updateConversationMessage(conversationId, welcome, now);
    if (!this.uiManager.isSupportNotificationsMuted()) {
      this.uiManager.showNotification(this.uiManager.formatSupportWelcome(this.currentUser.stageName), 'info');
    }
  }

  private async sendTechSupportAutoReply(conversationId: string, userMessageId: string): Promise<void> {
    if (!this.currentUser || isTechSupportUser(this.currentUser)) return;
    const reply = this.uiManager.formatSupportReply(this.currentUser.stageName);
    const now = new Date().toISOString();
    await this.conversationService.sendMessage(
      conversationId,
      TECHSUPPORT_ROOT_USER_ID,
      reply,
      {
        otherUserId: this.currentUser.id,
        messageId: `support_reply_${userMessageId}`,
        isFromChatbot: true,
      },
    );
    this.uiManager.updateConversationMessage(conversationId, reply, now);
  }

  private loadTravelModeStateFromStorage(): void {
    const active = localStorage.getItem('iinpublic_travel_mode') === '1';
    const home = localStorage.getItem('iinpublic_travel_home') || undefined;
    const travel = localStorage.getItem('iinpublic_travel_room') || undefined;
    this.travelModeActive = active;
    this.travelHomeChatroomId = home;
    this.travelChatroomId = travel;
    this.uiManager.setTravelModeState({
      active: this.travelModeActive,
      ...(this.travelHomeChatroomId ? { homeChatroomId: this.travelHomeChatroomId } : {}),
    });
  }

  private persistTravelModeStateToStorage(): void {
    localStorage.setItem('iinpublic_travel_mode', this.travelModeActive ? '1' : '0');
    if (this.travelHomeChatroomId) localStorage.setItem('iinpublic_travel_home', this.travelHomeChatroomId);
    else localStorage.removeItem('iinpublic_travel_home');
    if (this.travelChatroomId) localStorage.setItem('iinpublic_travel_room', this.travelChatroomId);
    else localStorage.removeItem('iinpublic_travel_room');
  }

  /**
   * Get a user-friendly display name for a chatroom
   */
  private getChatroomDisplayName(chatroomId: string): string {
    return this.uiManager.resolveChatroomTitle(chatroomId);
  }

  /**
   * Fetch member counts for all chatrooms in the UI list
   * This allows showing headcount badges for rooms the user hasn't visited
   */
  private subscribeToMessages(chatroomId: string): void {
    console.log('💬 Subscribing to chatroom messages:', chatroomId);
    const gun = this.gunService.getGun();

    gun
      .get('chatrooms')
      .get(chatroomId)
      .get('messages')
      .map()
      .on((messageData: any, messageId: string) => {
        if (messageId.startsWith('_')) return; // Skip Gun.js metadata

        console.log('📨 Received message:', messageData);

        if (messageData && messageData.text) {
          // Display the message in UI
          this.uiManager.displayChatroomMessage({
            id: messageData.id,
            text: messageData.text,
            senderName: messageData.senderName || 'Unknown',
            timestamp: messageData.timestamp,
            isOwnMessage: messageData.senderId === this.currentUser?.id,
          });
        }
      });
  }

  /**
   * When chatbot is on and we have a saved template for this talk, reply once per announcer
   * (e.g. Bob re-broadcasts the same talk Tom created — Jerry auto-replies on first receipt, not only on Gun replay).
   */
  private maybeAutoChatbotReplyToAnnouncer(
    talkId: string,
    talkData: any,
    authorId: string,
    authorName: string,
  ): void {
    if (!authorId || authorId === this.currentUser?.id) return;
    const pairKey = `${talkId}::${authorId}`;
    if (this.chatbotAutoReplySentForPair.has(pairKey)) {
      console.log('🤖 Chatbot auto-reply skipped: pair already handled', { pairKey });
      return;
    }
    if (!this.uiManager.getChatbotEnabled()) {
      console.log('🤖 Chatbot auto-reply skipped: chatbot disabled', { talkId, authorId });
      return;
    }
    const contentId = computeTalkIdFromTalkData(talkData);
    const canAuto =
      !!this.uiManager.getChatbotTemplate(talkId) ||
      (!!contentId &&
        contentId !== talkId &&
        !!this.uiManager.getChatbotTemplate(contentId)) ||
      !!this.uiManager.tryBuildChatbotAnswersFromFlattened(talkData);
    if (!canAuto) {
      const retries = this.chatbotAutoReplyRetryCountByPair.get(pairKey) ?? 0;
      if (retries < 6) {
        this.chatbotAutoReplyRetryCountByPair.set(pairKey, retries + 1);
        setTimeout(() => {
          this.maybeAutoChatbotReplyToAnnouncer(talkId, talkData, authorId, authorName);
        }, 250);
      } else {
        this.chatbotAutoReplyRetryCountByPair.delete(pairKey);
        console.log('🤖 Chatbot auto-reply skipped: no reusable template', {
          talkId,
          contentId,
          authorId,
          retries,
        });
      }
      return;
    }
    this.chatbotAutoReplyRetryCountByPair.delete(pairKey);
    console.log('🤖 Chatbot auto-reply triggered', { talkId, contentId, authorId, authorName });
    this.chatbotAutoReplySentForPair.add(pairKey);
    this.tryChatbotReply(talkId, talkData, authorId, authorName);
  }

  /** Load full talk for an incoming mesh/local announcement. */
  public isDirectTalkDeliveryEnabled(): boolean {
    return usesMeshTalkDelivery(this.p2pRuntimeFlags);
  }

  public isMeshTalkDeliveryEnabled(): boolean {
    return usesMeshTalkDelivery(this.p2pRuntimeFlags);
  }

  public async getLocalIncomingClustersForE2e(): Promise<any[]> {
    if (!this.currentUser?.id) return [];
    // R-a step 7: syncRoomTalkBodyRendezvous removed (Gun p2pMeshTalkBodies/* path deleted).
    // Incoming clusters arrive exclusively via mesh DataChannel push or mailbox drain.
    const gunClusters = await collectLocalIncomingTalkClusters(this.gunService, this.currentUser.id, this.p2pRuntimeFlags, { waitMs: 300 });
    const uiClusters = Array.isArray((this.uiManager as any).incomingTalkClusters)
      ? (this.uiManager as any).incomingTalkClusters
      : [];
    const byKey = new Map<string, any>();
    for (const cluster of [...gunClusters, ...uiClusters, ...this.e2eSeededIncomingClusters]) {
      if (cluster?.identityKey) byKey.set(cluster.identityKey, cluster);
    }
    return [...byKey.values()];
  }

  private recordLocalTalkExchange(
    peerId: string,
    peerName: string,
    talkId: string,
    talkData: any,
    outcome: 'match' | 'mismatch' | 'ignore',
    // R-2: forward-compat fields for steps 8–11 (responseId, version, respondedAt)
    meta?: {
      responseId?: string;
      version?: number;
      respondedAt?: string;
      answers?: any[];
      direction?: 'sent' | 'received';
    },
  ): void {
    if (!this.currentUser?.id || !peerId || peerId === this.currentUser.id || !talkId) return;
    console.log(`[RESP-RECORD] talk=${talkId.slice(-8)} peer=${peerId.slice(0, 8)} outcome=${outcome} dir=${meta?.direction || 'sent'}`);
    try {
      const raw = localStorage.getItem('localTalkExchanges');
      const exchanges = raw ? JSON.parse(raw) : {};
      const key = `${peerId}::${talkId}`;
      exchanges[key] = {
        ...(exchanges[key] || {}),
        peerId,
        peerName: String(peerName || 'Unknown'),
        talkId,
        title: String(talkData?.title || 'Talk'),
        type: String(talkData?.type || 'flow'),
        language: String(talkData?.language || 'en'),
        outcome,
        direction: meta?.direction || 'sent',
        date: new Date().toISOString(),
        answerMode: meta?.answers ? 'manual' : (exchanges[key]?.answerMode || 'manual'),
        ...(meta?.answers ? { answers: meta.answers } : {}),
        // R-2: forward-compat fields — inert in step 4, used by steps 8–11
        ...(meta?.responseId ? { responseId: meta.responseId } : {}),
        ...(meta?.version !== undefined ? { version: meta.version } : {}),
        ...(meta?.respondedAt ? { respondedAt: meta.respondedAt } : {}),
      };
      localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
    } catch {
      // Local exchange summaries only support UI fallbacks; ignore storage failures.
    }

    // A received talk answered by this user is already recorded as a responder-side
    // exchange by submitTalkResponsePairDirect. Writing the author-side projection here
    // would reuse the same peer::identity key and erase change-of-mind fanout targets.
    if (meta?.direction === 'received') return;

    // Step 8: co-write to the talk ledger (author outcome + exchanged entry).
    // Map outcome vocabulary: 'match' → 'matched', 'mismatch'|'ignore' → 'ignored'.
    try {
      const ledgerOutcome = outcome === 'match' ? 'matched' : 'ignored';
      const wholeTalkIdentityKey = buildTalkIdentityKey(talkData);
      const identityKeys = outcome === 'match'
        ? this.selectedTalkIdentityKeys(talkData, meta?.answers)
        : [wholeTalkIdentityKey];
      const authorId = this.currentUser!.id;
      const nowIso = new Date().toISOString();
      applyTalkLedgerEvent({
        kind: 'TALK_ANSWERED',
        responderId: peerId,
        talkId,
        authorId,
        identityKey: wholeTalkIdentityKey,
        outcome: ledgerOutcome,
        version: meta?.version ?? 1,
        responseId: meta?.responseId ?? `resp_${talkId}_${peerId}`,
        respondedAt: meta?.respondedAt ?? nowIso,
        now: nowIso,
      });
      writeAuthorExchangedEntries({
        responderId: peerId,
        identityKeys,
        outcome: ledgerOutcome,
        version: meta?.version ?? 1,
        respondedAt: meta?.respondedAt ?? nowIso,
      });
    } catch {
      // Ledger write failures are non-fatal — suppression misses cost one redundant send.
    }
  }

  private selectedTalkIdentityKeys(talkData: any, answers?: any[]): string[] {
    const wholeTalkIdentityKey = buildTalkIdentityKey(talkData);
    if (talkData?.type !== 'tag' || !Array.isArray(answers)) return [wholeTalkIdentityKey];
    const selectedAnswerIds = new Set(
      answers.map((answer: any) => String(answer?.answerId || '')).filter(Boolean),
    );
    const selectedAnswerTexts = new Set(
      answers.map((answer: any) => String(answer?.answerText || '').trim().toLowerCase()).filter(Boolean),
    );
    const selectedTalk = {
      ...talkData,
      questions: Array.isArray(talkData?.questions)
        ? talkData.questions.map((question: any, index: number) => index === 0
          ? {
              ...question,
              answers: (Array.isArray(question?.answers) ? question.answers : []).filter((answer: any) =>
                selectedAnswerIds.has(String(answer?.id || '')) ||
                selectedAnswerTexts.has(String(answer?.text || '').trim().toLowerCase()),
              ),
            }
          : question)
        : [],
    };
    return buildTagIdentityKeys(selectedTalk, wholeTalkIdentityKey);
  }

  private async syncDirectPairTalkExchangesForContacts(): Promise<void> {
    if (!usesMeshTalkDelivery(this.p2pRuntimeFlags) || !this.currentUser?.id) return;
    let myTalks: Record<string, any> = {};
    try {
      myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    } catch {
      myTalks = {};
    }
    const createdTalks = Object.entries(myTalks)
      .filter(([, entry]: [string, any]) => entry?.role === 'created')
      .map(([talkId, entry]: [string, any]) => ({
        talkId: String(entry?.fullTalk?.id || entry?.id || talkId),
        talkData: entry?.fullTalk || entry,
      }))
      .filter((entry) => entry.talkId && entry.talkData);
    if (createdTalks.length === 0) return;

    const chatroomId = this.chatroomService.getCurrentChatroomId?.() || this.currentChatroomId || 'global';
    let peerIds: string[] = [];
    try {
      peerIds = (await this.chatroomService.getActiveMembers(chatroomId))
        .map((id: string) => String(id || ''))
        .filter((id: string) => id && id !== this.currentUser!.id);
    } catch {
      peerIds = [];
    }
    if (peerIds.length === 0) return;

    const gun = this.gunService.getGun();
    const collectPairResponses = (pairId: string, talkId: string) =>
      new Promise<any[]>((resolve) => {
        const rows: any[] = [];
        const ref = gun.get('pairTalkResponses').get(pairId).get(talkId).map();
        ref.once((raw: unknown, key: string) => {
          if (raw && key && !key.startsWith('_')) rows.push(raw);
        });
        window.setTimeout(() => {
          try {
            ref.off();
          } catch {
            /* ignore */
          }
          resolve(rows);
        }, 350);
      });

    await Promise.all(
      peerIds.map(async (peerId) => {
        let peerName = 'Unknown';
        try {
          const peer = await this.userService.getUser(peerId);
          peerName = peer?.stageName || peerName;
        } catch {
          /* keep fallback */
        }
        for (const { talkId, talkData } of createdTalks) {
          const pairId = this.pairIdForUsers(this.currentUser!.id, peerId);
          const rows = await collectPairResponses(pairId, talkId);
          for (const row of rows) {
            if (String(row?.authorId || '') !== this.currentUser!.id) continue;
            if (String(row?.responderId || '') !== peerId) continue;
            try {
              const decrypted = await this.decryptPairTalkResponsePayload(row);
              const isMatch = this.checkIfMatch(talkData, decrypted.answers);
              this.recordLocalTalkExchange(peerId, decrypted.responderName || peerName, talkId, talkData, isMatch ? 'match' : 'mismatch');
            } catch (error) {
              console.warn('Failed to sync pair talk response for contacts:', error);
            }
          }
        }
      }),
    );
  }

  private pairIdForUsers(userA: string, userB: string): string {
    return [String(userA || '').trim(), String(userB || '').trim()].sort().join('__');
  }

  private pairTalkPeerEpubHint(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  }

  /**
   * Roster records now carry each member's public encryption key (see the membership
   * heartbeat) — harvest them into the epub cache on every roster update so encrypting FOR
   * any room member (talk-body mailbox posting, pair offers) needs no network lookup.
   */
  private harvestRosterEpubs(members: Array<{ userId?: string; epub?: string }>): void {
    for (const member of members || []) {
      const id = String(member?.userId || '').trim();
      const epub = typeof member?.epub === 'string' ? member.epub.trim() : '';
      if (id && epub && !this.peerEpubByUserId.has(id)) this.peerEpubByUserId.set(id, epub);
    }
  }

  private async resolvePeerEpub(peerUserId: string, hint?: string): Promise<string> {
    const hinted = this.pairTalkPeerEpubHint(hint);
    if (hinted) {
      this.peerEpubByUserId.set(peerUserId, hinted);
      return hinted;
    }
    const cached = this.peerEpubByUserId.get(peerUserId);
    if (cached) return cached;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const presence = this.presenceClient ?? new P2PPresenceClient({
          apiBase: this.getBackendApiBase(),
        });
        const peers = await Promise.race([
          presence.fetchNearby(this.currentUser?.id, 200),
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error('presence key lookup timeout')),
            1_500,
          )),
        ]);
        const peer = peers.find((candidate) => candidate.userId === peerUserId);
        const epub = typeof peer?.epub === 'string' ? peer.epub.trim() : '';
        if (epub) {
          this.peerEpubByUserId.set(peerUserId, epub);
          return epub;
        }
      } catch {
        /* bounded Gun fallback below */
      }

      try {
        const peer = await Promise.race([
          this.gunService.getPublicUser(peerUserId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 900)),
        ]);
        const epub = typeof peer?.epub === 'string' ? peer.epub.trim() : '';
        if (epub) {
          this.peerEpubByUserId.set(peerUserId, epub);
          return epub;
        }
      } catch {
        /* retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 100));
    }
    return '';
  }

  private async getPairTalkResponseSecret(peerUserId: string, peerEpubHint?: string): Promise<string> {
    const pair = this.gunService.getStoredPair();
    if (!pair) {
      throw new Error('No SEA keypair is available for pair-private talk response');
    }
    const epub = await this.resolvePeerEpub(peerUserId, peerEpubHint);
    if (!epub) throw new Error(`Peer ${peerUserId} has no public encryption key`);
    return getSEA().secret(epub, pair as GunPair);
  }

  private async encryptPairTalkResponsePayload(
    peerUserId: string,
    payload: Record<string, unknown>,
    peerEpubHint?: string,
  ): Promise<string> {
    const secret = await this.getPairTalkResponseSecret(peerUserId, peerEpubHint);
    return getSEA().encrypt(JSON.stringify(payload), secret);
  }

  private async decryptPairTalkResponsePayload(responseData: any): Promise<{
    responderName: string;
    authorName: string;
    answers: any[];
    isChatbotResponse: boolean;
  }> {
    if (responseData?.payloadCiphertext) {
      const peerId = String(responseData.responderId || responseData.authorId || '');
      // Inline key material first: a response that carries the responder's epub decrypts
      // with zero lookups (and seeds the cache for everything else about this peer).
      const inlineEpub = typeof responseData.responderEpub === 'string' ? responseData.responderEpub.trim() : '';
      if (inlineEpub && peerId === String(responseData.responderId || '')) {
        this.peerEpubByUserId.set(peerId, inlineEpub);
      }
      const secret = await this.getPairTalkResponseSecret(peerId, inlineEpub || undefined);
      const decrypted = await getSEA().decrypt(String(responseData.payloadCiphertext), secret);
      if (!decrypted) {
        throw new Error('Pair talk response payload could not be decrypted');
      }
      const payload = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
      return {
        responderName: String(payload.responderName || responseData.responderId || 'Unknown'),
        authorName: String(payload.authorName || responseData.authorId || 'Unknown'),
        answers: Array.isArray(payload.answers) ? payload.answers : JSON.parse(String(payload.answers || '[]')),
        isChatbotResponse: !!payload.isChatbotResponse,
      };
    }

    return {
      responderName: String(responseData.responderName || responseData.responderId || 'Unknown'),
      authorName: String(responseData.authorName || responseData.authorId || 'Unknown'),
      answers: Array.isArray(responseData.answers)
        ? responseData.answers
        : JSON.parse(String(responseData.answers || '[]')),
      isChatbotResponse: !!responseData.isChatbotResponse,
    };
  }

  /**
   * Auto-reply to a talk using saved template (chatbot). Puts response to Gun and creates
   * responder's conversation so the author will receive the match and see bot icon.
   */
  private tryChatbotReply(
    talkId: string,
    talkData: any,
    authorId: string,
    authorName: string,
  ): void {
    let template = this.uiManager.getChatbotTemplate(talkId);
    if (!template && talkData) {
      const cid = computeTalkIdFromTalkData(talkData);
      if (cid && cid !== talkId) {
        template = this.uiManager.getChatbotTemplate(cid);
      }
    }
    if (!template && talkData) {
      const built = this.uiManager.tryBuildChatbotAnswersFromFlattened(talkData);
      if (built && built.length > 0) {
        template = { answers: built, talkData };
      }
    }
    if (!template || !this.currentUser?.id) {
      console.log('🤖 Chatbot reply aborted: missing template or user', {
        talkId,
        hasTemplate: !!template,
        hasUser: !!this.currentUser?.id,
      });
      return;
    }

    void this.submitTalkResponsePairDirect({
      talkId,
      talkData,
      answers: template.answers,
      isChatbotResponse: true,
      authorId,
      authorName,
      isAutoResponse: true,
    });
  }


  /**
   * HTTP API lives on the Gun server (port 8080 in single-worker dev/e2e, 8080+N for parallel
   * Playwright worker N). Derive the port from the current page port so each worker's bundle
   * talks to its own backend.
   */
  private getBackendApiBase(): string {
    if (typeof window === 'undefined') {
      // Node/SSR fallback: honour PORT env var so callers running inside a parallel
      // worker process (web 3001+N ↔ gun 8080+N) still target their own Gun server.
      const envPort = typeof process !== 'undefined' && process.env && process.env.PORT
        ? parseInt(process.env.PORT, 10)
        : 8080;
      return `http://localhost:${Number.isFinite(envPort) ? envPort : 8080}`;
    }
    const { hostname, protocol, port } = window.location;
    return deriveBackendApiBaseFromLocation(protocol, hostname, port);
  }

  private async syncConversationTransportFromServer(): Promise<void> {
    try {
      const res = await fetch(`${this.getBackendApiBase()}/api/debug/storage`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = (await res.json()) as { flags?: P2PRuntimeFlags };
      if (payload.flags) {
        this.conversationService.applyRuntimeTransportFlags(payload.flags);
      }
    } catch (error) {
      console.warn('Could not sync conversation transport from server flags:', error);
    }
  }

  /**
   * Sender-driven mesh delivery for all resolved room receivers.
   */
  private async deliverTalkToReceiversOverMesh(
    talkId: string,
    talk: Talk,
    members: Array<{ userId: string; stageName: string }>,
    eligibleReceiverIds?: string[],
    deliveryOptions: { skipAcknowledgements?: boolean } = {},
  ): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || members.length === 0) return false;
    if (this.isTalkExpiredForDelivery(talk)) return false;
    let receiverIds = members
      .map((m) => m.userId)
      .filter((id) => id !== me.id && id !== TECHSUPPORT_ROOT_USER_ID);
    if (eligibleReceiverIds !== undefined) {
      const allowed = new Set(eligibleReceiverIds);
      receiverIds = receiverIds.filter((id) => allowed.has(id));
    }
    if (receiverIds.length === 0) return false;

    // Step 8.2 / Step 11.3: sender-side per-identity suppression.
    // For tag talks: compute suppressed identity keys per recipient and deliver a
    // filtered talk body (only non-exchanged answers). For flow/survey/route: whole-talk
    // suppression unchanged (no independent atoms).
    // NOTE: flood frames reach everyone by design; suppression applies only to the
    // directed recipientUserIds list used for announce/body delivery.
    const wholeTalkIdentityKey = buildTalkIdentityKey(talk);
    const identityKeys = buildTagIdentityKeys(talk, wholeTalkIdentityKey);
    const isTagTalk = talk.type === 'tag' && identityKeys.length > 1;
    const nowMs = Date.now();

    // Build per-recipient delivery plan:
    //   null    → skip entirely (all identities suppressed or edge gated)
    //   talk    → deliver unmodified talk (no suppression)
    //   filtered → deliver tag-filtered version (partial suppression)
    type DeliveryPlan = { recipientId: string; talkPayload: typeof talk };
    const plans: DeliveryPlan[] = [];

    for (const recipientId of receiverIds) {
      // Compute which identity keys are suppressed for this recipient.
      const suppressedSet = new Set<string>();
      if (!this.talkLedgerSuppressionDisabledForE2e) {
        for (const ik of identityKeys) {
          if (shouldSuppressForPeer(recipientId, ik)) suppressedSet.add(ik);
        }
      }

      // If ALL identity keys suppressed → skip recipient entirely.
      if (suppressedSet.size === identityKeys.length) {
        console.debug(`[Ledger] Suppressing talk deliver to ${recipientId} for all identityKey(s) ${identityKeys.join(',')} — already exchanged`);
        continue;
      }

      // Step 8.3: client per-edge cooldown/quota gate.
      const gate = applyEdgeGateForPeer(recipientId, nowMs);
      if (!gate.ok) {
        console.debug(`[Ledger] Edge gate rejected deliver to ${recipientId}: ${gate.rejectedBy.join(',')}`);
        continue;
      }

      if (isTagTalk && suppressedSet.size > 0) {
        // Partial suppression for tag talk: deliver filtered body.
        const filterResult = filterTalkForRecipient(talk, suppressedSet);
        if (!filterResult) {
          // filterTalkForRecipient returns null when all remaining are also suppressed (edge case).
          console.debug(`[Ledger] filterTalkForRecipient returned null for ${recipientId} — skipping`);
          continue;
        }
        const filteredTalk = { ...filterResult.filtered, id: talkId, authorId: me.id } as typeof talk;
        plans.push({ recipientId, talkPayload: filteredTalk });
        console.debug(`[Ledger] Partial tag suppression for ${recipientId}: delivering ${(filteredTalk.questions ?? []).length > 0 ? ((filteredTalk.questions as any[])[0]?.answers?.length ?? '?') : '?'} of ${identityKeys.length} tags`);
      } else {
        // No suppression (or non-tag talk with no suppression): deliver unmodified.
        plans.push({ recipientId, talkPayload: { ...talk, id: talkId, authorId: me.id } });
      }
    }

    if (plans.length === 0) {
      console.debug(`[Ledger] All recipients suppressed or gated for talkId=${talkId}, skipping broadcastTalk`);
      return true; // return true so the caller counts this as "sent" (suppression is silent)
    }

    const mesh = this.ensurePeerMeshService();
    if (!mesh) return false;
    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (chatroomId) {
      await mesh.joinRoom(chatroomId, [
        { userId: me.id, stageName: me.stageName },
        ...members,
      ]);
    }
    // R-f step 7: author-side Gun talks/* mirror removed; body cached in PeerMeshService directly.
    // Cache the full (unfiltered) talk body so body-request fallbacks get the complete talk.
    mesh.cacheTalkBody(talkId, talk as unknown as Record<string, unknown>);

    // Group plans by talkPayload identity to minimise frame count:
    //   - Recipients that get the full unfiltered talk can share one broadcast call.
    //   - Recipients that get different filtered versions each need a directed send.
    const fullTalkPayload = JSON.stringify({ ...talk, id: talkId, authorId: me.id });
    const fullRecipients = plans
      .filter((p) => JSON.stringify(p.talkPayload) === fullTalkPayload)
      .map((p) => p.recipientId);
    const filteredPlans = plans.filter((p) => JSON.stringify(p.talkPayload) !== fullTalkPayload);

    let announceCount = 0;
    // Deliver full-talk recipients in one broadcast (batched).
    if (fullRecipients.length > 0) {
      await mesh.broadcastTalk({ ...talk, id: talkId, authorId: me.id }, {
        recipientUserIds: fullRecipients,
        roomBroadcast: true,
        ...(deliveryOptions.skipAcknowledgements ? { skipAcknowledgements: true } : {}),
      });
      announceCount += fullRecipients.length;
    }
    // Deliver per-recipient filtered talk (directed sends, one per distinct filtered body).
    for (const plan of filteredPlans) {
      await mesh.broadcastTalk(plan.talkPayload, {
        recipientUserIds: [plan.recipientId],
        roomBroadcast: false,
      });
      announceCount += 1;
    }

    const suppressedCount = receiverIds.length - plans.length;
    console.log(`📡 Mesh talk announcement published: talkId=${talkId} receivers=${announceCount} (suppressed=${suppressedCount}, partialFiltered=${filteredPlans.length})`);
    return true;
  }

  /**
   * Other users who should receive direct offers or legacy server-side IN registration for a broadcast.
   * **Gun `chatrooms/<id>/users` is authoritative** for who is in the room (FR-BM-7: same node only,
   * no parent→child hierarchy fan-out). The UI member list supplies `stageName`s only — never adds
   * receiver ids when Gun reports an empty room.
   */
  private async resolveBroadcastReceivers(
    chatroomId: string,
    uiMembers: Array<{ userId: string; stageName: string }>,
  ): Promise<Array<{ userId: string; stageName: string }>> {
    const me = this.currentUser?.id;
    if (!me) return [];

    const uiNameById = new Map<string, string>();
    for (const m of uiMembers || []) {
      if (!m.userId || m.userId === me || m.userId === TECHSUPPORT_ROOT_USER_ID) continue;
      const name = String(m.stageName || m.userId).trim() || m.userId;
      uiNameById.set(m.userId, name);
    }

    let memberIds: string[] = [];
    const fromServer = await this.chatroomService.fetchMemberIdsFromServer(chatroomId);
    memberIds = [...new Set(fromServer.filter((id) => !!id && id !== me && id !== TECHSUPPORT_ROOT_USER_ID))];

    let gunMemberIds: string[] = [];
    const mergeGunOnce = async () => {
      const ids = await this.chatroomService.getActiveMembers(chatroomId);
      gunMemberIds = [...new Set(ids.filter((id) => !!id && id !== me && id !== TECHSUPPORT_ROOT_USER_ID))];
    };

    if (memberIds.length === 0) {
      await mergeGunOnce();
      memberIds = gunMemberIds;
    }

    if (memberIds.length === 0) {
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 150));
        await mergeGunOnce();
        memberIds = gunMemberIds;
        if (memberIds.length > 0) break;
      }
    }

    // Same-room UI list is authoritative for stage names when Gun/server snapshots lag after join.
    if (memberIds.length === 0 && uiNameById.size > 0) {
      memberIds = [...uiNameById.keys()];
    }

    return memberIds.map((userId) => ({
      userId,
      stageName: uiNameById.get(userId) || userId,
    }));
  }

  /**
   * Current user saw a talk announcement in their subscribed chatroom. Receiver-driven intake still
   * works when the sender's on-screen member list is wrong (e.g. eviction / room mismatch).
   */
  private async ingestIncomingTalkAnnouncement(
    talkId: string,
    senderId: string,
    senderName: string,
    talkData: any,
    opts: { deliveryChatroomId?: string } = {},
  ): Promise<boolean> {
    if (!this.currentUser) return false;
    if (
      !(await this.shouldAcceptIncomingTalkAsync({
        senderId,
        talkData: talkData as Record<string, unknown>,
        ...(opts.deliveryChatroomId ? { deliveryChatroomId: opts.deliveryChatroomId } : {}),
      }))
    ) {
      return false;
    }

    const cluster = upsertLocalIncomingTalkCluster(
      this.gunService,
      this.currentUser.id,
      {
        talkId,
        talkData: talkData as Record<string, unknown>,
        senderId,
        senderName,
      },
      this.p2pRuntimeFlags,
    );
    this.mergeIncomingClusterIntoUi([cluster]);

    // Step 9: write responder-side exchanged entry so change-of-mind fanout can
    // enumerate all senders of this identity.  Written here (on talk acceptance)
    // so the sender list is populated before any submitTalkResponsePairDirect call.
    // role:'responder' + version:0 means "received but not yet answered".
    // submitTalkResponsePairDirect will overwrite with the actual version on answer.
    try {
      const identityKey = buildTalkIdentityKey(talkData);
      const existingVersion = getResponderVersionForTalk(identityKey, senderId);
      if (existingVersion === 0) {
        // Only seed the sender record if not yet answered (version 0 = no prior answer)
        writeResponderExchangedEntry({
          authorId: senderId,
          identityKey,
          talkId,
          authorName: senderName,
          authorEpub: String(talkData?.authorEpub || talkData?.senderEpub || ''),
          outcome: 'no-reply',
          version: 0,
          responseId: '',
          respondedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Non-fatal: fanout may miss this sender on first change-of-mind attempt
    }

    return true;
  }

  /**
   * Full talk-completion flow. Three sequential steps:
   *
   * 1. Sync QA preferences — persist the user's chosen answers to their profile (Gun, SEA-signed).
   *
   * 2. Save the client-side chatbot template — stored in localStorage so the chatbot UI
   *    can use it for a rapid re-announce.
   *
   * 3. Submit the response via the direct mesh P2P path (P0 step 7: server talk delivery removed).
   *    Match/conversation creation happens fully client-side via submitTalkResponsePairDirect.
   */
  private async handleTalkCompleted(data: {
    talkId: string;
    answers: any[];
    talkData?: any;
    isChatbotResponse?: boolean;
  }): Promise<void> {
    console.log('📝 User completed talk:', data);
    const isChatbot = !!data.isChatbotResponse;
    const locallyLooksLikeMatch = !!data.talkData && this.checkIfMatch(data.talkData, data.answers);
    const isE2eLocalOnlyReject =
      data.talkData?.e2eLocalOnlyReject === true &&
      !locallyLooksLikeMatch &&
      data.talkData?.authorId &&
      data.talkData.authorId !== this.currentUser?.id;

    if (isE2eLocalOnlyReject) {
      this.recordLocalTalkExchange(
        String(data.talkData.authorId),
        String(data.talkData.authorName || 'Unknown'),
        data.talkId,
        data.talkData,
        'mismatch',
        {
          answers: data.answers,
          direction: 'received',
          respondedAt: new Date().toISOString(),
        },
      );
      const pairKey = `${data.talkId}::${String(data.talkData.authorId)}`;
      this.chatbotAutoReplySentForPair.add(pairKey);
      this.chatbotAutoReplyRetryCountByPair.delete(pairKey);
      return;
    }

    // Step 1 — sync QA preferences (best-effort: a transient Gun SEA write failure
    // must not abort step 3 which creates the match/conversation/contact).
    if (data.talkData) {
      const pair = this.gunService.getStoredPair();
      if (pair) {
        try {
          await this.userService.syncQuestionAnswersFromTalkCompletion(
            data.talkData,
            data.answers,
            this.uiManager.getAnswerPreferencesSnapshot(),
            pair,
          );
        } catch (syncErr) {
          console.warn('syncQuestionAnswersFromTalkCompletion failed (non-fatal):', syncErr);
        }
      }
    }

    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (!chatroomId) return;

    // Step 2 — save client-side chatbot template (localStorage, UI cache only)
    // Saved before the mesh response so a rapid re-announce can use it immediately.
    if (data.talkData && locallyLooksLikeMatch && !isChatbot) {
      this.uiManager.saveChatbotTemplate(data.talkId, {
        answers: data.answers,
        talkData: data.talkData,
      });
    }

    // A manual response already handled this sender/talk pair. Do not let later Gun replays
    // or duplicate room announcements trigger a chatbot follow-up to the same announcer.
    if (!isChatbot && this.currentUser?.id && data.talkData?.authorId) {
      const pairKey = `${data.talkId}::${String(data.talkData.authorId)}`;
      this.chatbotAutoReplySentForPair.add(pairKey);
      this.chatbotAutoReplyRetryCountByPair.delete(pairKey);
    }

    // Step 3 — submit via direct mesh P2P path (P0 step 7: server delivery removed).
    // All match/conversation creation happens inside submitTalkResponsePairDirect.
    const localAuthorName =
      data.talkData?.authorName && data.talkData.authorName !== 'Unknown'
        ? data.talkData.authorName
        : undefined;
    void localAuthorName; // referenced in submitTalkResponsePairDirect indirectly via authorName param

    if (data.talkData?.authorId && data.talkData.authorId !== this.currentUser?.id) {
      await this.submitTalkResponsePairDirect({
        talkId: data.talkId,
        talkData: data.talkData,
        answers: data.answers,
        isChatbotResponse: isChatbot,
        authorId: String(data.talkData.authorId),
        authorName: (data.talkData?.authorName && data.talkData.authorName !== 'Unknown'
          ? data.talkData.authorName
          : undefined) || String(data.talkData.authorName || 'Unknown'),
        isAutoResponse: !data.answers.some((a: any) => a?.mode === 'manual'),
      });
    }
    // If no authorId (e.g. self-test or malformed talk), no-op: mesh delivery requires an author.
  }

  private async submitTalkResponsePairDirect(params: {
    talkId: string;
    talkData: any;
    answers: any[];
    isChatbotResponse: boolean;
    authorId: string;
    authorName: string;
    isAutoResponse: boolean;
  }): Promise<void> {
    if (!this.currentUser?.id) return;
    const isMatch = this.checkIfMatch(params.talkData, params.answers);
    const isIgnore = params.answers.some((answer: any) => {
      const answerId = String(answer?.answerId || '').toLowerCase();
      const answerText = String(answer?.answerText || '').toLowerCase();
      return answerId === 'ignore' || answerId.includes('ignore') || answerText === 'ignore';
    });
    // R-1: CIDv1 response id — REQ-LEDGER-04/12 (replaces resp_<ts>_<rand> non-deterministic id)
    const responseContentJson = canonicalSerialize(params.answers);
    const responseId = await computeResponseId({
      talkId: params.talkId,
      responderId: this.currentUser.id,
      responseContentJson,
    });
    const submittedAt = new Date().toISOString();

    // Step 9: monotonic version bump (REQ-LEDGER-04).
    // The identityKey is the content-hash of the talk (same for all senders of identical content).
    // We look up the prior version we sent for this (identityKey, authorId) pair.
    const wholeTalkIdentityKey = buildTalkIdentityKey(params.talkData);
    const priorVersion = getResponderVersionForTalk(wholeTalkIdentityKey, params.authorId);
    const priorResponseId = getResponderLastResponseId(wholeTalkIdentityKey, params.authorId);
    // If responseId is unchanged from prior (same answers re-submitted), keep version.
    // If responseId changed (content changed), version = prior + 1.
    const isContentChange = priorResponseId !== null && priorResponseId !== responseId;
    const newVersion = priorResponseId === null
      ? 1                        // first answer ever
      : isContentChange
        ? priorVersion + 1       // change of mind: bump
        : priorVersion;          // same content re-submitted (idempotent)
    const respondedAt = submittedAt; // first answer: respondedAt == submittedAt; supersession: now

    const skipE2eLocalOnlyReject =
      process.env.DISABLE_HMR === 'true' &&
      params.talkData?.e2eLocalOnlyReject === true &&
      !isMatch;

    // Helper: send mesh+mailbox to a single target authorId
    const sentResponseByAuthor = new Map<string, { talkId: string; responseId: string; version: number }>();
    const sendToAuthor = async (
      targetAuthorId: string,
      targetAuthorName: string,
      targetEpub?: string,
      targetTalkId = params.talkId,
    ): Promise<void> => {
      const authorEpub = targetEpub ?? this.pairTalkPeerEpubHint(
        targetAuthorId === params.authorId ? params.talkData?.authorEpub : undefined,
        targetAuthorId === params.authorId ? params.talkData?.senderEpub : undefined,
      );
      let payloadCiphertext: string;
      try {
        payloadCiphertext = await this.encryptPairTalkResponsePayload(targetAuthorId, {
          responderName: this.currentUser!.stageName,
          authorName: targetAuthorName,
          answers: params.answers,
          isChatbotResponse: params.isChatbotResponse,
          transportMode: 'mesh-p2p',
        }, authorEpub);
      } catch (err) {
        console.warn(`[Step9] Failed to encrypt response for ${targetAuthorId}:`, err);
        return;
      }
      const targetResponseId = targetTalkId === params.talkId
        ? responseId
        : await computeResponseId({
            talkId: targetTalkId,
            responderId: this.currentUser!.id,
            responseContentJson,
          });
      const targetPriorResponseId = getResponderLastResponseId(wholeTalkIdentityKey, targetAuthorId);
      const targetPriorVersion = getResponderVersionForTalk(wholeTalkIdentityKey, targetAuthorId);
      const targetVersion = targetPriorResponseId === null
        ? 1
        : targetPriorResponseId === targetResponseId
          ? targetPriorVersion
          : targetPriorVersion + 1;
      const responderEpub = this.gunService.getStoredPair()?.epub;
      const meshPayload: P2PMeshTalkResponsePayload = {
        responseId: targetResponseId,
        talkId: targetTalkId,
        authorId: targetAuthorId,
        responderId: this.currentUser!.id,
        submittedAt,
        respondedAt,
        version: targetVersion,
        encryption: 'sea-ecdh-v1',
        payloadCiphertext,
        transportMode: 'mesh-p2p',
        // The author decrypts with the pair secret derived from OUR epub — carry it inline
        // so the author never has to network-resolve it at ingest (see type comment).
        ...(responderEpub ? { responderEpub } : {}),
      };
      const mesh = this.ensurePeerMeshService();
      let sent = false;
      if (mesh) {
        try {
          sent = await mesh.sendTalkResponse(meshPayload);
        } catch (err) {
          console.warn('[MeshResponse] sendTalkResponse failed, falling back to mailbox:', err);
        }
      }
      // Step 6: when unicast cannot be delivered (author offline or send failed),
      // post a ciphertext envelope to the server mailbox.
      let mailboxPosted: boolean | null = null;
      let queued = false;
      if (!sent) {
        mailboxPosted = await this.postToMailbox(meshPayload);
        if (!mailboxPosted) {
          this.enqueueFailedMailboxPost(meshPayload);
          queued = true;
        }
      }
      // Delivery-matrix diagnostic: exactly one line per response send with every stage's
      // outcome — the silent-success pipeline made every saturation post-mortem archaeology.
      console.log(`[RESP-SEND] talk=${targetTalkId.slice(-8)} to=${targetAuthorId.slice(0, 8)} v=${targetVersion} mesh=${sent} mailbox=${mailboxPosted} queued=${queued}`);
      sentResponseByAuthor.set(targetAuthorId, {
        talkId: targetTalkId,
        responseId: targetResponseId,
        version: targetVersion,
      });
    };

    if (!skipE2eLocalOnlyReject) {
      // Step 10: check dead inbox — if the talk has been retracted by the author, skip delivery.
      const ledgerDocForPrimary = getTalkLedgerDoc();
      const primaryRetractKey = ledgerRetractedKey(params.talkId, params.authorId);
      const talkRetractedForPrimary = !!ledgerDocForPrimary.retracted[primaryRetractKey];
      if (talkRetractedForPrimary) {
        console.debug(`[Step10] Skipping response send — talk ${params.talkId} retracted by ${params.authorId}`);
      } else {
        // Send to the primary author
        await sendToAuthor(params.authorId, params.authorName);
      }

      // Step 9.1: change-of-mind fanout — if this is a version bump (content change),
      // propagate to ALL original senders of this identity (not just the current author).
      // The responder's exchanged section records every author who sent them this identity.
      if (isContentChange) {
        const allSenders = getResponderTargetsForIdentity(wholeTalkIdentityKey);
        const ledgerDocForFanout = getTalkLedgerDoc();
        for (const sender of allSenders) {
          const senderId = sender.peerId;
          if (senderId === params.authorId) continue; // already sent above
          // Step 10: skip senders whose talk has been retracted (dead inbox).
          const rKey = ledgerRetractedKey(params.talkId, senderId);
          if (ledgerDocForFanout.retracted[rKey]) {
            console.debug(`[Step10] Skipping fanout to retracted-talk sender ${senderId}`);
            continue;
          }
          console.log(`[Step9] Change-of-mind fanout to additional sender ${senderId}`);
          try {
            await sendToAuthor(
              senderId,
              sender.peerName || 'Unknown',
              sender.peerEpub,
              sender.talkId || params.talkId,
            );
          } catch (err) {
            console.warn(`[Step9] Fanout to ${senderId} failed:`, err);
          }
        }
      }
    }

    // Write/update the responder-side exchanged entry to track this response.
    // This persists version + responseId for future version-bump decisions.
    try {
      const ledgerOutcomeVal = isMatch ? 'matched' as const : 'ignored' as const;
      writeResponderExchangedEntry({
        authorId: params.authorId,
        identityKey: wholeTalkIdentityKey,
        talkId: params.talkId,
        authorName: params.authorName,
        authorEpub: String(params.talkData?.authorEpub || params.talkData?.senderEpub || ''),
        outcome: ledgerOutcomeVal,
        version: newVersion,
        responseId,
        respondedAt,
      });
      for (const identityKey of this.selectedTalkIdentityKeys(params.talkData, params.answers)) {
        if (identityKey === wholeTalkIdentityKey) continue;
        writeResponderExchangedEntry({
          authorId: params.authorId,
          identityKey,
          talkId: params.talkId,
          authorName: params.authorName,
          authorEpub: String(params.talkData?.authorEpub || params.talkData?.senderEpub || ''),
          outcome: ledgerOutcomeVal,
          version: newVersion,
          responseId,
          respondedAt,
        });
      }
      // Also update for any other senders of the same identity (fanout case)
      if (isContentChange) {
        const allSenders = getResponderTargetsForIdentity(wholeTalkIdentityKey);
        for (const sender of allSenders) {
          const senderId = sender.peerId;
          if (senderId === params.authorId) continue;
          const sentResponse = sentResponseByAuthor.get(senderId);
          writeResponderExchangedEntry({
            authorId: senderId,
            identityKey: wholeTalkIdentityKey,
            ...(sentResponse?.talkId || sender.talkId
              ? { talkId: sentResponse?.talkId || sender.talkId }
              : {}),
            ...(sender.peerName ? { authorName: sender.peerName } : {}),
            ...(sender.peerEpub ? { authorEpub: sender.peerEpub } : {}),
            outcome: ledgerOutcomeVal,
            version: sentResponse?.version ?? sender.version,
            responseId: sentResponse?.responseId || String((sender as any).responseId || ''),
            respondedAt,
          });
        }
      }
    } catch {
      // Non-fatal
    }

    // Step 7: client-side stats POST removed (server route dies in phase B).
    this.ledgerEmit(InteractionKind.TALK_ANSWERED, {
      talkId: params.talkId,
      responseId,
      outcome: isMatch ? 'match' : isIgnore ? 'ignore' : 'mismatch',
    });

    this.recordLocalTalkExchange(
      params.authorId,
      params.authorName,
      params.talkId,
      params.talkData,
      isMatch ? 'match' : 'mismatch',
      {
        responseId,
        version: newVersion,
        respondedAt,
        answers: params.answers,
        direction: 'received',
      },
    );

    if (!isMatch) return;
    const conversationId = await this.conversationService.createConversation({
      userId1: this.currentUser.id,
      userName1: this.currentUser.stageName,
      userId2: params.authorId,
      userName2: params.authorName,
      talkId: params.talkId,
      respondedByBotForUser1: false,
      respondedByBotForUser2: params.isChatbotResponse,
    });
    this.uiManager.addNewConversation({
      conversationId,
      otherUserId: params.authorId,
      otherUserName: params.authorName,
      talkId: params.talkId,
      respondedByBot: false,
      transportMode: this.conversationService.getTransportMode(),
    });
    this.uiManager.setMemberMatched(params.authorId);
    this.ledgerEmit(InteractionKind.MATCH_CREATED, {
      talkId: params.talkId,
      conversationId,
      otherUserId: params.authorId,
    });
  }

  private checkIfMatch(talkData: any, answers: any[]): boolean {
    // Matching-type talks and tags both use isMatch on the chosen answer
    if (talkData.type !== 'flow' && talkData.type !== 'tag') {
      console.log('  Not a flow talk, type:', talkData.type);
      return false;
    }

    // Find the last answer
    const lastAnswer = answers[answers.length - 1];
    if (!lastAnswer) {
      console.log('  No last answer found');
      return false;
    }

    console.log('  Last answer:', lastAnswer);

    // Find the corresponding question and answer in the talk
    const question = talkData.questions.find((q: any) => q.id === lastAnswer.questionId);
    if (!question) {
      console.log('  Question not found for ID:', lastAnswer.questionId);
      return false;
    }

    console.log('  Found question:', question.text);

    const answer = question.answers.find((a: any) => a.id === lastAnswer.answerId);
    if (!answer) {
      console.log('  Answer not found for ID:', lastAnswer.answerId);
      return false;
    }

    console.log('  Found answer:', answer.text, 'isMatch:', answer.isMatch);

    // Check if this answer is marked as a match
    const isMatch = answer.isMatch === true;
    console.log('  Is match?', isMatch);
    return isMatch;
  }

  /** Resolve full talk using the receiver-owned local incoming-talk index. */
  private async loadFullTalkViaIncomingIdentity(identityKey: string): Promise<Talk | null> {
    if (!this.currentUser?.id) return null;
    try {
      const clusters = await collectLocalIncomingTalkClusters(this.gunService, this.currentUser.id, this.p2pRuntimeFlags, {
        waitMs: 400,
      });
      if (!Array.isArray(clusters)) return null;
      const cluster = clusters.find(
        (c: any) =>
          c &&
          (c.identityKey === identityKey ||
            (c.identityAliases &&
              typeof c.identityAliases === 'object' &&
              c.identityAliases[identityKey])),
      );
      if (!cluster) return null;
      const latestTalkId = pickLatestTalkIdFromIncomingCluster(cluster);
      if (!latestTalkId) return null;
      const cached = this.peerMeshService?.getCachedTalkBody(latestTalkId);
      if (cached) return cached as unknown as Talk;
      if (cluster.questionsJson) {
        try {
          const sender = Object.values(cluster.senders || {}).find(
            (candidate: any) => candidate?.lastTalkId === latestTalkId,
          ) as any;
          return {
            id: latestTalkId,
            title: cluster.title,
            type: cluster.type,
            language: cluster.language,
            authorId: sender?.senderId || '',
            authorName: sender?.senderName || 'Unknown',
            questions: JSON.parse(cluster.questionsJson),
            isAdult: false,
            tags: [],
            createdAt: new Date(cluster.updatedAt),
            isTemplate: false,
            usageCount: 0,
          } as unknown as Talk;
        } catch {
          /* retry the legacy lookup below */
        }
      }
      return this.talkService.getTalkWithRetry(latestTalkId);
    } catch {
      return null;
    }
  }

  private subscribeToIncomingTalks(): void {
    if (!this.currentUser) return;
    console.log('👂 Subscribing to incoming talk clusters for:', this.currentUser.id);

    this.incomingTalkClusterUnsubscribe?.();
    this.incomingTalkClusterUnsubscribe = subscribeLocalIncomingTalkClusters(
      this.gunService,
      this.currentUser.id,
      this.p2pRuntimeFlags,
      (cluster: any, id: string) => {
        if (!cluster || !id || id.startsWith('_')) return;
        if (this.incomingApiRefreshTimer) clearTimeout(this.incomingApiRefreshTimer);
        this.incomingApiRefreshTimer = setTimeout(() => {
          void this.refreshIncomingTalkClustersFromLocalGun();
        }, 120);
      },
    );
  }

  /**
   * E2E: deliver pending OUT talks using the same register + Gun path as Broadcast, without the audience modal.
   */
  public async deliverPendingBroadcastTalksForE2e(
    minReceivers = 1,
    opts: {
      skipAudiencePreview?: boolean;
      skipDeliveryAcks?: boolean;
      receiverUsers?: Array<{ userId: string; stageName?: string }>;
    } = {},
  ): Promise<{ talksSent: number; receivers: number }> {
    if (!this.currentUser) throw new Error('App not ready for E2E broadcast delivery');
    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (!chatroomId) throw new Error('No current chatroom for E2E broadcast delivery');
    const members = this.uiManager.getCurrentChatroomMembers();
    let broadcastableIds = this.uiManager.getBroadcastableTalkIds();
    if (broadcastableIds.length === 0) {
      broadcastableIds = this.uiManager.getPendingBroadcastTalkIds();
    }
    const receivers = Array.isArray(opts.receiverUsers) && opts.receiverUsers.length > 0
      ? opts.receiverUsers
          .filter((user) => user.userId && user.userId !== this.currentUser!.id && user.userId !== TECHSUPPORT_ROOT_USER_ID)
          .map((user) => ({ userId: user.userId, stageName: user.stageName || user.userId }))
      : await this.resolveBroadcastReceivers(chatroomId, members);
    if (receivers.length < minReceivers && !(minReceivers === 0 && receivers.length === 0)) {
      throw new Error(`receiverIds=${receivers.length} room=${chatroomId}`);
    }
    const targetCount = receivers.length;
    if (!Array.isArray(broadcastableIds) || broadcastableIds.length === 0) {
      this.uiManager.setBroadcastBulkAck(0, targetCount);
      return { talksSent: 0, receivers: targetCount };
    }
    let sent = 0;
    const talkPayloads: Array<{ tid: string; talk: Talk }> = [];
    for (const talkId of broadcastableIds) {
      let talk = this.uiManager.getBroadcastTalkPayload(talkId);
      if (!talk) {
        talk = await this.talkService.getTalkWithRetry(talkId, { attempts: 15, gapMs: 100 });
      }
      if (!talk) continue;
      const tid = String(talk.id || talkId);
      talk = { ...talk, id: tid, authorId: talk.authorId || this.currentUser.id };
      if (this.isTalkExpiredForDelivery(talk)) continue;
      talkPayloads.push({ tid, talk: talk as Talk });
    }
    if (talkPayloads.length === 0) {
      throw new Error('no talk payloads for E2E broadcast delivery');
    }
    if (receivers.length === 0) {
      const attempted = talkPayloads
        .filter(({ tid }) => this.uiManager.getBroadcastableTalkIds().includes(tid))
        .length;
      this.uiManager.setBroadcastBulkAck(attempted, 0);
      this.uiManager.recordBroadcastConversation(
        chatroomId,
        talkPayloads
          .filter(({ tid }) => this.uiManager.getBroadcastableTalkIds().includes(tid))
          .map(({ tid }) => tid),
        [],
      );
      return { talksSent: attempted, receivers: 0 };
    }
    // Mesh delivery fans out to resolved receivers directly; no server preview needed.
    const previews: BroadcastAudiencePreview[] = [];
    const previewByTalkId = new Map(previews.map((p) => [p.talkId, p]));
    const REGISTER_BATCH = 5;
    const registeredTalkIds: string[] = [];
    for (let i = 0; i < talkPayloads.length; i += REGISTER_BATCH) {
      const batch = talkPayloads.slice(i, i + REGISTER_BATCH);
      const batchResults = await Promise.all(
        batch.map(async ({ tid, talk }) => {
          const preview = previewByTalkId.get(tid);
          const eligibleIds =
            usesMeshTalkDelivery(this.p2pRuntimeFlags) || preview?.previewUnavailable || !Array.isArray(preview?.eligibleReceiverIds)
              ? undefined
              : preview.eligibleReceiverIds;
          const ok = await this.deliverTalkToReceiversOverMesh(
            tid,
            talk,
            receivers,
            eligibleIds,
            { skipAcknowledgements: opts.skipDeliveryAcks === true },
          );
          if (ok) registeredTalkIds.push(tid);
          return ok;
        }),
      );
      sent += batchResults.filter(Boolean).length;
    }
    this.uiManager.setBroadcastBulkAck(sent, targetCount);
    this.uiManager.recordBroadcastConversation(chatroomId, registeredTalkIds, receivers);
    return { talksSent: sent, receivers: targetCount };
  }

  /**
   * E2E: await the same IN-list merge as the Talks tab. The tab emits
   * `needIncomingTalkClusters` without awaiting; Playwright needs a promise-bound sync.
   */
  public async syncIncomingClustersFromServer(): Promise<void> {
    // R-a step 7: Gun p2pMeshTalkBodies/* rendezvous path removed; clusters arrive via mesh or mailbox drain.
    await this.refreshIncomingTalkClustersFromLocalGun();
    if (this.e2eSeededIncomingClusters.length > 0) {
      this.mergeIncomingClusterIntoUi(this.e2eSeededIncomingClusters);
    }
  }

  /**
   * Step 7: setSkipDirectTalkStatsForE2e removed — client stats POST deleted.
   * Step 8 E2E hook: set quota unlimited for high-fanout rebroadcast specs.
   */
  public setTalkLedgerQuotaUnlimitedForE2e(unlimited: boolean): void {
    setTalkLedgerQuotaUnlimited(unlimited === true);
  }

  public setTalkLedgerSuppressionDisabledForE2e(disabled: boolean): void {
    this.talkLedgerSuppressionDisabledForE2e = disabled === true;
  }

  public setMailboxFallbackDisabledForE2e(disabled: boolean): void {
    this.mailboxFallbackDisabledForE2e = disabled === true;
  }

  public getFetchedAttachmentBytesLengthForE2e(cid: string): number {
    const bytes = this.fetchedAttachmentBytesByCid.get(String(cid || '').trim());
    return bytes ? bytes.length : 0;
  }

  /**
   * Step 8 E2E read helper: return the current talkLedger doc for assertions.
   */
  public getTalkLedgerDocForE2e(): unknown {
    return getTalkLedgerDoc();
  }

  public async seedIncomingTagTalkForE2e(params: {
    keyword: string;
    senderId: string;
    senderName: string;
  }): Promise<void> {
    if (!this.currentUser?.id) return;
    const keyword = String(params.keyword || '').trim();
    const senderId = String(params.senderId || '').trim();
    if (!keyword || !senderId || senderId === this.currentUser.id) return;
    const talkId = `e2e-tag-${senderId}-${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const talkData = {
      id: talkId,
      title: keyword,
      type: 'tag',
      language: 'en',
      authorId: senderId,
      authorName: params.senderName || senderId,
      e2eLocalOnlyReject: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: `${talkId}-q`,
          text: keyword,
          answers: [
            { id: 'match', text: 'Match.', isMatch: true },
            { id: 'ignore', text: 'Ignore.', isIgnore: true },
          ],
        },
      ],
    };
    this.e2eSeededTagTalks.set(keyword.toLowerCase(), talkData);
    const cluster = upsertLocalIncomingTalkCluster(
      this.gunService,
      this.currentUser.id,
      {
        talkId,
        talkData,
        senderId,
        senderName: params.senderName || senderId,
      },
      this.p2pRuntimeFlags,
    );
    this.e2eSeededIncomingClusters.push(cluster);
    await this.refreshIncomingTalkClustersFromLocalGun();
    this.mergeIncomingClusterIntoUi([cluster]);
  }

  /**
   * Generic incoming-talk seed for E2E specs that need a real IN row + real response-modal
   * UI without waiting on a live mesh/WebRTC round trip (e.g. mobile-viewport specs where the
   * point under test is the response dialog, not delivery). Mirrors {@link seedIncomingTagTalkForE2e}
   * but accepts any talk type/shape as-is (flow/route/survey/tag) instead of hardcoding a tag talk.
   * Also caches the talk body on the local mesh service so {@link resolveMeshTalkData} (used by the
   * "View" button's demandFullTalk handler) resolves it without a network round trip.
   */
  public async seedIncomingTalkForE2e(params: {
    talkData: Record<string, unknown>;
    senderId: string;
    senderName: string;
  }): Promise<void> {
    if (!this.currentUser?.id) return;
    const senderId = String(params.senderId || '').trim();
    const talkId = String(params.talkData?.id || '').trim();
    if (!talkId || !senderId || senderId === this.currentUser.id) return;
    const talkData = { ...params.talkData, authorId: senderId, authorName: params.senderName || senderId };
    this.ensurePeerMeshService()?.cacheTalkBody?.(talkId, talkData);
    const cluster = upsertLocalIncomingTalkCluster(
      this.gunService,
      this.currentUser.id,
      {
        talkId,
        talkData,
        senderId,
        senderName: params.senderName || senderId,
      },
      this.p2pRuntimeFlags,
    );
    this.e2eSeededIncomingClusters.push(cluster);
    await this.refreshIncomingTalkClustersFromLocalGun();
    this.mergeIncomingClusterIntoUi([cluster]);
  }

  public openSeededTagResponseForE2e(keyword: string): boolean {
    const talk = this.e2eSeededTagTalks.get(String(keyword || '').trim().toLowerCase());
    if (!talk) return false;
    this.uiManager.showTalkResponseDialog(talk as Talk, { skipAutoAnswer: true });
    return true;
  }

  private async refreshIncomingTalkClustersFromLocalGun(): Promise<void> {
    if (!this.currentUser?.id) return;
    const clusters = await collectLocalIncomingTalkClusters(this.gunService, this.currentUser.id, this.p2pRuntimeFlags, {
      waitMs: 500,
    });
    this.mergeIncomingClusterIntoUi(clusters);
  }

  private mergeIncomingClusterIntoUi(clusters: any[]): void {
    this.applyIncomingTalkClusters(clusters);
  }

  private applyIncomingTalkClusters(clusters: any[]): void {
    // Replace the UI snapshot with the current local/direct or legacy server cluster list.
    // Spreading incomingClustersMap left stale/non-identity entries and could prevent IN rows from matching.
    const next: Record<string, any> = {};
    for (const c of clusters) {
      if (c?.identityKey) {
        next[c.identityKey] = c;
      }
    }
    const list = Object.values(next).filter((c: any) => c && c.identityKey);
    if (this.currentUser?.id) {
      mirrorIncomingTalkClustersToLocalGun(
        this.gunService,
        this.currentUser.id,
        list,
        this.p2pRuntimeFlags,
      );
    }
    this.uiManager.setIncomingTalkClusters(list);
    this.uiManager.displayTalksList();
  }

  /**
   * The talk-independent DM thread with a peer (redesign §5): one conversation per
   * pair with `talkId: 'direct'`, kept separate from per-matched-talk threads so DM
   * and thread messages never leak into each other. The TechSupport pair reuses its
   * dedicated support channel.
   */
  private async findOrCreateDirectConversation(peerId: string, peerName: string): Promise<string> {
    if (!this.currentUser) throw new Error('Not logged in');
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}') as Record<string, any>;
    const existing = Object.entries(conversations).find(
      ([, conv]: [string, any]) =>
        conv?.otherUserId === peerId && (conv?.supportChannel === true || conv?.talkId === 'direct'),
    );
    if (existing) return existing[0];
    const conversationId = await this.conversationService.createConversation({
      userId1: this.currentUser.id,
      userName1: this.currentUser.stageName,
      userId2: peerId,
      userName2: peerName,
      talkId: 'direct',
    });
    await this.ingestConversationRecords([{
      conversationId,
      otherUserId: peerId,
      otherUserName: peerName,
      talkId: 'direct',
      createdAt: new Date().toISOString(),
    }]);
    return conversationId;
  }

  private async ingestConversationRecords(conversations: any[]): Promise<void> {
    if (!this.currentUser) return;

    for (const conversationData of conversations) {
      // Gun stores otherUserId/otherUserName; legacy or other sources may use userId1/userId2
      const otherUserId =
        conversationData.otherUserId ??
        (conversationData.userId1 === this.currentUser.id
          ? conversationData.userId2
          : conversationData.userId1);
      const otherUserName =
        conversationData.otherUserName ??
        (conversationData.userId1 === this.currentUser.id
          ? conversationData.userName2
          : conversationData.userName1);

      // Never ingest a conversation whose other participant resolves to the local user.
      // A content-collision (two authors, identical content-addressed talkId) can produce
      // a `conv_<a>_<b>_<talkId>` record whose participants array, read back from the
      // shared Gun node, leaves otherUserId ambiguous; guarding self here keeps the user
      // out of their own contacts list.
      if (!otherUserId || otherUserId === this.currentUser.id) continue;

      let resolvedOtherUserName = otherUserName ?? 'Unknown';
      if (
        !resolvedOtherUserName ||
        resolvedOtherUserName === 'Unknown' ||
        resolvedOtherUserName === 'Someone'
      ) {
        try {
          const publicUser = await this.gunService.getPublicUser(otherUserId);
          if (publicUser?.stageName) {
            resolvedOtherUserName = publicUser.stageName;
          }
        } catch {
          /* keep placeholder */
        }
        if (
          !resolvedOtherUserName ||
          resolvedOtherUserName === 'Unknown' ||
          resolvedOtherUserName === 'Someone'
        ) {
          try {
            const fullUser = await this.userService.getUser(otherUserId);
            if (fullUser?.stageName) {
              resolvedOtherUserName = fullUser.stageName;
            }
          } catch {
            /* keep placeholder */
          }
        }
      }

      this.uiManager.addNewConversation({
        conversationId: conversationData.conversationId,
        otherUserId,
        otherUserName: resolvedOtherUserName,
        talkId: conversationData.talkId,
        relatedTalkIds: conversationData.relatedTalkIds,
        relatedTalkIdsJson: conversationData.relatedTalkIdsJson,
        respondedByBot: conversationData.respondedByBot,
        supportChannel: conversationData.supportChannel,
        transportMode:
          conversationData.transportMode ?? this.conversationService.getTransportMode(),
        transportFallbackReason: conversationData.transportFallbackReason,
      });
    }
  }

  private subscribeToUserConversations(): void {
    if (!this.currentUser) return;

    console.log('💬 Subscribing to user conversations for:', this.currentUser.id);

    this.conversationService.subscribeToUserConversations(
      this.currentUser.id,
      async (conversations) => {
        console.log('📨 New conversations detected:', conversations);
        await this.ingestConversationRecords(conversations);
      },
    );
  }

  private ensureConversationPreviewSubscription(conversationId: string): void {
    if (!this.currentUser || this.conversationPreviewUnsubscribers.has(conversationId)) return;
    const conversation = this.uiManager.getMyConversations()[conversationId];
    if (!conversation?.otherUserId) return;
    const unsubscribe = this.conversationService.subscribeToMessages(
      conversationId,
      (messages) => this.uiManager.syncConversationMessageSummary(conversationId, messages, this.currentUser!.id),
      this.currentUser.id,
      conversation.otherUserId,
    );
    this.conversationPreviewUnsubscribers.set(conversationId, unsubscribe);
  }

  private async refreshConversationPresence(): Promise<void> {
    if (!this.currentUser) return;
    const presence = this.presenceClient ?? new P2PPresenceClient({ apiBase: this.getBackendApiBase() });
    try {
      const peers = await presence.fetchNearby(this.currentUser.id, 200);
      this.uiManager.setConversationOnlineStatus(new Set(peers.map((peer) => peer.userId)));
    } catch {
      // Presence is supplemental list metadata; leave the existing state intact on failure.
    }
  }

  private refreshStatusBar(): void {
    const chatroomId = this.currentChatroomId || this.chatroomService.getCurrentChatroomId();
    if (!chatroomId || !this.currentUser) return;
    const chatroomName = this.getChatroomDisplayName(chatroomId);
    const memberCount = this.uiManager.getChatroomMemberCount(chatroomId) || 0;
    this.uiManager.updateStatusBar(
      this.currentUser.stageName,
      chatroomName,
      memberCount,
      this.uiManager.getTotalMatches(),
    );
  }

  private setupEventHandlers(): void {
    // Handle UI events

    this.uiManager.on('conversationAdded', (data: { conversationId: string }) => {
      this.refreshStatusBar();
      this.ensureConversationPreviewSubscription(data.conversationId);
      void this.refreshConversationPresence();
    });

    this.uiManager.on('updateTalkFilters', async (filters: any) => {
      if (!this.currentUser) return;
      this.currentUser.talkFilters = filters;
      try {
        await this.userService.updateTalkFilters(this.currentUser.id, filters);
      } catch (error) {
        console.warn('Failed to persist talk filters:', error);
      }
    });

    this.uiManager.on('setCreditVisibility', async (data: { visible: boolean }) => {
      if (!this.currentUser) return;
      this.currentUser.reputation.isHidden = !data.visible;
      try {
        await this.userService.updateReputationVisibility(this.currentUser.id, !data.visible);
      } catch (error) {
        console.warn('Failed to persist credit visibility:', error);
      }
    });

    this.uiManager.on(
      'saveKnownPerson',
      async (data: { userId: string; label: any; nickname?: string; customLabel?: string; rating?: number; notes?: string }) => {
        if (!this.currentUser) return;
        try {
          const extras = {
            ...(data.customLabel ? { customLabel: data.customLabel } : {}),
            ...(typeof data.rating === 'number' ? { rating: data.rating } : {}),
            ...(data.notes ? { notes: data.notes } : {}),
          };
          await this.userService.addKnownPerson(
            this.currentUser.id,
            data.userId,
            data.label,
            data.nickname,
            extras,
          );
        } catch (error) {
          console.warn('Failed to save known person:', error);
        }
      },
    );

    this.uiManager.on('submitPeerReview', async (data: { userId: string; rating: number }) => {
      try {
        await this.userService.submitPeerReview(data.userId, data.rating);
      } catch (error) {
        console.warn('Failed to submit peer review:', error);
      }
    });

    this.uiManager.on('vouchAgeVerified', async (data: { userId: string }) => {
      try {
        await this.userService.vouchAgeVerified(data.userId);
        this.uiManager.showNotification(this.uiManager.formatAgeVoteSubmitted(), 'success');
      } catch (error) {
        console.warn('Failed to vouch age:', error);
      }
    });

    this.uiManager.on('setUserBlocked', async (data: { userId: string; blocked: boolean }) => {
      if (!this.currentUser) return;
      try {
        const blockedUserIds = data.blocked
          ? await this.userService.blockUser(this.currentUser.id, data.userId)
          : await this.userService.unblockUser(this.currentUser.id, data.userId);
        this.currentUser.blockedUserIds = blockedUserIds;
        this.uiManager.adoptSessionUser(this.currentUser);
        this.uiManager.showNotification(
          this.uiManager.formatUserBlockChanged(data.blocked),
          'success',
        );
      } catch (error) {
        console.warn('Failed to update block state:', error);
      }
    });

    // Handle stage name changes
    this.uiManager.onStageNameChange = async (userId: string, newStageName: string) => {
      try {
        await this.userService.updateStageName(userId, newStageName);

        // Update current user object
        if (this.currentUser && this.currentUser.id === userId) {
          this.currentUser.stageName = newStageName;
          const pair = this.gunService.getStoredPair();
          await this.userService.syncPublicUserForRelay({
            ...this.currentUser,
            ...(pair?.pub ? { pub: pair.pub } : {}),
            ...(pair?.epub ? { epub: pair.epub } : {}),
          });
          // Refresh the UI to show the new name
          this.uiManager.showMainInterface(this.currentUser);

          // Update the stage name in the current chatroom so others can see it
          if (this.currentChatroomId) {
            const gun = this.gunService.getGun();
            gun.get('chatrooms').get(this.currentChatroomId).get('users').get(userId).put({
              stageName: newStageName,
            });
            // Restart the membership heartbeat with the new name — its ~30s beats re-put the
            // member record with the name captured at heartbeat start and would otherwise
            // clobber this write back to the old name (peers' rosters then stay stale forever).
            this.chatroomService.refreshMembershipStageName(this.currentChatroomId, userId, newStageName);
            await fetch(
              `${this.getBackendApiBase()}/api/chatrooms/${encodeURIComponent(this.currentChatroomId)}/members/${encodeURIComponent(userId)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stageName: newStageName, lastSeen: new Date().toISOString() }),
              },
            ).catch(() => undefined);

            // Force status bar update with new name
            this.refreshStatusBar();
          }
        }

        this.uiManager.showNotification(this.uiManager.formatStageNameUpdated(), 'success');
      } catch (error) {
        console.error('Failed to update stage name:', error);
        throw error;
      }
    };

    this.uiManager.onProfileChange = async (
      userId: string,
      updates: {
        headshot?: string;
        languages: string[];
        profile: Array<{ id: string; question: string; answer: string; isAuto: boolean; answeredAt: Date }>;
        interests: Tag[];
      },
    ) => {
      try {
        const previousTalkFilters = this.currentUser?.talkFilters;
        const updatedUser = await this.userService.updateProfileFoundation(userId, updates);
        if (this.currentUser && this.currentUser.id === userId) {
          this.currentUser = {
            ...updatedUser,
            ...(previousTalkFilters ? { talkFilters: previousTalkFilters } : {}),
          };
          this.uiManager.showMainInterface(this.currentUser);
          this.refreshStatusBar();
        }
        this.uiManager.showNotification(this.uiManager.formatProfileUpdated(), 'success');
      } catch (error) {
        console.error('Failed to update profile foundation:', error);
        throw error;
      }
    };

    // Handle "Send Talk" button click on user - now opens conversation if exists
    this.uiManager.on('sendTalkToUser', async (data: { userId: string }) => {
      console.log('👤 User clicked:', data.userId);

      // Check if conversation exists with this user
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const existingEntry = Object.entries(conversations).find(
        ([, conv]: [string, any]) => conv?.otherUserId === data.userId,
      );

      if (existingEntry) {
        const [conversationId] = existingEntry;
        console.log('💬 Opening existing conversation:', conversationId);
        this.uiManager.showConversationDetail(conversationId);
      } else {
        // No conversation yet - show notification
        this.uiManager.showNotification(
          this.uiManager.formatMatchToStartConversation(),
          'info',
        );
      }
    });

    this.uiManager.on(
      'sendTalk',
      async (data: { talkId: string; targetScope: any; maxRecipients: number }) => {
        try {
          await this.talkService.sendBulkTalk(
            data.talkId,
            this.currentUser!.id,
            data.targetScope,
            data.maxRecipients,
          );
          this.uiManager.showNotification(this.uiManager.formatTalkSendSuccess(), 'success');
        } catch (error) {
          this.uiManager.showNotification(this.uiManager.formatTalkSendFailed((error as Error).message), 'error');
        }
      },
    );

    this.uiManager.on(
      'createTalk',
      async (
        talkData: Partial<Talk> & {
          selfAnswers?: Array<{ questionId: string; answerId: string }>;
        },
      ) => {
      try {
        console.log('📝 Creating talk:', talkData);

        // Create the talk
        const talk = await this.talkService.createTalk({
          ...talkData,
          authorId: this.currentUser!.id,
          ...(this.currentLocation
            ? {
                authorLocation: {
                  latitude: this.currentLocation.latitude,
                  longitude: this.currentLocation.longitude,
                },
              }
            : {}),
        });

        if (Array.isArray(talk.ipfsAttachments) && talk.ipfsAttachments.length > 0) {
          await this.ensureContentNodeInitialized();
          this.contentNodeService.pinTalkAttachments(talk.id, talk.ipfsAttachments);
        }

        console.log('✅ Talk created:', talk);

        // Phase E: ledger hook — TALK_CREATED
        this.ledgerEmit(InteractionKind.TALK_CREATED, {
          talkId: talk.id,
          title: talk.title,
          type: talk.type,
          language: talk.language,
        });

        this.uiManager.saveCreatedTalk(talk, {
          selfAnswers: talkData.selfAnswers ?? [],
        });

        // Deliver to the current room over mesh.
        const wantSendToChatroom = (talkData as { sendToChatroom?: boolean }).sendToChatroom !== false;
        const chatroomId = this.chatroomService.getCurrentChatroomId();
        if (chatroomId && wantSendToChatroom) {
          const receivers = await this.resolveBroadcastReceivers(
            chatroomId,
            this.uiManager.getCurrentChatroomMembers(),
          );
          await this.deliverTalkToReceiversOverMesh(talk.id, talk, receivers);

          console.log('📢 Talk broadcasted to chatroom:', chatroomId);
        }

        let createdMode: 'sent' | 'saved-only' | 'needs-room' = 'sent';
        if (!wantSendToChatroom) {
          createdMode = 'saved-only';
        } else if (!chatroomId) {
          createdMode = 'needs-room';
        }
        this.uiManager.showNotification(this.uiManager.formatTalkCreated(createdMode), 'success');
      } catch (error) {
        console.error('Failed to create talk:', error);
        this.uiManager.showNotification(this.uiManager.formatTalkCreateFailed((error as Error).message), 'error');
      }
    });

    // Broadcast broadcastable OUT talks: server register + Gun announce (current chatroom only)
    this.uiManager.on(
      'broadcastTalk',
      async (data: {
        chatroomId: string;
        members: Array<{ userId: string; stageName: string }>;
        talkIds?: string[];
        broadcastTargetTags?: string[];
        broadcastMaxDistanceMiles?: number;
        automatic?: boolean;
      }) => {
        try {
          const chatroomId = data.chatroomId || this.chatroomService.getCurrentChatroomId();
          if (!chatroomId || !this.currentUser) {
            this.uiManager.showNotification(this.uiManager.formatBroadcastNoChatroom(), 'error');
            return;
          }
          const broadcastableIds = Array.isArray(data.talkIds) && data.talkIds.length > 0
            ? data.talkIds
            : this.uiManager.getBroadcastableTalkIds();
          console.log(`📢 broadcastTalk: ${broadcastableIds.length} broadcastable ids, members=${data.members?.length ?? 0}`);
          const receivers = await this.resolveBroadcastReceivers(chatroomId, data.members ?? []);
          const targetCountEarly = receivers.length;
          if (broadcastableIds.length === 0) {
            // UI already shows this notification when broadcastableCount === 0; skip duplicate to avoid double toast
            this.uiManager.setBroadcastBulkAck(0, targetCountEarly);
            return;
          }

          const targetCount = receivers.length;
          console.log(`📢 broadcastTalk: ${targetCount} receivers resolved`);
          if (targetCount === 0) {
            console.warn(
              '⚠️ broadcastTalk: no receivers resolved (no other active members in this chatroom).',
            );
          }
          let sent = 0;
          // Resolve all talk payloads first (sync from localStorage, no awaits)
          const talkPayloads: Array<{ tid: string; talk: Talk }> = [];
          for (const talkId of broadcastableIds) {
            // Prefer OUT row fullTalk (localStorage) — Gun getTalk often lags for 20 talks; skipping
            // register + Gun put for most ids leaves Tom with a single IN cluster (e2e poll sees 1).
            let talk = this.uiManager.getBroadcastTalkPayload(talkId);
            if (!talk) {
              talk = await this.talkService.getTalkWithRetry(talkId, { attempts: 15, gapMs: 100 });
            }
            if (!talk) { console.warn(`📢 broadcastTalk: skipping ${talkId} (no talk data)`); continue; }
            const tid = String(talk.id || talkId);
            talk = { ...talk, id: tid, authorId: talk.authorId || this.currentUser!.id };
            if (this.isTalkExpiredForDelivery(talk)) {
              console.warn(`📢 broadcastTalk: skipping ${talkId} (expired)`);
              continue;
            }
            talkPayloads.push({ tid, talk: talk as Talk });
          }
          // Mesh delivery fans out to resolved receivers directly; no server preview needed.
          const previews: BroadcastAudiencePreview[] = [];
          const previewTalkIds = new Set(talkPayloads.map(({ tid }) => tid));
          const senderOmittedPreviews = this.uiManager
            .getSenderOmittedBroadcastPreviews()
            .filter((preview) => !previewTalkIds.has(preview.talkId));
          const audiencePreviews = [...previews, ...senderOmittedPreviews];
          if (!data.automatic && !(await this.uiManager.confirmBroadcastAudience(audiencePreviews))) {
            this.uiManager.showNotification(this.uiManager.formatBroadcastCancelled(), 'info');
            return;
          }
          // Phase 1: deliver in small parallel batches (direct mesh in P2P mode, legacy HTTP in star mode).
          // Fully sequential was very slow (20 round-trips); full parallel can spike the server.
          const REGISTER_BATCH = 5;
          const registeredTalkIds: string[] = [];
          const previewByTalkId = new Map(audiencePreviews.map((p) => [p.talkId, p]));
          const broadcastableSnapshot = new Set(broadcastableIds);
          for (let i = 0; i < talkPayloads.length; i += REGISTER_BATCH) {
            const batch = talkPayloads.slice(i, i + REGISTER_BATCH);
            const batchResults = await Promise.all(
              batch.map(async ({ tid, talk }) => {
                if (!broadcastableSnapshot.has(tid)) return false;
                const preview = previewByTalkId.get(tid);
                const eligibleIds =
                  usesMeshTalkDelivery(this.p2pRuntimeFlags) &&
                  !preview?.previewUnavailable &&
                  Array.isArray(preview?.eligibleReceiverIds)
                    ? preview.eligibleReceiverIds
                    : undefined;
                const ok = await this.deliverTalkToReceiversOverMesh(
                  tid,
                  talk,
                  receivers,
                  eligibleIds,
                );
                if (ok) registeredTalkIds.push(tid);
                return ok;
              }),
            );
            sent += batchResults.filter(Boolean).length;
          }
          const broadcastableNowForGun = new Set(registeredTalkIds);
          // Phase E: ledger hook — TALK_BROADCAST (one event per broadcasted talk)
          for (const { tid } of talkPayloads.filter(({ tid }) => broadcastableNowForGun.has(tid))) {
            this.ledgerEmit(InteractionKind.TALK_BROADCAST, {
              talkId: tid,
              recipientCount: sent,
              chatroomIds: [chatroomId],
            });
          }

          this.uiManager.setBroadcastBulkAck(sent, targetCount);
          this.uiManager.recordBroadcastConversation(chatroomId, registeredTalkIds, receivers);
          this.uiManager.showNotification(this.uiManager.formatBroadcastSent(sent, targetCount), 'success');
        } catch (error) {
          console.error('Broadcast talks failed:', error);
          this.uiManager.showNotification(this.uiManager.formatBroadcastFailed((error as Error).message), 'error');
        }
      },
    );

    this.uiManager.on('updateTalk', async (data: { id: string; title: string; type: string; questions: any[]; language?: string; tags?: any[] }) => {
      try {
        const updatedTalk = await this.talkService.updateTalk(data.id, {
          title: data.title,
          type: data.type as 'flow' | 'survey',
          questions: data.questions,
          language: data.language || 'en',
          tags: data.tags || [],
        });
        if (Array.isArray(updatedTalk.ipfsAttachments) && updatedTalk.ipfsAttachments.length > 0) {
          await this.ensureContentNodeInitialized();
          this.contentNodeService.pinTalkAttachments(updatedTalk.id, updatedTalk.ipfsAttachments);
        }
        this.uiManager.showNotification(this.uiManager.formatTalkUpdated(), 'success');
        this.uiManager.displayTalksList();
        // Phase F: emit TALK_SUPERSEDED so peers know this talk was revised.
        // Since we update in-place (same ID), oldTalkId === newTalkId; the ledger
        // captures the edit event for chatbot differential answering (REQ-CHATBOT-03).
        this.ledgerEmit(InteractionKind.TALK_SUPERSEDED, {
          oldTalkId: data.id,
          newTalkId: data.id,
        });
      } catch (error) {
        console.error('Failed to update talk:', error);
        this.uiManager.showNotification(this.uiManager.formatTalkUpdateFailed((error as Error).message), 'error');
      }
    });

    // Phase F: TALK_WITHDRAWN — emitted when user deletes or disables a talk (REQ-LEDGER-13)
    // Grace window default: 24h (configurable via TALK_WITHDRAWN_GRACE_MS env var if available)
    this.uiManager.on('withdrawTalk', (data: { talkId: string }) => {
      const gracePeriodMs =
        (typeof process !== 'undefined' && process.env && Number(process.env['TALK_WITHDRAWN_GRACE_MS']) > 0)
          ? Number(process.env['TALK_WITHDRAWN_GRACE_MS'])
          : 24 * 60 * 60 * 1000; // 24 hours default
      this.ledgerEmit(InteractionKind.TALK_WITHDRAWN, {
        talkId: data.talkId,
        gracePeriodMs,
      });
    });

    // Step 10: TALK_RETRACTED — hard retraction on delete or tag-uncheck.
    // Emits the audit-feed event, writes the local tombstone, floods the mesh frame,
    // and posts mailbox envelopes to all known responders (outcomes + exchanged).
    this.uiManager.on('retractTalk', (data: { talkId: string; retractedAt: number }) => {
      void this.handleRetractTalk(data.talkId, data.retractedAt);
    });

    this.uiManager.on(
      'demandFullTalk',
      async (data: {
        talkId: string;
        identityKeyFallback?: string;
        callback: (fullTalk: any) => void;
      }) => {
        try {
          let talk: Talk | null = null;
          const id = (data.talkId || '').trim();
          if (id) talk = await this.resolveMeshTalkData(id);
          if (!talk && data.identityKeyFallback) {
            talk = await this.loadFullTalkViaIncomingIdentity(data.identityKeyFallback);
          }
          data.callback(talk);
        } catch (error) {
          console.error('Failed to get full talk:', error);
          data.callback(null);
        }
      },
    );

    this.uiManager.on(
      'demandFullTalkByIdentity',
      async (data: { identityKey: string; callback: (fullTalk: any) => void }) => {
        if (!this.currentUser?.id) {
          data.callback(null);
          return;
        }
        try {
          const talk = await this.loadFullTalkViaIncomingIdentity(data.identityKey);
          data.callback(talk);
        } catch (error) {
          console.error('demandFullTalkByIdentity failed:', error);
          data.callback(null);
        }
      },
    );

    this.uiManager.on('loadTalkForEdit', async (data: { talkId: string }) => {
      try {
        const talk = await this.talkService.getTalk(data.talkId);
        if (talk) {
          this.uiManager.showTalkEditorDialog(talk);
        } else {
          this.uiManager.showNotification(this.uiManager.formatTalkNotFound(), 'error');
        }
      } catch (error) {
        console.error('Failed to load talk:', error);
        this.uiManager.showNotification(this.uiManager.formatTalkLoadFailed((error as Error).message), 'error');
      }
    });

    this.uiManager.on('needIncomingTalkClusters', () => {
      void this.refreshIncomingTalkClustersFromLocalGun();
    });

    this.uiManager.on('needTalkStats', async (data: { talkIds: string[] }) => {
      if (data.talkIds.length === 0) {
        this.uiManager.setTalkStats({});
        this.uiManager.displayTalksList();
        return;
      }
      const statsMap: Record<string, { responses: number; matches: number; ignores: number }> = {};
      const outcomes = Object.values(getTalkLedgerDoc().outcomes);
      for (const talkId of data.talkIds) {
        const rows = outcomes.filter(
          (entry) => entry.talkId === talkId && entry.authorId === this.currentUser?.id,
        );
        statsMap[talkId] = {
          responses: rows.length,
          matches: rows.filter((entry) => entry.outcome === 'matched').length,
          ignores: rows.filter((entry) => entry.outcome === 'ignored').length,
        };
      }
      this.uiManager.setTalkStats(statsMap);
      // Refresh status bar so match count is shown
      this.refreshStatusBar();
    });

    this.uiManager.on(
      'talkCompleted',
      async (data: { talkId: string; answers: any[]; talkData?: any; isChatbotResponse?: boolean }) => {
        const completion = (async () => {
          await this.handleTalkCompleted(data);
        })();
        (globalThis as any).__iinpublic_lastTalkCompletion = completion;
        try {
          await completion;
        } catch (error) {
          console.error('Failed to handle talk completion:', error);
        }
      },
    );

    this.uiManager.on(
      'answerQuestion',
      async (data: { conversationId: string; questionId: string; answerId: string }) => {
        try {
          const result = await this.talkService.processAnswer(
            data.conversationId,
            data.questionId,
            data.answerId,
            this.currentUser!.id,
          );

          this.uiManager.updateConversation(data.conversationId, result);

          if (result.isComplete) {
            this.uiManager.showTalkCompletion(data.conversationId, result.outcome);
          }
        } catch (error) {
          this.uiManager.showNotification(
            this.uiManager.formatAnswerProcessFailed((error as Error).message),
            'error',
          );
        }
      },
    );

    this.uiManager.on('sendMessage', async (data: { conversationId: string; message: string }) => {
      try {
        console.log('📤 Sending message:', data.message);

        // For now, broadcast message to the chatroom
        const chatroomId = this.chatroomService.getCurrentChatroomId();
        if (!chatroomId) {
          this.uiManager.showNotification(this.uiManager.formatNotInChatroom(), 'error');
          return;
        }

        // Create a simple message object
        const message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          text: data.message,
          senderId: this.currentUser!.id,
          senderName: this.currentUser!.stageName,
          timestamp: new Date().toISOString(),
        };

        // Store message in Gun.js
        const gun = this.gunService.getGun();
        gun.get('chatrooms').get(chatroomId).get('messages').get(message.id).put(message);

        console.log('✅ Message sent:', message);
        this.uiManager.showNotification(this.uiManager.formatMessageSent(), 'success');
      } catch (error) {
        console.error('Failed to send message:', error);
        this.uiManager.showNotification(
          this.uiManager.formatMessageSendFailed((error as Error).message),
          'error',
        );
      }
    });

    // Handle conversation message loading
    this.uiManager.on('loadConversation', async (data: { conversationId: string }) => {
      try {
        console.log('📖 Loading conversation:', data.conversationId);
        const conversation = this.uiManager.getMyConversations()[data.conversationId] as any;
        const otherUserId = conversation?.otherUserId ? String(conversation.otherUserId) : undefined;

        // Subscribe to messages for this conversation (pass myUserId for prevSeen DAG tracking)
        this.conversationService.subscribeToMessages(data.conversationId, (messages) => {
          console.log('📨 Received conversation messages:', messages);
          this.uiManager.displayConversationMessages(data.conversationId, messages);
          for (const message of messages) {
            const sharePayload = this.parseAttachmentShareMessageText(String(message.text || ''));
            if (!sharePayload) continue;
            if (!message.senderId || message.senderId === this.currentUser?.id) continue;
            void this.maybeFetchSharedAttachmentBytes(sharePayload, String(message.senderId)).catch((err) => {
              console.warn('[L5] conversation attachment fetch failed:', err);
            });
          }
          // When a message update arrives for a conversation the user isn't currently viewing,
          // record the latest message and mark the conversation unread so the badge appears.
          if (messages.length > 0) {
            const last = messages[messages.length - 1];
            this.uiManager.updateConversationMessage(
              data.conversationId,
              String(last.text ?? ''),
              String(last.timestamp ?? Date.now()),
            );
          }
        }, this.currentUser?.id, otherUserId);
      } catch (error) {
        console.error('Failed to load conversation:', error);
        this.uiManager.showNotification(
          this.uiManager.formatConversationLoadFailed((error as Error).message),
          'error',
        );
      }
    });

    // Handle sending conversation messages
    this.uiManager.on(
      'sendConversationMessage',
      async (data: { conversationId: string; message: string; talkId?: string }) => {
        try {
          console.log('📤 Sending conversation message:', data.message);
          const conversation = this.uiManager.getMyConversations()[data.conversationId];
          const otherUserId = conversation?.otherUserId
            ? String(conversation.otherUserId)
            : undefined;
          const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

          await this.conversationService.sendMessage(
            data.conversationId,
            this.currentUser!.id,
            data.message,
            {
              messageId,
              ...(otherUserId ? { otherUserId } : {}),
              // Per-talk thread scope (redesign §5) — omitted for the DM thread.
              ...(data.talkId ? { talkId: data.talkId } : {}),
            },
          );

          console.log('✅ Conversation message sent');
          if (conversation?.supportChannel === true || otherUserId === TECHSUPPORT_ROOT_USER_ID) {
            await this.sendTechSupportAutoReply(data.conversationId, messageId);
          }

          // Phase E: ledger hook — CONVERSATION_MSG
          this.ledgerEmit(InteractionKind.CONVERSATION_MSG, {
            conversationId: data.conversationId,
            messageId,
            seq: Date.now(),
          });
        } catch (error) {
          console.error('Failed to send conversation message:', error);
          this.uiManager.showNotification(
            this.uiManager.formatMessageSendFailed((error as Error).message),
            'error',
          );
        }
      },
    );

    // Direct message from peer detail overlay — find or create a conversation then send
    this.uiManager.on(
      'sendDirectMessage',
      async (data: { peerId: string; peerName: string; text: string; resolve: () => void; reject: (e: unknown) => void }) => {
        try {
          if (!this.currentUser) throw new Error('Not logged in');
          const conversationId = await this.findOrCreateDirectConversation(data.peerId, data.peerName);
          await this.conversationService.sendMessage(conversationId, this.currentUser.id, data.text, {
            otherUserId: data.peerId,
          });
          data.resolve();
        } catch (error) {
          console.error('Failed to send direct message:', error);
          this.uiManager.showNotification(this.uiManager.formatMessageSendFailed((error as Error).message), 'error');
          data.reject(error);
        }
      },
    );

    // Conversation-first user click (rule N2a): resolve the peer's default DM
    // conversation, creating it on first contact.
    this.uiManager.on(
      'openDirectConversation',
      async (data: { peerId: string; peerName: string; resolve: (id: string) => void; reject: (e: unknown) => void }) => {
        try {
          if (!this.currentUser) throw new Error('Not logged in');
          data.resolve(await this.findOrCreateDirectConversation(data.peerId, data.peerName));
        } catch (error) {
          console.warn('openDirectConversation failed:', error);
          data.reject(error);
        }
      },
    );

    this.uiManager.on('needConversationSync', async () => {
      if (!this.currentUser) return;
      try {
        const snapshot = await this.conversationService.getUserConversationsSnapshot(this.currentUser.id);
        await this.ingestConversationRecords(snapshot);
      } catch (error) {
        console.warn('Conversation sync snapshot failed:', error);
      }
    });

    this.uiManager.on('requestLocationUpdate', async () => {
      await this.updateLocationAndMaybeSwitch();
    });

    this.uiManager.on('toggleTravelMode', async () => {
      if (!this.currentUser) return;
      this.travelModeActive = !this.travelModeActive;
      if (this.travelModeActive) {
        // Enter travel mode: lock in current room as home (if not set).
        this.travelHomeChatroomId = this.currentChatroomId || this.chatroomService.getCurrentChatroomId() || undefined;
        this.uiManager.setTravelModeState({
          active: true,
          ...(this.travelHomeChatroomId ? { homeChatroomId: this.travelHomeChatroomId } : {}),
        });
        this.persistTravelModeStateToStorage();
        this.uiManager.showNotification(this.uiManager.formatTravelEnabled(), 'info');
      } else {
        // Exit travel mode: return to home room if known.
        const home = this.travelHomeChatroomId;
        this.travelChatroomId = undefined;
        this.persistTravelModeStateToStorage();
        this.uiManager.setTravelModeState({ active: false });
        if (home && this.currentChatroomId !== home) {
          await this.chatroomService.switchChatroom(this.currentUser.id, home, this.currentUser.stageName);
          this.currentChatroomId = home;
          localStorage.setItem('iinpublic_last_chatroom', home);
          this.subscribeToMessages(home);
          this.uiManager.setCurrentChatroomId(home);
        this.chatroomService.subscribeToMembers(home, (members) => {
          this.harvestRosterEpubs(members);
          this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
          const chatroomName = this.getChatroomDisplayName(home);
          this.uiManager.updateStatusBar(
            this.currentUser!.stageName,
            chatroomName,
            this.countOrdinaryRoomMembers(members),
            this.uiManager.getTotalMatches(),
          );
        });
        }
        this.uiManager.showNotification(this.uiManager.formatTravelReturnedHomeRoom(), 'success');
      }
    });

    this.uiManager.on('returnHomeFromTravel', async () => {
      if (!this.currentUser) return;
      const locationPath = this.currentLocation ? getLocationChatroomPath(this.currentLocation) : [];
      const home =
        (!this.travelModeActive && locationPath[locationPath.length - 1]) ||
        this.travelHomeChatroomId ||
        locationPath[locationPath.length - 1] ||
        'global';
      this.travelModeActive = false;
      this.travelChatroomId = undefined;
      this.travelHomeChatroomId = home;
      this.persistTravelModeStateToStorage();
      this.uiManager.setTravelModeState({ active: false });
      if (this.currentChatroomId !== home) {
        await this.chatroomService.switchChatroom(this.currentUser.id, home, this.currentUser.stageName);
        this.currentChatroomId = home;
        localStorage.setItem('iinpublic_last_chatroom', home);
        this.subscribeToMessages(home);
        this.uiManager.setCurrentChatroomId(home);
        this.chatroomService.subscribeToMembers(home, (members) => {
          this.harvestRosterEpubs(members);
          this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
          const chatroomName = this.getChatroomDisplayName(home);
          this.uiManager.updateStatusBar(
            this.currentUser!.stageName,
            chatroomName,
            this.countOrdinaryRoomMembers(members),
            this.uiManager.getTotalMatches(),
          );
        });
      }
      this.uiManager.showNotification(this.uiManager.formatTravelReturnedHome(), 'success');
    });

    this.uiManager.on('setHomeChatroom', async (data: { chatroomId: string }) => {
      if (!this.currentUser) return;
      const chatroomId = String(data.chatroomId || '').trim() || 'global';
      this.travelHomeChatroomId = chatroomId;
      if (this.travelChatroomId === chatroomId) {
        this.travelChatroomId = undefined;
      }
      this.persistTravelModeStateToStorage();
      this.uiManager.setTravelModeState({
        active: this.travelModeActive,
        homeChatroomId: this.travelHomeChatroomId,
      });
      this.uiManager.showNotification(this.uiManager.formatTravelHomeSet(this.getChatroomDisplayName(chatroomId)), 'success');
    });

    this.uiManager.on(
      'createCustomChatroom',
      async (payload: {
        type: 'business' | 'custom';
        name: string;
        description?: string;
        capacity?: number;
        businessInfo?: { headline?: string };
      }) => {
        if (!this.currentUser) return;
        const base = this.getBackendApiBase();
        try {
          const res = await fetch(`${base}/api/chatrooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: payload.name,
              type: payload.type,
              createdBy: this.currentUser.id,
              ...(payload.description != null ? { description: payload.description } : {}),
              ...(payload.capacity != null ? { capacity: payload.capacity } : {}),
              ...(payload.businessInfo != null ? { businessInfo: payload.businessInfo } : {}),
            }),
          });
          const text = await res.text();
          let created: {
            id?: string;
            name?: string;
            type?: string;
            description?: string;
            createdBy?: string;
            capacity?: number;
            createdAt?: string;
            businessInfo?: { headline?: string };
          } | null = null;
          if (text) {
            try {
              created = JSON.parse(text) as {
                id?: string;
                name?: string;
                type?: string;
                description?: string;
                createdBy?: string;
                capacity?: number;
                createdAt?: string;
                businessInfo?: { headline?: string };
              };
            } catch {
              created = null;
            }
          }
          if (!res.ok) {
            this.uiManager.showNotification(text || this.uiManager.formatChatroomCreateFailed(), 'error');
            return;
          }
          const createdId = String(created?.id || '').trim();
          if (createdId) {
            this.uiManager.upsertCustomChatroomFromServer({
              id: createdId,
              name: String(created?.name || payload.name),
              type: created?.type === 'business' ? 'business' : 'custom',
              description: String(created?.description || payload.description || ''),
              createdBy: String(created?.createdBy || this.currentUser.id),
              ...(created?.capacity != null || payload.capacity != null
                ? { capacity: created?.capacity ?? payload.capacity! }
                : {}),
              ...(created?.createdAt != null ? { createdAt: created.createdAt } : {}),
              ...(created?.businessInfo != null || payload.businessInfo != null
                ? { businessInfo: created?.businessInfo ?? payload.businessInfo! }
                : {}),
            });
            this.uiManager.showChatroomDetail(createdId);
          }
          void this.refreshCustomChatroomsFromServer().then(() => {
            this.subscribeToAllChatroomMemberCounts();
          });
          this.uiManager.showNotification(this.uiManager.formatChatroomCreated(created?.name || payload.name), 'success');
        } catch (e) {
          this.uiManager.showNotification(this.uiManager.formatChatroomCreateFailed((e as Error).message), 'error');
        }
      },
    );

    this.uiManager.on('renameCustomChatroom', async (data: { chatroomId: string }) => {
      if (!this.currentUser) return;
      const meta = this.uiManager.getCustomChatroomMeta(data.chatroomId);
      const next = await this.uiManager.showRenameCustomChatroomDialog(meta?.name || data.chatroomId);
      if (!next) return;
      const base = this.getBackendApiBase();
      try {
        const res = await fetch(`${base}/api/chatrooms/${encodeURIComponent(data.chatroomId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: this.currentUser.id, name: next }),
        });
        const text = await res.text();
        if (!res.ok) {
          this.uiManager.showNotification(text || this.uiManager.formatChatroomRenameFailed(), 'error');
          return;
        }
        await this.refreshCustomChatroomsFromServer();
        const chatroomName = this.getChatroomDisplayName(data.chatroomId);
        const headcount = this.uiManager.getChatroomMemberCount(data.chatroomId) || 1;
        this.uiManager.updateStatusBar(
          this.currentUser.stageName,
          chatroomName,
          headcount,
          this.uiManager.getTotalMatches(),
        );
        const titleEl = document.getElementById('current-chatroom-title');
        const headerEl = document.getElementById('header-title');
        if (titleEl) titleEl.textContent = chatroomName;
        if (headerEl && document.getElementById('chatroom-detail-container')?.style.display !== 'none') {
          headerEl.textContent = chatroomName;
        }
        this.uiManager.showNotification(this.uiManager.formatChatroomRenamed(), 'success');
      } catch (e) {
        this.uiManager.showNotification(this.uiManager.formatChatroomRenameFailed((e as Error).message), 'error');
      }
    });

    this.uiManager.on('deleteCustomChatroom', async (data: { chatroomId: string }) => {
      if (!this.currentUser) return;
      if (!confirm(this.uiManager.formatChatroomDeleteConfirm())) return;
      const base = this.getBackendApiBase();
      try {
        const res = await fetch(
          `${base}/api/chatrooms/${encodeURIComponent(data.chatroomId)}?userId=${encodeURIComponent(this.currentUser.id)}`,
          { method: 'DELETE' },
        );
        const text = await res.text();
        if (!res.ok) {
          this.uiManager.showNotification(text || this.uiManager.formatChatroomDeleteFailed(), 'error');
          return;
        }
        await this.refreshCustomChatroomsFromServer();
        if (this.currentChatroomId === data.chatroomId) {
          this.uiManager.showChatroomList();
        }
        this.subscribeToAllChatroomMemberCounts();
        this.uiManager.showNotification(this.uiManager.formatChatroomDeleted(), 'success');
      } catch (e) {
        this.uiManager.showNotification(this.uiManager.formatChatroomDeleteFailed((e as Error).message), 'error');
      }
    });

    this.uiManager.on('chatroomChanged', async (chatroomId: string) => {
      if (!this.currentUser) {
        return;
      }
      const previousChatroomId = this.currentChatroomId;
      this.uiManager.setCurrentChatroomId(chatroomId);

      // In travel mode, every room switch becomes “the” travel destination (single remote room at a time).
      if (this.travelModeActive) {
        if (!this.travelHomeChatroomId) {
          this.travelHomeChatroomId = this.currentChatroomId || this.chatroomService.getCurrentChatroomId() || undefined;
        }
        if (chatroomId !== this.travelHomeChatroomId) {
          this.travelChatroomId = chatroomId;
        }
        this.persistTravelModeStateToStorage();
        this.uiManager.setTravelModeState({
          active: true,
          ...(this.travelHomeChatroomId ? { homeChatroomId: this.travelHomeChatroomId } : {}),
        });
      } else {
        // Not travelling: treat switches as normal.
        this.travelChatroomId = undefined;
        this.persistTravelModeStateToStorage();
      }

      const isSameRoom = previousChatroomId === chatroomId;

      if (!isSameRoom) {
        if (this.currentChatroomId) {
          console.log(`🔄 User switching from chatroom ${this.currentChatroomId} to ${chatroomId}`);

          await this.chatroomService.switchChatroom(
            this.currentUser.id,
            chatroomId,
            this.currentUser.stageName,
          );
        } else {
          // App lost track of room (race / fresh UI) while user opened a room — align service with UI.
          const svcId = this.chatroomService.getCurrentChatroomId();
          if (svcId && svcId !== chatroomId) {
            await this.chatroomService.switchChatroom(
              this.currentUser.id,
              chatroomId,
              this.currentUser.stageName,
            );
          } else if (!svcId) {
            await this.chatroomService.joinChatroom(
              chatroomId,
              this.currentUser.id,
              this.currentUser.stageName,
            );
          }
        }

        this.currentChatroomId = chatroomId;
        localStorage.setItem('iinpublic_last_chatroom', chatroomId);

        this.subscribeToMessages(chatroomId);
            console.log(`✅ Switched to ${chatroomId}`);
        if (this.uiManager.getChatbotEnabled()) {
          setTimeout(() => this.uiManager.broadcastPendingTalksOnRoomEntry(), 350);
        }
      } else {
        // Same room: ensure app id matches (e.g. first time opening detail after join)
        this.currentChatroomId = chatroomId;
      }

      // subscribeToMembers reuses the Gun listener when chatroomId is unchanged (see WebChatroomService)
      this.chatroomService.subscribeToMembers(chatroomId, (members) => {
        this.harvestRosterEpubs(members);
        this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
        this.syncPeerMeshRoom(chatroomId, members);
        const chatroomName = this.getChatroomDisplayName(chatroomId);
        this.uiManager.updateStatusBar(
          this.currentUser!.stageName,
          chatroomName,
          this.countOrdinaryRoomMembers(members),
          this.uiManager.getTotalMatches(),
        );
      });
    });

    // Handle Gun.js real-time updates
    this.gunService.on('newMessage', (message: any) => {
      this.uiManager.displayNewMessage(message);
    });

    this.gunService.on('newTalk', (conversation: any) => {
      this.uiManager.displayIncomingTalk(conversation);
    });

    this.gunService.on('chatroomUpdate', (update: any) => {
      this.uiManager.updateChatroomInfo(update);
    });

    // Handle visibility changes (for offline/online status)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.userService.setUserStatus(this.currentUser!.id, 'away');
      } else {
        this.userService.setUserStatus(this.currentUser!.id, 'online');
      }
    });

    // Handle beforeunload to cleanup
    window.addEventListener('beforeunload', () => {
      if (this.mailboxPollTimer) clearInterval(this.mailboxPollTimer);
      this.mailboxPollTimer = undefined;
      this.peerMeshService?.leaveRoom();
      if (this.currentUser && this.currentChatroomId) {
        // Mark user as inactive in current chatroom (for member count)
        this.chatroomService.leaveChatroom(this.currentChatroomId, this.currentUser.id);
        // Set user status to offline
        this.userService.setUserStatus(this.currentUser.id, 'offline');
      }
    });
  }

  // Public methods for UI interaction
  public getCurrentUser(): User | undefined {
    return this.currentUser;
  }

  public getCurrentLocation(): GPSCoordinate | undefined {
    return this.currentLocation;
  }

  /**
   * Content layer bootstrap entry point. Helia/libp2p initializes on first use,
   * never on first paint.
   */
  public async ensureContentNodeInitialized(): Promise<WebContentNode> {
    return this.contentNodeService.ensureNode();
  }

  public async ensureContentLibp2pInitialized(): Promise<unknown> {
    return this.contentNodeService.ensureLibp2p();
  }

  public async refreshUserData(): Promise<void> {
    if (this.currentUser) {
      this.currentUser = await this.userService.getUser(this.currentUser.id);
      this.uiManager.updateUserInfo(this.currentUser);
    }
  }

  public async logout(): Promise<void> {
    if (this.currentUser) {
      await this.userService.setUserStatus(this.currentUser.id, 'offline');
      localStorage.removeItem('iinpublic_user_id');
      this.currentUser = undefined as any; // Type assertion for now

      // Reload the page to restart
      window.location.reload();
    }
  }

  // E2E Testing helpers - expose private state for manual cleanup in tests
  public getCurrentChatroomId(): string | undefined {
    return this.currentChatroomId;
  }

  public async updateLocationAndMaybeSwitch(nextLocation?: GPSCoordinate): Promise<void> {
    try {
      const newLocation = nextLocation || (await LocationPrivacy.getCurrentLocation());
      this.currentLocation = newLocation;

      if (this.currentUser) {
        await this.userService.updateUserLocation(this.currentUser.id, newLocation);

        if (this.travelModeActive) {
          this.uiManager.showNotification(this.uiManager.formatTravelLocationHeld(), 'info');
          return;
        }

        const newChatroomId = await this.chatroomService.findOptimalChatroom(newLocation);
        const currentChatroomId = this.chatroomService.getCurrentChatroomId();

        if (newChatroomId !== currentChatroomId) {
          await this.chatroomService.switchChatroom(this.currentUser.id, newChatroomId);
          this.currentChatroomId = newChatroomId;
          this.uiManager.setCurrentChatroomId(newChatroomId);
          this.uiManager.showNotification(this.uiManager.formatTravelMovedLocation(), 'info');
        }
      }
    } catch (error) {
      this.uiManager.showNotification(this.uiManager.formatLocationUpdateFailed((error as Error).message), 'error');
      throw error;
    }
  }

  /**
   * Re-announce a talk to the current room as the current user (for E2E: Bob "sends same talk" to trigger chatbot).
   */
  public async announceTalkToRoom(talkId: string, localTalkData?: any): Promise<void> {
    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (!chatroomId || !this.currentUser) return Promise.reject(new Error('No chatroom or user'));
    const talkData = localTalkData || await this.resolveMeshTalkData(talkId);
    if (!talkData) throw new Error(`Talk not found: ${talkId}`);
    const receivers = await this.resolveBroadcastReceivers(
      chatroomId,
      this.uiManager.getCurrentChatroomMembers(),
    );
    await this.deliverTalkToReceiversOverMesh(talkId, {
      ...talkData,
      id: talkId,
      authorId: this.currentUser.id,
      authorName: this.currentUser.stageName,
    } as Talk, receivers);
  }

  /**
   * E2E / advanced: open response dialog with flattened / saved auto-answers applied.
   * The normal IN-row "View" path uses skipAutoAnswer so opening the list does not instantly complete a match.
   */
  public async openTalkResponseDialogWithAuto(talkId: string): Promise<void> {
    const talk = await this.resolveMeshTalkData(talkId);
    if (!talk) {
      this.uiManager.showNotification(this.uiManager.formatTalkCouldNotLoad(), 'error');
      return;
    }
    this.uiManager.showTalkResponseDialog(talk, { skipAutoAnswer: false });
  }

  private applyChatroomMemberCount(chatroomId: string, count: number): void {
    if (isDevStageZero()) {
      const prev = this.stageZeroLastMemberCounts.get(chatroomId) ?? 0;
      this.stageZeroLastMemberCounts.set(chatroomId, count);
      const pastBootGrace = Date.now() - this.stageZeroBootedAt > 30_000;
      const maxGlobalMembers = getDevStageZeroMaxGlobalMembers();
      if (
        pastBootGrace
        && !this.stageZeroRepairInFlight
        && prev <= 1
        && count > maxGlobalMembers
        && (chatroomId === 'global' || count > 8)
      ) {
        void this.repairStageZeroGunGraph(`headcount:${chatroomId}:${prev}->${count}`);
        return;
      }
    }
    this.uiManager.setChatroomMemberCount(chatroomId, count);
  }

  private async repairStageZeroGunGraph(reason: string): Promise<void> {
    if (this.stageZeroRepairInFlight) return;
    this.stageZeroRepairInFlight = true;
    console.warn(`[stage-zero] repairing Gun graph (${reason}) — close other localhost tabs`);
    try {
      const gun = this.gunService.getGun();
      const bootGraceMs = 30_000;
      const clearServer = Date.now() - this.stageZeroBootedAt > bootGraceMs;
      await purgeDevStageZeroGraph(this.getBackendApiBase(), gun, { clearServer });
      if (clearServer) {
        await this.gunService.ensureKeypairAndAuth();
      }
      await this.reloadChatroomMemberCountsAfterStageClear();
      this.stageZeroLastMemberCounts.clear();
    } catch (err) {
      console.warn('[stage-zero] repair failed (non-fatal):', err);
    } finally {
      this.stageZeroRepairInFlight = false;
    }
  }

  private startStageZeroHeadcountWatchdog(): void {
    if (this.stageZeroWatchdogTimer) clearInterval(this.stageZeroWatchdogTimer);
    let ticks = 0;
    this.stageZeroWatchdogTimer = setInterval(() => {
      ticks += 1;
      const globalN = this.uiManager.getChatroomMemberCount('global');
      const maxGlobalMembers = getDevStageZeroMaxGlobalMembers();
      if (globalN > maxGlobalMembers) {
        void this.repairStageZeroGunGraph(`watchdog:global=${globalN}`);
      }
      if (ticks >= 12) {
        clearInterval(this.stageZeroWatchdogTimer);
        this.stageZeroWatchdogTimer = undefined;
      }
    }, 5000);
  }

  /**
   * After stage-zero wipes Gun, re-join the current room and refresh list headcounts
   * so Global and other rooms do not show stale members from a previous session.
   */
  public async reloadChatroomMemberCountsAfterStageClear(): Promise<void> {
    this.chatroomService.unsubscribeAllMemberCounts();
    this.subscribedMemberCountRoomIds.clear();

    const gun = this.gunService.getGun();
    gun.get('chatrooms').put({});

    for (const chatroomId of getAllChatroomIds()) {
      this.uiManager.setChatroomMemberCount(chatroomId, 0);
    }
    for (const chatroomId of this.uiManager.getCustomChatroomIds()) {
      if (chatroomId) {
        this.uiManager.setChatroomMemberCount(chatroomId, 0);
      }
    }

    if (this.currentUser && this.currentChatroomId) {
      await this.chatroomService.joinChatroom(
        this.currentChatroomId,
        this.currentUser.id,
        this.currentUser.stageName,
      );
    }

    this.subscribeToAllChatroomMemberCounts();
  }

  public async manualCleanup(): Promise<void> {
    // Manually trigger cleanup (for E2E tests where beforeunload may not fire)
    console.log('🧹 Manual cleanup called');
    if (this.incomingApiRefreshTimer) {
      clearTimeout(this.incomingApiRefreshTimer);
      this.incomingApiRefreshTimer = undefined;
    }
    if (this.mailboxPollTimer) {
      clearInterval(this.mailboxPollTimer);
      this.mailboxPollTimer = undefined;
    }
    this.peerMeshService?.leaveRoom();
    for (const unsubscribe of this.conversationPreviewUnsubscribers.values()) unsubscribe();
    this.conversationPreviewUnsubscribers.clear();
    if (this.currentUser && this.currentChatroomId) {
      console.log(`🧹 Cleanup: user=${this.currentUser.id}, chatroom=${this.currentChatroomId}`);
      this.chatroomService.unsubscribeAllMemberCounts();
      // Leave current chatroom
      await this.chatroomService.leaveChatroom(this.currentChatroomId, this.currentUser.id);
      await this.userService.setUserStatus(this.currentUser.id, 'offline');
      console.log('✅ Manual cleanup complete');
    } else {
      console.log('⚠️ Manual cleanup skipped - no user or chatroom');
    }
  }
}
