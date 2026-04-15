import { WebGunService } from './web-gun-service';
import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';

export type SendMessageOptions = {
  channel?: Message['channel'];
  /** If omitted, the other participant is inferred from the conversation record. */
  otherUserId?: string;
};

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

  private async getOtherParticipantId(conversationId: string, myId: string): Promise<string | undefined> {
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      gun.get(`conversations/${conversationId}`).once((d: any) => {
        if (!d?.data) {
          resolve(undefined);
          return;
        }
        try {
          const c = JSON.parse(d.data);
          const parts: string[] = c.participants || [];
          resolve(parts.find((p) => p !== myId));
        } catch {
          resolve(undefined);
        }
      });
    });
  }

  private async getUserEpub(userId: string): Promise<string | undefined> {
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      gun.get(`users/${userId}`).once((u: any) => {
        resolve(u?.epub);
      });
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
    const channel = opts?.channel ?? 'public';
    const gun = this.gunService.getGun();
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let payloadText = text;
    let messageData: Record<string, unknown> = {
      id: messageId,
      senderId,
      text: payloadText,
      timestamp: new Date().toISOString(),
      channel,
    };

    if (channel !== 'public') {
      const pair = this.gunService.getStoredPair();
      if (!pair) {
        throw new Error('No SEA keypair — call ensureKeypairAndAuth first');
      }
      const otherId = opts?.otherUserId ?? (await this.getOtherParticipantId(conversationId, senderId));
      if (!otherId) {
        throw new Error('Could not resolve recipient for encrypted channel');
      }
      const epub = await this.getUserEpub(otherId);
      if (!epub) {
        throw new Error('Recipient has no epub published');
      }
      const SEA = getSEA();
      const secret = await SEA.secret(epub, pair);
      payloadText = await SEA.encrypt(text, secret);
      messageData = {
        id: messageId,
        senderId,
        text: payloadText,
        timestamp: new Date().toISOString(),
        channel,
      };
    }

    gun.get(`conversations/${conversationId}`).get('messages').get(messageId).put(messageData);

    console.log(`📤 Message sent in conversation ${conversationId} (${channel})`);
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
          void this.collectAndDecryptMessages(conversationId, processedMessages, callback);
        }, 300);
      });

    return () => {
      console.log(`👋 Unsubscribed from conversation ${conversationId}`);
    };
  }

  private async collectAndDecryptMessages(
    conversationId: string,
    processedMessages: Set<string>,
    callback: (messages: Message[]) => void,
  ): Promise<void> {
    const gun = this.gunService.getGun();
    const pair = this.gunService.getStoredPair();
    const ids = Array.from(processedMessages);
    const messagesArray: Message[] = [];

    for (const msgId of ids) {
      const msg = await new Promise<any>((resolve) => {
        gun
          .get(`conversations/${conversationId}`)
          .get('messages')
          .get(msgId)
          .once((data: any) => resolve(data));
      });
      if (!msg || !msg.text) continue;

      let text = String(msg.text);
      const ch = (msg.channel as Message['channel']) || 'public';

      if (ch !== 'public' && pair) {
        const SEA = getSEA();
        const senderEpub = await this.getUserEpub(String(msg.senderId));
        if (senderEpub) {
          try {
            const secret = await SEA.secret(senderEpub, pair as GunPair);
            const dec = await SEA.decrypt(text, secret);
            if (dec) {
              text = typeof dec === 'string' ? dec : String(dec);
            }
          } catch {
            /* leave ciphertext */
          }
        }
      }

      messagesArray.push({
        id: msg.id || msgId,
        senderId: msg.senderId,
        text,
        isFromChatbot: !!msg.isFromChatbot,
        questionId: msg.questionId,
        answerId: msg.answerId,
        timestamp: new Date(msg.timestamp),
        readBy: msg.readBy || [],
        channel: ch,
      });
    }

    messagesArray.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    callback(messagesArray);
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
