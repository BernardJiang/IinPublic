import { computeMerkleRoot, sha256Hex } from '../../shared/merkle-checkpoint';
import type { WebGunService } from './web-gun-service';

export type LocalConversationWire = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
  transport?: string;
  encryption?: 'sea-ecdh-v1';
  prevSeen?: string;
  isFromChatbot?: boolean;
  talkId?: string;
  [key: string]: unknown;
};

export type LocalConversationCheckpoint = {
  rangeStartId: string;
  rangeEndId: string;
  count: number;
  merkleRoot: string;
  leafHashes: string[];
  createdAt: string;
};

type LocalConversationEnvelope = {
  version: 1;
  conversationId: string;
  messagesJson: string;
  checkpointsJson: string;
  totalCount: number;
  lastCheckpointedCount: number;
  prunedThroughCount: number;
  updatedAt: string;
};

const writeQueues = new WeakMap<WebGunService, Map<string, Promise<void>>>();

function sorted(wires: LocalConversationWire[]): LocalConversationWire[] {
  return [...wires].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id),
  );
}

function parseArray<T>(value: string | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

/**
 * Durable conversation history inside WebGunService's peerless encrypted worker Gun.
 *
 * One encrypted envelope per conversation makes enumeration, checkpointing, pruning, and atomic
 * append possible without exposing a shared pair soul to the public control graph. Direct peers
 * synchronize these endpoint-local copies explicitly over their authenticated DataChannel.
 */
export class LocalPrivateConversationRepository {
  constructor(
    private readonly gun: WebGunService,
    private readonly checkpointInterval: number,
    private readonly retentionWindow: number,
  ) {}

  private key(conversationId: string): string {
    return `conversations/${encodeURIComponent(conversationId)}/history`;
  }

  private async readEnvelope(conversationId: string): Promise<LocalConversationEnvelope | null> {
    const raw = await this.gun.getPrivate(this.key(conversationId)).catch(() => null);
    if (!raw || raw.version !== 1 || raw.conversationId !== conversationId) return null;
    return raw as LocalConversationEnvelope;
  }

  async list(conversationId: string): Promise<LocalConversationWire[]> {
    const envelope = await this.readEnvelope(conversationId);
    return envelope ? sorted(parseArray<LocalConversationWire>(envelope.messagesJson)) : [];
  }

  async append(conversationId: string, wire: LocalConversationWire): Promise<void> {
    await this.mutate(conversationId, (messages) => {
      const byId = new Map(messages.map((item) => [item.id, item]));
      byId.set(wire.id, wire);
      return sorted([...byId.values()]);
    });
  }

  /** Import a legacy peered history only when the local encrypted history is empty. */
  async importIfEmpty(conversationId: string, wires: LocalConversationWire[]): Promise<boolean> {
    if (wires.length === 0 || (await this.list(conversationId)).length > 0) return false;
    await this.mutate(conversationId, () => sorted(wires));
    return true;
  }

  subscribe(
    conversationId: string,
    callback: (wires: LocalConversationWire[]) => void,
  ): () => void {
    return this.gun.subscribePrivate(this.key(conversationId), (raw) => {
      if (!raw || raw.version !== 1 || raw.conversationId !== conversationId) return;
      callback(sorted(parseArray<LocalConversationWire>(raw.messagesJson)));
    });
  }

  private mutate(
    conversationId: string,
    update: (messages: LocalConversationWire[]) => LocalConversationWire[],
  ): Promise<void> {
    let queues = writeQueues.get(this.gun);
    if (!queues) {
      queues = new Map();
      writeQueues.set(this.gun, queues);
    }
    const previous = queues.get(conversationId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const current = await this.readEnvelope(conversationId);
      const before = current ? parseArray<LocalConversationWire>(current.messagesJson) : [];
      let messages = update(before);
      const oldIds = new Set(before.map((wire) => wire.id));
      const newUniqueCount = messages.filter((wire) => !oldIds.has(wire.id)).length;
      const prunedThroughCount = current?.prunedThroughCount ?? 0;
      const totalCount = Math.max(
        current?.totalCount ?? prunedThroughCount + before.length,
        prunedThroughCount + before.length + newUniqueCount,
      );
      let lastCheckpointedCount = current?.lastCheckpointedCount ?? 0;
      let checkpoints = current
        ? parseArray<LocalConversationCheckpoint>(current.checkpointsJson)
        : [];

      while (totalCount - lastCheckpointedCount >= this.checkpointInterval) {
        const localStart = Math.max(0, lastCheckpointedCount - prunedThroughCount);
        const window = messages.slice(localStart, localStart + this.checkpointInterval);
        if (window.length < this.checkpointInterval) break;
        const leafHashes = await Promise.all(
          window.map(async (item) => `${item.id}:${await sha256Hex(item.text)}`),
        );
        checkpoints.push({
          rangeStartId: window[0].id,
          rangeEndId: window[window.length - 1].id,
          count: window.length,
          merkleRoot: await computeMerkleRoot(leafHashes),
          leafHashes,
          createdAt: new Date().toISOString(),
        });
        lastCheckpointedCount += window.length;
      }

      const deletableThrough = Math.min(
        lastCheckpointedCount,
        Math.max(0, totalCount - this.retentionWindow),
      );
      const deleteCount = Math.max(0, deletableThrough - prunedThroughCount);
      if (deleteCount > 0) messages = messages.slice(deleteCount);
      // Checkpoints are local integrity aids, not permanent history. Retain a bounded tail.
      checkpoints = checkpoints.slice(-Math.max(2, Math.ceil(this.retentionWindow / this.checkpointInterval) + 1));

      const envelope: LocalConversationEnvelope = {
        version: 1,
        conversationId,
        messagesJson: JSON.stringify(messages),
        checkpointsJson: JSON.stringify(checkpoints),
        totalCount,
        lastCheckpointedCount,
        prunedThroughCount: deletableThrough,
        updatedAt: new Date().toISOString(),
      };
      await this.gun.putPrivate(this.key(conversationId), envelope);
    });
    queues.set(conversationId, next);
    void next.then(
      () => {
        if (queues?.get(conversationId) === next) queues.delete(conversationId);
      },
      () => {
        if (queues?.get(conversationId) === next) queues.delete(conversationId);
      },
    );
    return next;
  }
}
