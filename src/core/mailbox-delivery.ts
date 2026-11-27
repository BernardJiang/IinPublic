export interface MailboxPostResult {
  stored: boolean;
  error?: string;
}

export interface MailboxDeliveryTransport<SenderKey> {
  encryptForRecipient(recipientEpub: string, senderKey: SenderKey, payload: unknown): Promise<string>;
  postEnvelope(params: {
    id: string;
    recipientId: string;
    ciphertext: string;
    ttlMs?: number;
  }): Promise<MailboxPostResult>;
}

export interface MailboxDeliveryPorts<SenderKey> {
  senderKey(): SenderKey | undefined;
  resolveRecipientEpub(recipientId: string, knownEpub?: string): Promise<string>;
  transport(): MailboxDeliveryTransport<SenderKey>;
  sleep?: (delayMs: number) => Promise<void>;
  onEvent?: (event: MailboxDeliveryEvent) => void;
}

export interface MailboxDeliveryRequest {
  envelopeId: string;
  recipientId: string;
  payload: unknown;
  /** Trusted explicit key: bypasses ambient discovery (for example TechSupport trust anchors). */
  recipientEpub?: string;
  /** Discovery hint that the host may validate/cache before returning (for example a DM session key). */
  knownRecipientEpub?: string;
  ttlMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  context?: string;
}

export type MailboxDeliveryEvent =
  | {
      type: 'retrying';
      context: string;
      envelopeId: string;
      recipientId: string;
      attempt: number;
      delayMs: number;
      error: Error;
    }
  | {
      type: 'stored';
      context: string;
      envelopeId: string;
      recipientId: string;
      attempts: number;
    }
  | {
      type: 'failed';
      context: string;
      envelopeId: string;
      recipientId: string;
      attempts: number;
      error: Error;
    };

export type MailboxDeliveryResult =
  | { stored: true; envelopeId: string; recipientId: string; attempts: number }
  | { stored: false; envelopeId: string; recipientId: string; attempts: number; error: Error };

