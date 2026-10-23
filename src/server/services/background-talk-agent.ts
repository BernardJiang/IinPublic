import fs from 'fs/promises';
import path from 'path';
import SEA from 'gun/sea';
import {
  appendBackgroundEvent,
  backgroundTalkPassesPolicy,
  classifyBackgroundResponse,
  resolveBackgroundTalkAnswers,
  responseIdForBackgroundAnswers,
  type BackgroundAgentEvent,
  type BackgroundTalkAgentConfig,
} from '../../shared/background-talk-agent';
import {
  isP2PMeshTalkBodyPayload,
  isP2PMeshTalkResponsePayload,
  type P2PMeshTalkResponsePayload,
} from '../../shared/p2p-mesh-protocol';

type SeaPair = { pub: string; priv: string; epub: string; epriv: string };
type RemoteEnvelope = { id: string; ciphertext: string };
const DISCARD_ENVELOPE = Symbol('discard-envelope');

export type BackgroundTalkAgentStatus = {
  provisioned: boolean;
  enabled: boolean;
  userId?: string;
  pendingEvents: number;
};

/** Android-only, loopback-owned background mailbox processor. */
export class BackgroundTalkAgent {
  private pair: SeaPair | null = null;
  private config: BackgroundTalkAgentConfig | null = null;
  private events: BackgroundAgentEvent[] = [];
  private drainPromise: Promise<BackgroundAgentEvent[]> | null = null;

  constructor(
    private readonly apiBase: string,
    private readonly journalPath: string,
    private readonly relayEnvelope?: (
      recipientId: string,
      envelope: { id: string; ciphertext: string },
    ) => Promise<void>,
  ) {}

  async provision(config: BackgroundTalkAgentConfig, pair: SeaPair): Promise<void> {
    if (config.version !== 1 || !config.userId || config.userId.length > 256) {
      throw new Error('invalid background agent configuration');
    }
    if (![pair.pub, pair.priv, pair.epub, pair.epriv].every((value) => typeof value === 'string' && value.length > 0)) {
      throw new Error('invalid SEA pair');
    }
    const identityChanged = this.pair?.pub !== pair.pub;
    this.pair = { ...pair };
    this.config = {
      ...config,
      userId: config.userId.trim(),
      stageName: config.stageName.trim().slice(0, 200),
      activeRoomId: config.activeRoomId.trim().slice(0, 256),
    };
    if (identityChanged) await this.loadJournal();
  }

  status(): BackgroundTalkAgentStatus {
    return {
      provisioned: !!this.pair && !!this.config,
      enabled: !!this.config?.enabled,
      ...(this.config?.userId ? { userId: this.config.userId } : {}),
      pendingEvents: this.events.length,
    };
  }

  listEvents(): BackgroundAgentEvent[] {
    return this.events.map((event) => structuredClone(event));
  }

  async acknowledge(eventIds: string[]): Promise<void> {
    const ids = new Set(eventIds.map(String));
    if (ids.size === 0) return;
    this.events = this.events.filter((event) => !ids.has(event.id));
    await this.saveJournal();
  }

