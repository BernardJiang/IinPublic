import { User, GPSCoordinate, Talk, type Tag, InteractionKind } from '../../shared/types';
import { KEY_CUSTODY_DEVICE_SECRET_STORAGE, KEY_CUSTODY_STORAGE, WebGunService } from '../services/web-gun-service';
import { WebUserService } from '../services/web-user-service';
import { WebChatroomService } from '../services/web-chatroom-service';
import { WebTalkService } from '../services/web-talk-service';
import { WebConversationService } from '../services/web-conversation-service';
import { WebLedgerService } from '../services/web-ledger-service';
import { UIManager, type BroadcastAudiencePreview } from '../ui/ui-manager';
import { LocationPrivacy } from '../../shared/location';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { getAllChatroomIds } from '../../shared/chatroom-hierarchy';
import { pickLatestTalkIdFromIncomingCluster } from '../../shared/incoming-talk-ids';
import { buildTalkIdentityKey, computeTalkIdFromTalkData } from '../../shared/cid';
import { isDevStageZero } from '../dev-stage-env';
import { purgeDevStageZeroGraph } from '../dev-stage-seeds';
import {
  isTechSupportUser,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';
import { resolveP2PRuntimeFlags, usesDirectTalkDelivery, type P2PRuntimeFlags } from '../../shared/p2p-runtime';
import { expandTalkDataFromGunWire, type PeerTalkOfferWire } from '../../shared/peer-talk-delivery';
import { intakeFilterRejectReasons } from '../../shared/talk-intake-filters';
import { getTalkIntakeFilters } from '../ui/talk-intake-filters';
import { P2PPresenceClient } from '../services/p2p-presence-client';
import { P2PLocalNodeBridgeClient } from '../services/p2p-local-node-bridge-client';
import {
  mirrorIncomingTalkClustersToLocalGun,
  mirrorTalkDefinitionToLocalGun,
} from '../services/client-incoming-talk-mirror';
import {
  applyPeerTalkOfferToLocalInbox,
  collectLocalIncomingTalkClusters,
  publishPeerTalkCatalog,
  publishPeerTalkOffer,
  reconcilePeerTalkOffersFromGun,
  resolveTalkFromPeerMesh,
  subscribeLocalIncomingTalkClusters,
  subscribePeerTalkOffers,
  upsertLocalIncomingTalkCluster,
} from '../services/client-peer-talk-delivery';
import { getSEA, type GunPair } from '../sea-gun';

export class IinPublicApp {
  private gunService: WebGunService;
  private userService: WebUserService;
  private chatroomService: WebChatroomService;
  private talkService: WebTalkService;
  private conversationService: WebConversationService;
  /** Interaction ledger (Phase E). Initialized lazily after SEA keypair is ready. */
  private ledgerService: WebLedgerService | null = null;
  private uiManager: UIManager;
  private currentUser?: User;
  private currentLocation?: GPSCoordinate;
  private currentChatroomId?: string;
  /** Gun .map().on may replay the same response node; avoid duplicate match UI/conversations. */
  private processedTalkResponseKeys = new Set<string>();
  private directPairResponseSubscriptionKeys = new Set<string>();
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
  private localNodeBridge: P2PLocalNodeBridgeClient | null = null;
  private peerTalkOfferUnsubscribe: (() => void) | null = null;
  private incomingTalkClusterUnsubscribe: (() => void) | null = null;
  private chatroomTalksMapOff: (() => void) | null = null;
  private readonly p2pRuntimeFlags: P2PRuntimeFlags = resolveP2PRuntimeFlags(
    typeof process !== 'undefined'
      ? {
          P2P_DIRECT_CHAT_ENABLED: process.env.P2P_DIRECT_CHAT_ENABLED,
          P2P_NODE_ENABLED: process.env.P2P_NODE_ENABLED,
          STAR_SERVER_PERSISTENCE: process.env.STAR_SERVER_PERSISTENCE,
          RELAY_ONLY_HUB: process.env.RELAY_ONLY_HUB,
          P2P_CLIENT_TALK_MIRROR: process.env.P2P_CLIENT_TALK_MIRROR,
          P0_DIRECT_TALK_DELIVERY: process.env.P0_DIRECT_TALK_DELIVERY,
        }
      : {},
  );

  /** Initialize the interaction ledger after the SEA keypair is available. */
  private initLedger(): void {
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
    if (!this.ledgerService) return;
    void this.ledgerService.appendEvent(kind, content as any).catch((err) => {
      console.warn('[Ledger] appendEvent failed (non-fatal):', kind, err);
    });
  }

  private buildChatroomTalkAnnouncementKey(logicalTalkId: string, authorId: string): string {
    return `${logicalTalkId}__${authorId}`;
  }

  private getChatroomTalkAnnouncementRoot(gun: any, chatroomId: string, legacy = false): any {
    const room = gun.get('chatrooms').get(chatroomId);
    if (usesDirectTalkDelivery(this.p2pRuntimeFlags) && !legacy) {
      return room.get('announcements');
    }
    return room.get('talks');
  }

  private publishChatroomTalkAnnouncement(
    gun: any,
    chatroomId: string,
    announcementKey: string,
    announcement: Record<string, unknown>,
  ): void {
    this.getChatroomTalkAnnouncementRoot(gun, chatroomId).get(announcementKey).put(announcement);
  }

  private currentUserEpub(): string | undefined {
    const epub = this.gunService.getStoredPair()?.epub;
    return epub ? String(epub) : undefined;
  }

  private countOrdinaryRoomMembers(members: Array<{ userId: string }>): number {
    return members.filter((member) => member.userId !== TECHSUPPORT_ROOT_USER_ID).length;
  }

  constructor() {
    this.gunService = new WebGunService();
    this.userService = new WebUserService(this.gunService);
    this.chatroomService = new WebChatroomService(this.gunService);
    this.talkService = new WebTalkService(this.gunService, this.getBackendApiBase(), {
      meshLocalFirst: usesDirectTalkDelivery(this.p2pRuntimeFlags),
    });
    this.conversationService = new WebConversationService(this.gunService);
    this.uiManager = new UIManager();
  }

  async initialize(location: GPSCoordinate): Promise<void> {
    this.currentLocation = location;

    // Initialize services (stage-zero server wipe happens in index.ts before init; do not purge
    // here — clearing the graph before SEA auth breaks gun.user().auth()).
    await this.gunService.initialize();
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
      const data = await this.gunService.get(`user-public-profile/${userId}`);
      if (!data || typeof data !== 'object') return null;
      return data as {
        headshot?: string | null;
        languagesJson?: string;
        profileJson?: string;
        interestsJson?: string;
      };
    });
    this.uiManager.setContactPreRenderSync(async () => {
      await this.syncDirectPairTalkExchangesForContacts();
    });
    // Get or create user
    await this.initializeUser();

    // Join appropriate chatroom
    await this.initializeChatrooms();

    // Setup event handlers
    this.setupEventHandlers();

    // Show main interface
    this.uiManager.showMainInterface(this.currentUser!);

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
      const firstNetworkUser = !(await this.userService.hasAnyUser());
      this.currentUser = await this.createNewUser({ rootTechSupport: firstNetworkUser });
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
        this.uiManager.updateChatroomMembers(members, this.currentUser!.id);

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
      this.subscribeToTalks(toChatroomId);

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
      console.log('👥 Chatroom members updated:', members);
      this.uiManager.updateChatroomMembers(members, this.currentUser!.id);

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
    this.subscribeToTalks(chatroomId);

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
      this.subscribeToTalks(this.currentChatroomId);
      this.uiManager.setCurrentChatroomId(this.currentChatroomId);
      this.chatroomService.subscribeToMembers(this.currentChatroomId, (members) => {
        this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
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

  private async shouldAcceptPeerTalkOfferAsync(offer: {
    senderId: string;
    talkData: Record<string, unknown>;
    deliveryChatroomId?: string;
    directPeerSend?: boolean;
  }): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || offer.senderId === me.id) return false;
    if (await this.resolveBlockStatusEitherWay(offer.senderId)) return false;
    const talkData = expandTalkDataFromGunWire(offer.talkData);
    const expiresAtValue = talkData?.expiresAt;
    const expiresAt =
      typeof expiresAtValue === 'number'
        ? expiresAtValue
        : typeof expiresAtValue === 'string'
          ? new Date(expiresAtValue).getTime()
          : Number.NaN;
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) return false;
    if (talkData?.isAdult && !(await this.resolveAgeVerifiedForIntake())) return false;
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
        ...(authorLoc ? { authorLocation: authorLoc } : {}),
        questions: Array.isArray(td.questions) ? td.questions : [],
        ...(typeof td.questionsJson === 'string' ? { questionsJson: td.questionsJson } : {}),
        isAdult: !!td.isAdult,
      },
      filters,
      this.currentLocation,
    );
    return reasons.length === 0;
  }

  /** Directed peer send (Send My Talks) — mesh offer in P0, POST /received in star mode. */
  public async sendDirectTalkToPeer(
    talkId: string,
    talkData: Talk | Record<string, unknown>,
    peerId: string,
    peerName: string,
  ): Promise<void> {
    const me = this.currentUser;
    if (!me?.id) throw new Error('Not signed in');
    const talk = talkData as Talk;
    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
      mirrorTalkDefinitionToLocalGun(this.gunService, talkId, talk, this.p2pRuntimeFlags);
      const talkRecord = talk as unknown as Record<string, unknown>;
      publishPeerTalkCatalog(this.gunService, {
        talkId,
        authorId: me.id,
        talkData: talkRecord,
      });
      await publishPeerTalkOffer(this.gunService, peerId, {
        talkId,
        senderId: me.id,
        senderName: me.stageName || 'Unknown',
        talkData: talkRecord,
        directPeerSend: true,
      });
      this.subscribeToPairTalkResponses(talkId, talk, peerId);
      return;
    }
    const base = this.getBackendApiBase();
    const res = await fetch(`${base}/api/talks/${encodeURIComponent(talkId)}/received`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiverId: peerId,
        receiverName: peerName,
        senderId: me.id,
        senderName: me.stageName,
        talkData: talk,
        chatbotEnabled: this.uiManager.getChatbotEnabled(),
      }),
    });
    if (!res.ok) throw new Error(`register talk for peer failed: HTTP ${res.status}`);
    const result = (await res.json()) as { registered?: boolean };
    if (result.registered !== true) {
      throw new Error('register talk for peer rejected by recipient delivery policy');
    }
  }

  /** P0: subscribe to directed talk offers on local Gun (mesh via hub relay). */
  private initDirectTalkDeliverySubscriptions(): void {
    if (!usesDirectTalkDelivery(this.p2pRuntimeFlags) || !this.currentUser?.id) return;
    this.peerTalkOfferUnsubscribe?.();
    this.peerTalkOfferUnsubscribe = subscribePeerTalkOffers(
      this.gunService,
      this.currentUser.id,
      (offer) => {
        void this.handlePeerTalkOffer(offer);
      },
    );
    void this.refreshIncomingTalkClustersFromLocalGun();
  }

  private async handlePeerTalkOffer(offer: PeerTalkOfferWire): Promise<void> {
    const talkData =
      offer.talkData ??
      (await resolveTalkFromPeerMesh(
        this.gunService,
        offer.talkRef?.talkId || offer.talkId,
        offer.talkRef?.authorId || offer.senderId,
        (id) => this.talkService.getTalk(id),
        { attempts: 8, gapMs: 250 },
      ));
    if (!talkData) return;
    const talkRecord = {
      ...(talkData as unknown as Record<string, unknown>),
      authorId: offer.senderId,
      authorName: offer.senderName,
      ...(offer.senderEpub ? { authorEpub: offer.senderEpub } : {}),
    };
    const acceptParams: {
      senderId: string;
      talkData: Record<string, unknown>;
      deliveryChatroomId?: string;
      directPeerSend?: boolean;
    } = {
      senderId: offer.senderId,
      talkData: talkRecord,
    };
    if (offer.deliveryChatroomId) acceptParams.deliveryChatroomId = offer.deliveryChatroomId;
    if (offer.directPeerSend) acceptParams.directPeerSend = offer.directPeerSend;
    if (!(await this.shouldAcceptPeerTalkOfferAsync(acceptParams))) return;
    const hydratedOffer: PeerTalkOfferWire & { talkData: Record<string, unknown> } = {
      ...offer,
      talkData: talkRecord,
    };
    const cluster = applyPeerTalkOfferToLocalInbox(
      this.gunService,
      this.currentUser!.id,
      hydratedOffer,
      this.p2pRuntimeFlags,
    );
    this.mergeIncomingClusterIntoUi([cluster]);
  }

  /** P2P-I / P2P-O: register live presence and probe local node bridge (stack only). */
  private async initP2PPresenceAndBridge(): Promise<void> {
    if (!this.currentUser?.id || isTechSupportUser(this.currentUser)) return;
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair.priv) return;
    const base = this.getBackendApiBase();
    try {
      this.presenceClient = new P2PPresenceClient({ apiBase: base, heartbeatMs: 30_000 });
      this.presenceClient.startHeartbeat({
        userId: this.currentUser.id,
        pub: String(pair.pub),
        ...(pair.epub ? { epub: String(pair.epub) } : {}),
      });
      const peers = await this.presenceClient.fetchNearby(this.currentUser.id, 20);
      for (const peer of peers) {
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
    await this.conversationService.sendMessage(conversationId, TECHSUPPORT_ROOT_USER_ID, welcome, {
      otherUserId: userId,
    });
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

  /** Load full talk for an incoming announcement (P0: mesh/catalog only). */
  private loadIncomingTalkData(talkId: string, authorId: string): Promise<Talk | null> {
    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
      return resolveTalkFromPeerMesh(
        this.gunService,
        talkId,
        authorId,
        (id) => this.talkService.getTalk(id),
      );
    }
    return this.talkService.getTalkWithRetry(talkId);
  }

  /** E2E: expose direct-talk flag and local IN snapshot. */
  public isDirectTalkDeliveryEnabled(): boolean {
    return usesDirectTalkDelivery(this.p2pRuntimeFlags);
  }

  public async getLocalIncomingClustersForE2e(): Promise<any[]> {
    if (!this.currentUser?.id) return [];
    return collectLocalIncomingTalkClusters(this.gunService, this.currentUser.id, this.p2pRuntimeFlags, { waitMs: 300 });
  }

  private subscribeToTalks(chatroomId: string): void {
    console.log('🎯 Subscribing to chatroom talks:', chatroomId);
    if (this.chatroomTalksMapOff) {
      try {
        this.chatroomTalksMapOff();
      } catch {
        /* ignore */
      }
      this.chatroomTalksMapOff = null;
    }
    const gun = this.gunService.getGun();

    const announcementRoots = usesDirectTalkDelivery(this.p2pRuntimeFlags)
      ? [
          this.getChatroomTalkAnnouncementRoot(gun, chatroomId),
          this.getChatroomTalkAnnouncementRoot(gun, chatroomId, true),
        ]
      : [this.getChatroomTalkAnnouncementRoot(gun, chatroomId, true)];

    /** Dedupe by (talkId, authorId); same content-hash id from two senders must both register. */
    const seenTalkAuthor = new Set<string>();

    const processTalkAnnouncement = (talkAnnouncement: any, talkId: string) => {
      if (talkId.startsWith('_')) return; // Skip Gun.js metadata
      // Ignore announcements from chatrooms we are not currently in (stale .on handlers or FR-BM-7).
      if (this.currentChatroomId && this.currentChatroomId !== chatroomId) return;

      console.log('📨 Received talk announcement:', { talkId, talkAnnouncement });

      const authorId = String(talkAnnouncement?.authorId || '');
      const logicalTalkId = String(talkAnnouncement?.talkId || talkId);
      const pairKey = `${logicalTalkId}::${authorId}`;

      /**
       * Gun may fire .once and .on in any order, and replay nodes after replication. We must not mark
       * (talkId, author) as "seen" until full talk JSON loads — otherwise a first failed getTalkWithRetry
       * blocks forever. Replays must re-run POST /received (idempotent) so incomingTalksByUser fills
       * even when the first attempt ran before server/browser graph caught up.
       */
      if (seenTalkAuthor.has(pairKey)) {
        if (talkAnnouncement?.talkId && authorId && authorId !== this.currentUser?.id) {
          void this.loadIncomingTalkData(talkAnnouncement.talkId, authorId).then((talkData) => {
            if (!talkData) return;
            mirrorTalkDefinitionToLocalGun(
              this.gunService,
              talkAnnouncement.talkId,
              talkData,
              this.p2pRuntimeFlags,
            );
            const talkWithAuthor = {
              ...talkData,
              authorName: talkAnnouncement.authorName || (talkData as any)?.authorName || 'Unknown',
              ...(talkAnnouncement.authorEpub ? { authorEpub: talkAnnouncement.authorEpub } : {}),
            };
            this.registerSelfAsReceiverOfIncomingTalk(
              talkAnnouncement.talkId,
              authorId,
              talkAnnouncement.authorName || 'Unknown',
              talkWithAuthor,
            );
            this.maybeAutoChatbotReplyToAnnouncer(
              logicalTalkId,
              talkWithAuthor,
              authorId,
              talkAnnouncement.authorName || 'Unknown',
            );
          });
        }
        return;
      }

      if (talkAnnouncement && talkAnnouncement.talkId) {
        // Wait for full JSON (questions/answers) — Gun .once often fires before replication completes.
        void this.loadIncomingTalkData(talkAnnouncement.talkId, authorId).then((talkData) => {
          if (!talkData) {
            console.warn('Could not load full talk after retry:', talkAnnouncement.talkId);
            return;
          }
          mirrorTalkDefinitionToLocalGun(
            this.gunService,
            talkAnnouncement.talkId,
            talkData,
            this.p2pRuntimeFlags,
          );
          console.log('📋 Full talk data:', talkData);
          const talkWithAuthor = {
            ...talkData,
            authorName: talkAnnouncement.authorName || (talkData as any)?.authorName || 'Unknown',
            ...(talkAnnouncement.authorEpub ? { authorEpub: talkAnnouncement.authorEpub } : {}),
          };

          const firstUi = !seenTalkAuthor.has(pairKey);
          if (firstUi) {
            seenTalkAuthor.add(pairKey);
            this.uiManager.displayIncomingTalk({
              id: talkData.id,
              title: talkData.title,
              authorName: talkAnnouncement.authorName || 'Unknown',
              type: talkData.type,
              questionCount: talkData.questions?.length || 0,
              timestamp: talkAnnouncement.timestamp,
              isOwnTalk: talkAnnouncement.authorId === this.currentUser?.id,
              fullTalk: talkWithAuthor,
            });
            if (talkAnnouncement.authorId === this.currentUser?.id) {
              this.subscribeToTalkResponses(talkAnnouncement.talkId, talkWithAuthor);
            }
          }

          if (talkAnnouncement.authorId !== this.currentUser?.id) {
            this.registerSelfAsReceiverOfIncomingTalk(
              talkAnnouncement.talkId,
              talkAnnouncement.authorId,
              talkAnnouncement.authorName || 'Unknown',
              talkWithAuthor,
            );
            if (firstUi) {
              this.maybeAutoChatbotReplyToAnnouncer(
                logicalTalkId,
                talkWithAuthor,
                authorId,
                talkAnnouncement.authorName || 'Unknown',
              );
            }
          }
        });
      }
    };

    const mapRefs = announcementRoots.map((root) => root.map());
    for (const mapRef of mapRefs) {
      mapRef.on(processTalkAnnouncement);
    }
    console.log('🔄 Loading existing talks with .once()...');
    for (const mapRef of mapRefs) {
      mapRef.once(processTalkAnnouncement);
    }
    this.chatroomTalksMapOff = () => {
      for (const mapRef of mapRefs) {
        try {
          mapRef.off();
        } catch {
          /* ignore */
        }
      }
    };
  }

  private subscribeToTalkResponses(talkId: string, talkData: any): void {
    console.log('👂 Subscribing to responses for talk:', talkId);
    const gun = this.gunService.getGun();

    gun
      .get(`talks/${talkId}`)
      .get('responses')
      .map()
      .on((responseData: any, responseId: string) => {
        if (responseId.startsWith('_')) return; // Skip Gun.js metadata

        const dedupeKey = `${talkId}::${responseId}`;
        if (this.processedTalkResponseKeys.has(dedupeKey)) return;

        console.log('📬 Received talk response:', responseData);

        // Gun can emit partial objects before replication completes; wait for a complete payload.
        if (!(responseData && responseData.responderId && responseData.answers)) {
          return;
        }

        // Don't notify for own responses
        if (responseData.responderId === this.currentUser?.id) {
          this.processedTalkResponseKeys.add(dedupeKey);
          return;
        }

        // Chatbot responses include authorId: only that author should get the match/conversation
        if (responseData.authorId && responseData.authorId !== this.currentUser?.id) {
          this.processedTalkResponseKeys.add(dedupeKey);
          return;
        }

        try {
          const answers = Array.isArray(responseData.answers)
            ? responseData.answers
            : JSON.parse(String(responseData.answers));
          this.processedTalkResponseKeys.add(dedupeKey);

          // Check if this is a match
          const isMatch = this.checkIfMatch(talkData, answers);
          this.recordLocalTalkExchange(responseData.responderId, responseData.responderName, talkId, talkData, isMatch ? 'match' : 'mismatch');

          if (isMatch) {
            this.uiManager.showNotification(
              this.uiManager.formatTalkMatched(responseData.responderName, talkData.title),
              'success',
            );
            console.log(`✅ Match detected with ${responseData.responderName}`);

            // Create conversation between the two users
            this.conversationService
              .createConversation({
                userId1: this.currentUser!.id,
                userName1: this.currentUser!.stageName,
                userId2: responseData.responderId,
                userName2: responseData.responderName,
                talkId: talkId,
                respondedByBotForUser1: !!responseData.isChatbotResponse,
                respondedByBotForUser2: false,
              })
              .then((conversationId) => {
                // Add conversation to UI
                this.uiManager.addNewConversation({
                  conversationId,
                  otherUserId: responseData.responderId,
                  otherUserName: responseData.responderName,
                  talkId: talkId,
                  respondedByBot: !!responseData.isChatbotResponse,
                  transportMode: this.conversationService.getTransportMode(),
                });
                this.uiManager.setMemberMatched(responseData.responderId);
              })
              .catch((error) => {
                console.error('Failed to create conversation:', error);
              });
          }
        } catch (error) {
          // Leave unprocessed so a later complete payload can still be handled.
          console.error('Error processing talk response:', error);
        }
      });
  }

  private recordLocalTalkExchange(
    peerId: string,
    peerName: string,
    talkId: string,
    talkData: any,
    outcome: 'match' | 'mismatch' | 'ignore',
  ): void {
    if (!this.currentUser?.id || !peerId || peerId === this.currentUser.id || !talkId) return;
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
        outcome,
        direction: 'sent',
        date: new Date().toISOString(),
      };
      localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
    } catch {
      // Local exchange summaries only support UI fallbacks; ignore storage failures.
    }
  }

  private async syncDirectPairTalkExchangesForContacts(): Promise<void> {
    if (!usesDirectTalkDelivery(this.p2pRuntimeFlags) || !this.currentUser?.id) return;
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

  private async getPairTalkResponseSecret(peerUserId: string, peerEpubHint?: string): Promise<string> {
    const pair = this.gunService.getStoredPair();
    if (!pair) {
      throw new Error('No SEA keypair is available for pair-private talk response');
    }
    if (peerEpubHint) {
      return getSEA().secret(peerEpubHint, pair as GunPair);
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const peer = await Promise.race([
          this.gunService.getPublicUser(peerUserId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 900)),
        ]);
        const epub = typeof peer?.epub === 'string' ? peer.epub.trim() : '';
        if (epub) {
          return getSEA().secret(epub, pair as GunPair);
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + attempt * 100));
    }
    const suffix = lastError instanceof Error ? ` (${lastError.message})` : '';
    throw new Error(`Peer ${peerUserId} has no public encryption key${suffix}`);
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
      const secret = await this.getPairTalkResponseSecret(peerId);
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

  private subscribeToPairTalkResponses(talkId: string, talkData: any, peerId: string): void {
    if (!this.currentUser?.id || !peerId || peerId === this.currentUser.id) return;
    const pairId = this.pairIdForUsers(this.currentUser.id, peerId);
    const subscriptionKey = `${pairId}::${talkId}`;
    if (this.directPairResponseSubscriptionKeys.has(subscriptionKey)) return;
    this.directPairResponseSubscriptionKeys.add(subscriptionKey);

    const gun = this.gunService.getGun();
    gun
      .get('pairTalkResponses')
      .get(pairId)
      .get(talkId)
      .map()
      .on((responseData: any, responseId: string) => {
        if (!responseData || !responseId || responseId.startsWith('_')) return;
        const dedupeKey = `pair::${pairId}::${talkId}::${responseId}`;
        if (this.processedTalkResponseKeys.has(dedupeKey)) return;
        if (responseData.responderId === this.currentUser?.id) {
          this.processedTalkResponseKeys.add(dedupeKey);
          return;
        }
        if (responseData.authorId && responseData.authorId !== this.currentUser?.id) {
          this.processedTalkResponseKeys.add(dedupeKey);
          return;
        }

        void (async () => {
          const decrypted = await this.decryptPairTalkResponsePayload(responseData);
          const answers = decrypted.answers;
          this.processedTalkResponseKeys.add(dedupeKey);
          const isMatch = this.checkIfMatch(talkData, answers);
          this.recordLocalTalkExchange(
            responseData.responderId,
            decrypted.responderName,
            talkId,
            talkData,
            isMatch ? 'match' : 'mismatch',
          );
          if (!isMatch) return;

          this.uiManager.showNotification(
            this.uiManager.formatTalkMatched(decrypted.responderName, talkData.title),
            'success',
          );
          this.conversationService
            .createConversation({
              userId1: this.currentUser!.id,
              userName1: this.currentUser!.stageName,
              userId2: responseData.responderId,
              userName2: decrypted.responderName,
              talkId,
              respondedByBotForUser1: !!decrypted.isChatbotResponse,
              respondedByBotForUser2: false,
            })
            .then((conversationId) => {
              this.uiManager.addNewConversation({
                conversationId,
                otherUserId: responseData.responderId,
                otherUserName: decrypted.responderName,
                talkId,
                respondedByBot: !!decrypted.isChatbotResponse,
                transportMode: this.conversationService.getTransportMode(),
              });
              this.uiManager.setMemberMatched(responseData.responderId);
            })
            .catch((error) => {
              console.error('Failed to create pair-direct conversation:', error);
            });
        })().catch((error) => {
          console.error('Error processing pair-direct talk response:', error);
        });
      });
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

    const gun = this.gunService.getGun();
    const responseId = `response-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
      void this.submitTalkResponsePairDirect({
        talkId,
        talkData,
        answers: template.answers,
        isChatbotResponse: true,
        authorId,
        authorName,
        isAutoResponse: true,
      });
      return;
    }

    const responsePayload = {
      responderId: this.currentUser.id,
      responderName: this.currentUser.stageName,
      answers: JSON.stringify(template.answers),
      respondedAt: new Date().toISOString(),
      isChatbotResponse: true,
      authorId, // so only this author creates a conversation when they receive the response
      authorName,
    };

    gun.get(`talks/${talkId}`).get('responses').get(responseId).put(responsePayload);
    console.log('🤖 Chatbot response stored', { talkId, responseId, authorId, authorName });

    const isMatch = this.checkIfMatch(talkData, template.answers);
    if (isMatch) {
      console.log('🤖 Chatbot reply produced a match', { talkId, authorId, authorName });
      this.conversationService
        .createConversation({
          userId1: this.currentUser.id,
          userName1: this.currentUser.stageName,
          userId2: authorId,
          userName2: authorName,
          talkId,
          respondedByBotForUser1: false,
          respondedByBotForUser2: true,
        })
        .then((conversationId) => {
          this.uiManager.addNewConversation({
            conversationId,
            otherUserId: authorId,
            otherUserName: authorName,
            talkId,
            respondedByBot: false, // responder (Jerry) sees author (Bob), not bot
            transportMode: this.conversationService.getTransportMode(),
          });
        })
        .catch((err) => console.error('Chatbot conversation create failed:', err));
    }
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
   * Sender-driven: upsert `incomingTalksByUser` on the API for each room member so receivers see IN rows
   * even when Gun does not replicate the chatroom announcement to their peer in time (common in e2e).
   * Client POST /received remains supported and is idempotent with this path.
   */
  private async registerReceiversOnServerForTalk(
    talkId: string,
    talk: Talk,
    members: Array<{ userId: string; stageName: string }>,
    broadcastTargetTags?: string[],
    broadcastMaxDistanceMiles?: number,
    eligibleReceiverIds?: string[],
  ): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || members.length === 0) return false;
    let receiverIds = members
      .map((m) => m.userId)
      .filter((id) => id !== me.id && id !== TECHSUPPORT_ROOT_USER_ID);
    if (eligibleReceiverIds !== undefined) {
      const allowed = new Set(eligibleReceiverIds);
      receiverIds = receiverIds.filter((id) => allowed.has(id));
    }
    if (receiverIds.length === 0) return false;

    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
      mirrorTalkDefinitionToLocalGun(this.gunService, talkId, talk, this.p2pRuntimeFlags);
      const talkRecord = talk as unknown as Record<string, unknown>;
      publishPeerTalkCatalog(this.gunService, {
        talkId,
        authorId: me.id,
        talkData: talkRecord,
      });
      const deliveryRoom = this.currentChatroomId || this.chatroomService.getCurrentChatroomId() || '';
      for (const receiverId of receiverIds) {
        await publishPeerTalkOffer(this.gunService, receiverId, {
          talkId,
          senderId: me.id,
          senderName: me.stageName || 'Unknown',
          talkData: talkRecord,
          ...(deliveryRoom ? { deliveryChatroomId: deliveryRoom } : {}),
        });
        this.subscribeToPairTalkResponses(talkId, talk, receiverId);
      }
      console.log(`📡 Pair-direct talk offers published: talkId=${talkId} receivers=${receiverIds.length}`);
      return true;
    }

    return this.postRegisterReceiversForBroadcast(
      talkId,
      talk,
      receiverIds,
      broadcastTargetTags,
      broadcastMaxDistanceMiles,
    );
  }

  /** Legacy server-side IN metadata for star-mode peer APIs. Direct mode skips this path. */
  private async postRegisterReceiversForBroadcast(
    talkId: string,
    talk: Talk,
    receiverIds: string[],
    broadcastTargetTags?: string[],
    broadcastMaxDistanceMiles?: number,
  ): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || receiverIds.length === 0) return false;
    const base = this.getBackendApiBase();
    console.log(`📡 POSTing register-receivers: talkId=${talkId} receivers=${receiverIds.length}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300_000);
      let res: Response;
      try {
        res = await fetch(
          `${base}/api/talks/${encodeURIComponent(talkId)}/register-receivers-for-broadcast`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              senderId: me.id,
              senderName: me.stageName,
              receiverIds,
              talkData: talk,
              ...(broadcastTargetTags && broadcastTargetTags.length > 0
                ? { broadcastTargetTags }
                : {}),
              ...(typeof broadcastMaxDistanceMiles === 'number' &&
              Number.isFinite(broadcastMaxDistanceMiles) &&
              broadcastMaxDistanceMiles > 0
                ? { broadcastMaxDistanceMiles }
                : {}),
            }),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) {
        const t = await res.text();
        console.warn('register-receivers-for-broadcast failed:', res.status, t);
        return false;
      }
      const r = await res.json();
      const registered = Number(r?.registered ?? 0);
      console.log(`register-receivers-for-broadcast ok: talkId=${talkId} registered=${registered}`);
      return registered > 0;
    } catch (e) {
      console.warn('register-receivers-for-broadcast request failed:', e);
      return false;
    }
  }

  private async previewReceiversOnServerForTalk(
    talkId: string,
    talk: Talk,
    members: Array<{ userId: string; stageName: string }>,
    broadcastTargetTags?: string[],
    broadcastMaxDistanceMiles?: number,
    supportExcludedCount = 0,
  ): Promise<BroadcastAudiencePreview> {
    const me = this.currentUser;
    const stageNameById = new Map(members.map((member) => [member.userId, member.stageName || member.userId]));
    const receiverIds = members
      .map((member) => member.userId)
      .filter((id) => !!id && id !== me?.id && id !== TECHSUPPORT_ROOT_USER_ID);
    const fallback = {
      talkId,
      title: String(talk.title || 'Untitled Talk'),
      totalCandidates: receiverIds.length,
      eligibleReceivers: receiverIds.length,
      eligibleReceiverIds: receiverIds,
      rejectedByCounts: {},
      eligibleReceiverNames: receiverIds.map((receiverId) => stageNameById.get(receiverId) || receiverId),
      rejectedReceiverDetails: [],
      supportExcludedCount,
      previewUnavailable: receiverIds.length > 0,
    };
    if (!me?.id || receiverIds.length === 0) return fallback;

    const talkPayload: Talk = {
      ...talk,
      id: String(talk.id || talkId),
      authorId: me.id,
      ...(this.currentLocation &&
      (!talk.authorLocation ||
        typeof talk.authorLocation.latitude !== 'number' ||
        typeof talk.authorLocation.longitude !== 'number')
        ? {
            authorLocation: {
              latitude: this.currentLocation.latitude,
              longitude: this.currentLocation.longitude,
            },
          }
        : {}),
    };
    const previewBody = {
      senderId: me.id,
      receiverIds,
      talkData: JSON.parse(JSON.stringify(talkPayload)) as Talk,
      ...(broadcastTargetTags && broadcastTargetTags.length > 0 ? { broadcastTargetTags } : {}),
      ...(typeof broadcastMaxDistanceMiles === 'number' && Number.isFinite(broadcastMaxDistanceMiles) && broadcastMaxDistanceMiles > 0
        ? { broadcastMaxDistanceMiles }
        : {}),
    };

    const parsePreviewResponse = (preview: Partial<BroadcastAudiencePreview>): BroadcastAudiencePreview => {
      const eligibleReceiverIds = Array.isArray((preview as any).eligibleReceiverIds)
        ? (preview as any).eligibleReceiverIds.map(String)
        : receiverIds;
      const rejectedReceivers = Array.isArray((preview as any).rejectedReceivers)
        ? (preview as any).rejectedReceivers as Array<{ receiverId?: string; rejectedBy?: string[] }>
        : [];
      return {
        talkId,
        title: String(talk.title || 'Untitled Talk'),
        totalCandidates: Number(preview.totalCandidates ?? receiverIds.length),
        eligibleReceivers: Number(preview.eligibleReceivers ?? receiverIds.length),
        eligibleReceiverIds,
        rejectedByCounts: preview.rejectedByCounts && typeof preview.rejectedByCounts === 'object'
          ? preview.rejectedByCounts
          : {},
        eligibleReceiverNames: eligibleReceiverIds.map((receiverId: string) => stageNameById.get(receiverId) || receiverId),
        rejectedReceiverDetails: rejectedReceivers.map((receiver) => ({
          name: stageNameById.get(String(receiver.receiverId || '')) || String(receiver.receiverId || ''),
          rejectedBy: Array.isArray(receiver.rejectedBy) ? receiver.rejectedBy.map(String) : [],
        })),
        supportExcludedCount,
        previewUnavailable: false,
      };
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.getBackendApiBase()}/api/talks/broadcast-receiver-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(previewBody),
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.warn(
            `broadcast-receiver-preview HTTP ${response.status} (attempt ${attempt + 1}/2): ${errText.slice(0, 200)}`,
          );
          continue;
        }
        return parsePreviewResponse(await response.json() as Partial<BroadcastAudiencePreview>);
      } catch (error) {
        console.warn(`broadcast-receiver-preview failed (attempt ${attempt + 1}/2):`, error);
      }
      if (attempt < 1) await new Promise((r) => setTimeout(r, 500));
    }
    return fallback;
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

  /** Merges Gun members with UI list ids for bulk-send audience preview (same chatroom only). */
  /**
   * Wait until GET /api/talks/:id returns full talk JSON from the server graph so POST /received
   * and receivers’ incoming list can resolve the same id before we announce in the chatroom.
   */
  private async waitUntilTalkReadableOnServer(talkId: string): Promise<boolean> {
    const base = this.getBackendApiBase();
    const maxAttempts = 60;
    const gapMs = 250;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`${base}/api/talks/${encodeURIComponent(talkId)}`);
        if (res.status === 202) {
          /* pending — server graph not replicated yet; no 404 console spam */
        } else if (res.ok) {
          const data = await res.json();
          if (data && typeof data === 'object' && (data as { pending?: boolean }).pending === true) {
            /* same */
          } else {
            const qs = data?.questions;
            if (Array.isArray(qs) && qs.length > 0) return true;
          }
        }
      } catch {
        /* network — retry */
      }
      await new Promise((r) => setTimeout(r, gapMs));
    }
    return false;
  }

  /**
   * Current user saw a talk announcement in their subscribed chatroom — register with the backend
   * so `incomingTalksByUser` is populated (IN list). Receiver-driven so it still works when the
   * sender's on-screen member list is wrong (e.g. eviction / room mismatch).
   */
  private registerSelfAsReceiverOfIncomingTalk(
    talkId: string,
    senderId: string,
    senderName: string,
    talkData: any,
  ): void {
    if (!this.currentUser || !senderId || senderId === this.currentUser.id) return;
    if (isTechSupportUser(this.currentUser)) return;

    void this.ingestIncomingTalkAnnouncement(talkId, senderId, senderName, talkData);
  }

  private async ingestIncomingTalkAnnouncement(
    talkId: string,
    senderId: string,
    senderName: string,
    talkData: any,
  ): Promise<void> {
    if (!this.currentUser) return;
    if (
      !(await this.shouldAcceptPeerTalkOfferAsync({
        senderId,
        talkData: talkData as Record<string, unknown>,
      }))
    ) {
      return;
    }

    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
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
      return;
    }

    const base = this.getBackendApiBase();
    void fetch(`${base}/api/talks/${encodeURIComponent(talkId)}/received`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiverId: this.currentUser.id,
        receiverName: this.currentUser.stageName,
        senderId,
        senderName,
        talkData,
        chatbotEnabled: this.uiManager.getChatbotEnabled(),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error('Incoming talk registration failed:', res.status, text);
          return;
        }
        await this.refreshIncomingTalkClustersFromApiUntilVisible(talkData, talkId);
      })
      .catch((e) => console.error('Incoming talk registration request failed:', e));
  }

  /**
   * Full talk-completion flow. Four sequential steps:
   *
   * 1. Sync QA preferences — persist the user's chosen answers to their profile (Gun, SEA-signed).
   *
   * 2. Save the client-side chatbot template — stored eagerly in localStorage so the chatbot UI
   *    can use it for a rapid re-announce before the server round-trip completes. This is a UI
   *    cache only; it does NOT drive the server auto-reply logic.
   *
   * 3. Submit the response to the server — the server is the authority for:
   *      a. Writing the Gun answer template (`talkAnswerTemplateByUser`) that drives auto-reply
   *         when a new incoming talk is received via POST /api/talks/:id/received.
   *      b. Recording stats (`talkResponsesMap`).
   *      c. Creating match conversations (`createOrGetConversation`).
   *    If the server is unreachable, the raw answers are written to Gun as a data-preservation
   *    fallback, but no conversation is created (server is authoritative for match side-effects).
   *
   * 4. Update the UI — add any conversations the server returned to the local conversation list.
   */
  private async handleTalkCompleted(data: {
    talkId: string;
    answers: any[];
    talkData?: any;
    isChatbotResponse?: boolean;
  }): Promise<void> {
    console.log('📝 User completed talk:', data);
    const isChatbot = !!data.isChatbotResponse;

    // Step 1 — sync QA preferences
    if (data.talkData) {
      const pair = this.gunService.getStoredPair();
      if (pair) {
        await this.userService.syncQuestionAnswersFromTalkCompletion(
          data.talkData,
          data.answers,
          this.uiManager.getAnswerPreferencesSnapshot(),
          pair,
        );
      }
    }

    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (!chatroomId) return;

    // Step 2 — save client-side chatbot template (localStorage, UI cache only)
    // Saved before the server round-trip so a rapid re-announce can use it immediately.
    // The server saves its own copy to Gun inside submitTalkResponse(); that copy drives
    // the server-side auto-reply in POST /api/talks/:id/received.
    const locallyLooksLikeMatch = !!data.talkData && this.checkIfMatch(data.talkData, data.answers);
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

    // Step 3 — submit to server; server saves Gun template, stats, and conversations
    const localAuthorName =
      data.talkData?.authorName && data.talkData.authorName !== 'Unknown'
        ? data.talkData.authorName
        : undefined;

    if (usesDirectTalkDelivery(this.p2pRuntimeFlags) && data.talkData?.authorId && data.talkData.authorId !== this.currentUser?.id) {
      await this.submitTalkResponsePairDirect({
        talkId: data.talkId,
        talkData: data.talkData,
        answers: data.answers,
        isChatbotResponse: isChatbot,
        authorId: String(data.talkData.authorId),
        authorName: localAuthorName || String(data.talkData.authorName || 'Unknown'),
        isAutoResponse: !data.answers.some((a: any) => a?.mode === 'manual'),
      });
      return;
    }

    let submittedViaServer = false;
    let serverIsMatch = false;
    let serverMatches: Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }> = [];

    if (data.talkData) {
      try {
        // isAuto: true when none of the answers were manually chosen (chatbot or all-auto mode).
        const isAutoResponse = !data.answers.some((a: any) => a?.mode === 'manual');
        const serverResult = await this.talkService.submitTalkResponse({
          talkId: data.talkId,
          responderId: this.currentUser!.id,
          responderName: this.currentUser!.stageName,
          answers: data.answers,
          talkData: data.talkData,
          isAuto: isAutoResponse,
          isChatbotResponse: isChatbot,
        });
        submittedViaServer = true;
        serverIsMatch = !!serverResult.isMatch;
        serverMatches = Array.isArray(serverResult.matches) ? serverResult.matches : [];
        // Back-fill from the legacy single-match fields when the matches array is empty.
        if (serverMatches.length === 0 && serverResult.otherUserId && serverResult.conversationId) {
          serverMatches = [{
            senderId: serverResult.otherUserId,
            senderName: serverResult.otherUserName || localAuthorName || 'Unknown',
            conversationId: serverResult.conversationId,
            talkId: data.talkId,
          }];
        }
        console.log('✅ Talk response stored via server');

        // Phase E: ledger hooks — TALK_ANSWERED + MATCH_CREATED (fire-and-forget)
        const outcome = serverResult.isMatch ? 'match' : (serverResult as any).isIgnore ? 'ignore' : 'mismatch';
        this.ledgerEmit(InteractionKind.TALK_ANSWERED, {
          talkId: data.talkId,
          responseId: (serverResult as any).responseId || `resp_${Date.now()}`,
          outcome,
        });
        if (serverResult.isMatch) {
          for (const match of serverMatches) {
            this.ledgerEmit(InteractionKind.MATCH_CREATED, {
              talkId: data.talkId,
              conversationId: match.conversationId,
              otherUserId: match.senderId,
            });
          }
        }
      } catch (error) {
        console.warn('Talk response server submit failed, falling back to direct Gun write:', error);
      }
    }

    if (!submittedViaServer) {
      // Data-preservation fallback: record the raw answers in Gun so they aren't lost.
      // No conversation is created here — server is authoritative for match side-effects.
      const gun = this.gunService.getGun();
      const responseId = `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      gun.get(`talks/${data.talkId}`).get('responses').get(responseId).put({
        responderId: this.currentUser!.id,
        responderName: this.currentUser!.stageName,
        answers: JSON.stringify(data.answers),
        submittedAt: new Date().toISOString(),
        isChatbotResponse: isChatbot,
      });
      if (locallyLooksLikeMatch) {
        console.warn('Talk response was not submitted via server — skipping conversation creation until server is reachable.');
      }
    }

    // Step 4 — update UI with conversations the server created
    if (submittedViaServer && serverIsMatch) {
      for (const match of serverMatches) {
        const displayName =
          match.senderName && match.senderName !== 'Unknown' && match.senderName !== 'Someone'
            ? match.senderName
            : localAuthorName || 'Unknown';
        this.uiManager.addNewConversation({
          conversationId: match.conversationId,
          otherUserId: match.senderId,
          otherUserName: displayName,
          talkId: match.talkId || data.talkId,
          respondedByBot: isChatbot,
          transportMode: this.conversationService.getTransportMode(),
        });
      }
    }
  }

  private async recordDirectTalkStats(params: {
    talkId: string;
    talkData: any;
    responderId: string;
    answers: any[];
    outcome: 'match' | 'ignore' | 'other';
    isAuto: boolean;
  }): Promise<void> {
    try {
      const res = await fetch(`${this.getBackendApiBase()}/api/stats/talks/${encodeURIComponent(params.talkId)}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responderId: params.responderId,
          talkType: params.talkData?.type || 'flow',
          answers: params.answers.map((a: any) => ({
            questionId: String(a.questionId || ''),
            answerId: String(a.answerId || ''),
            answerText: String(a.answerText ?? ''),
          })),
          outcome: params.outcome,
          isAuto: params.isAuto,
        }),
      });
      if (!res.ok) {
        console.warn(`Pair-direct stats record failed: HTTP ${res.status}`);
      }
    } catch (error) {
      console.warn('Pair-direct stats record failed:', error);
    }
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
    const pairId = this.pairIdForUsers(this.currentUser.id, params.authorId);
    const responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const authorEpub = this.pairTalkPeerEpubHint(params.talkData?.authorEpub, params.talkData?.senderEpub);
    const payloadCiphertext = await this.encryptPairTalkResponsePayload(params.authorId, {
      responderName: this.currentUser.stageName,
      authorName: params.authorName,
      answers: params.answers,
      isChatbotResponse: params.isChatbotResponse,
      transportMode: 'pair-direct',
    }, authorEpub);
    const responsePayload = {
      version: 2,
      responseId,
      talkId: params.talkId,
      pairId,
      responderId: this.currentUser.id,
      authorId: params.authorId,
      submittedAt: new Date().toISOString(),
      encryption: 'sea-ecdh-v1',
      payloadCiphertext,
      transportMode: 'pair-direct',
    };

    this.gunService
      .getGun()
      .get('pairTalkResponses')
      .get(pairId)
      .get(params.talkId)
      .get(responseId)
      .put(responsePayload);

    await this.recordDirectTalkStats({
      talkId: params.talkId,
      talkData: params.talkData,
      responderId: this.currentUser.id,
      answers: params.answers,
      outcome: isMatch ? 'match' : isIgnore ? 'ignore' : 'other',
      isAuto: params.isAutoResponse,
    });

    this.ledgerEmit(InteractionKind.TALK_ANSWERED, {
      talkId: params.talkId,
      responseId,
      outcome: isMatch ? 'match' : isIgnore ? 'ignore' : 'mismatch',
    });

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

  /** Resolve full talk using the direct local IN index or the legacy server inbox. */
  private async loadFullTalkViaIncomingIdentity(identityKey: string): Promise<Talk | null> {
    if (!this.currentUser?.id) return null;
    try {
      let clusters: unknown[];
      if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
        clusters = await collectLocalIncomingTalkClusters(this.gunService, this.currentUser.id, this.p2pRuntimeFlags, {
          waitMs: 400,
        });
      } else {
        const base = this.getBackendApiBase();
        const res = await fetch(
          `${base}/api/users/${encodeURIComponent(this.currentUser.id)}/incoming-talks`,
          { cache: 'no-store' },
        );
        if (!res.ok) return null;
        clusters = await res.json();
      }
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
          if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
            void this.refreshIncomingTalkClustersFromLocalGun();
          } else {
            void this.refreshIncomingTalkClustersFromApi();
          }
        }, 120);
      },
    );
  }

  /**
   * Merge IN clusters from the HTTP API (server Gun graph). Notifications can show before the browser
   * peer replicates `incomingTalksByUser`; opening the Talks tab emits `needIncomingTalkClusters` to
   * pull this list without waiting on Gun.
   */
  private async refreshIncomingTalkClustersFromApi(): Promise<void> {
    if (!this.currentUser?.id) return;
    const base = this.getBackendApiBase();
    try {
      const res = await fetch(
        `${base}/api/users/${encodeURIComponent(this.currentUser.id)}/incoming-talks`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const clusters = await res.json();
      if (!Array.isArray(clusters)) return;
      this.applyIncomingClustersFromApiArray(clusters);
    } catch (e) {
      console.warn('refreshIncomingTalkClustersFromApi failed:', e);
    }
  }

  /**
   * E2E: deliver pending OUT talks using the same register + Gun path as Broadcast, without the audience modal.
   */
  public async deliverPendingBroadcastTalksForE2e(
    minReceivers = 1,
  ): Promise<{ talksSent: number; receivers: number }> {
    if (!this.currentUser) throw new Error('App not ready for E2E broadcast delivery');
    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (!chatroomId) throw new Error('No current chatroom for E2E broadcast delivery');
    const members = this.uiManager.getCurrentChatroomMembers();
    let broadcastableIds = this.uiManager.getBroadcastableTalkIds();
    if (broadcastableIds.length === 0) {
      broadcastableIds = this.uiManager.getPendingBroadcastTalkIds();
    }
    const receivers = await this.resolveBroadcastReceivers(chatroomId, members);
    if (receivers.length < minReceivers && !(minReceivers === 0 && receivers.length === 0)) {
      throw new Error(`receiverIds=${receivers.length} room=${chatroomId}`);
    }
    const targetCount = receivers.length;
    if (!Array.isArray(broadcastableIds) || broadcastableIds.length === 0) {
      this.uiManager.setBroadcastBulkAck(0, targetCount);
      return { talksSent: 0, receivers: targetCount };
    }
    const gun = this.gunService.getGun();
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
      talkPayloads.push({ tid, talk: talk as Talk });
    }
    if (talkPayloads.length === 0) {
      throw new Error('no talk payloads for E2E broadcast delivery');
    }
    if (receivers.length === 0) {
      const broadcastableNowForGun = new Set(
        this.uiManager.getBroadcastableTalkIds().filter((id) => broadcastableIds.includes(id)),
      );
      for (const { tid, talk } of talkPayloads) {
        if (!broadcastableNowForGun.has(tid)) continue;
        const authorEpub = this.currentUserEpub();
        const announcementKey = this.buildChatroomTalkAnnouncementKey(
          tid,
          String(talk.authorId || this.currentUser.id),
        );
        this.publishChatroomTalkAnnouncement(gun, chatroomId, announcementKey, {
          talkId: tid,
          title: talk.title,
          authorId: talk.authorId,
          authorName: this.currentUser.stageName,
          ...(authorEpub ? { authorEpub } : {}),
          type: talk.type,
          timestamp: new Date().toISOString(),
          questionCount: talk.questions?.length ?? 0,
        });
      }
      const attempted = talkPayloads.filter(({ tid }) => broadcastableNowForGun.has(tid)).length;
      this.uiManager.setBroadcastBulkAck(attempted, 0);
      this.uiManager.recordBroadcastConversation(
        chatroomId,
        talkPayloads.filter(({ tid }) => broadcastableNowForGun.has(tid)).map(({ tid }) => tid),
        [],
      );
      return { talksSent: attempted, receivers: 0 };
    }
    const supportExcludedCount = members.filter((m) => m.userId === TECHSUPPORT_ROOT_USER_ID).length;
    const previews = await Promise.all(
      talkPayloads.map(({ tid, talk }) =>
        this.previewReceiversOnServerForTalk(tid, talk, receivers, undefined, undefined, supportExcludedCount),
      ),
    );
    const previewByTalkId = new Map(previews.map((p) => [p.talkId, p]));
    const REGISTER_BATCH = 5;
    const registeredTalkIds: string[] = [];
    const directDelivery = usesDirectTalkDelivery(this.p2pRuntimeFlags);
    for (let i = 0; i < talkPayloads.length; i += REGISTER_BATCH) {
      const batch = talkPayloads.slice(i, i + REGISTER_BATCH);
      const batchResults = await Promise.all(
        batch.map(async ({ tid, talk }) => {
          const preview = previewByTalkId.get(tid);
          const eligibleIds =
            directDelivery || preview?.previewUnavailable || !Array.isArray(preview?.eligibleReceiverIds)
              ? undefined
              : preview.eligibleReceiverIds;
          const ok = await this.registerReceiversOnServerForTalk(
            tid,
            talk,
            receivers,
            undefined,
            undefined,
            eligibleIds,
          );
          if (ok) registeredTalkIds.push(tid);
          return ok;
        }),
      );
      sent += batchResults.filter(Boolean).length;
    }
    const broadcastableNowForGun = new Set(registeredTalkIds);
    for (const { tid, talk } of talkPayloads) {
      if (!broadcastableNowForGun.has(tid)) continue;
      const authorEpub = this.currentUserEpub();
      const announcementKey = this.buildChatroomTalkAnnouncementKey(
        tid,
        String(talk.authorId || this.currentUser.id),
      );
      this.publishChatroomTalkAnnouncement(gun, chatroomId, announcementKey, {
        talkId: tid,
        title: talk.title,
        authorId: talk.authorId,
        authorName: this.currentUser.stageName,
        ...(authorEpub ? { authorEpub } : {}),
        type: talk.type,
        timestamp: new Date().toISOString(),
        questionCount: talk.questions?.length ?? 0,
      });
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
    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
      await this.refreshIncomingTalkClustersFromLocalGun();
      return;
    }
    await this.refreshIncomingTalkClustersFromApi();
  }

  private async refreshIncomingTalkClustersFromLocalGun(): Promise<void> {
    if (!this.currentUser?.id) return;
    await reconcilePeerTalkOffersFromGun(
      this.gunService,
      this.currentUser.id,
      this.p2pRuntimeFlags,
      (offer) => this.shouldAcceptPeerTalkOfferAsync(offer),
      { waitMs: 500 },
    );
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
      for (const cluster of list) {
        const talkId = pickLatestTalkIdFromIncomingCluster(cluster);
        const talkBody = (cluster as { latestTalk?: unknown }).latestTalk ?? cluster;
        if (talkId) {
          mirrorTalkDefinitionToLocalGun(this.gunService, talkId, talkBody, this.p2pRuntimeFlags);
        }
      }
    }
    this.uiManager.setIncomingTalkClusters(list);
    this.uiManager.displayTalksList();
  }

  /** @deprecated name kept for call sites — applies cluster list from API or local Gun. */
  private applyIncomingClustersFromApiArray(clusters: any[]): void {
    this.applyIncomingTalkClusters(clusters);
  }

  /**
   * After delivery, poll until this talk appears (or timeout). Aligns IN list
   * with notification when Gun replication lags.
   */
  private async refreshIncomingTalkClustersFromApiUntilVisible(talkData: any, talkId: string): Promise<void> {
    if (!this.currentUser?.id || !talkData) return;
    const identityKey = buildTalkIdentityKey(talkData);
    const maxAttempts = 30;
    const gapMs = 400;

    const clusterIncludesTalk = (clusters: any[]): boolean =>
      clusters.some((c: any) => {
        if (!c?.identityKey) return false;
        if (c.identityKey === identityKey) return true;
        if (c.identityAliases && typeof c.identityAliases === 'object' && c.identityAliases[identityKey]) {
          return true;
        }
        if (c.talkIds && typeof c.talkIds === 'object' && c.talkIds[talkId]) return true;
        return false;
      });

    for (let i = 0; i < maxAttempts; i++) {
      if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
        const clusters = await collectLocalIncomingTalkClusters(this.gunService, this.currentUser.id, this.p2pRuntimeFlags, {
          waitMs: 200,
        });
        if (clusterIncludesTalk(clusters)) {
          this.mergeIncomingClusterIntoUi(clusters);
          return;
        }
      } else {
        try {
          const base = this.getBackendApiBase();
          const res = await fetch(
            `${base}/api/users/${encodeURIComponent(this.currentUser.id)}/incoming-talks`,
            { cache: 'no-store' },
          );
          if (res.ok) {
            const clusters = await res.json();
            if (Array.isArray(clusters)) {
              this.applyIncomingClustersFromApiArray(clusters);
              if (clusterIncludesTalk(clusters)) return;
            }
          }
        } catch {
          /* retry */
        }
      }
      await new Promise((r) => setTimeout(r, gapMs));
    }
    if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
      await this.refreshIncomingTalkClustersFromLocalGun();
    } else {
      await this.refreshIncomingTalkClustersFromApi();
    }
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

      if (!otherUserId) continue;

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

    this.uiManager.on('conversationAdded', () => {
      this.refreshStatusBar();
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
          // Refresh the UI to show the new name
          this.uiManager.showMainInterface(this.currentUser);

          // Update the stage name in the current chatroom so others can see it
          if (this.currentChatroomId) {
            const gun = this.gunService.getGun();
            gun.get('chatrooms').get(this.currentChatroomId).get('users').get(userId).put({
              stageName: newStageName,
            });

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

        // Register receivers via API using local talk payload; Gun chatroom announce when server echoes talk.
        const wantSendToChatroom = (talkData as { sendToChatroom?: boolean }).sendToChatroom !== false;
        const chatroomId = this.chatroomService.getCurrentChatroomId();
        if (chatroomId && wantSendToChatroom) {
          const synced = await this.waitUntilTalkReadableOnServer(talk.id);
          this.subscribeToTalkResponses(talk.id, talk);
          const receivers = await this.resolveBroadcastReceivers(
            chatroomId,
            this.uiManager.getCurrentChatroomMembers(),
          );
          await this.registerReceiversOnServerForTalk(talk.id, talk, receivers);
          if (!synced) {
            this.uiManager.showNotification(this.uiManager.formatTalkCreateSyncSlow(), 'info');
            return;
          }

          const gun = this.gunService.getGun();
          const announcementKey = this.buildChatroomTalkAnnouncementKey(talk.id, talk.authorId);
          const authorEpub = this.currentUserEpub();
          this.publishChatroomTalkAnnouncement(gun, chatroomId, announcementKey, {
            talkId: talk.id,
            title: talk.title,
            authorId: talk.authorId,
            authorName: this.currentUser!.stageName,
            ...(authorEpub ? { authorEpub } : {}),
            type: talk.type,
            timestamp: new Date().toISOString(),
            questionCount: talk.questions.length,
          });

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

          const supportExcludedCount = (data.members ?? [])
            .filter((member) => member.userId === TECHSUPPORT_ROOT_USER_ID).length;

          const broadcastTargetTags = data.broadcastTargetTags;
          const broadcastMaxDistanceMiles =
            typeof data.broadcastMaxDistanceMiles === 'number' &&
            Number.isFinite(data.broadcastMaxDistanceMiles) &&
            data.broadcastMaxDistanceMiles > 0
              ? data.broadcastMaxDistanceMiles
              : undefined;
          const targetCount = receivers.length;
          console.log(`📢 broadcastTalk: ${targetCount} receivers resolved`);
          if (targetCount === 0) {
            console.warn(
              '⚠️ broadcastTalk: no receivers resolved (no other active members in this chatroom id per Gun). IN list will not populate for others.',
            );
          }
          const gun = this.gunService.getGun();
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
            talkPayloads.push({ tid, talk: talk as Talk });
          }
          const previews = await Promise.all(
            talkPayloads.map(({ tid, talk }) =>
              this.previewReceiversOnServerForTalk(
                tid,
                talk,
                receivers,
                broadcastTargetTags,
                broadcastMaxDistanceMiles,
                supportExcludedCount,
              ),
            ),
          );
          const previewTalkIds = new Set(talkPayloads.map(({ tid }) => tid));
          const senderOmittedPreviews = this.uiManager
            .getSenderOmittedBroadcastPreviews()
            .filter((preview) => !previewTalkIds.has(preview.talkId));
          const audiencePreviews = [...previews, ...senderOmittedPreviews];
          if (!(await this.uiManager.confirmBroadcastAudience(audiencePreviews))) {
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
                  usesDirectTalkDelivery(this.p2pRuntimeFlags) &&
                  !preview?.previewUnavailable &&
                  Array.isArray(preview?.eligibleReceiverIds)
                    ? preview.eligibleReceiverIds
                    : undefined;
                const ok = await this.registerReceiversOnServerForTalk(
                  tid,
                  talk,
                  receivers,
                  broadcastTargetTags,
                  broadcastMaxDistanceMiles,
                  eligibleIds,
                );
                if (ok) registeredTalkIds.push(tid);
                return ok;
              }),
            );
            sent += batchResults.filter(Boolean).length;
          }
          const broadcastableNowForGun = new Set(registeredTalkIds);
          for (const { tid, talk } of talkPayloads) {
            if (!broadcastableNowForGun.has(tid)) continue;
            const announcementKey = this.buildChatroomTalkAnnouncementKey(
              tid,
              String(talk.authorId || this.currentUser!.id),
            );
            this.publishChatroomTalkAnnouncement(gun, chatroomId, announcementKey, {
              talkId: tid,
              title: talk.title,
              authorId: talk.authorId,
              authorName: this.currentUser!.stageName,
              type: talk.type,
              timestamp: new Date().toISOString(),
              questionCount: talk.questions?.length ?? 0,
            });
          }
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
        await this.talkService.updateTalk(data.id, {
          title: data.title,
          type: data.type as 'flow' | 'survey',
          questions: data.questions,
          language: data.language || 'en',
          tags: data.tags || [],
        });
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
          if (id) talk = await this.talkService.getTalkWithRetry(id);
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
      if (usesDirectTalkDelivery(this.p2pRuntimeFlags)) {
        void this.refreshIncomingTalkClustersFromLocalGun();
      } else {
        void this.refreshIncomingTalkClustersFromApi();
      }
    });

    this.uiManager.on('needTalkStats', async (data: { talkIds: string[] }) => {
      if (data.talkIds.length === 0) {
        this.uiManager.setTalkStats({});
        this.uiManager.displayTalksList();
        return;
      }
      const statsMap: Record<string, { responses: number; matches: number; ignores: number }> = {};
      let localTalks: Record<string, any> = {};
      try {
        localTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      } catch {
        localTalks = {};
      }
      await Promise.all(
        data.talkIds.map(async (talkId) => {
          try {
            const statsTalkId = String(localTalks?.[talkId]?.fullTalk?.id || talkId);
            const summary = await this.talkService.queryStats(statsTalkId, 'summary');
            if (summary && typeof summary.total === 'number') {
              statsMap[talkId] = {
                responses: summary.total,
                matches: typeof summary.matches === 'number' ? summary.matches : 0,
                ignores: typeof summary.ignores === 'number' ? summary.ignores : 0,
              };
              return;
            }
          } catch {
            // Fall back to local talk structure inference only when the stats endpoint is unavailable.
          }

          statsMap[talkId] = { responses: 0, matches: 0, ignores: 0 };
        }),
      );
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

        // Subscribe to messages for this conversation (pass myUserId for prevSeen DAG tracking)
        this.conversationService.subscribeToMessages(data.conversationId, (messages) => {
          console.log('📨 Received conversation messages:', messages);
          this.uiManager.displayConversationMessages(data.conversationId, messages);
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
        }, this.currentUser?.id);
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
      async (data: { conversationId: string; message: string }) => {
        try {
          console.log('📤 Sending conversation message:', data.message);

          await this.conversationService.sendMessage(
            data.conversationId,
            this.currentUser!.id,
            data.message,
          );

          console.log('✅ Conversation message sent');

          // Phase E: ledger hook — CONVERSATION_MSG
          this.ledgerEmit(InteractionKind.CONVERSATION_MSG, {
            conversationId: data.conversationId,
            messageId: `msg_${Date.now()}`,
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
          const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
          const existing = Object.values(conversations).find(
            (conv: any) => conv.otherUserId === data.peerId,
          ) as any;
          let conversationId: string;
          if (existing?.conversationId) {
            conversationId = existing.conversationId;
          } else {
            conversationId = await this.conversationService.createConversation({
              userId1: this.currentUser.id,
              userName1: this.currentUser.stageName,
              userId2: data.peerId,
              userName2: data.peerName,
              talkId: 'direct',
            });
            await this.ingestConversationRecords([{
              conversationId,
              otherUserId: data.peerId,
              otherUserName: data.peerName,
              talkId: 'direct',
              createdAt: new Date().toISOString(),
            }]);
          }
          await this.conversationService.sendMessage(conversationId, this.currentUser.id, data.text);
          data.resolve();
        } catch (error) {
          console.error('Failed to send direct message:', error);
          this.uiManager.showNotification(this.uiManager.formatMessageSendFailed((error as Error).message), 'error');
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
          this.subscribeToTalks(home);
          this.uiManager.setCurrentChatroomId(home);
        this.chatroomService.subscribeToMembers(home, (members) => {
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
        this.subscribeToTalks(home);
        this.uiManager.setCurrentChatroomId(home);
        this.chatroomService.subscribeToMembers(home, (members) => {
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

      const isSameRoom = this.currentChatroomId === chatroomId;

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
        this.subscribeToTalks(chatroomId);
        console.log(`✅ Switched to ${chatroomId}`);
      } else {
        // Same room: ensure app id matches (e.g. first time opening detail after join)
        this.currentChatroomId = chatroomId;
      }

      // subscribeToMembers reuses the Gun listener when chatroomId is unchanged (see WebChatroomService)
      this.chatroomService.subscribeToMembers(chatroomId, (members) => {
        this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
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
   * Fetches talk from Gun and puts to chatroom with current user as author.
   */
  public announceTalkToRoom(talkId: string): Promise<void> {
    const chatroomId = this.chatroomService.getCurrentChatroomId();
    if (!chatroomId || !this.currentUser) return Promise.reject(new Error('No chatroom or user'));

    const gun = this.gunService.getGun();
    return new Promise((resolve, reject) => {
      gun.get(`talks/${talkId}`).once((wrapper: any) => {
        if (!wrapper || !wrapper.data) {
          reject(new Error(`Talk not found: ${talkId}`));
          return;
        }
        try {
          const talkData = JSON.parse(wrapper.data);
          const announcementKey = this.buildChatroomTalkAnnouncementKey(talkId, this.currentUser!.id);
          this.publishChatroomTalkAnnouncement(gun, chatroomId, announcementKey, {
            talkId,
            title: talkData.title,
            authorId: this.currentUser!.id,
            authorName: this.currentUser!.stageName,
            type: talkData.type,
            timestamp: new Date().toISOString(),
            questionCount: talkData.questions?.length ?? 0,
          });
          // So we receive responses (e.g. chatbot reply) for this talk
          this.subscribeToTalkResponses(talkId, talkData);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * E2E / advanced: open response dialog with flattened / saved auto-answers applied.
   * The normal IN-row "View" path uses skipAutoAnswer so opening the list does not instantly complete a match.
   */
  public async openTalkResponseDialogWithAuto(talkId: string): Promise<void> {
    const talk = await this.talkService.getTalkWithRetry(talkId);
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
      if (
        pastBootGrace
        && !this.stageZeroRepairInFlight
        && prev <= 1
        && count > 3
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
      if (globalN > 3) {
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
