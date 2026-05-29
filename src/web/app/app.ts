import { User, GPSCoordinate, Talk, type Tag } from '../../shared/types';
import { KEY_CUSTODY_DEVICE_SECRET_STORAGE, KEY_CUSTODY_STORAGE, WebGunService } from '../services/web-gun-service';
import { WebUserService } from '../services/web-user-service';
import { WebChatroomService } from '../services/web-chatroom-service';
import { WebTalkService } from '../services/web-talk-service';
import { WebConversationService } from '../services/web-conversation-service';
import { UIManager, type BroadcastAudiencePreview } from '../ui/ui-manager';
import { LocationPrivacy } from '../../shared/location';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { getAllChatroomIds } from '../../shared/chatroom-hierarchy';
import { pickLatestTalkIdFromIncomingCluster } from '../../shared/incoming-talk-ids';
import { buildTalkIdentityKey, computeTalkIdFromTalkData } from '../../shared/talk-content-id';
import { isDevStageZero } from '../dev-stage-env';
import { purgeDevStageZeroGraph } from '../dev-stage-seeds';
import {
  isTechSupportUser,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';

export class IinPublicApp {
  private gunService: WebGunService;
  private userService: WebUserService;
  private chatroomService: WebChatroomService;
  private talkService: WebTalkService;
  private conversationService: WebConversationService;
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

  private buildChatroomTalkAnnouncementKey(logicalTalkId: string, authorId: string): string {
    return `${logicalTalkId}__${authorId}`;
  }

  private countOrdinaryRoomMembers(members: Array<{ userId: string }>): number {
    return members.filter((member) => member.userId !== TECHSUPPORT_ROOT_USER_ID).length;
  }

  constructor() {
    this.gunService = new WebGunService();
    this.userService = new WebUserService(this.gunService);
    this.chatroomService = new WebChatroomService(this.gunService);
    this.talkService = new WebTalkService(this.gunService, this.getBackendApiBase());
    this.conversationService = new WebConversationService(this.gunService);
    this.uiManager = new UIManager();
  }

  async initialize(location: GPSCoordinate): Promise<void> {
    this.currentLocation = location;

    // Initialize services (stage-zero server wipe happens in index.ts before init; do not purge
    // here — clearing the graph before SEA auth breaks gun.user().auth()).
    await this.gunService.initialize();
    await this.gunService.ensureKeypairAndAuth();

    // Initialize UI
    this.uiManager.initialize();
    this.uiManager.setApiBase(this.getBackendApiBase());
    this.uiManager.setCurrentLocation(location);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${base}/api/chatrooms`, { signal: controller.signal }).finally(() => {
        clearTimeout(timeout);
      });
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
    gun.get(`conversations/${conversationId}`).get('messages').get(`support_welcome_${userId}`).put({
      id: `support_welcome_${userId}`,
      senderId: TECHSUPPORT_ROOT_USER_ID,
      text: welcome,
      timestamp: now,
      channel: 'public',
      transport: this.conversationService.getTransportMode(),
      supportMessage: true,
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

  private subscribeToTalks(chatroomId: string): void {
    console.log('🎯 Subscribing to chatroom talks:', chatroomId);
    const gun = this.gunService.getGun();

    const talksRef = gun.get('chatrooms').get(chatroomId).get('talks');

    /** Dedupe by (talkId, authorId); same content-hash id from two senders must both register. */
    const seenTalkAuthor = new Set<string>();

    const processTalkAnnouncement = (talkAnnouncement: any, talkId: string) => {
      if (talkId.startsWith('_')) return; // Skip Gun.js metadata

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
          void this.talkService.getTalkWithRetry(talkAnnouncement.talkId).then((talkData) => {
            if (!talkData) return;
            this.registerSelfAsReceiverOfIncomingTalk(
              talkAnnouncement.talkId,
              authorId,
              talkAnnouncement.authorName || 'Unknown',
              talkData,
            );
            this.maybeAutoChatbotReplyToAnnouncer(
              logicalTalkId,
              talkData,
              authorId,
              talkAnnouncement.authorName || 'Unknown',
            );
          });
        }
        return;
      }

      if (talkAnnouncement && talkAnnouncement.talkId) {
        // Wait for full JSON (questions/answers) — Gun .once often fires before replication completes.
        void this.talkService.getTalkWithRetry(talkAnnouncement.talkId).then((talkData) => {
          if (!talkData) {
            console.warn('Could not load full talk after retry:', talkAnnouncement.talkId);
            return;
          }
          console.log('📋 Full talk data:', talkData);
          const talkWithAuthor = {
            ...talkData,
            authorName: talkAnnouncement.authorName || (talkData as any)?.authorName || 'Unknown',
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

    // Use .on() for real-time updates
    talksRef.map().on(processTalkAnnouncement);

    // ALSO use .once() to load existing talks immediately
    // This ensures we don't miss talks that were added while we were offline
    console.log('🔄 Loading existing talks with .once()...');
    talksRef.map().once(processTalkAnnouncement);
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
  ): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || members.length === 0) return true;
    const receiverIds = members
      .map((m) => m.userId)
      .filter((id) => id !== me.id && id !== TECHSUPPORT_ROOT_USER_ID);
    if (receiverIds.length === 0) return true;
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
      } else {
        const r = await res.json();
        console.log(`register-receivers-for-broadcast ok: talkId=${talkId} registered=${r?.registered}`);
        return true;
      }
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

    const previewTimeoutMs = 30_000;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), previewTimeoutMs);
        const response = await fetch(`${this.getBackendApiBase()}/api/talks/broadcast-receiver-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(previewBody),
          signal: controller.signal,
        }).finally(() => window.clearTimeout(timeoutId));
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
   * Other users who should receive server-side IN registration for a broadcast.
   * **Gun `chatrooms/<id>/users` is authoritative** for who is in the room. We only use the UI
   * member list to fill nicer `stageName`s. A naive merge used to keep stale UI rows from a prior
   * room (e.g. Global) after switching to a parent/child node, which incorrectly registered bulk
   * sends for users who were no longer in that chatroom id.
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

    let gunMemberIds: string[] = [];
    const mergeGunOnce = async () => {
      const ids = await this.chatroomService.getActiveMembers(chatroomId);
      gunMemberIds = [...new Set(ids.filter((id) => !!id && id !== me && id !== TECHSUPPORT_ROOT_USER_ID))];
    };

    await mergeGunOnce();

    if (gunMemberIds.length === 0) {
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        await mergeGunOnce();
        if (gunMemberIds.length > 0) break;
      }
    }

    if (gunMemberIds.length === 0) {
      for (const m of uiMembers || []) {
        const id = String(m.userId || '').trim();
        if (!id || id === me || id === TECHSUPPORT_ROOT_USER_ID) continue;
        gunMemberIds.push(id);
      }
      gunMemberIds = [...new Set(gunMemberIds)];
    }

    return gunMemberIds.map((userId) => ({
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
        });
      }
    }
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

  /** Resolve full talk using server incoming-talks (authoritative ids), not reshaped Gun cluster keys. */
  private async loadFullTalkViaIncomingIdentity(identityKey: string): Promise<Talk | null> {
    if (!this.currentUser?.id) return null;
    try {
      const base = this.getBackendApiBase();
      const res = await fetch(
        `${base}/api/users/${encodeURIComponent(this.currentUser.id)}/incoming-talks`,
        { cache: 'no-store' },
      );
      if (!res.ok) return null;
      const clusters = await res.json();
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
    const gun = this.gunService.getGun();
    console.log('👂 Subscribing to incoming talk clusters for:', this.currentUser.id);

    gun
      .get('incomingTalksByUser')
      .get(this.currentUser.id)
      .map()
      .on((cluster: any, id: string) => {
        if (!cluster || !id || id.startsWith('_')) return;
        if (this.incomingApiRefreshTimer) clearTimeout(this.incomingApiRefreshTimer);
        this.incomingApiRefreshTimer = setTimeout(() => {
          void this.refreshIncomingTalkClustersFromApi();
        }, 120);
      });
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
   * E2E: await the same IN-list merge as the Talks tab (GET incoming-talks → UI). The tab emits
   * `needIncomingTalkClusters` without awaiting; Playwright needs a promise-bound sync.
   */
  public async syncIncomingClustersFromServer(): Promise<void> {
    await this.refreshIncomingTalkClustersFromApi();
  }

  private applyIncomingClustersFromApiArray(clusters: any[]): void {
    // Authoritative snapshot from GET /incoming-talks — do not merge old Gun .map() soul keys on top.
    // Spreading incomingClustersMap left stale/non-identity entries and could prevent IN rows from matching
    // the server list after syncIncomingClustersFromServer (e2e: row missing despite API having the talk).
    const next: Record<string, any> = {};
    for (const c of clusters) {
      if (c?.identityKey) {
        next[c.identityKey] = c;
      }
    }
    const list = Object.values(next).filter((c: any) => c && c.identityKey);
    this.uiManager.setIncomingTalkClusters(list);
    this.uiManager.displayTalksList();
  }

  /**
   * After registration, poll GET incoming-talks until this talk appears (or timeout). Aligns IN list
   * with notification when server/Gun replication lags.
   */
  private async refreshIncomingTalkClustersFromApiUntilVisible(talkData: any, talkId: string): Promise<void> {
    if (!this.currentUser?.id || !talkData) return;
    const identityKey = buildTalkIdentityKey(talkData);
    const base = this.getBackendApiBase();
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
      try {
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
      await new Promise((r) => setTimeout(r, gapMs));
    }
    await this.refreshIncomingTalkClustersFromApi();
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
        transportMode: conversationData.transportMode,
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
      const existingConversation = Object.values(conversations).find(
        (conv: any) => conv.otherUserId === data.userId,
      ) as any;

      if (existingConversation) {
        // Open existing conversation
        console.log('💬 Opening existing conversation:', existingConversation.conversationId);
        this.uiManager.showConversationDetail(existingConversation.conversationId);
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
          gun.get('chatrooms').get(chatroomId).get('talks').get(announcementKey).put({
            talkId: talk.id,
            title: talk.title,
            authorId: talk.authorId,
            authorName: this.currentUser!.stageName,
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
          if (broadcastableIds.length === 0) {
            // UI already shows this notification when broadcastableCount === 0; skip duplicate to avoid double toast
            return;
          }

          const receivers = await this.resolveBroadcastReceivers(chatroomId, data.members ?? []);
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
          if (audiencePreviews.length > 0 && !(await this.uiManager.confirmBroadcastAudience(audiencePreviews))) {
            this.uiManager.showNotification(this.uiManager.formatBroadcastCancelled(), 'info');
            return;
          }
          // Phase 1: POST register-receivers in small parallel batches (HTTP only — no Gun on this path).
          // Fully sequential was very slow (20 round-trips); full parallel can spike the server.
          const REGISTER_BATCH = 5;
          for (let i = 0; i < talkPayloads.length; i += REGISTER_BATCH) {
            const batch = talkPayloads.slice(i, i + REGISTER_BATCH);
            // Cancellation semantics: if creator deletes/disables a talk while Phase 1 is in-flight,
            // we must skip registering receivers for that talk (and also skip Gun announce in Phase 2).
            const broadcastableNow = new Set(
              this.uiManager.getBroadcastableTalkIds().filter((id) => broadcastableIds.includes(id)),
            );
            // registerReceiversOnServerForTalk returns boolean (ok vs error) — count only non-skipped calls.
            const batchResults = await Promise.all(
              batch.map(({ tid, talk }) => {
                if (!broadcastableNow.has(tid)) return Promise.resolve(false);
                return this.registerReceiversOnServerForTalk(
                  tid,
                  talk,
                  receivers,
                  broadcastTargetTags,
                  broadcastMaxDistanceMiles,
                );
              }),
            );
            sent += batchResults.filter(Boolean).length;
          }
          // Phase 2: Gun announce — single room only (no descendant hierarchy fan-out).
          const broadcastableNowForGun = new Set(
            this.uiManager.getBroadcastableTalkIds().filter((id) => broadcastableIds.includes(id)),
          );
          for (const { tid, talk } of talkPayloads) {
            if (!broadcastableNowForGun.has(tid)) continue;
            const announcementKey = this.buildChatroomTalkAnnouncementKey(
              tid,
              String(talk.authorId || this.currentUser!.id),
            );
            gun.get('chatrooms').get(chatroomId).get('talks').get(announcementKey).put({
              talkId: tid,
              title: talk.title,
              authorId: talk.authorId,
              authorName: this.currentUser!.stageName,
              type: talk.type,
              timestamp: new Date().toISOString(),
              questionCount: talk.questions?.length ?? 0,
            });
          }
          this.uiManager.setBroadcastBulkAck(sent, targetCount);
          this.uiManager.recordBroadcastConversation(
            chatroomId,
            talkPayloads.filter(({ tid }) => broadcastableNowForGun.has(tid)).map(({ tid }) => tid),
            receivers,
          );
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
      } catch (error) {
        console.error('Failed to update talk:', error);
        this.uiManager.showNotification(this.uiManager.formatTalkUpdateFailed((error as Error).message), 'error');
      }
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
      void this.refreshIncomingTalkClustersFromApi();
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

        // Subscribe to messages for this conversation
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
        });
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
      const home = this.travelHomeChatroomId || locationPath[locationPath.length - 1] || 'global';
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
          gun.get('chatrooms').get(chatroomId).get('talks').get(announcementKey).put({
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