  async drain(): Promise<BackgroundAgentEvent[]> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.drainOnce().finally(() => { this.drainPromise = null; });
    return this.drainPromise;
  }

  private async drainOnce(): Promise<BackgroundAgentEvent[]> {
    const config = this.config;
    const pair = this.pair;
    if (!config?.enabled || !pair || !config.activeRoomId) return [];
    const response = await fetch(`${this.apiBase}/api/mailbox/${encodeURIComponent(config.userId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`mailbox fetch failed: HTTP ${response.status}`);
    const body = await response.json() as { envelopes?: RemoteEnvelope[] };
    const created: BackgroundAgentEvent[] = [];
    for (const envelope of Array.isArray(body.envelopes) ? body.envelopes : []) {
      if (!envelope?.id || !envelope.ciphertext) continue;
      try {
        const payload = await this.decryptOuter(envelope.ciphertext, pair);
        const event = isP2PMeshTalkBodyPayload(payload as any)
          ? await this.processTalkBody(envelope.id, payload as any, config, pair)
          : isP2PMeshTalkResponsePayload(payload as any)
            ? await this.processTalkResponse(envelope.id, payload as P2PMeshTalkResponsePayload, config, pair)
            : null;
        if (event === DISCARD_ENVELOPE) {
          await this.deleteEnvelope(config.userId, envelope.id);
          continue;
        }
        if (!event) continue;
        this.events = appendBackgroundEvent(this.events, event);
        await this.saveJournal();
        await this.deleteEnvelope(config.userId, envelope.id);
        created.push(event);
      } catch (error) {
        // Leave the envelope for a later retry. Unsupported payloads intentionally reach here
        // only when malformed; other mailbox kinds are skipped above and remain for the UI.
        if (error instanceof UnsupportedEnvelopeError) continue;
        // eslint-disable-next-line no-console
        console.warn(`[background-agent] envelope ${envelope.id} retained:`, error);
      }
    }
    return created;
  }

  private async processTalkBody(
    envelopeId: string,
    payload: any,
    config: BackgroundTalkAgentConfig,
    pair: SeaPair,
  ): Promise<BackgroundAgentEvent | typeof DISCARD_ENVELOPE | null> {
    if (payload.authorId === config.userId || payload.roomId !== config.activeRoomId) return DISCARD_ENVELOPE;
    if (!backgroundTalkPassesPolicy(config, payload)) return DISCARD_ENVELOPE;
    try {
      const block = await fetch(
        `${this.apiBase}/api/users/${encodeURIComponent(config.userId)}/block-status/${encodeURIComponent(payload.authorId)}`,
        { cache: 'no-store' },
      );
      if (block.ok && !!((await block.json()) as { eitherBlocked?: boolean }).eitherBlocked) return DISCARD_ENVELOPE;
    } catch {
      // Match foreground behavior: an unavailable block-status lookup is not itself a block.
    }
    const answers = resolveBackgroundTalkAnswers(config, payload);
    let responsePayload: P2PMeshTalkResponsePayload | undefined;
    if (answers && answers.length > 0) {
      const authorEpub = String(payload.authorEpub || '').trim();
      if (!authorEpub) return null;
      const secret = await SEA.secret(authorEpub, pair as any);
      if (!secret) throw new Error('could not derive author secret');
      const responseId = await responseIdForBackgroundAnswers(payload.talkId, config.userId, answers);
      const now = new Date().toISOString();
      const payloadCiphertext = await SEA.encrypt(JSON.stringify({
        responderName: config.stageName,
        authorName: String(payload.authorName || payload.authorId),
        answers,
        isChatbotResponse: true,
        transportMode: 'mesh-p2p',
      }), secret);
      responsePayload = {
        responseId,
        talkId: payload.talkId,
        authorId: payload.authorId,
        responderId: config.userId,
        submittedAt: now,
        respondedAt: now,
        version: 1,
        encryption: 'sea-ecdh-v1',
        payloadCiphertext: String(payloadCiphertext),
        transportMode: 'mesh-p2p',
        responderEpub: pair.epub,
      };
      const outerCiphertext = await SEA.encrypt(JSON.stringify(responsePayload), secret);
      const envelope = {
        id: `mbx_${responseId}`,
        ciphertext: JSON.stringify({ senderEpub: pair.epub, ct: outerCiphertext }),
      };
      const post = await fetch(`${this.apiBase}/api/mailbox/${encodeURIComponent(payload.authorId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      if (post.status !== 201) throw new Error(`response mailbox post failed: HTTP ${post.status}`);
      // The generic embedded-node route relays asynchronously so the foreground UI stays fast.
      // An unattended outbox has a stronger contract: retain the incoming Talk until the shared
      // hub has accepted the response. Re-posting is idempotent on the deterministic envelope id.
      if (this.relayEnvelope) await this.relayEnvelope(payload.authorId, envelope);
    }
    const event: BackgroundAgentEvent = {
      version: 1,
      id: `background:${envelopeId}`,
      kind: 'incoming-talk',
      createdAt: new Date().toISOString(),
      envelopeId,
      payload,
      ...(answers && answers.length > 0 ? { answers } : {}),
      ...(responsePayload ? { response: responsePayload } : {}),
    };
    return event;
  }

  private async processTalkResponse(
    envelopeId: string,
    payload: P2PMeshTalkResponsePayload,
    config: BackgroundTalkAgentConfig,
    pair: SeaPair,
  ): Promise<BackgroundAgentEvent | null> {
    if (payload.authorId !== config.userId || !payload.responderEpub) return null;
    const secret = await SEA.secret(payload.responderEpub, pair as any);
    if (!secret) throw new Error('could not derive responder secret');
    const decrypted = await SEA.decrypt(payload.payloadCiphertext, secret);
    if (!decrypted) throw new Error('could not decrypt talk response');
    const privatePayload = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    const answers = Array.isArray((privatePayload as any)?.answers) ? (privatePayload as any).answers : [];
    const classification = classifyBackgroundResponse(config, payload, answers);
    if (!classification) return null;
    return {
      version: 1,
      id: `background:${envelopeId}`,
      kind: 'talk-response',
      createdAt: new Date().toISOString(),
      envelopeId,
      payload,
      ...classification,
    };
  }

  private async decryptOuter(ciphertext: string, pair: SeaPair): Promise<unknown> {
    let wrapper: { senderEpub?: string; ct?: string };
    try { wrapper = JSON.parse(ciphertext); } catch { throw new UnsupportedEnvelopeError(); }
    if (!wrapper.senderEpub || !wrapper.ct) throw new UnsupportedEnvelopeError();
    const secret = await SEA.secret(wrapper.senderEpub, pair as any);
    const decrypted = secret ? await SEA.decrypt(wrapper.ct, secret) : null;
    if (!decrypted) throw new Error('mailbox envelope decryption failed');
    return typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
  }

  private async deleteEnvelope(userId: string, envelopeId: string): Promise<void> {
    const deleted = await fetch(
      `${this.apiBase}/api/mailbox/${encodeURIComponent(userId)}/${encodeURIComponent(envelopeId)}`,
      { method: 'DELETE' },
    );
    if (!deleted.ok) throw new Error(`mailbox delete failed: HTTP ${deleted.status}`);
  }

  private async loadJournal(): Promise<void> {
    const pair = this.pair;
    if (!pair) return;
    try {
      const ciphertext = await fs.readFile(this.journalPath, 'utf8');
      const decrypted = await SEA.decrypt(ciphertext, pair as any);
      const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
      this.events = Array.isArray(parsed) ? parsed.slice(-500) : [];
    } catch {
      this.events = [];
    }
  }

  private async saveJournal(): Promise<void> {
    const pair = this.pair;
    if (!pair) return;
    await fs.mkdir(path.dirname(this.journalPath), { recursive: true });
    const ciphertext = await SEA.encrypt(JSON.stringify(this.events), pair as any);
    const temporary = `${this.journalPath}.tmp`;
    await fs.writeFile(temporary, String(ciphertext), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.journalPath);
  }
}

class UnsupportedEnvelopeError extends Error {}
