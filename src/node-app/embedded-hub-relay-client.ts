import { classifyServerConnectorPath } from '../shared/p2p-runtime';
import type { User } from '../shared/types';

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

export interface EmbeddedHubRelayClientLike {
  listMembers(chatroomId: string): Promise<RelayRoomMember[]>;
  addMember(chatroomId: string, userId: string, stageName?: string): Promise<void>;
  touchMember(chatroomId: string, userId: string, options?: TouchMemberOptions): Promise<void>;
  removeMember(chatroomId: string, userId: string): Promise<void>;
  listSignalingFrames(conversationId: string, recipientPub?: string): Promise<SignalingRelayFrame[]>;
  postSignalingFrame(conversationId: string, frame: SignalingRelayFrame): Promise<void>;
  getPublicUser(userId: string): Promise<Partial<User> | null>;
  upsertPublicUser(user: Partial<User> & { id: string }): Promise<void>;
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
