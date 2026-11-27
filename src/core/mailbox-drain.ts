import {
  dispatchMailboxPayload,
  mailboxSenderId,
  type MailboxPayloadHandlers,
} from './mailbox-envelope';

export interface MailboxEnvelopeRecord {
  id: string;
  ciphertext: string;
}

export interface MailboxDrainTransport<RecipientKey> {
  fetchEnvelopes(recipientId: string): Promise<MailboxEnvelopeRecord[]>;
  decryptEnvelope(ciphertext: string, recipientKey: RecipientKey): Promise<unknown>;
  deleteEnvelope(recipientId: string, envelopeId: string): Promise<boolean>;
}

export type MailboxDrainEvent =
  | { type: 'batch'; recipientId: string; count: number }
  | { type: 'retained'; envelopeId: string }
  | { type: 'acknowledged'; envelopeId: string }
  | { type: 'failed'; envelopeId: string; error: unknown };

export interface MailboxDrainOptions<RecipientKey> {
  recipientId: string;
  recipientKey: RecipientKey;
  transport: MailboxDrainTransport<RecipientKey>;
  handlers: MailboxPayloadHandlers;
  rememberSenderKey?: (senderId: string, senderEpub: string) => void;
  onEvent?: (event: MailboxDrainEvent) => void;
}

export interface MailboxDrainSummary {
  fetched: number;
  acknowledged: number;
  retained: number;
  failed: number;
}

function senderEpubFromCiphertext(ciphertext: string): string {
  try {
    const wrapper = JSON.parse(ciphertext) as { senderEpub?: unknown };
    return typeof wrapper.senderEpub === 'string' ? wrapper.senderEpub.trim() : '';
  } catch {
    // Decryption owns validation and reports malformed wrappers through the normal retry path.
    return '';
  }
}

/**
 * Drain every currently queued encrypted envelope. Each item is isolated: an unavailable handler,
 * malformed envelope, or failed acknowledgement stays queued without preventing later items from
 * being processed. Host code supplies encryption, transport, persistence, and observability ports.
 */
export async function drainMailboxEnvelopes<RecipientKey>(
  options: MailboxDrainOptions<RecipientKey>,
): Promise<MailboxDrainSummary> {
  const summary: MailboxDrainSummary = { fetched: 0, acknowledged: 0, retained: 0, failed: 0 };
  const envelopes = await options.transport.fetchEnvelopes(options.recipientId);
  summary.fetched = envelopes.length;
  if (!envelopes.length) return summary;

  options.onEvent?.({ type: 'batch', recipientId: options.recipientId, count: envelopes.length });
  for (const envelope of envelopes) {
    try {
      const senderEpub = senderEpubFromCiphertext(envelope.ciphertext);
      const payload = await options.transport.decryptEnvelope(envelope.ciphertext, options.recipientKey);
      const senderId = senderEpub ? mailboxSenderId(payload) : '';
      if (senderId) options.rememberSenderKey?.(senderId, senderEpub);

      const disposition = await dispatchMailboxPayload(payload, options.handlers);
      if (disposition === 'retain') {
        summary.retained++;
        options.onEvent?.({ type: 'retained', envelopeId: envelope.id });
        continue;
      }

      const deleted = await options.transport.deleteEnvelope(options.recipientId, envelope.id);
      if (!deleted) throw new Error('Mailbox acknowledgement failed');
      summary.acknowledged++;
      options.onEvent?.({ type: 'acknowledged', envelopeId: envelope.id });
    } catch (error) {
      summary.failed++;
      options.onEvent?.({ type: 'failed', envelopeId: envelope.id, error });
    }
  }
  return summary;
}
