/**
 * Portable conversation read-model orchestration.
 *
 * Hosts own transport, persistence, identity lookup, support-message verification and UI. This
 * coordinator owns record normalization, participant/name gates, graph projection, serialized
 * message imports, legacy cutover and bounded device-sync snapshots.
 */
import type { ImportedMessage } from './device-graph/message-events';

export type ConversationProjectionUser = {
  id: string;
  stageName?: string;
};

export type ConversationRecord = Record<string, any>;

export type ConversationMessage = Record<string, any>;

export type ProjectedConversation = {
  conversationId: string;
  otherUserId: string;
  otherUserName: string;
  talkId?: unknown;
  relatedTalkIds?: unknown;
  relatedTalkIdsJson?: unknown;
  respondedByBot?: unknown;
  supportChannel?: unknown;
  transportMode?: unknown;
  transportFallbackReason?: unknown;
  dealEligible: boolean;
  matchScore?: unknown;
  matchTotal?: unknown;
};

export type ConversationGraphProjection = {
  conversationId: string;
  otherUserId: string;
  talkIds?: string[];
  startedAt?: number;
};

export type ProjectedSyncedMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  talkId?: string;
  channel?: string;
};

export interface ConversationProjectionEffectsPorts {
  currentUser(): ConversationProjectionUser | undefined;
  transportMode(): unknown;
  resolveOtherUserName(userId: string): Promise<string | undefined>;
  upsertConversation(conversation: ProjectedConversation): void;
  recordConversation(projection: ConversationGraphProjection): Promise<void>;
  applyDealConfirmations(conversationId: string, confirmations: string[]): unknown;
  maybeFinalizeDeal(confirmations: unknown, otherUserId: string, conversationId: string): void;
  verifySupportMessages(messages: ConversationMessage[], stageName: string): Promise<ConversationMessage[]>;
  readLegacyMessages(
    conversationId: string,
    currentUserId: string,
    otherUserId: string,
  ): Promise<ConversationMessage[]>;
  clearLegacyMessages(conversationId: string): Promise<void>;
  waitForGraphWrite(): Promise<unknown>;
  recordMessages(params: {
    conversationId: string;
    otherUserId: string;
    messages: Array<Omit<ImportedMessage, 'conversationId' | 'otherUserId'>>;
  }): Promise<void>;
  subscribeToMessages(
    conversationId: string,
    listener: (messages: ConversationMessage[]) => void,
    currentUserId: string,
    otherUserId: string,
  ): () => void;
  refreshGraph(): Promise<unknown> | void;
  onFailure?(context: 'conversation' | 'message-import' | 'legacy-migration', error: unknown): void;
}

export type ConversationProjectionEffectsOptions = {
  nameLookupTimeoutMs?: number;
  snapshotTimeoutMs?: number;
  messageBatchSize?: number;
};

const placeholderName = (name: unknown): boolean => {
  const normalized = String(name ?? '').trim();
  return !normalized || normalized === 'Unknown' || normalized === 'Someone';
};

