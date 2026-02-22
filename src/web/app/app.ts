import { User, GPSCoordinate, Talk } from '../../shared/types';
import { WebGunService } from '../services/web-gun-service';
import { WebUserService } from '../services/web-user-service';
import { WebChatroomService } from '../services/web-chatroom-service';
import { WebTalkService } from '../services/web-talk-service';
import { WebConversationService } from '../services/web-conversation-service';
import { UIManager } from '../ui/ui-manager';
import { LocationPrivacy } from '../../shared/location';
import { getAllChatroomIds } from '../../shared/chatroom-hierarchy';

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

  constructor() {
    this.gunService = new WebGunService();
    this.userService = new WebUserService(this.gunService);
    this.chatroomService = new WebChatroomService(this.gunService);
    this.talkService = new WebTalkService(this.gunService);
    this.conversationService = new WebConversationService(this.gunService);
    this.uiManager = new UIManager();
  }

  async initialize(location: GPSCoordinate): Promise<void> {
    this.currentLocation = location;

    // Initialize services
    await this.gunService.initialize();

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

    if (existingUserId) {
      try {
        this.currentUser = await this.userService.getUser(existingUserId);
        console.log('👤 Existing user loaded:', this.currentUser.stageName);
      } catch (error) {
        console.log('🆕 Existing user not found, creating new user');
        this.currentUser = await this.createNewUser();
      }
    } else {
      this.currentUser = await this.createNewUser();
    }

    // Update user location
    if (this.currentLocation) {
      await this.userService.updateUserLocation(this.currentUser.id, this.currentLocation);
    }
  }

  private async createNewUser(): Promise<User> {
    // Show user creation UI
    const userData = await this.uiManager.showUserCreationDialog();

    const blurredLocation = LocationPrivacy.blurLocation(this.currentLocation!);

    const newUser: Partial<User> = {
      // stageName will be auto-generated in userService.createUser()
      headshot: userData.headshot,
      location: blurredLocation,
      languages: userData.languages || ['en'],
      interests: userData.interests || [],
      profile: [],
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

    // Join the assigned chatroom (FIFO logic will be enforced in joinChatroom)
    await this.chatroomService.joinChatroom(
      chatroomId,
      this.currentUser.id,
      this.currentUser.stageName,
    );

    // Store current chatroom in localStorage for next time
    localStorage.setItem('iinpublic_last_chatroom', chatroomId);

    console.log('🏠 Joined chatroom:', chatroomId);

    // Subscribe to chatroom members and update UI
    this.chatroomService.subscribeToMembers(chatroomId, (members) => {
      console.log('👥 Chatroom members updated:', members);
      this.uiManager.updateChatroomMembers(members, this.currentUser!.id);
    });

    // Subscribe to chatroom messages
    this.subscribeToMessages(chatroomId);

    // Subscribe to chatroom talks
    this.subscribeToTalks(chatroomId);

    // Subscribe to user's conversations (for matches)
    this.subscribeToUserConversations();

    // Update chatroom info
    this.uiManager.updateChatroomInfo({ id: chatroomId, name: `Chatroom: ${chatroomId}` });
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

  private subscribeToTalks(chatroomId: string): void {
    console.log('🎯 Subscribing to chatroom talks:', chatroomId);
    const gun = this.gunService.getGun();

    const talksRef = gun.get('chatrooms').get(chatroomId).get('talks');

    // Track processed talks to avoid duplicates
    const processedTalks = new Set<string>();

    const processTalkAnnouncement = (talkAnnouncement: any, talkId: string) => {
      if (talkId.startsWith('_')) return; // Skip Gun.js metadata

      console.log('📨 Received talk announcement:', { talkId, talkAnnouncement });

      // Avoid processing the same talk multiple times
      if (processedTalks.has(talkId)) {
        console.log('⏭️  Skipping already processed talk:', talkId);
        return;
      }

      if (talkAnnouncement && talkAnnouncement.talkId) {
        processedTalks.add(talkId);

        // Fetch the full talk details
        gun.get(`talks/${talkAnnouncement.talkId}`).once((talkDataWrapper: any) => {
          if (talkDataWrapper && talkDataWrapper.data) {
            // Parse the JSON string to get the full talk
            const talkData = JSON.parse(talkDataWrapper.data);
            console.log('📋 Full talk data:', talkData);

            // Display the talk in UI
            this.uiManager.displayIncomingTalk({
              id: talkData.id,
              title: talkData.title,
              authorName: talkAnnouncement.authorName || 'Unknown',
              type: talkData.type,
              questionCount: talkData.questions?.length || 0,
              timestamp: talkAnnouncement.timestamp,
              isOwnTalk: talkAnnouncement.authorId === this.currentUser?.id,
              fullTalk: talkData,
            });

            // If this is the user's own talk, subscribe to responses
            if (talkAnnouncement.authorId === this.currentUser?.id) {
              this.subscribeToTalkResponses(talkAnnouncement.talkId, talkData);
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

        console.log('📬 Received talk response:', responseData);

        if (responseData && responseData.responderId && responseData.answers) {
          // Don't notify for own responses
          if (responseData.responderId === this.currentUser?.id) return;

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
                })
                .then((conversationId) => {
                  // Add conversation to UI
                  this.uiManager.addNewConversation({
                    conversationId,
                    otherUserId: responseData.responderId,
                    otherUserName: responseData.responderName,
                    talkId: talkId,
                  });
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

  private checkIfMatch(talkData: any, answers: any[]): boolean {
    // For matching-type talks, check if the final answer was "noticed"
    if (talkData.type !== 'matching') {
      console.log('  Not a matching talk, type:', talkData.type);
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

  private subscribeToUserConversations(): void {
    if (!this.currentUser) return;

    console.log('💬 Subscribing to user conversations for:', this.currentUser.id);

    this.conversationService.subscribeToUserConversations(
      this.currentUser.id,
      async (conversations) => {
        console.log('📨 New conversations detected:', conversations);

        // Process each conversation
        for (const conversationData of conversations) {
          // Get the other user's info
          const otherUserId =
            conversationData.userId1 === this.currentUser!.id
              ? conversationData.userId2
              : conversationData.userId1;
          const otherUserName =
            conversationData.userId1 === this.currentUser!.id
              ? conversationData.userName2
              : conversationData.userName1;

          // Add to UI
          this.uiManager.addNewConversation({
            conversationId: conversationData.conversationId,
            otherUserId: otherUserId,
            otherUserName: otherUserName,
            talkId: conversationData.talkId,
          });
        }
      },
    );
  }

  private setupEventHandlers(): void {
    // Handle UI events

    // Handle stage name changes
    this.uiManager.onStageNameChange = async (userId: string, newStageName: string) => {
      try {
        await this.userService.updateStageName(userId, newStageName);

        // Update current user object
        if (this.currentUser && this.currentUser.id === userId) {
          this.currentUser.stageName = newStageName;
          // Refresh the UI to show the new name
          this.uiManager.showMainInterface(this.currentUser);
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

    this.uiManager.on('createTalk', async (talkData: Partial<Talk>) => {
      try {
        console.log('📝 Creating talk:', talkData);

        // Create the talk
        const talk = await this.talkService.createTalk({
          ...talkData,
          authorId: this.currentUser!.id,
        });

        console.log('✅ Talk created:', talk);

        // Broadcast the talk to the chatroom
        const chatroomId = this.chatroomService.getCurrentChatroomId();
        if (chatroomId) {
          const gun = this.gunService.getGun();

          // Store the talk announcement in the chatroom
          gun.get('chatrooms').get(chatroomId).get('talks').get(talk.id).put({
            talkId: talk.id,
            title: talk.title,
            authorId: talk.authorId,
            authorName: this.currentUser!.stageName,
            type: talk.type,
            timestamp: new Date().toISOString(),
            questionCount: talk.questions.length,
          });

          console.log('📢 Talk broadcasted to chatroom:', chatroomId);

          // Subscribe to responses for this talk (since author won't receive their own announcement)
          this.subscribeToTalkResponses(talk.id, talk);
        }

        this.uiManager.showNotification('Talk created and sent to chatroom!', 'success');
      } catch (error) {
        console.error('Failed to create talk:', error);
        this.uiManager.showNotification(
          'Failed to create talk: ' + (error as Error).message,
          'error',
        );
      }
    });

    this.uiManager.on(
      'talkCompleted',
      async (data: { talkId: string; answers: any[]; talkData?: any }) => {
        try {
          console.log('📝 User completed talk:', data);

          // Store the response in Gun.js
          const chatroomId = this.chatroomService.getCurrentChatroomId();
          if (chatroomId) {
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
              });

            console.log('✅ Talk response stored');

            // Check if this response is a match
            if (data.talkData) {
              const isMatch = this.checkIfMatch(data.talkData, data.answers);

              if (isMatch) {
                console.log(`✅ Match! Creating conversation with talk author`);

                // Get talk author info
                gun.get(`talks/${data.talkId}`).once(async (talkWrapper: any) => {
                  if (talkWrapper && talkWrapper.data) {
                    const talkData = JSON.parse(talkWrapper.data);

                    // Get author's user data to get their name
                    gun.get(`users/${talkData.authorId}`).once(async (authorData: any) => {
                      const authorName = authorData?.stageName || 'Unknown';

                      // Create conversation
                      const conversationId = await this.conversationService.createConversation({
                        userId1: this.currentUser!.id,
                        userName1: this.currentUser!.stageName,
                        userId2: talkData.authorId,
                        userName2: authorName,
                        talkId: data.talkId,
                      });

                      // Add to UI
                      this.uiManager.addNewConversation({
                        conversationId,
                        otherUserId: talkData.authorId,
                        otherUserName: authorName,
                        talkId: data.talkId,
                      });
                    });
                  }
                });
              }
            }
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
