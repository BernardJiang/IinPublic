import type { Message } from '../../shared/types';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';
import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';
import {
  StarGunConversationTransport,
  type ConversationMessageWire,
} from './star-gun-conversation-transport';

type SupportWire = ConversationMessageWire & { supportMessage?: boolean };

/**
 * P2P-N: TechSupport is the only server-durable chat channel (spec §19.7).
 * Gun local replica + server message store.
 */
export class TechSupportConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'star-gun';

  private readonly gunStore: StarGunConversationTransport;
  private readonly apiBase: string;

  constructor(
    gunService: WebGunService,
    apiBase?: string,
  ) {
    this.gunStore = new StarGunConversationTransport(gunService);
    this.apiBase = apiBase || DirectP2PConversationTransport.resolveApiBase();
  }

  private async persistToServer(conversationId: string, wire: SupportWire): Promise<void> {
    const res = await fetch(`${this.apiBase}/api/support/messages/${encodeURIComponent(conversationId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: wire.id,
        senderId: wire.senderId,
        text: wire.text,
        timestamp: wire.timestamp,
        channel: wire.channel,
      }),
    });
    if (!res.ok) {
      throw new Error(`TechSupport server persist failed: ${res.status}`);
    }
  }

  private async loadFromServer(conversationId: string): Promise<Message[]> {
    const res = await fetch(
      `${this.apiBase}/api/support/messages/${encodeURIComponent(conversationId)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      messages?: Array<{
        id: string;
        senderId: string;
        text: string;
        timestamp: string;
        channel?: string;
      }>;
    };
    return (body.messages || []).map((m) => ({
      id: m.id,
      senderId: m.senderId,
      text: m.text,
      timestamp: new Date(m.timestamp),
      channel: (m.channel as Message['channel']) || 'public',
      readBy: [],
      isFromChatbot: false,
    }));
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const wire = await this.gunStore.buildAndPersistMessage(conversationId, senderId, text, {
      ...opts,
      transport: this.mode,
    });
    const supportWire: SupportWire = { ...wire, supportMessage: true };
    await this.persistToServer(conversationId, supportWire);
    console.log(`📤 TechSupport message sent in ${conversationId}`);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
  ): () => void {
    let disposed = false;
    const mergeAndNotify = async (gunMessages: Message[]) => {
      if (disposed) return;
      const serverMessages = await this.loadFromServer(conversationId);
      const byId = new Map<string, Message>();
      for (const m of [...gunMessages, ...serverMessages]) {
        byId.set(m.id, m);
      }
      const merged = [...byId.values()].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );
      callback(merged);
    };

    const unsubscribeGun = this.gunStore.subscribeToMessages(
      conversationId,
      (msgs) => {
        void mergeAndNotify(msgs);
      },
      myUserId,
    );

    void this.loadFromServer(conversationId).then((serverOnly) => {
      if (!disposed && serverOnly.length) void mergeAndNotify(serverOnly);
    });

    const poll = setInterval(() => {
      void this.loadFromServer(conversationId).then((serverOnly) => {
        if (!disposed) void mergeAndNotify(serverOnly);
      });
    }, 5000);

    return () => {
      disposed = true;
      clearInterval(poll);
      unsubscribeGun();
    };
  }
}
