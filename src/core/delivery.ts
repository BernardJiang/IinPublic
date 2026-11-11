/**
 * The sender's delivery records in the device core (OPEN-91 P2): each Talk response kept before any
 * transport is tried, and the journal of how far each delivery got (`committed` → `sent`). Both live
 * under `local/`, which never leaves the device (docs/design/data-sharing-privacy-rules.md); they
 * used to go through the page's hub-connected Gun, so the hub could see who answered whom and when.
 * The response itself reaches its author over the mesh or, as ciphertext, the mailbox.
 */
import type { P2PMeshTalkResponsePayload } from '../shared/p2p-mesh-protocol';
import type { GraphStore } from './graph-store';

export const SENT_RESPONSES_PATH = 'local/sentResponses';
export const DELIVERY_JOURNAL_PATH = 'local/deliveryJournal';
export const ANSWER_OUTBOX_PATH = 'local/answerOutbox';

export type DeliveryState = 'committed' | 'sent' | 'persisted-receipt';
export type DeliveryJournalRecord = {
  version: 1;
  objectId: string;
  recipientId: string;
  objectKind: 'talk-offer' | 'talk-response';
  state: DeliveryState;
  updatedAt: string;
};
export type DeliveryInput = Omit<DeliveryJournalRecord, 'version' | 'updatedAt'>;

// One flat node per record. Keys stay bounded (a talk or response CID and a recipient id), so the
// native host's radisk can use them as file names.
const key = (...parts: string[]): string => encodeURIComponent(parts.join('::'));

function decode<T>(node: Record<string, unknown> | null): T | null {
  if (!node || typeof node.json !== 'string') return null;
  try {
    return JSON.parse(node.json) as T;
  } catch {
    return null;
  }
}

export class DeliveryStore {
  constructor(private readonly store: GraphStore) {}

  async putSentResponse(payload: P2PMeshTalkResponsePayload): Promise<void> {
    await this.store.put(`${SENT_RESPONSES_PATH}/${key(payload.authorId, payload.talkId, payload.responseId)}`, {
      json: JSON.stringify({ version: 1, responseId: payload.responseId, payload }),
    });
  }

  async getSentResponse(talkId: string, responseId: string, recipientId: string): Promise<P2PMeshTalkResponsePayload | null> {
    const current = decode<{ payload: P2PMeshTalkResponsePayload }>(await this.store.get(`${SENT_RESPONSES_PATH}/${key(recipientId, talkId, responseId)}`))?.payload;
    if (current) return current.authorId === recipientId ? current : null;
    // Earlier devices keyed only by content: a response to another author could overwrite it.
    const legacy = decode<{ payload: P2PMeshTalkResponsePayload }>(await this.store.get(`${SENT_RESPONSES_PATH}/${key(talkId, responseId)}`))?.payload;
    return legacy?.authorId === recipientId ? legacy : null;
  }

  async record(input: DeliveryInput): Promise<void> {
    const previous = await this.get(input.objectId, input.recipientId);
    const rank: Record<DeliveryState, number> = { committed: 0, sent: 1, 'persisted-receipt': 2 };
    if (previous?.objectKind === input.objectKind && rank[previous.state] >= rank[input.state]) return;
    const record: DeliveryJournalRecord = { version: 1, ...input, updatedAt: new Date().toISOString() };
    await this.store.put(`${DELIVERY_JOURNAL_PATH}/${key(input.objectId, input.recipientId)}`, { json: JSON.stringify(record) });
  }

  /**
   * An answer waiting to go into its author's pair log (`graph.answer`). Kept until it is in the
   * log, so an answer whose send failed (no keys for the author yet, no graph identity, the
   * process killed) is sent again later instead of staying only on this device (OPEN-96 a).
   * One entry per Talk and author: a newer answer replaces the waiting one.
   */
  async queueAnswer(talkId: string, authorId: string, request: Record<string, unknown>): Promise<void> {
    await this.store.put(`${ANSWER_OUTBOX_PATH}/${key(talkId, authorId)}`, { json: JSON.stringify({ version: 1, talkId, authorId, request }) });
  }

  async unqueueAnswer(talkId: string, authorId: string): Promise<void> {
    await this.store.put(`${ANSWER_OUTBOX_PATH}/${key(talkId, authorId)}`, null);
  }

  async queuedAnswers(): Promise<Array<{ talkId: string; authorId: string; request: Record<string, unknown> }>> {
    const out: Array<{ talkId: string; authorId: string; request: Record<string, unknown> }> = [];
    for (const child of await this.store.childKeys(ANSWER_OUTBOX_PATH)) {
      const entry = decode<{ version: number; talkId: string; authorId: string; request: Record<string, unknown> }>(await this.store.get(`${ANSWER_OUTBOX_PATH}/${child}`));
      if (entry?.version === 1 && entry.talkId && entry.authorId && entry.request) out.push({ talkId: entry.talkId, authorId: entry.authorId, request: entry.request });
    }
    return out;
  }

  async get(objectId: string, recipientId: string): Promise<DeliveryJournalRecord | null> {
    const record = decode<DeliveryJournalRecord>(await this.store.get(`${DELIVERY_JOURNAL_PATH}/${key(objectId, recipientId)}`));
    return record?.version === 1 && record.objectId === objectId ? record : null;
  }
}
