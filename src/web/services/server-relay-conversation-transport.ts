import type { Message } from '../../shared/types';
import { createDirectP2PMessageEnvelope, SIGNALING_TTL_SECONDS } from '../../shared/p2p-runtime';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';
import { encodeSignalingPayload, decodeSignalingPayload } from './p2p-signaling-client';
import { P2PConversationRelayClient } from './p2p-conversation-relay-client';
import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';

type RelayWireMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
  prevSeen?: string;
  isFromChatbot?: boolean;
};

export class ServerRelayConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'server-relay';

  private readonly apiBase: string;
  private readonly relay: P2PConversationRelayClient;
  private readonly participantCache = new Map<string, string>();
  private readonly messagesByConversation = new Map<string, Message[]>();
  private readonly lastSeenFromOther = new Map<string, string>();

  constructor(private gunService: WebGunService, apiBase?: string) {
    this.apiBase = apiBase || DirectP2PConversationTransport.resolveApiBase();
    this.relay = new P2PConversationRelayClient(this.apiBase);
  }

  private async getLocalPub(): Promise<string> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) throw new Error('No SEA keypair');
    return String(pair.pub);
  }

  private async resolveOtherUserId(
    conversationId: string,
    myId: string,
    hint?: string,
  ): Promise<string> {
    if (hint) return hint;
    const cached = this.participantCache.get(`${conversationId}:${myId}`);
    if (cached) return cached;
    const gun = this.gunService.getGun();
    const otherId = await new Promise<string | undefined>((resolve) => {
      gun.get(`conversations/${conversationId}`).once((d: { data?: string }) => {
        if (!d?.data) {
          resolve(undefined);
          return;
        }
        try {
          const c = JSON.parse(d.data) as { participants?: string[] };
          resolve((c.participants || []).find((p) => p !== myId));
        } catch {
          resolve(undefined);
        }
      });
    });
    if (!otherId) throw new Error('Could not resolve other participant');
    this.participantCache.set(`${conversationId}:${myId}`, otherId);
    return otherId;
  }

  private async getUserPub(userId: string, attempts = 20): Promise<string> {
    for (let i = 0; i < attempts; i++) {
      const user = await this.gunService.getPublicUser(userId);
      if (user.pub) return String(user.pub);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`User ${userId} has no pub`);
  }

  private getMessages(conversationId: string): Message[] {
    return [...(this.messagesByConversation.get(conversationId) || [])].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }

  private ingest(conversationId: string, wire: RelayWireMessage, localUserId?: string): void {
    const msg: Message = {
      id: wire.id,
      senderId: wire.senderId,
      text: wire.text,
      timestamp: new Date(wire.timestamp),
      channel: (wire.channel as Message['channel']) || 'public',
      readBy: [],
      isFromChatbot: !!wire.isFromChatbot,
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
    };
    const bucket = this.messagesByConversation.get(conversationId) || [];
    if (bucket.some((m) => m.id === msg.id)) return;
    bucket.push(msg);
    this.messagesByConversation.set(conversationId, bucket);
    if (localUserId && wire.senderId !== localUserId) {
      this.lastSeenFromOther.set(`${conversationId}:${localUserId}`, wire.id);
    }
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const localPub = await this.getLocalPub();
    const otherId = await this.resolveOtherUserId(conversationId, senderId, opts?.otherUserId);
    const otherPub = await this.getUserPub(otherId);
    const prevSeen =
      this.lastSeenFromOther.get(`${conversationId}:${senderId}`) ?? undefined;
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const wire: RelayWireMessage = {
      id: messageId,
      senderId,
      text,
      timestamp: new Date().toISOString(),
      channel,
      ...(prevSeen !== undefined ? { prevSeen } : {}),
    };
    const envelope = createDirectP2PMessageEnvelope({
      conversationId,
      messageId,
      senderPub: localPub,
      recipientPub: otherPub,
      bodyCiphertext: encodeSignalingPayload(wire),
      signature: `sig_${localPub}_${Date.now()}`,
      nonce: `nonce_${localPub}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      expiresAt: new Date(Date.now() + SIGNALING_TTL_SECONDS * 1000).toISOString(),
    });
    await this.relay.post(conversationId, envelope);
    this.ingest(conversationId, wire, senderId);
    console.log(`📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})`);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
  ): () => void {
    if (!myUserId) {
      callback([]);
      return () => undefined;
    }

    let stopRelayPoll: (() => void) | null = null;
    const listeners = new Set<(messages: Message[]) => void>();
    listeners.add(callback);
    callback(this.getMessages(conversationId));

    const notify = () => {
      const snapshot = this.getMessages(conversationId);
      for (const listener of listeners) listener(snapshot);
    };

    void this.getLocalPub()
      .then((localPub) => {
        stopRelayPoll = this.relay.startPolling(conversationId, localPub, async (envelope) => {
          if (!envelope.bodyCiphertext) return;
          try {
            const wire = decodeSignalingPayload(envelope.bodyCiphertext) as RelayWireMessage;
            if (!wire?.id || !wire.senderId) return;
            this.ingest(conversationId, wire, myUserId);
            notify();
          } catch {
            // ignore malformed relay payloads
          }
        });
      })
      .catch(() => callback([]));

    return () => {
      listeners.delete(callback);
      stopRelayPoll?.();
      console.log(`👋 Unsubscribed from conversation ${conversationId} messages (${this.mode})`);
    };
  }
}
