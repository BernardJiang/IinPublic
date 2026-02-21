import { WebGunService } from './web-gun-service';
import { Message } from '../../shared/types';

export class WebConversationService {
  constructor(private gunService: WebGunService) {}

  /**
   * Create a new conversation between two users after a match
   */
  async createConversation(params: {
    userId1: string;
    userName1: string;
    userId2: string;
    userName2: string;
    talkId: string;
  }): Promise<string> {
    const gun = this.gunService.getGun();

    // Create a unique conversation ID (sorted user IDs to ensure consistency)
    const sortedIds = [params.userId1, params.userId2].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${params.talkId}`;

    console.log(`💬 Creating conversation: ${conversationId}`);

    // Check if conversation already exists
    return new Promise((resolve) => {
      gun.get(`conversations/${conversationId}`).once((existingData: any) => {
        if (existingData && existingData.data) {
          console.log(`ℹ️  Conversation already exists: ${conversationId}`);
          resolve(conversationId);
          return;
        }

        // Store conversation in Gun.js
        const conversationData = {
          id: conversationId,
          participants: [params.userId1, params.userId2],
          talkId: params.talkId,
          createdAt: new Date().toISOString(),
          status: 'active',
        };

        gun.get(`conversations/${conversationId}`).put({
          data: JSON.stringify(conversationData),
        });

        // Add conversation to each user's conversation list
        gun.get(`users/${params.userId1}`).get('conversations').get(conversationId).put({
          conversationId,
          otherUserId: params.userId2,
          otherUserName: params.userName2,
          talkId: params.talkId,
          createdAt: new Date().toISOString(),
        });

        gun.get(`users/${params.userId2}`).get('conversations').get(conversationId).put({
          conversationId,
          otherUserId: params.userId1,
          otherUserName: params.userName1,
          talkId: params.talkId,
          createdAt: new Date().toISOString(),
        });

        console.log(`✅ Conversation created: ${conversationId}`);
        resolve(conversationId);
      });
    });
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(conversationId: string, senderId: string, text: string): Promise<void> {
    const gun = this.gunService.getGun();
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const messageData = {
      id: messageId,
      senderId,
      text,
      timestamp: new Date().toISOString(),
    };

    gun.get(`conversations/${conversationId}`).get('messages').get(messageId).put(messageData);

    console.log(`📤 Message sent in conversation ${conversationId}`);
  }

  /**
   * Subscribe to messages in a conversation
   */
  subscribeToMessages(conversationId: string, callback: (messages: Message[]) => void): () => void {
    const gun = this.gunService.getGun();
    const processedMessages = new Set<string>();

    gun
      .get(`conversations/${conversationId}`)
      .get('messages')
      .map()
      .on((_messageData: any, messageId: string) => {
        if (messageId.startsWith('_')) return;
        if (processedMessages.has(messageId)) return;

        processedMessages.add(messageId);

        // Collect all messages after a short delay
        setTimeout(() => {
          gun
            .get(`conversations/${conversationId}`)
            .get('messages')
            .map()
            .once((msg: any, msgId: string) => {
              if (!msgId.startsWith('_') && msg && msg.text) {
                processedMessages.add(msgId);
              }
            });

          // Convert to array and sort by timestamp
          const messagesArray = Array.from(processedMessages)
            .map((msgId) => {
              let msgData: any = null;
              gun
                .get(`conversations/${conversationId}`)
                .get('messages')
                .get(msgId)
                .once((data: any) => {
                  msgData = data;
                });
              return msgData;
            })
            .filter((msg) => msg && msg.text)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          callback(messagesArray as Message[]);
        }, 300);
      });

    return () => {
      // Unsubscribe logic
      console.log(`👋 Unsubscribed from conversation ${conversationId}`);
    };
  }

  /**
   * Subscribe to user's conversations list
   */
  subscribeToUserConversations(
    userId: string,
    callback: (conversations: any[]) => void,
  ): () => void {
    const gun = this.gunService.getGun();
    const processedConversations = new Set<string>();

    gun
      .get(`users/${userId}`)
      .get('conversations')
      .map()
      .on((conversationData: any, conversationId: string) => {
        if (conversationId.startsWith('_')) return;
        if (processedConversations.has(conversationId)) return;

        processedConversations.add(conversationId);
        console.log(`🔔 New conversation detected: ${conversationId}`, conversationData);

        // Trigger callback with conversation data
        if (conversationData && conversationData.otherUserId) {
          callback([conversationData]);
        }
      });

    return () => {
      console.log(`👋 Unsubscribed from user ${userId} conversations`);
    };
  }
}
