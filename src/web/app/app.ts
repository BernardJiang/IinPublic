import { User, GPSCoordinate, Talk } from '../../shared/types';
import { WebGunService } from '../services/web-gun-service';
import { WebUserService } from '../services/web-user-service';
import { WebChatroomService } from '../services/web-chatroom-service';
import { WebTalkService } from '../services/web-talk-service';
import { WebConversationService } from '../services/web-conversation-service';
import { UIManager } from '../ui/ui-manager';
import { LocationPrivacy } from '../../shared/location';
import { getAllChatroomIds, CHATROOM_HIERARCHY } from '../../shared/chatroom-hierarchy';
import { pickLatestTalkIdFromIncomingCluster } from '../../shared/incoming-talk-ids';
import { buildTalkIdentityKey, computeTalkIdFromTalkData } from '../../shared/talk-content-id';

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
  private incomingClustersMap: Record<string, any> = {};
  /** Gun .map().on may replay the same response node; avoid duplicate match UI/conversations. */
  private processedTalkResponseKeys = new Set<string>();
  /** One auto chatbot reply per announcer for the same content-hash talk id (same qa_* = same talk; keys are not author-based talk identity). */
  private chatbotAutoReplySentForPair = new Set<string>();

  private buildChatroomTalkAnnouncementKey(logicalTalkId: string, authorId: string): string {
    return `${logicalTalkId}__${authorId}`;
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

    // Initialize services
    await this.gunService.initialize();
    await this.gunService.ensureKeypairAndAuth();

    // Initialize UI
    this.uiManager.initialize();

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
  }

  /**
   * Subscribe to member count updates for all chatrooms in the UI list
   * This allows showing real-time headcount badges that update when users join/leave
   */
  private subscribeToAllChatroomMemberCounts(): void {
    // Get all chatroom IDs from the hierarchy
    const chatroomIds = getAllChatroomIds();

    // Also include the current chatroom ID (location-based) if it's not in the list
    const currentChatroomId = this.chatroomService.getCurrentChatroomId();
    if (currentChatroomId && !chatroomIds.includes(currentChatroomId)) {
      chatroomIds.push(currentChatroomId);
      console.log(`📍 Also subscribing to current location-based chatroom: ${currentChatroomId}`);
    }

    console.log('📊 Subscribing to member counts for all chatrooms...');
    console.log(`   Total chatrooms: ${chatroomIds.length}`);

    chatroomIds.forEach((chatroomId) => {
      this.chatroomService.subscribeToMemberCount(chatroomId, (count) => {
        console.log(`  - ${chatroomId}: ${count} members`);
        this.uiManager.setChatroomMemberCount(chatroomId, count);
      });
    });

    console.log('✅ Subscribed to all chatroom member counts');
  }

  private async initializeUser(): Promise<void> {
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
        this.currentUser = await this.createNewUser();
        isNewUser = true;
      }
    } else {
      this.currentUser = await this.createNewUser();
      isNewUser = true;
    }

    // Store whether this is a new user for welcome banner
    (this as any).isNewUser = isNewUser;

    // Update user location
    if (this.currentLocation) {
      await this.userService.updateUserLocation(this.currentUser.id, this.currentLocation);
    }
  }

  private async createNewUser(): Promise<User> {
    // Show user creation UI
    const userData = await this.uiManager.showUserCreationDialog();

    const blurredLocation = LocationPrivacy.blurLocation(this.currentLocation!);
    const pair = this.gunService.getStoredPair();

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
          members.length,
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
        this.uiManager.setChatroomMemberCount(toChatroomId, count);
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
        members.length,
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
  }

  /**
   * Get a user-friendly display name for a chatroom
   */
  private getChatroomDisplayName(chatroomId: string): string {
    // Look up proper display name from the chatroom hierarchy
    const findChatroom = (node: any): string | null => {
      if (node.id === chatroomId) {
        return node.name;
      }
      if (node.children) {
        for (const child of node.children) {
          const result = findChatroom(child);
          if (result) return result;
        }
      }
      return null;
    };

    const displayName = findChatroom(CHATROOM_HIERARCHY);
    if (displayName) {
      return displayName;
    }

    // Fallback: Capitalize and format the chatroom ID
    return chatroomId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
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
      console.log('🤖 Chatbot auto-reply skipped: no reusable template', { talkId, contentId, authorId });
      return;
    }
    const pairKey = `${talkId}::${authorId}`;
    if (this.chatbotAutoReplySentForPair.has(pairKey)) {
      console.log('🤖 Chatbot auto-reply skipped: pair already handled', { pairKey });
      return;
    }
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
        this.processedTalkResponseKeys.add(dedupeKey);

        console.log('📬 Received talk response:', responseData);

        if (responseData && responseData.responderId && responseData.answers) {
          // Don't notify for own responses
          if (responseData.responderId === this.currentUser?.id) return;

          // Chatbot responses include authorId: only that author should get the match/conversation
          if (responseData.authorId && responseData.authorId !== this.currentUser?.id) return;

          try {
            const answers = JSON.parse(responseData.answers);

            // Check if this is a match
            const isMatch = this.checkIfMatch(talkData, answers);

            if (isMatch) {
              this.uiManager.showNotification(
                `Match! ${responseData.responderName} noticed you on "${talkData.title}"`,
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
            console.error('Error processing talk response:', error);
          }
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
  ): Promise<boolean> {
    const me = this.currentUser;
    if (!me?.id || members.length === 0) return true;
    const receiverIds = members.map((m) => m.userId).filter((id) => id !== me.id);
    if (receiverIds.length === 0) return true;
    const base = this.getBackendApiBase();
    console.log(`📡 POSTing register-receivers: talkId=${talkId} receivers=${receiverIds.length}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
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

  /**
   * Other users who should receive server-side IN registration for a broadcast.
   * Merge UI members with Gun `chatrooms/.../users` ids. Do not return UI-only early: the detail
   * panel can show an empty list (or debounce lag) while the graph already has other members, which
   * used to skip all register-receivers POSTs and leave only a single Gun-driven /received.
   */
  private async resolveBroadcastReceivers(
    chatroomId: string,
    uiMembers: Array<{ userId: string; stageName: string }>,
  ): Promise<Array<{ userId: string; stageName: string }>> {
    const me = this.currentUser?.id;
    if (!me) return [];

    const byId = new Map<string, { userId: string; stageName: string }>();
    for (const m of uiMembers || []) {
      if (!m.userId || m.userId === me) continue;
      const name = String(m.stageName || m.userId).trim() || m.userId;
      byId.set(m.userId, { userId: m.userId, stageName: name });
    }

    const mergeGunOnce = async () => {
      const ids = await this.chatroomService.getActiveMembers(chatroomId);
      for (const id of ids) {
        if (!id || id === me || byId.has(id)) continue;
        byId.set(id, { userId: id, stageName: id });
      }
    };

    await mergeGunOnce();

    if (byId.size === 0) {
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 200));
        await mergeGunOnce();
        if (byId.size > 0) break;
      }
    } else {
      await new Promise((r) => setTimeout(r, 150));
      await mergeGunOnce();
    }

    return Array.from(byId.values());
  }

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
        if (!cluster) return;
        this.incomingClustersMap[id] = cluster;
        const clusters = Object.values(this.incomingClustersMap).filter((c: any) => c && c.identityKey);
        this.uiManager.setIncomingTalkClusters(clusters);
        this.uiManager.displayTalksList();
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
    this.incomingClustersMap = next;
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

  private subscribeToUserConversations(): void {
    if (!this.currentUser) return;

    console.log('💬 Subscribing to user conversations for:', this.currentUser.id);

    this.conversationService.subscribeToUserConversations(
      this.currentUser.id,
      async (conversations) => {
        console.log('📨 New conversations detected:', conversations);

        // Process each conversation
        for (const conversationData of conversations) {
          // Gun stores otherUserId/otherUserName; legacy or other sources may use userId1/userId2
          const otherUserId =
            conversationData.otherUserId ??
            (conversationData.userId1 === this.currentUser!.id
              ? conversationData.userId2
              : conversationData.userId1);
          const otherUserName =
            conversationData.otherUserName ??
            (conversationData.userId1 === this.currentUser!.id
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
          }

          this.uiManager.addNewConversation({
            conversationId: conversationData.conversationId,
            otherUserId,
            otherUserName: resolvedOtherUserName,
            talkId: conversationData.talkId,
            respondedByBot: conversationData.respondedByBot,
          });
        }
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

        this.uiManager.showNotification('Stage name updated successfully!', 'success');
      } catch (error) {
        console.error('Failed to update stage name:', error);
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
          'Match with this user through Talks to start a conversation!',
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
          this.uiManager.showNotification('Talk sent successfully!', 'success');
        } catch (error) {
          this.uiManager.showNotification(
            'Failed to send talk: ' + (error as Error).message,
            'error',
          );
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
            this.uiManager.showNotification(
              'Talk saved locally. Server is slow to sync — use Broadcast in the chatroom in a few seconds.',
              'info',
            );
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

        let createdMsg = 'Talk created and sent to chatroom!';
        if (!wantSendToChatroom) {
          createdMsg =
            'Talk saved to your list (send-to-room was off). Use Broadcast in Chatrooms when you want others to receive it.';
        } else if (!chatroomId) {
          createdMsg =
            'Talk created. Open Chatrooms, join a room, then use Broadcast so others receive it.';
        }
        this.uiManager.showNotification(createdMsg, 'success');
      } catch (error) {
        console.error('Failed to create talk:', error);
        this.uiManager.showNotification(
          'Failed to create talk: ' + (error as Error).message,
          'error',
        );
      }
    });

    // Broadcast all my created talks to all other users in the current room
    this.uiManager.on(
      'broadcastTalk',
      async (data: { chatroomId: string; members: Array<{ userId: string; stageName: string }> }) => {
        try {
          const chatroomId = data.chatroomId || this.chatroomService.getCurrentChatroomId();
          if (!chatroomId || !this.currentUser) {
            this.uiManager.showNotification('No chatroom selected.', 'error');
            return;
          }
          const broadcastableIds = this.uiManager.getBroadcastableTalkIds();
          console.log(`📢 broadcastTalk: ${broadcastableIds.length} broadcastable ids, members=${data.members?.length ?? 0}`);
          if (broadcastableIds.length === 0) {
            // UI already shows this notification when broadcastableCount === 0; skip duplicate to avoid double toast
            return;
          }
          const receivers = await this.resolveBroadcastReceivers(chatroomId, data.members ?? []);
          const targetCount = receivers.length;
          console.log(`📢 broadcastTalk: ${targetCount} receivers resolved`);
          if (targetCount === 0) {
            console.warn(
              '⚠️ broadcastTalk: no receivers resolved (UI members + Gun fallback empty). IN list will not populate for others.',
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
          // Phase 1: POST register-receivers in small parallel batches (HTTP only — no Gun on this path).
          // Fully sequential was very slow (20 round-trips); full parallel can spike the server.
          const REGISTER_BATCH = 5;
          for (let i = 0; i < talkPayloads.length; i += REGISTER_BATCH) {
            const batch = talkPayloads.slice(i, i + REGISTER_BATCH);
            await Promise.all(
              batch.map(({ tid, talk }) => this.registerReceiversOnServerForTalk(tid, talk, receivers)),
            );
            sent += batch.length;
          }
          // Phase 2: announce all talks in the chatroom via Gun.js AFTER all POSTs complete.
          for (const { tid, talk } of talkPayloads) {
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
          this.uiManager.showNotification(
            `Sent ${sent} talk${sent !== 1 ? 's' : ''} to ${targetCount} user${targetCount !== 1 ? 's' : ''} in the room.`,
            'success',
          );
        } catch (error) {
          console.error('Broadcast talks failed:', error);
          this.uiManager.showNotification(
            'Failed to broadcast talks: ' + (error as Error).message,
            'error',
          );
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
        this.uiManager.showNotification('Talk updated.', 'success');
        this.uiManager.displayTalksList();
      } catch (error) {
        console.error('Failed to update talk:', error);
        this.uiManager.showNotification(
          'Failed to update talk: ' + (error as Error).message,
          'error',
        );
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
          this.uiManager.showNotification('Talk not found.', 'error');
        }
      } catch (error) {
        console.error('Failed to load talk:', error);
        this.uiManager.showNotification(
          'Failed to load talk: ' + (error as Error).message,
          'error',
        );
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
      await Promise.all(
        data.talkIds.map(async (talkId) => {
          try {
            const summary = await this.talkService.queryStats(talkId, 'summary');
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
        try {
          console.log('📝 User completed talk:', data);

          const isChatbot = !!data.isChatbotResponse;

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
          if (!chatroomId) {
            return;
          }

          let submittedViaServer = false;
          let isMatch = !!data.talkData && this.checkIfMatch(data.talkData, data.answers);
          if (data.talkData && isMatch && !isChatbot) {
            // Persist the template before awaiting server work so a rapid re-announce can reuse it immediately.
            this.uiManager.saveChatbotTemplate(data.talkId, {
              answers: data.answers,
              talkData: data.talkData,
            });
          }
          const localAuthorName =
            data.talkData?.authorName && data.talkData.authorName !== 'Unknown'
              ? data.talkData.authorName
              : undefined;
          let serverMatches:
            | Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }>
            | null = null;
          let serverOtherUser:
            | { userId: string; userName: string; conversationId: string | null; talkId: string }
            | null = null;
          if (data.talkData) {
            try {
              const serverResult = await this.talkService.submitTalkResponse({
                talkId: data.talkId,
                responderId: this.currentUser!.id,
                responderName: this.currentUser!.stageName,
                answers: data.answers,
                talkData: data.talkData,
                isAuto: !data.answers.some((a: any) => a?.mode === 'manual'),
                isChatbotResponse: isChatbot,
              });
              submittedViaServer = true;
              isMatch = !!serverResult.isMatch;
              serverMatches = Array.isArray(serverResult.matches) ? serverResult.matches : [];
              if (serverResult.otherUserId) {
                serverOtherUser = {
                  userId: serverResult.otherUserId,
                  userName: serverResult.otherUserName || 'Unknown',
                  conversationId: serverResult.conversationId,
                  talkId: data.talkId,
                };
              }
              console.log('✅ Talk response stored via server');
            } catch (error) {
              console.warn('Talk response server submit failed, falling back to direct Gun write:', error);
            }
          }

          if (!submittedViaServer) {
            const gun = this.gunService.getGun();
            const responseId = `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            gun
              .get(`talks/${data.talkId}`)
              .get('responses')
              .get(responseId)
              .put({
                responderId: this.currentUser!.id,
                responderName: this.currentUser!.stageName,
                answers: JSON.stringify(data.answers),
                submittedAt: new Date().toISOString(),
                isChatbotResponse: isChatbot,
              });

            console.log('✅ Talk response stored');
          }

          if (submittedViaServer && isMatch) {
            const directTargets =
              serverMatches && serverMatches.length > 0
                ? serverMatches.map((match) => ({
                    conversationId: match.conversationId,
                    otherUserId: match.senderId,
                    otherUserName:
                      match.senderName && match.senderName !== 'Unknown' && match.senderName !== 'Someone'
                        ? match.senderName
                        : localAuthorName || 'Unknown',
                    talkId: match.talkId || data.talkId,
                  }))
                : serverOtherUser && serverOtherUser.conversationId
                  ? [
                      {
                        conversationId: serverOtherUser.conversationId,
                        otherUserId: serverOtherUser.userId,
                        otherUserName:
                          serverOtherUser.userName &&
                          serverOtherUser.userName !== 'Unknown' &&
                          serverOtherUser.userName !== 'Someone'
                            ? serverOtherUser.userName
                            : localAuthorName || 'Unknown',
                        talkId: serverOtherUser.talkId,
                      },
                    ]
                  : [];

            for (const target of directTargets) {
              this.uiManager.addNewConversation({
                conversationId: target.conversationId,
                otherUserId: target.otherUserId,
                otherUserName: target.otherUserName,
                talkId: target.talkId,
                respondedByBot: isChatbot,
              });
            }
          }

          if (!submittedViaServer && data.talkData && isMatch) {
            // Server is the authority for conversation creation. When the server submit path is
            // unavailable we cannot safely create a conversation because the server will not know
            // about it and match/stats state will be inconsistent. The Gun response write above
            // preserves the raw answer data; the user should retry when the server is reachable.
            console.warn('Talk response was not submitted via server — skipping conversation creation until server is reachable.');
          }
        } catch (error) {
          console.error('Failed to store talk response:', error);
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
            'Failed to process answer: ' + (error as Error).message,
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
          this.uiManager.showNotification('Not in a chatroom', 'error');
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
        this.uiManager.showNotification('Message sent!', 'success');
      } catch (error) {
        console.error('Failed to send message:', error);
        this.uiManager.showNotification(
          'Failed to send message: ' + (error as Error).message,
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
        });
      } catch (error) {
        console.error('Failed to load conversation:', error);
        this.uiManager.showNotification(
          'Failed to load conversation: ' + (error as Error).message,
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
            'Failed to send message: ' + (error as Error).message,
            'error',
          );
        }
      },
    );

    this.uiManager.on('requestLocationUpdate', async () => {
      try {
        const newLocation = await LocationPrivacy.getCurrentLocation();
        this.currentLocation = newLocation;

        if (this.currentUser) {
          await this.userService.updateUserLocation(this.currentUser.id, newLocation);

          // Check if we need to switch chatrooms
          const newChatroomId = await this.chatroomService.findOptimalChatroom(newLocation);
          const currentChatroomId = this.chatroomService.getCurrentChatroomId();

          if (newChatroomId !== currentChatroomId) {
            await this.chatroomService.switchChatroom(this.currentUser.id, newChatroomId);
            this.uiManager.showNotification('Moved to new chatroom based on location', 'info');
          }
        }
      } catch (error) {
        this.uiManager.showNotification(
          'Failed to update location: ' + (error as Error).message,
          'error',
        );
      }
    });

    this.uiManager.on('chatroomChanged', async (chatroomId: string) => {
      if (!this.currentUser) {
        return;
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
          members.length,
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
      this.uiManager.showNotification('Could not load talk.', 'error');
      return;
    }
    this.uiManager.showTalkResponseDialog(talk, { skipAutoAnswer: false });
  }

  public manualCleanup(): void {
    // Manually trigger cleanup (for E2E tests where beforeunload may not fire)
    console.log('🧹 Manual cleanup called');
    if (this.currentUser && this.currentChatroomId) {
      console.log(`🧹 Cleanup: user=${this.currentUser.id}, chatroom=${this.currentChatroomId}`);
      // Leave current chatroom
      this.chatroomService.leaveChatroom(this.currentChatroomId, this.currentUser.id);
      this.userService.setUserStatus(this.currentUser.id, 'offline');
      console.log('✅ Manual cleanup complete');
    } else {
      console.log('⚠️ Manual cleanup skipped - no user or chatroom');
    }
  }
}
