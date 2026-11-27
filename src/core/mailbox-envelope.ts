/**
 * What an encrypted mailbox envelope holds, once decrypted (OPEN-91 P4), moved out of `app.ts`
 * (`drainMailboxOnce`): the kind decides which handler takes it. Offline delivery of everything
 * the mesh carries live — Talk bodies, responses and retractions — plus direct messages,
 * attachment shares, TechSupport questions, block signals and content-free wake-ups.
 */
import { BLOCK_SIGNAL_PAYLOAD_KIND } from '../shared/block-signal';
import { TALK_WAKE_PAYLOAD_KIND } from '../shared/talk-wake';

export type MailboxPayloadKind =
  | 'wake' // OPEN-38: content-free; waking the device was its whole job
  | 'conversation-message' // an offline direct message (Phase 4)
  | 'attachment-share'
  | 'support-question' // TechSupport inbox delivery (K5)
  | 'block-signal' // friend-circle block signal
  | 'talk-body' // the mesh's fallback for a Talk (R-a)
  | 'talk-retraction' // step 10
  | 'talk-response'; // step 6

export type MailboxEnvelopeDisposition = 'acknowledge' | 'retain';

/**
 * Host capabilities needed after an envelope has been decrypted. The portable core owns which
 * payloads are actionable and when an envelope may be acknowledged; browser/storage details stay
 * behind these ports.
 */
export interface MailboxPayloadHandlers {
  ingestConversationMessage(payload: unknown): Promise<void>;
  ingestAttachmentShare(payload: unknown): Promise<void>;
  ingestSupportQuestion(payload: unknown): Promise<boolean>;
  ingestBlockSignal(payload: unknown): Promise<void>;
}

export function classifyMailboxPayload(payload: any): MailboxPayloadKind {
  switch (payload?.kind) {
    case TALK_WAKE_PAYLOAD_KIND: return 'wake';
    case 'conversation-message-v1': return 'conversation-message';
    case 'ipfs-conversation-share-v1': return 'attachment-share';
    case 'support-question-v1': return 'support-question';
    case BLOCK_SIGNAL_PAYLOAD_KIND: return 'block-signal';
    default:
      if (payload?.talkData !== undefined) return 'talk-body';
      if (typeof payload?.retractedAt === 'number') return 'talk-retraction';
      return 'talk-response';
  }
}

/** Who sent it, whatever its kind (their encryption key comes with the envelope). */
export function mailboxSenderId(payload: any): string {
  return String(payload?.senderId || payload?.responderId || payload?.authorId || '').trim();
}

/**
 * Dispatch one decrypted payload and decide whether its encrypted envelope is safe to delete.
 * A rejected support question is deliberately retained: an eligible delegate may temporarily be
 * unable to prove operator state, and acknowledging it here would lose the question.
 */
export async function dispatchMailboxPayload(
  payload: unknown,
  handlers: MailboxPayloadHandlers,
): Promise<MailboxEnvelopeDisposition> {
  switch (classifyMailboxPayload(payload)) {
    case 'conversation-message':
      await handlers.ingestConversationMessage(payload);
      return 'acknowledge';
    case 'attachment-share':
      await handlers.ingestAttachmentShare(payload);
      return 'acknowledge';
    case 'support-question':
      return await handlers.ingestSupportQuestion(payload) ? 'acknowledge' : 'retain';
    case 'block-signal':
      await handlers.ingestBlockSignal(payload);
      return 'acknowledge';
    case 'wake':
      // OPEN-38: waking the device was the payload's whole job.
      return 'acknowledge';
    case 'talk-body':
    case 'talk-retraction':
    case 'talk-response':
      // OPEN-106: these payloads now travel only over graph links; discard old envelopes.
      return 'acknowledge';
  }
}
