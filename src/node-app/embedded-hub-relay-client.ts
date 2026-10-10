import { classifyServerConnectorPath } from '../shared/p2p-runtime';
import type { User } from '../shared/types';
import type { TechSupportStoredMessage } from '../server/services/techsupport-message-store';
import type { MailboxEnvelope } from '../server/services/mailbox-store';
import type { PlaceAdmissionClaim } from '../shared/place-admission-evidence';

export type RelayRoomMember = {
  userId: string;
  stageName: string;
  isTraveler?: boolean;
};

export type PlaceAdmissionReservation = {
  reservationToken: string;
  expiresAt: string;
};

export class EmbeddedHubRelayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddedHubRelayRequestError';
  }
}

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
  isTraveler?: boolean;
  admissionClaim?: PlaceAdmissionClaim;
};

export type RelayTurnCredentials = {
  username: string;
  credential: string;
  ttl: number;
  urls: string[];
};

export interface EmbeddedHubRelayClientLike {
  listMembers(chatroomId: string): Promise<RelayRoomMember[]>;
  addMember(
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler?: boolean,
    reservationToken?: string,
  ): Promise<void>;
  reservePlaceMember?(
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler?: boolean,
    admissionClaim?: PlaceAdmissionClaim,
  ): Promise<PlaceAdmissionReservation>;
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
  /** Targeted (remote) delegate invites — optional like postDelegateGrant. */
  postTargetedDelegateInvite?(invite: unknown): Promise<void>;
  getTargetedDelegateInvite?(targetPub: string): Promise<unknown | null>;
  /**
   * OPEN-29: same "embedded node dials the hub for discovery only" gap, one layer up — a native
   * device needs to be able to discover a published recovery anchor record too, arguably more
   * urgently than a delegate grant during an actual incident. Optional (like postDelegateGrant)
   * so existing EmbeddedHubRelayClientLike test doubles don't need updating to keep compiling.
   */
  listRecoveryAnchors?(): Promise<unknown[]>;
  postRecoveryAnchor?(record: unknown): Promise<void>;
  getFaqBundle(): Promise<unknown | null>;
  postFaqBundle(bundle: unknown): Promise<void>;
  /**
   * docs/TODO.md OPEN-31: per-entry FAQ records, addressed by questionKey. Optional (like the
   * recovery methods) so existing EmbeddedHubRelayClientLike test doubles keep compiling.
   */
  getFaqEntry?(questionKey: string): Promise<unknown | null>;
  listFaqEntries?(limit?: number): Promise<unknown[]>;
  postFaqEntry?(entry: unknown): Promise<void>;
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
  /**
   * §16.5/§16.8 attestation verifier — same "the embedded node must never hold the secret" shape
   * as getTurnCredentials above (see that method's doc comment: an on-device server's own apiBase
   * IS its local loopback origin, so the client always calls its own embedded server first). The
   * verifier's ECDSA signing key is exactly that kind of secret: baking it into every distributed
   * APK would let anyone extract it and forge a passing `OfficialBuildCredential` for a modified
   * build, defeating the entire point of the check. So the embedded node holds no verifier key at
   * all (attestation-routes.ts's own `ATTESTATION_VERIFIER_KEY_FILE`-gated startup already 503s
   * locally when unset) and instead forwards the three attestation routes to the real hub over
   * this same relay client, exactly like TURN credentials.
   *
   * Unlike every other relay method on this interface, these three surface the hub's exact HTTP
   * status and body rather than throwing generically on a non-2xx response (`request()`'s usual
   * behavior) or silently falling back to a soft default (TURN's STUN-only fallback) — a failed
   * attestation attempt has a specific, meaningful reason (expired challenge, wrong package,
   * unofficial signing key, …) that the phone's own UI should be able to surface, not swallow.
   * Optional, matching the rest of this interface's newer additions, so existing
   * EmbeddedHubRelayClientLike test doubles keep compiling without updating them.
   */
  postAttestationChallenge?(body: unknown): Promise<{ status: number; body: unknown }>;
  postAttestationVerify?(body: unknown): Promise<{ status: number; body: unknown }>;
  getAttestationVerifierKeys?(): Promise<{ status: number; body: unknown }>;
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
        const record = row as { userId?: unknown; stageName?: unknown; isTraveler?: unknown };
        const userId = String(record.userId || '').trim();
        if (!userId) return null;
        return {
          userId,
          stageName: String(record.stageName || userId),
          ...(typeof record.isTraveler === 'boolean' ? { isTraveler: record.isTraveler } : {}),
        };
      })
      .filter((row): row is RelayRoomMember => row !== null);
  }

  async addMember(
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler = false,
    reservationToken?: string,
  ): Promise<void> {
    assertRelayMetadataPath(['chatrooms', chatroomId, 'users', userId]);
    await this.request(`/api/chatrooms/${encodeURIComponent(chatroomId)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        stageName: stageName || userId,
        isTraveler,
        ...(reservationToken ? { reservationToken } : {}),
      }),
    });
  }

  async reservePlaceMember(
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler = false,
    admissionClaim?: PlaceAdmissionClaim,
  ): Promise<PlaceAdmissionReservation> {
    assertRelayMetadataPath(['chatrooms', chatroomId, 'users', userId]);
    const response = await this.request(`/api/chatrooms/${encodeURIComponent(chatroomId)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        stageName: stageName || userId,
        isTraveler,
        reserveOnly: true,
        ...(admissionClaim ? { admissionClaim } : {}),
      }),
    });
    return response.json() as Promise<PlaceAdmissionReservation>;
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

  async postTargetedDelegateInvite(invite: unknown): Promise<void> {
    await this.request('/api/support/delegate-invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invite),
    });
  }

  async getTargetedDelegateInvite(targetPub: string): Promise<unknown | null> {
    const response = await this.request(`/api/support/delegate-invites/${encodeURIComponent(targetPub)}`);
    return response.ok ? await response.json() : null;
  }

  async listDelegateGrants(): Promise<unknown[]> {
    const response = await this.request('/api/support/delegate-grants');
    const body = (await response.json()) as { grants?: unknown[]; revocations?: unknown[] };
    return [
      ...(Array.isArray(body.grants) ? body.grants : []),
      ...(Array.isArray(body.revocations) ? body.revocations : []),
    ];
  }

  async postRecoveryAnchor(record: unknown): Promise<void> {
    await this.request('/api/support/recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  }

  async listRecoveryAnchors(): Promise<unknown[]> {
    const response = await this.request('/api/support/recovery');
    const body = (await response.json()) as { current?: unknown; history?: unknown[] };
    return [
      ...(body.current ? [body.current] : []),
      ...(Array.isArray(body.history) ? body.history : []),
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

  async getFaqEntry(questionKey: string): Promise<unknown | null> {
    const response = await this.request(`/api/support/faq-entries/${encodeURIComponent(questionKey)}`);
    const body = (await response.json()) as { entry?: unknown };
    return body.entry ?? null;
  }

  async listFaqEntries(limit?: number): Promise<unknown[]> {
    const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    const response = await this.request(`/api/support/faq-entries${query}`);
    const body = (await response.json()) as { entries?: unknown[] };
    return Array.isArray(body.entries) ? body.entries : [];
  }

  async postFaqEntry(entry: unknown): Promise<void> {
    await this.request('/api/support/faq-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
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

  async postAttestationChallenge(body: unknown): Promise<{ status: number; body: unknown }> {
    return this.forwardJson('/api/attestation/challenge', 'POST', body);
  }

  async postAttestationVerify(body: unknown): Promise<{ status: number; body: unknown }> {
    return this.forwardJson('/api/attestation/verify', 'POST', body);
  }

  async getAttestationVerifierKeys(): Promise<{ status: number; body: unknown }> {
    return this.forwardJson('/api/attestation/verifier-keys', 'GET');
  }

  /**
   * Like `request()` below, but returns the hub's status/body instead of throwing on a non-2xx
   * response — see the doc comment on the three attestation methods above for why this route
   * family needs the real status preserved rather than either a thrown error or a soft fallback.
   */
  private async forwardJson(path: string, method: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        ...(body !== undefined
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        signal: controller.signal,
      });
      const parsed = await response.json().catch(() => ({}));
      return { status: response.status, body: parsed };
    } finally {
      clearTimeout(timer);
    }
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
        throw new EmbeddedHubRelayRequestError(
          response.status,
          text,
          `embedded hub relay ${init.method || 'GET'} ${path} failed with ${response.status}: ${text.slice(0, 200)}`,
        );
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}