const relatedTalkIdsOf = (record: ConversationRecord): unknown[] => {
  if (Array.isArray(record.relatedTalkIds)) return record.relatedTalkIds;
  try {
    const parsed = JSON.parse(String(record.relatedTalkIdsJson || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const syncedMessageOf = (message: ConversationMessage): ProjectedSyncedMessage => ({
  id: String(message.id),
  senderId: String(message.senderId),
  text: String(message.text ?? ''),
  timestamp: (message.timestamp instanceof Date
    ? message.timestamp
    : new Date(message.timestamp)).toISOString(),
  ...(message.talkId ? { talkId: String(message.talkId) } : {}),
  ...(message.channel ? { channel: String(message.channel) } : {}),
});

export class ConversationProjectionEffects {
  private readonly graphMessageWrites = new Map<string, Promise<void>>();
  private readonly legacyMigrations = new Map<string, Promise<void>>();
  private readonly nameLookupTimeoutMs: number;
  private readonly snapshotTimeoutMs: number;
  private readonly messageBatchSize: number;

  constructor(
    private readonly ports: ConversationProjectionEffectsPorts,
    options: ConversationProjectionEffectsOptions = {},
  ) {
    this.nameLookupTimeoutMs = options.nameLookupTimeoutMs ?? 2_500;
    this.snapshotTimeoutMs = options.snapshotTimeoutMs ?? 5_000;
    this.messageBatchSize = options.messageBatchSize ?? 200;
  }

  private resolveNameWithinBudget(userId: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (name: string | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(name);
      };
      const timer = setTimeout(() => finish(undefined), this.nameLookupTimeoutMs);
      void this.ports.resolveOtherUserName(userId).then(finish, () => finish(undefined));
    });
  }

  async ingestRecords(records: ConversationRecord[]): Promise<number> {
    const currentUser = this.ports.currentUser();
    if (!currentUser?.id) return 0;

    let ingested = 0;
    for (const record of records) {
      const otherUserId = String(record.otherUserId ?? (
        record.userId1 === currentUser.id ? record.userId2 : record.userId1
      ) ?? '');
      const candidateName = record.otherUserName ?? (
        record.userId1 === currentUser.id ? record.userName2 : record.userName1
      );
      if (!otherUserId || otherUserId === currentUser.id) continue;

      let otherUserName = String(candidateName ?? 'Unknown');
      if (placeholderName(otherUserName)) {
        const found = await this.resolveNameWithinBudget(otherUserId);
        if (found) otherUserName = found;
      }

      const conversationId = String(record.conversationId || '');
      this.ports.upsertConversation({
        conversationId,
        otherUserId,
        otherUserName,
        talkId: record.talkId,
        relatedTalkIds: record.relatedTalkIds,
        relatedTalkIdsJson: record.relatedTalkIdsJson,
        respondedByBot: record.respondedByBot,
        supportChannel: record.supportChannel,
        transportMode: record.transportMode ?? this.ports.transportMode(),
        transportFallbackReason: record.transportFallbackReason,
        dealEligible: record.dealEligible === true,
        ...(record.matchScore !== undefined ? { matchScore: record.matchScore } : {}),
        ...(record.matchTotal !== undefined ? { matchTotal: record.matchTotal } : {}),
      });
      ingested += 1;

      if (conversationId) {
        const hasTalkProjection = record.talkId !== undefined
          || record.relatedTalkIds !== undefined
          || record.relatedTalkIdsJson !== undefined;
        const talkIds = [...new Set([record.talkId, ...relatedTalkIdsOf(record)]
          .map(String)
          .filter((talkId) => talkId && talkId !== 'direct'))];
        const startedAt = Date.parse(String(record.createdAt || ''));
        void this.ports.recordConversation({
          conversationId,
          otherUserId,
          ...(hasTalkProjection ? { talkIds } : {}),
          ...(Number.isFinite(startedAt) ? { startedAt } : {}),
        }).then(() => this.ports.refreshGraph()).catch((error) => {
          this.ports.onFailure?.('conversation', error);
        });
      }

      if (typeof record.dealConfirmedByJson === 'string') {
        try {
          const confirmations = JSON.parse(record.dealConfirmedByJson);
          if (Array.isArray(confirmations)) {
            const merged = this.ports.applyDealConfirmations(
              conversationId,
              confirmations.map(String),
            );
            this.ports.maybeFinalizeDeal(merged, otherUserId, conversationId);
          }
        } catch {
          // Malformed sync payload: the next sync tick can retry with a valid record.
        }
      }
    }
    return ingested;
  }

  messageImports(
    otherUserId: string,
    messages: readonly ConversationMessage[],
  ): Array<Omit<ImportedMessage, 'conversationId' | 'otherUserId'>> {
    const currentUserId = this.ports.currentUser()?.id;
    if (!currentUserId || !otherUserId || otherUserId === currentUserId) return [];
    return messages.flatMap((message) => {
      const sourceMessageId = String(message?.id || '');
      const senderId = String(message?.senderId || '');
      const text = String(message?.text ?? '');
      const when = (message?.timestamp instanceof Date
        ? message.timestamp
        : new Date(message?.timestamp)).getTime();
      if (!sourceMessageId || sourceMessageId.length > 500
        || (senderId !== currentUserId && senderId !== otherUserId)
        || !Number.isFinite(when)
        || text.length > 4_000
        || text.startsWith('SEA{')) return [];
      return [{
        sourceMessageId,
        senderId,
        text,
        when,
        ...(message?.talkId ? { talkId: String(message.talkId) } : {}),
        ...(message?.channel === 'public' || message?.channel === 'known' || message?.channel === 'mutual'
          ? { channel: message.channel }
          : {}),
        ...(message?.isFromChatbot === true ? { isFromChatbot: true } : {}),
      }];
    });
  }

  recordConversationMessages(
    conversationId: string,
    otherUserId: string,
    messages: readonly ConversationMessage[],
  ): void {
    void (async () => {
      const verified = conversationId.startsWith('conv_support_')
        ? await this.ports.verifySupportMessages(
          [...messages],
          this.ports.currentUser()?.stageName || '',
        )
        : messages;
      const imports = this.messageImports(otherUserId, verified);
      if (imports.length) await this.writeMessages(conversationId, otherUserId, imports);
    })().catch((error) => this.ports.onFailure?.('message-import', error));
  }

  migrateLegacyHistory(conversationId: string, otherUserId: string): Promise<void> {
    const existing = this.legacyMigrations.get(conversationId);
    if (existing) return existing;
    const currentUserId = this.ports.currentUser()?.id;
    if (!currentUserId) return Promise.reject(new Error('Current user is unavailable'));
    const migration = (async () => {
      const messages = await this.ports.readLegacyMessages(
        conversationId,
        currentUserId,
        otherUserId,
      );
      const imports = this.messageImports(otherUserId, messages);
      if (messages.length !== imports.length) {
        throw new Error('Legacy conversation still contains undecryptable messages');
      }
      if (imports.length) await this.writeMessages(conversationId, otherUserId, imports);
      await this.ports.clearLegacyMessages(conversationId);
    })();
    this.legacyMigrations.set(conversationId, migration);
    void migration.catch((error) => {
      this.legacyMigrations.delete(conversationId);
      this.ports.onFailure?.('legacy-migration', error);
    });
    return migration;
  }

  writeMessages(
    conversationId: string,
    otherUserId: string,
    imports: Array<Omit<ImportedMessage, 'conversationId' | 'otherUserId'>>,
  ): Promise<void> {
    const currentUserId = this.ports.currentUser()?.id;
    if (!currentUserId) return Promise.reject(new Error('Device graph is unavailable'));
    if (!otherUserId || otherUserId === currentUserId) {
      return Promise.reject(new Error('Invalid conversation participant'));
    }
    if (!imports.length) return Promise.resolve();

    const previous = this.graphMessageWrites.get(conversationId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(async () => {
      await this.ports.waitForGraphWrite().catch(() => undefined);
      for (let offset = 0; offset < imports.length; offset += this.messageBatchSize) {
        await this.ports.recordMessages({
          conversationId,
          otherUserId,
          messages: imports.slice(offset, offset + this.messageBatchSize),
        });
      }
      await this.ports.refreshGraph();
    }).finally(() => {
      if (this.graphMessageWrites.get(conversationId) === write) {
        this.graphMessageWrites.delete(conversationId);
      }
    });
    this.graphMessageWrites.set(conversationId, write);
    return write;
  }

  snapshotLocalMessages(
    conversationId: string,
    otherUserId: string,
  ): Promise<ProjectedSyncedMessage[]> {
    return new Promise((resolve) => {
      const currentUserId = this.ports.currentUser()?.id;
      if (!currentUserId) {
        resolve([]);
        return;
      }
      let settled = false;
      let unsubscribe = (): void => undefined;
      const finish = (messages: ProjectedSyncedMessage[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(messages);
      };
      const timer = setTimeout(() => finish([]), this.snapshotTimeoutMs);
      unsubscribe = this.ports.subscribeToMessages(
        conversationId,
        (messages) => finish(messages.map(syncedMessageOf)),
        currentUserId,
        otherUserId,
      );
      // Some local repositories replay synchronously during subscribe; release the real handle
      // after it has been returned even though finish() could only see the no-op placeholder.
      if (settled) unsubscribe();
    });
  }
}
