/**
 * The exchange log in the device core (OPEN-88 part 2, OPEN-91 P1): one node per exchange — who, which
 * Talk, which way, the outcome, where — under `local/exchanges/`, which never leaves the device
 * (docs/design/data-sharing-privacy-rules.md). Contacts, the tag graph, 👥 counts, places and
 * statistics are all derived from it.
 */
import type { GraphStore } from './graph-store';

export const EXCHANGES_PATH = 'local/exchanges';

export type ExchangeRecord = {
  peerId: string;
  peerName: string;
  talkId: string;
  title: string;
  outcome: 'match' | 'mismatch' | 'ignore';
  direction: 'sent' | 'received';
  date: string;
  responseId?: string;
  version?: number;
  respondedAt?: string;
  type?: string;
  language?: string;
  answerMode?: 'auto' | 'manual';
  answers?: Array<{ questionId: string; answerId: string; answerText: string }>;
  /** The physical-world collection outing that caused this author-side exchange. */
  collectionSessionId?: string;
  collectionLabel?: string;
  collectionStartedAt?: string;
  /** Where it happened (OPEN-89): the room I was in — Nearby or a Place — and its name then. */
  roomId?: string;
  roomName?: string;
};

/** One record per person, Talk and direction (OPEN-88 part 1). */
export function exchangeKey(record: Pick<ExchangeRecord, 'peerId' | 'talkId' | 'direction'>): string {
  return `${record.peerId}::${record.talkId}::${record.direction || 'sent'}`;
}

/** Gun stores flat records: the whole exchange travels as one JSON field (answers are an array). */
const nodePath = (key: string): string => `${EXCHANGES_PATH}/${encodeURIComponent(key)}`;

function decode(node: Record<string, unknown> | null): ExchangeRecord | null {
  if (!node || typeof node.json !== 'string') return null;
  try {
    const record = JSON.parse(node.json) as ExchangeRecord;
    return record?.peerId && record?.talkId ? record : null;
  } catch {
    return null;
  }
}

export class ExchangeStore {
  constructor(private readonly store: GraphStore) {}

  async all(): Promise<ExchangeRecord[]> {
    const keys = await this.store.childKeys(EXCHANGES_PATH);
    const records = await Promise.all(keys.map(async (key) => decode(await this.store.get(`${EXCHANGES_PATH}/${key}`))));
    return records.filter((record): record is ExchangeRecord => !!record);
  }

  /** Writes each record whole; the caller has already merged it with what it replaces. */
  async upsert(records: ExchangeRecord[]): Promise<number> {
    await Promise.all(records.map((record) => this.store.put(nodePath(exchangeKey(record)), { json: JSON.stringify(record), peerId: record.peerId })));
    return records.length;
  }

  /** Forgets everything exchanged with these people (the Contacts cap's prune). */
  async removePeers(peerIds: string[]): Promise<number> {
    const drop = new Set(peerIds);
    const doomed = (await this.all()).filter((record) => drop.has(record.peerId));
    await Promise.all(doomed.map((record) => this.store.put(nodePath(exchangeKey(record)), null)));
    return doomed.length;
  }
}
