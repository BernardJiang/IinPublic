import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import type { SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';

/** Wire shape shared by P2P transports when persisting to Gun (REQ-P2P-01). */
export type ConversationMessageWire = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
  transport?: string;
  encryption?: 'sea-ecdh-v1';
  prevSeen?: string;
  isFromChatbot?: boolean;
};

/**
 * Gun-on-device message persistence — the durable source of truth for
 * `conversations/<id>/messages` (and pair-private `pairConversations/...`), per spec
 * §19.4. Builds/persists outbound messages, writes message records idempotently, and
 * subscribes to + decrypts the conversation graph.
 *
 * This is the store that `DirectP2PConversationTransport` writes through (WebRTC is
 * notify/sync only). It is intentionally NOT a `ConversationTransport`: the
 * `mode`/`sendMessage` "transport" facade lives in `StarGunConversationTransport`,
 * which extends this class. Splitting the two (P2P-messaging Phase 2) keeps the Gun
 * persistence role distinct from the star-fallback transport role.
 */
export class GunMessageStore {
  /** Default transport label for records that don't carry their own (overridden by subclasses). */
  mode: ConversationTransportMode = 'direct-p2p';

  /**
   * Tracks the most-recent message id from the *other* participant, keyed by
   * `${conversationId}:${myUserId}`. Updated by subscribeToMessages when
   * myUserId is provided; read by buildAndPersistMessage to populate prevSeen.
   */
  private lastSeenFromOther = new Map<string, string>();

  constructor(protected gunService: WebGunService) {}

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

  private pairIdForUsers(userA: string, userB: string): string {
    return [String(userA || '').trim(), String(userB || '').trim()].sort().join('__');
  }

  private async getPairMessageRoot(conversationId: string, myId: string, otherUserId?: string): Promise<any | null> {
    const otherId = otherUserId || (await this.getOtherParticipantId(conversationId, myId));
    if (!otherId) return null;
    return this.gunService
      .getGun()
      .get('pairConversations')
      .get(this.pairIdForUsers(myId, otherId))
      .get(conversationId)
      .get('messages');
  }

  private async getPairMessageSecret(conversationId: string, myId: string, peerUserId?: string): Promise<string> {
    const pair = this.gunService.getStoredPair();
    if (!pair) {
      throw new Error('No SEA keypair — call ensureKeypairAndAuth first');
    }
    const otherId = peerUserId || (await this.getOtherParticipantId(conversationId, myId));
    if (!otherId) {
      throw new Error('Could not resolve recipient for encrypted channel');
    }
    const epub = await this.getUserEpub(otherId);
    if (!epub) {
      throw new Error('Recipient has no epub published');
    }
    return getSEA().secret(epub, pair);
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
    const messageId = String(opts?.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    const prevSeen = this.lastSeenFromOther.get(`${conversationId}:${senderId}`) ?? undefined;
    const otherUserId = opts?.otherUserId ?? (await this.getOtherParticipantId(conversationId, senderId));

    let payloadText = text;
    const shouldEncrypt = channel !== 'public' || transport === 'direct-p2p';
    const base: ConversationMessageWire = {
      id: messageId,
      senderId,
      text: payloadText,
      timestamp: new Date().toISOString(),
      channel,
      transport,
      ...(opts?.isFromChatbot ? { isFromChatbot: true } : {}),
      ...(prevSeen !== undefined ? { prevSeen } : {}),
    };

    if (shouldEncrypt) {
      const secret = await this.getPairMessageSecret(conversationId, senderId, otherUserId);
      payloadText = await getSEA().encrypt(text, secret);
      base.text = payloadText;
      base.encryption = 'sea-ecdh-v1';
    }

    this.putMessageRecord(
      conversationId,
      base,
      otherUserId ? { otherUserId } : {},
    );
    return base;
  }

  /** Idempotent write of a message node to local Gun (and hub sync during migration). */
  putMessageRecord(conversationId: string, wire: ConversationMessageWire, opts: { otherUserId?: string } = {}): void {
    const gun = this.gunService.getGun();
    const record = {
      id: wire.id,
      senderId: wire.senderId,
      text: wire.text,
      timestamp: wire.timestamp,
      channel: wire.channel,
      transport: wire.transport ?? this.mode,
      ...(wire.encryption ? { encryption: wire.encryption } : {}),
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
      ...(wire.isFromChatbot ? { isFromChatbot: true } : {}),
    };
    if (wire.transport === 'direct-p2p' && opts.otherUserId) {
      gun
        .get('pairConversations')
        .get(this.pairIdForUsers(wire.senderId, opts.otherUserId))
        .get(conversationId)
        .get('messages')
        .get(wire.id)
        .put(record);
      return;
    }
    gun.get(`conversations/${conversationId}`).get('messages').get(wire.id).put(record);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): () => void {
    const gun = this.gunService.getGun();
    const processedMessages = new Set<string>();

    const subscribeRoot = (root: any) => root
      .get(`conversations/${conversationId}`)
      .get('messages')
      .map()
      .on((_messageData: any, messageId: string) => {
        if (!messageId || messageId.startsWith('_')) return;
        if (processedMessages.has(messageId)) return;

        processedMessages.add(messageId);
        setTimeout(() => {
          void this.collectAndDecryptMessages(conversationId, processedMessages, callback, myUserId, otherUserId);
        }, 300);
      });

    subscribeRoot(gun);
    if (myUserId) {
      void this.getPairMessageRoot(conversationId, myUserId, otherUserId).then((root) => {
        if (!root) return;
        root.map().on((_messageData: any, messageId: string) => {
          if (!messageId || messageId.startsWith('_')) return;
          if (processedMessages.has(messageId)) return;

          processedMessages.add(messageId);
          setTimeout(() => {
            void this.collectAndDecryptMessages(conversationId, processedMessages, callback, myUserId, otherUserId);
          }, 300);
        });
      }).catch(() => undefined);
    }

    return () => {
      console.log(`👋 Unsubscribed from user ${conversationId} messages (${this.mode})`);
    };
  }

  private async collectAndDecryptMessages(
    conversationId: string,
    processedMessages: Set<string>,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): Promise<void> {
    const gun = this.gunService.getGun();
    const pair = this.gunService.getStoredPair();
    const ids = Array.from(processedMessages);
    const messagesArray: Message[] = [];
    const otherId = myUserId ? otherUserId || await this.getOtherParticipantId(conversationId, myUserId) : undefined;
    const pairRoot = myUserId ? await this.getPairMessageRoot(conversationId, myUserId, otherId) : null;

    for (const msgId of ids) {
      const msg = await new Promise<any>((resolve) => {
        if (pairRoot) {
          pairRoot.get(msgId).once((pairData: any) => {
            if (pairData?.text) {
              resolve(pairData);
              return;
            }
            gun
              .get(`conversations/${conversationId}`)
              .get('messages')
              .get(msgId)
              .once((data: any) => resolve(data));
          });
          return;
        }
        gun
          .get(`conversations/${conversationId}`)
          .get('messages')
          .get(msgId)
          .once((data: any) => resolve(data));
      });
      if (!msg || !msg.text) continue;

      let text = String(msg.text);
      const ch = (msg.channel as Message['channel']) || 'public';

      if ((ch !== 'public' || msg.encryption === 'sea-ecdh-v1') && pair) {
        const SEA = getSEA();
        const peerForSecret = myUserId && String(msg.senderId) === myUserId ? otherId : String(msg.senderId);
        const peerEpub = peerForSecret ? await this.getUserEpub(peerForSecret) : undefined;
        if (peerEpub) {
          try {
            const secret = await SEA.secret(peerEpub, pair as GunPair);
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