function deliveryError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function nonEmpty(value: string, name: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const mailboxEnvelopeId = {
  attachmentShare(messageId: string): string {
    return `mbx_share_${nonEmpty(messageId, 'messageId')}`;
  },
  blockSignal(signalId: string, recipientId: string): string {
    return `blocksig_${nonEmpty(signalId, 'signalId')}_${nonEmpty(recipientId, 'recipientId')}`;
  },
  conversationMessage(conversationId: string, messageId: string): string {
    return `mbx_dm_${nonEmpty(conversationId, 'conversationId')}_${nonEmpty(messageId, 'messageId')}`;
  },
  supportQuestion(questionKey: string, askedBy: string, recipientId: string): string {
    return `mbx_support_${nonEmpty(questionKey, 'questionKey')}_${nonEmpty(askedBy, 'askedBy')}_${nonEmpty(recipientId, 'recipientId')}`;
  },
};

/**
 * Portable encrypted-mailbox sender. The host supplies key custody, recipient-key discovery,
 * encryption/transport, and sleeping; the core owns rejection semantics, bounded retries and
 * per-recipient fan-out isolation.
 */
export class MailboxDeliveryService<SenderKey> {
  constructor(private readonly ports: MailboxDeliveryPorts<SenderKey>) {}

  hasSenderKey(): boolean {
    return this.ports.senderKey() != null;
  }

  private emit(event: MailboxDeliveryEvent): void {
    try {
      this.ports.onEvent?.(event);
    } catch {
      // Observability must never change whether an encrypted envelope is delivered.
    }
  }

  async deliver(request: MailboxDeliveryRequest): Promise<MailboxDeliveryResult> {
    const envelopeId = String(request.envelopeId || '').trim();
    const recipientId = String(request.recipientId || '').trim();
    const context = String(request.context || 'mailbox').trim() || 'mailbox';
    const senderKey = this.ports.senderKey();
    if (!senderKey || !envelopeId || !recipientId) {
      const error = new Error(!senderKey
        ? 'Mailbox sender key is unavailable'
        : !envelopeId ? 'Mailbox envelope id is required' : 'Mailbox recipient id is required');
      const result: MailboxDeliveryResult = { stored: false, envelopeId, recipientId, attempts: 0, error };
      this.emit({ type: 'failed', context, envelopeId, recipientId, attempts: 0, error });
      return result;
    }

    const requestedAttempts = Math.floor(request.maxAttempts ?? 1);
    const requestedDelayMs = Math.floor(request.retryDelayMs ?? 0);
    const maxAttempts = Number.isFinite(requestedAttempts) && requestedAttempts > 0 ? requestedAttempts : 1;
    const retryDelayMs = Number.isFinite(requestedDelayMs) && requestedDelayMs > 0 ? requestedDelayMs : 0;
    let lastError = new Error('Mailbox delivery failed');
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const recipientEpub = String(request.recipientEpub || '').trim()
          || String(await this.ports.resolveRecipientEpub(recipientId, request.knownRecipientEpub)).trim();
        if (!recipientEpub) throw new Error(`Mailbox recipient key not found for ${recipientId}`);
        const transport = this.ports.transport();
        const ciphertext = await transport.encryptForRecipient(
          recipientEpub,
          senderKey,
          request.payload,
        );
        const postResult = await transport.postEnvelope({
          id: envelopeId,
          recipientId,
          ciphertext,
          ...(request.ttlMs != null ? { ttlMs: request.ttlMs } : {}),
        });
        if (!postResult.stored) {
          throw new Error(`Mailbox rejected envelope: ${postResult.error || 'unknown error'}`);
        }
        const result: MailboxDeliveryResult = { stored: true, envelopeId, recipientId, attempts: attempt };
        this.emit({ type: 'stored', context, envelopeId, recipientId, attempts: attempt });
        return result;
      } catch (error) {
        lastError = deliveryError(error);
        if (attempt < maxAttempts) {
          const delayMs = retryDelayMs * attempt;
          this.emit({
            type: 'retrying',
            context,
            envelopeId,
            recipientId,
            attempt,
            delayMs,
            error: lastError,
          });
          if (delayMs > 0) {
            await (this.ports.sleep?.(delayMs)
              ?? new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
          }
        }
      }
    }

    const result: MailboxDeliveryResult = {
      stored: false,
      envelopeId,
      recipientId,
      attempts: maxAttempts,
      error: lastError,
    };
    this.emit({
      type: 'failed',
      context,
      envelopeId,
      recipientId,
      attempts: maxAttempts,
      error: lastError,
    });
    return result;
  }

  async deliverOrThrow(request: MailboxDeliveryRequest): Promise<Extract<MailboxDeliveryResult, { stored: true }>> {
    const result = await this.deliver(request);
    if (!result.stored) throw result.error;
    return result;
  }

  async fanOut(requests: readonly MailboxDeliveryRequest[]): Promise<MailboxDeliveryResult[]> {
    const unique = new Map<string, MailboxDeliveryRequest>();
    for (const request of requests) {
      const key = `${String(request.recipientId || '').trim()}\u0000${String(request.envelopeId || '').trim()}`;
      if (!unique.has(key)) unique.set(key, request);
    }
    return Promise.all([...unique.values()].map(async (request): Promise<MailboxDeliveryResult> => {
      try {
        return await this.deliver(request);
      } catch (error) {
        const failure: MailboxDeliveryResult = {
          stored: false,
          envelopeId: String(request.envelopeId || '').trim(),
          recipientId: String(request.recipientId || '').trim(),
          attempts: 0,
          error: deliveryError(error),
        };
        this.emit({
          type: 'failed',
          context: String(request.context || 'mailbox').trim() || 'mailbox',
          envelopeId: failure.envelopeId,
          recipientId: failure.recipientId,
          attempts: 0,
          error: failure.error,
        });
        return failure;
      }
    }));
  }
}
