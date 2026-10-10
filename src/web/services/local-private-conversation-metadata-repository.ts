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
  legacyImportedAt?: string;
  updatedAt: string;
};

const writeQueues = new WeakMap<WebGunService, Map<string, Promise<void>>>();

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

  async importLegacyOnce(ownerUserId: string, records: LocalConversationMetadata[]): Promise<boolean> {
    const existing = await this.readEnvelope(ownerUserId);
    if (existing?.legacyImportedAt) return false;
    await this.mutate(ownerUserId, (current) => {
      for (const record of records) {
        if (!record?.conversationId || !record.otherUserId) continue;
        current[record.conversationId] = { ...record, ...current[record.conversationId] };
      }
      return current;
    }, true);
    return true;
  }

  subscribe(ownerUserId: string, callback: (records: LocalConversationMetadata[]) => void): () => void {
    return this.gun.subscribePrivate(this.key(ownerUserId), (raw) => callback(Object.values(parseRecords(raw))));
  }

  private mutate(
    ownerUserId: string,
    update: (records: Record<string, LocalConversationMetadata>) => Record<string, LocalConversationMetadata>,
    markLegacyImported = false,
  ): Promise<void> {
    let queues = writeQueues.get(this.gun);
    if (!queues) {
      queues = new Map();
      writeQueues.set(this.gun, queues);
    }
    const previous = queues.get(ownerUserId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const current = await this.readEnvelope(ownerUserId);
      const records = update(parseRecords(current));
      const now = new Date().toISOString();
      await this.gun.putPrivate(this.key(ownerUserId), {
        version: 1,
        ownerUserId,
        recordsJson: JSON.stringify(records),
        ...(current?.legacyImportedAt || markLegacyImported
          ? { legacyImportedAt: current?.legacyImportedAt || now }
          : {}),
        updatedAt: now,
      } satisfies MetadataEnvelope);
    });
    queues.set(ownerUserId, next);
    void next.finally(() => {
      if (queues?.get(ownerUserId) === next) queues.delete(ownerUserId);
    }).catch(() => undefined);
    return next;
  }
}
