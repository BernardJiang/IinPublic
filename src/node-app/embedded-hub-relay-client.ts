import { classifyServerConnectorPath } from '../shared/p2p-runtime';
import type { User } from '../shared/types';
import type { TechSupportStoredMessage } from '../server/services/techsupport-message-store';

export type RelayRoomMember = {
  userId: string;
  stageName: string;
};

export type SignalingRelayFrame = {
  conversationId: string;
  kind: string;
  senderPeerId: string;
  senderPub: string;
  recipientPub: string;
  signalCiphertext: string;
  timestamp: string;
  payloadHash: string;
  signature: string;
  nonce: string;
  createdAt?: string;
  expiresAt?: string;
};

export type TouchMemberOptions = {
  stageName?: string;
  lastSeen?: string;
};

export type RelayTurnCredentials = {
  username: string;
  credential: string;
  ttl: number;
  urls: string[];
};

export interface EmbeddedHubRelayClientLike {
  listMembers(chatroomId: string): Promise<RelayRoomMember[]>;
  addMember(chatroomId: string, userId: string, stageName?: string): Promise<void>;
  touchMember(chatroomId: string, userId: string, options?: TouchMemberOptions): Promise<void>;
  removeMember(chatroomId: string, userId: string): Promise<void>;
  listSignalingFrames(conversationId: string, recipientPub?: string): Promise<SignalingRelayFrame[]>;
  postSignalingFrame(conversationId: string, frame: SignalingRelayFrame): Promise<void>;
  getPublicUser(userId: string): Promise<Partial<User> | null>;
  upsertPublicUser(user: Partial<User> & { id: string }): Promise<void>;
  getTurnCredentials(): Promise<RelayTurnCredentials>;
  /**
   * TechSupport is the one channel documented as server-durable regardless of transport
   * (spec §19.7) — an embedded node's own local techsupport-durable-store is real, but it is
   * also isolated per-instance by design (dodges an unrelated Gun radisk:false write bug), so
   * without this relay an embedded-node user's support messages never reach the real hub's
   * store a human operator elsewhere actually reads from. Best-effort like every other relay
   * call here: an embedded node stays usable offline, with only its own local copy, if the hub
   * is unreachable.
   */
  listSupportMessages(conversationId: string): Promise<TechSupportStoredMessage[]>;
  postSupportMessage(conversationId: string, message: TechSupportStoredMessage): Promise<void>;
}

export function assertRelayMetadataPath(path: string[] | string): void {
  const classification = classifyServerConnectorPath(path);
  if (classification.kind !== 'relay-metadata' || classification.serverCanPersistBody) {
    const printable = Array.isArray(path) ? path.join('/') : path;
    throw new Error(
      `embedded hub relay refuses non-metadata path "${printable}" (${classification.kind})`,
    );
  }
}

export class EmbeddedHubRelayClient implements EmbeddedHubRelayClientLike {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(params: { upstreamHubBaseUrl: string; requestTimeoutMs?: number }) {
    this.baseUrl = params.upstreamHubBaseUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = params.requestTimeoutMs ?? 2_500;
  }

  async listMembers(chatroomId: string): Promise<RelayRoomMember[]> {
    assertRelayMetadataPath(['chatrooms', chatroomId, 'users']);
    const response = await this.request(`/api/chatrooms/${encodeURIComponent(chatroomId)}/members`);
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const record = row as { userId?: unknown; stageName?: unknown };
        const userId = String(record.userId || '').trim();
        if (!userId) return null;
        return {
          userId,
          stageName: String(record.stageName || userId),
        };
      })
      .filter((row): row is RelayRoomMember => row !== null);
  }

  async addMember(chatroomId: string, userId: string, stageName?: string): Promise<void> {
    assertRelayMetadataPath(['chatrooms', chatroomId, 'users', userId]);
    await this.request(`/api/chatrooms/${encodeURIComponent(chatroomId)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, stageName: stageName || userId }),
    });
  }

  async touchMember(
    chatroomId: string,
    userId: string,
    options: TouchMemberOptions = {},
  ): Promise<void> {
    assertRelayMetadataPath(['chatrooms', chatroomId, 'users', userId]);
    await this.request(
      `/api/chatrooms/${encodeURIComponent(chatroomId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      },
    );
  }

  async removeMember(chatroomId: string, userId: string): Promise<void> {
    assertRelayMetadataPath(['chatrooms', chatroomId, 'users', userId]);
    await this.request(
      `/api/chatrooms/${encodeURIComponent(chatroomId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }

  async listSignalingFrames(
    conversationId: string,
    recipientPub?: string,
  ): Promise<SignalingRelayFrame[]> {
    const params = new URLSearchParams();
    if (recipientPub) params.set('recipientPub', recipientPub);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(
      `/api/p2p/signaling-relay/${encodeURIComponent(conversationId)}${suffix}`,
    );
    const body = (await response.json()) as { frames?: unknown[] };
    return Array.isArray(body.frames)
      ? body.frames.filter((frame): frame is SignalingRelayFrame => !!frame && typeof frame === 'object') as SignalingRelayFrame[]
      : [];
  }

  async postSignalingFrame(conversationId: string, frame: SignalingRelayFrame): Promise<void> {
    await this.request(`/api/p2p/signaling-relay/${encodeURIComponent(conversationId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frame),
    });
  }

  async getPublicUser(userId: string): Promise<Partial<User> | null> {
    const response = await this.request(`/api/users/${encodeURIComponent(userId)}`);
    return (await response.json()) as Partial<User>;
  }

  async upsertPublicUser(user: Partial<User> & { id: string }): Promise<void> {
    await this.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
  }

  async listSupportMessages(conversationId: string): Promise<TechSupportStoredMessage[]> {
    const response = await this.request(`/api/support/messages/${encodeURIComponent(conversationId)}`);
    const body = (await response.json()) as { messages?: unknown[] };
    return Array.isArray(body.messages)
      ? (body.messages.filter((m): m is TechSupportStoredMessage => !!m && typeof m === 'object') as TechSupportStoredMessage[])
      : [];
  }

  async postSupportMessage(conversationId: string, message: TechSupportStoredMessage): Promise<void> {
    await this.request(`/api/support/messages/${encodeURIComponent(conversationId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  }

  async getTurnCredentials(): Promise<RelayTurnCredentials> {
    const response = await this.request('/api/turn-credentials');
    const body = (await response.json()) as Partial<RelayTurnCredentials>;
    return {
      username: String(body.username || ''),
      credential: String(body.credential || ''),
      ttl: Number(body.ttl) || 0,
      urls: Array.isArray(body.urls) ? body.urls.filter((url): url is string => typeof url === 'string') : [],
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `embedded hub relay ${init.method || 'GET'} ${path} failed with ${response.status}: ${text.slice(0, 200)}`,
        );
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}
