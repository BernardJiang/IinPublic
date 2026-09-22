import { classifyServerConnectorPath } from '../shared/p2p-runtime';
import type { User } from '../shared/types';
import type { TechSupportStoredMessage } from '../server/services/techsupport-message-store';
import type { MailboxEnvelope } from '../server/services/mailbox-store';

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
  /**
   * docs/TODO.md K7 follow-on: the delegate-request/grant/FAQ-bundle paths have the exact same
   * "embedded node dials the hub for discovery only" gap the two relays above were built to
   * close — a candidate's signed delegate request, and a delegate's published FAQ-bundle answer,
   * are plain Gun writes that never reach the real hub's graph from a native device without an
   * explicit relay, and a native device can never read the delegate roster or FAQ bundle back
   * without one either (found via a real-hardware test: 09-android-techsupport-delegate-answers).
   */
  postDelegateRequest(request: unknown): Promise<void>;
  postDelegateGrant?(grant: unknown): Promise<void>;
  listDelegateGrants(): Promise<unknown[]>;
  getFaqBundle(): Promise<unknown | null>;
  postFaqBundle(bundle: unknown): Promise<void>;
  /**
   * docs/TODO.md K7 follow-on, second layer: `mailbox-routes.ts`'s generic store
   * (`MailboxStore`) is per-server in-memory with NO relay — only mail addressed to
   * `TECHSUPPORT_ROOT_USER_ID` gets the durable, hub-visible `TechSupportDurableStore` instead.
   * A delegate is an ORDINARY user id, so fan-out mail addressed to one lands in the generic
   * store — invisible to the delegate's own separate device/process without this relay. Same
   * real-hardware finding as the two relays above (09-android-techsupport-delegate-answers).
   */
  postMailboxEnvelope(recipientId: string, envelope: { id: string; ciphertext: string; ttlMs?: number }): Promise<void>;
  listMailboxEnvelopes(recipientId: string): Promise<MailboxEnvelope[]>;
  /**
   * Generic counterpart to the bespoke relays above, for src/server/routes/graph-relay-routes.ts's
   * small allowlist of opaque-JSON-blob Gun paths (identity-linking, WP5 device-sync — see that
   * file's own doc comment). One pair of methods instead of one bespoke pair per path: every path
   * on the allowlist has the identical shape (write once, read back, no server-side validation).
   */
  getGraphBlob(segments: readonly string[]): Promise<unknown | null>;
  putGraphBlob(segments: readonly string[], data: unknown): Promise<void>;
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

  async postDelegateRequest(request: unknown): Promise<void> {
    await this.request('/api/support/delegate-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  async postDelegateGrant(grant: unknown): Promise<void> {
    await this.request('/api/support/delegate-grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grant),
    });
  }

  async listDelegateGrants(): Promise<unknown[]> {
    const response = await this.request('/api/support/delegate-grants');
    const body = (await response.json()) as { grants?: unknown[]; revocations?: unknown[] };
    return [
      ...(Array.isArray(body.grants) ? body.grants : []),
      ...(Array.isArray(body.revocations) ? body.revocations : []),
    ];
  }

  async getFaqBundle(): Promise<unknown | null> {
    const response = await this.request('/api/support/faq-bundle');
    const body = (await response.json()) as { bundle?: unknown };
    return body.bundle ?? null;
  }

  async postFaqBundle(bundle: unknown): Promise<void> {
    await this.request('/api/support/faq-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });
  }

  async postMailboxEnvelope(recipientId: string, envelope: { id: string; ciphertext: string; ttlMs?: number }): Promise<void> {
    await this.request(`/api/mailbox/${encodeURIComponent(recipientId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
  }

  async listMailboxEnvelopes(recipientId: string): Promise<MailboxEnvelope[]> {
    const response = await this.request(`/api/mailbox/${encodeURIComponent(recipientId)}`);
    const body = (await response.json()) as { envelopes?: unknown[] };
    return Array.isArray(body.envelopes)
      ? (body.envelopes.filter((e): e is MailboxEnvelope => !!e && typeof e === 'object') as MailboxEnvelope[])
      : [];
  }

  async getGraphBlob(segments: readonly string[]): Promise<unknown | null> {
    const response = await this.request(`/api/relay/graph/${segments.map(encodeURIComponent).join('/')}`);
    const body = (await response.json()) as { data?: unknown };
    return body.data ?? null;
  }

  async putGraphBlob(segments: readonly string[], data: unknown): Promise<void> {
    await this.request(`/api/relay/graph/${segments.map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
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
