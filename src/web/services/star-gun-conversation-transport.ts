import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';

/** Wire shape shared by P2P transports when persisting to Gun (REQ-P2P-01). */
export type ConversationMessageWire = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
  transport?: string;
  prevSeen?: string;
  isFromChatbot?: boolean;
};

export class StarGunConversationTransport implements ConversationTransport {
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

  /**
   * Build outbound wire + Gun record, persist locally, return wire for P2P notify (P2P-H).
   */
  async buildAndPersistMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions & { transport?: ConversationTransportMode },
  ): Promise<ConversationMessageWire> {
    const channel = opts?.channel ?? 'public';
    const transport = opts?.transport ?? this.mode;
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const prevSeen = this.lastSeenFromOther.get(`${conversationId}:${senderId}`) ?? undefined;

    let payloadText = text;
    const base: ConversationMessageWire = {
      id: messageId,
      senderId,
      text: payloadText,
      timestamp: new Date().toISOString(),
      channel,
      transport,
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
      base.text = payloadText;
    }

    this.putMessageRecord(conversationId, base);
    return base;
  }

  /** Idempotent write of a message node to local Gun (and hub sync during migration). */
  putMessageRecord(conversationId: string, wire: ConversationMessageWire): void {
    const gun = this.gunService.getGun();
    gun.get(`conversations/${conversationId}`).get('messages').get(wire.id).put({
      id: wire.id,
      senderId: wire.senderId,
      text: wire.text,
      timestamp: wire.timestamp,
      channel: wire.channel,
      transport: wire.transport ?? this.mode,
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
      ...(wire.isFromChatbot ? { isFromChatbot: true } : {}),
    });
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const wire = await this.buildAndPersistMessage(conversationId, senderId, text, opts);
    console.log(
      `📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})${wire.prevSeen ? ` prevSeen=${wire.prevSeen}` : ''}`,
    );
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
