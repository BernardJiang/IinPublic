import { WebGunService } from './web-gun-service';
import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';

export type SendMessageOptions = {
  channel?: Message['channel'];
  /** If omitted, the other participant is inferred from the conversation record. */
  otherUserId?: string;
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
  ): () => void;
};

class StarGunConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'star-gun';

  /**
   * Tracks the most-recent message id from the *other* participant, keyed by
   * `${conversationId}:${myUserId}`. Updated by subscribeToMessages when
   * myUserId is provided; read by sendMessage to populate prevSeen.
   */
  private lastSeenFromOther = new Map<string, string>();

  constructor(private gunService: WebGunService) {}

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
    const user = await this.gunService.getPublicUser(userId);
    return user.epub;
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const gun = this.gunService.getGun();
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Two-writer DAG (REQ-LEDGER-08): attach the last message id from the other
    // participant that this sender had observed. Updated by subscribeToMessages.
    const prevSeen = this.lastSeenFromOther.get(`${conversationId}:${senderId}`) ?? undefined;

    let payloadText = text;
    let messageData: Record<string, unknown> = {
      id: messageId,
      senderId,
      text: payloadText,
      timestamp: new Date().toISOString(),
      channel,
      transport: this.mode,
      ...(prevSeen !== undefined ? { prevSeen } : {}),
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
        transport: this.mode,
        ...(prevSeen !== undefined ? { prevSeen } : {}),
      };
    }

    gun.get(`conversations/${conversationId}`).get('messages').get(messageId).put(messageData);
    console.log(`📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})${prevSeen ? ` prevSeen=${prevSeen}` : ''}`);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
  ): () => void {
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
        setTimeout(() => {
          void this.collectAndDecryptMessages(conversationId, processedMessages, callback, myUserId);
        }, 300);
      });

    return () => {
      console.log(`👋 Unsubscribed from user ${conversationId} messages (${this.mode})`);
    };
  }

  private async collectAndDecryptMessages(
    conversationId: string,
    processedMessages: Set<string>,
    callback: (messages: Message[]) => void,
    myUserId?: string,
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
        prevSeen: msg.prevSeen ?? undefined,
      });
    }

    messagesArray.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Two-writer DAG tracking (REQ-LEDGER-08): update lastSeenFromOther so
    // the next outgoing message from myUserId can carry the correct prevSeen link.
    if (myUserId) {
      for (const m of messagesArray) {
        if (m.senderId && m.senderId !== myUserId) {
          this.lastSeenFromOther.set(`${conversationId}:${myUserId}`, m.id);
        }
      }
    }

    callback(messagesArray);
  }
}

export class WebConversationService {
  private transport: ConversationTransport;

  constructor(private gunService: WebGunService, transport?: ConversationTransport) {
    this.transport = transport ?? new StarGunConversationTransport(gunService);
  }

  getTransportMode(): ConversationTransportMode {
    return this.transport.mode;
  }

  /**
   * Create a new conversation between two users after a match
   */
  createConversation(params: {
    userId1: string;
    userName1: string;
    userId2: string;
    userName2: string;
    talkId: string;
    respondedByBotForUser1?: boolean;
    respondedByBotForUser2?: boolean;
  }): Promise<string> {
    const gun = this.gunService.getGun();

    const sortedIds = [params.userId1, params.userId2].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${params.talkId}`;

    console.log(`💬 Creating conversation: ${conversationId}`);

    // Gun.put is idempotent — no need to .once()-check first.
    // Skipping the existence check eliminates a Gun round-trip that can stall
    // the match notification path for several seconds on a busy graph.
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

    gun.get(`users/${params.userId1}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: params.userId2,
      otherUserName: params.userName2,
      talkId: params.talkId,
      createdAt: new Date().toISOString(),
      respondedByBot: !!params.respondedByBotForUser1,
    });

    gun.get(`users/${params.userId2}`).get('conversations').get(conversationId).put({
      conversationId,
      otherUserId: params.userId1,
      otherUserName: params.userName1,
      talkId: params.talkId,
      createdAt: new Date().toISOString(),
      respondedByBot: !!params.respondedByBotForUser2,
    });

    console.log(`✅ Conversation created: ${conversationId}`);
    return Promise.resolve(conversationId);
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
    return this.transport.sendMessage(conversationId, senderId, text, opts);
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
  ): () => void {
    return this.transport.subscribeToMessages(conversationId, callback, myUserId);
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
          createdAt: normalized.createdAt || '',
          respondedByBot: !!normalized.respondedByBot,
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
