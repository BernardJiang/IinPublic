import type { WebGunService } from './web-gun-service';

export type LocalConversationMetadata = {
  conversationId: string;
  otherUserId: string;
  otherUserName?: string;
  talkId?: string;
  relatedTalkIdsJson?: string;
  createdAt?: string;
  updatedAt?: string;
  respondedByBot?: boolean;
  supportChannel?: boolean;
  transportMode?: string;
  dealEligible?: boolean;
  dealConfirmedByJson?: string;
  matchScore?: number;
  matchTotal?: number;
  [key: string]: unknown;
};

type MetadataEnvelope = {
  version: 1;
  ownerUserId: string;
  recordsJson: string;
  updatedAt: string;
};

type MutationBatch = {
  updates: Array<(records: Record<string, LocalConversationMetadata>) => Record<string, LocalConversationMetadata>>;
  started: boolean;
  done: Promise<void>;
};
const writeQueues = new WeakMap<WebGunService, Map<string, MutationBatch>>();

function parseRecords(value: unknown): Record<string, LocalConversationMetadata> {
  if (!value || typeof value !== 'object') return {};
  const envelope = value as Partial<MetadataEnvelope>;
  if (envelope.version !== 1 || typeof envelope.recordsJson !== 'string') return {};
  try {
    const parsed = JSON.parse(envelope.recordsJson) as Record<string, LocalConversationMetadata>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Owner-private conversation/contact metadata. Public Gun is never used by this repository. */
export class LocalPrivateConversationMetadataRepository {
  constructor(private readonly gun: WebGunService) {}

  private key(ownerUserId: string): string {
    return `conversationMetadata/${encodeURIComponent(ownerUserId)}/index`;
  }

  private async readEnvelope(ownerUserId: string): Promise<MetadataEnvelope | null> {
    const raw = await this.gun.getPrivate(this.key(ownerUserId)).catch(() => null);
    if (!raw || raw.version !== 1 || raw.ownerUserId !== ownerUserId) return null;
    return raw as MetadataEnvelope;
  }

  async list(ownerUserId: string): Promise<LocalConversationMetadata[]> {
    const envelope = await this.readEnvelope(ownerUserId);
    return Object.values(parseRecords(envelope)).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      || a.conversationId.localeCompare(b.conversationId));
  }

  async get(ownerUserId: string, conversationId: string): Promise<LocalConversationMetadata | null> {
    const envelope = await this.readEnvelope(ownerUserId);
    return parseRecords(envelope)[conversationId] ?? null;
  }

  async upsert(ownerUserId: string, record: LocalConversationMetadata): Promise<void> {
    await this.mutate(ownerUserId, (records) => {
      const existing = records[record.conversationId] || {};
      records[record.conversationId] = { ...existing, ...record } as LocalConversationMetadata;
      return records;
    });
  }

  subscribe(ownerUserId: string, callback: (records: LocalConversationMetadata[]) => void): () => void {
    return this.gun.subscribePrivate(this.key(ownerUserId), (raw) => callback(Object.values(parseRecords(raw))));
  }

  /**
   * Updates queued while a write is in flight are applied together: one read and one encrypted
   * write for the batch, and no write at all when nothing changed. Each match and message used to
   * rewrite the whole envelope, a dozen times in 15 s on a phone mid-exchange (2026-11-21).
   */
  private mutate(
    ownerUserId: string,
    update: (records: Record<string, LocalConversationMetadata>) => Record<string, LocalConversationMetadata>,
  ): Promise<void> {
    let queues = writeQueues.get(this.gun);
    if (!queues) {
      queues = new Map();
      writeQueues.set(this.gun, queues);
    }
    const queue = queues;
    const waiting = queue.get(ownerUserId);
    if (waiting && !waiting.started) {
      waiting.updates.push(update);
      return waiting.done;
    }
    const batch: MutationBatch = { updates: [update], started: false, done: Promise.resolve() };
    const previous = waiting?.done ?? Promise.resolve();
    batch.done = previous.catch(() => undefined).then(async () => {
      batch.started = true;
      const current = await this.readEnvelope(ownerUserId);
      const before = parseRecords(current);
      const beforeJson = JSON.stringify(before);
      let records = JSON.parse(beforeJson) as Record<string, LocalConversationMetadata>;
      for (const apply of batch.updates) records = apply(records);
      const recordsJson = JSON.stringify(records);
      if (current && recordsJson === beforeJson) return;
      await this.gun.putPrivate(this.key(ownerUserId), {
        version: 1,
        ownerUserId,
        recordsJson,
        updatedAt: new Date().toISOString(),
      } satisfies MetadataEnvelope);
    });
    queue.set(ownerUserId, batch);
    void batch.done.finally(() => {
      if (queue.get(ownerUserId) === batch) queue.delete(ownerUserId);
    }).catch(() => undefined);
    return batch.done;
  }
}
