import { User, GPSCoordinate, Talk } from '../../shared/types';
import { WebGunService } from '../services/web-gun-service';
import { WebUserService } from '../services/web-user-service';
import { WebChatroomService } from '../services/web-chatroom-service';
import { WebTalkService } from '../services/web-talk-service';
import { UIManager } from '../ui/ui-manager';
import { LocationPrivacy } from '../../shared/location';

export class IinPublicApp {
  private gunService: WebGunService;
  private userService: WebUserService;
  private chatroomService: WebChatroomService;
  private talkService: WebTalkService;
  private uiManager: UIManager;
  private currentUser?: User;
  private currentLocation?: GPSCoordinate;

  constructor() {
    this.gunService = new WebGunService();
    this.userService = new WebUserService(this.gunService);
    this.chatroomService = new WebChatroomService(this.gunService);
    this.talkService = new WebTalkService(this.gunService);
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
      stageName: userData.stageName,
      headshot: userData.headshot,
      location: blurredLocation,
      languages: userData.languages || ['en'],
      interests: userData.interests || [],
      profile: []
    };
    
    const user = await this.userService.createUser(newUser);
    localStorage.setItem('iinpublic_user_id', user.id);
    
    console.log('✨ New user created:', user.stageName);
    return user;
  }

  private async initializeChatrooms(): Promise<void> {
    if (!this.currentUser || !this.currentLocation) return;
    
    // Find optimal chatroom for user's location
    const chatroomId = await this.chatroomService.findOptimalChatroom(this.currentLocation);
    
    // Join the chatroom
    await this.chatroomService.joinChatroom(chatroomId, this.currentUser.id);
    
    console.log('🏠 Joined chatroom:', chatroomId);
  }

  private setupEventHandlers(): void {
    // Handle UI events
    this.uiManager.on('sendTalk', async (data: { talkId: string; targetScope: any; maxRecipients: number }) => {
      try {
        await this.talkService.sendBulkTalk(
          data.talkId,
          this.currentUser!.id,
          data.targetScope,
          data.maxRecipients
        );
        this.uiManager.showNotification('Talk sent successfully!', 'success');
      } catch (error) {
        this.uiManager.showNotification('Failed to send talk: ' + (error as Error).message, 'error');
      }
    });

    this.uiManager.on('createTalk', async (talkData: Partial<Talk>) => {
      try {
        await this.talkService.createTalk({
          ...talkData,
          authorId: this.currentUser!.id
        });
        this.uiManager.showNotification('Talk created successfully!', 'success');
        this.uiManager.refreshTalksList();
      } catch (error) {
        this.uiManager.showNotification('Failed to create talk: ' + (error as Error).message, 'error');
      }
    });

    this.uiManager.on('answerQuestion', async (data: { 
      conversationId: string; 
      questionId: string; 
      answerId: string; 
    }) => {
      try {
        const result = await this.talkService.processAnswer(
          data.conversationId,
          data.questionId,
          data.answerId,
          this.currentUser!.id
        );
        
        this.uiManager.updateConversation(data.conversationId, result);
        
        if (result.isComplete) {
          this.uiManager.showTalkCompletion(data.conversationId, result.outcome);
        }
      } catch (error) {
        this.uiManager.showNotification('Failed to process answer: ' + (error as Error).message, 'error');
      }
    });

    this.uiManager.on('sendMessage', async (data: { conversationId: string; message: string }) => {
      try {
        // Check for auto-linear capture pattern
        const linearCapture = this.talkService.checkForLinearCapture(data.message);
        
        if (linearCapture) {
          this.uiManager.showLinearCaptureInterface(data.conversationId, linearCapture);
        } else {
          await this.talkService.sendMessage(data.conversationId, this.currentUser!.id, data.message);
        }
      } catch (error) {
        this.uiManager.showNotification('Failed to send message: ' + (error as Error).message, 'error');
      }
    });

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
        this.uiManager.showNotification('Failed to update location: ' + (error as Error).message, 'error');
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
      if (this.currentUser) {
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
}