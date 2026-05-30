import type { Message } from '../../shared/types';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { WebGunService } from './web-gun-service';
import { getOrCreateP2PSession, getP2PSession } from './p2p-webrtc-session';
import type { P2PConnectionState } from './p2p-webrtc-session';

export class DirectP2PConversationTransport implements ConversationTransport {
  mode: ConversationTransportMode = 'direct-p2p';

  private readonly apiBase: string;
  private readonly participantCache = new Map<string, string>();

  constructor(
    private gunService: WebGunService,
    apiBase?: string,
  ) {
    this.apiBase = apiBase || DirectP2PConversationTransport.resolveApiBase();
  }

  /** Same port mapping as IinPublicApp.getBackendApiBase(). */
  static resolveApiBase(): string {
    if (typeof window === 'undefined') {
      const envPort =
        typeof process !== 'undefined' && process.env?.PORT
          ? parseInt(process.env.PORT, 10)
          : 8080;
      return `http://127.0.0.1:${Number.isFinite(envPort) ? envPort : 8080}`;
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

  getConnectionState(conversationId: string, localUserId: string): P2PConnectionState {
    return getP2PSession(conversationId, localUserId)?.getState() ?? 'idle';
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

  private async sessionFor(
    conversationId: string,
    localUserId: string,
    otherUserId?: string,
  ) {
    const otherId = await this.resolveOtherUserId(conversationId, localUserId, otherUserId);
    const localPub = await this.getLocalPub();
    const otherPub = await this.getUserPub(otherId);
    const isInitiator = localUserId.localeCompare(otherId) < 0;
    return getOrCreateP2PSession({
      apiBase: this.apiBase,
      conversationId,
      localUserId,
      localPub,
      otherUserId: otherId,
      otherPub,
      isInitiator,
    });
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const session = await this.sessionFor(conversationId, senderId, opts?.otherUserId);
    await session.sendDm(senderId, text, channel);
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

    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    void this.sessionFor(conversationId, myUserId)
      .then((session) => {
        if (disposed) return;
        void session.ensureConnected().catch((err) => {
          console.warn(`Direct P2P connect failed for ${conversationId}:`, err);
        });
        unsubscribe = session.subscribe(callback);
      })
      .catch((err) => {
        console.warn(`Direct P2P session setup failed for ${conversationId}:`, err);
        callback([]);
      });

    return () => {
      disposed = true;
      unsubscribe?.();
      console.log(`👋 Unsubscribed from conversation ${conversationId} messages (${this.mode})`);
    };
  }
}
