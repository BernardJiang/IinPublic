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

type LegacyConversationEnvelope = {
  version: 1;
  conversationId: string;
  messagesJson: string;
  checkpointsJson: string;
  totalCount: number;
  lastCheckpointedCount: number;
  prunedThroughCount: number;
  updatedAt: string;
};

export type SegmentedConversationManifest = {
  version: 2;
  conversationId: string;
  segmentSize: number;
  segmentCount: number;
  revision: number;
  checkpointsJson: string;
  totalCount: number;
  lastCheckpointedCount: number;
  prunedThroughCount: number;
  updatedAt: string;
};

type ConversationSegment = {
  version: 2;
  conversationId: string;
  index: number;
  messagesJson: string;
  updatedAt: string;
};

type LoadedConversation = {
  manifest: SegmentedConversationManifest;
  segments: LocalConversationWire[][];
  legacy: boolean;
};

/** Re-encrypt at most this many message wires for an ordinary append. */
export const DEFAULT_CONVERSATION_SEGMENT_SIZE = 32;

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

function partition(wires: LocalConversationWire[], size: number): LocalConversationWire[][] {
  const out: LocalConversationWire[][] = [];
  for (let i = 0; i < wires.length; i += size) out.push(wires.slice(i, i + size));
  return out;
}

function sameSegment(a: LocalConversationWire[] | undefined, b: LocalConversationWire[] | undefined): boolean {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

/**
 * Durable conversation history inside WebGunService's peerless encrypted local store.
 *
 * Version 1 kept every retained message in one encrypted envelope. Appending one DM therefore
 * decrypted and re-encrypted the complete conversation; on older Android hardware that took
 * seconds and also blocked unrelated private records. Version 2 keeps a small manifest plus
 * bounded encrypted segments. The common append rewrites only the final segment and manifest.
 * Existing v1 envelopes migrate lazily on their next append, without dropping history.
 */
export class LocalPrivateConversationRepository {
  private readonly loaded = new Map<string, LoadedConversation>();

  constructor(
    private readonly gun: WebGunService,
    private readonly checkpointInterval: number,
    private readonly retentionWindow: number,
    private readonly segmentSize = DEFAULT_CONVERSATION_SEGMENT_SIZE,
  ) {}

  private key(conversationId: string): string {
    return `conversations/${encodeURIComponent(conversationId)}/history`;
  }

  private segmentKey(conversationId: string, index: number): string {
    return `conversationHistorySegments/${encodeURIComponent(conversationId)}/${index}`;
  }

  private emptyManifest(conversationId: string): SegmentedConversationManifest {
    return {
      version: 2,
      conversationId,
      segmentSize: this.segmentSize,
      segmentCount: 0,
      revision: 0,
      checkpointsJson: '[]',
      totalCount: 0,
      lastCheckpointedCount: 0,
      prunedThroughCount: 0,
      updatedAt: new Date(0).toISOString(),
    };
  }

  private async load(
    conversationId: string,
    suppliedManifest?: LegacyConversationEnvelope | SegmentedConversationManifest | null,
  ): Promise<LoadedConversation> {
    const raw = suppliedManifest === undefined
      ? await this.gun.getPrivate(this.key(conversationId)).catch(() => null)
      : suppliedManifest;

    if (!raw || raw.conversationId !== conversationId) {
      const empty = { manifest: this.emptyManifest(conversationId), segments: [], legacy: false };
      this.loaded.set(conversationId, empty);
      return empty;
    }

    if (raw.version === 1) {
      const legacy = raw as LegacyConversationEnvelope;
      const messages = sorted(parseArray<LocalConversationWire>(legacy.messagesJson));
      const state: LoadedConversation = {
        manifest: {
          version: 2,
          conversationId,
          segmentSize: this.segmentSize,
          segmentCount: Math.ceil(messages.length / this.segmentSize),
          revision: 0,
          checkpointsJson: legacy.checkpointsJson || '[]',
          totalCount: legacy.totalCount || messages.length,
          lastCheckpointedCount: legacy.lastCheckpointedCount || 0,
          prunedThroughCount: legacy.prunedThroughCount || 0,
          updatedAt: legacy.updatedAt || new Date(0).toISOString(),
        },
        segments: partition(messages, this.segmentSize),
        legacy: true,
      };
      this.loaded.set(conversationId, state);
      return state;
    }

    const manifest = raw as SegmentedConversationManifest;
    if (manifest.version !== 2 || manifest.segmentCount < 0) {
      const empty = { manifest: this.emptyManifest(conversationId), segments: [], legacy: false };
      this.loaded.set(conversationId, empty);
      return empty;
    }
    const cached = this.loaded.get(conversationId);
    if (!cached?.legacy && cached?.manifest.revision === manifest.revision) return cached;

    const segments = await Promise.all(
      Array.from({ length: manifest.segmentCount }, async (_, index) => {
        const segment = await this.gun.getPrivate(this.segmentKey(conversationId, index)).catch(() => null) as ConversationSegment | null;
        if (!segment || segment.version !== 2 || segment.conversationId !== conversationId || segment.index !== index) return [];
        return parseArray<LocalConversationWire>(segment.messagesJson);
      }),
    );
    const state = { manifest, segments, legacy: false };
    this.loaded.set(conversationId, state);
    return state;
  }

  async list(conversationId: string): Promise<LocalConversationWire[]> {
    const state = await this.load(conversationId);
    return sorted(state.segments.flat());
  }

  async append(conversationId: string, wire: LocalConversationWire): Promise<void> {
    await this.mutate(conversationId, (messages) => {
      const byId = new Map(messages.map((item) => [item.id, item]));
      byId.set(wire.id, wire);
      return sorted([...byId.values()]);
    });
  }

  /** OPEN-110 cutover: remove an ordinary conversation only after its graph import succeeds. */
  async clear(conversationId: string): Promise<void> {
    const current = await this.load(conversationId);
    await Promise.all([
      ...Array.from(
        { length: current.manifest.segmentCount },
        (_, index) => this.gun.putPrivate(this.segmentKey(conversationId, index), null),
      ),
      this.gun.putPrivate(this.key(conversationId), null),
    ]);
    this.loaded.delete(conversationId);
  }

  subscribe(
    conversationId: string,
    callback: (wires: LocalConversationWire[]) => void,
  ): () => void {
    let disposed = false;
    const off = this.gun.subscribePrivate(this.key(conversationId), (raw) => {
      if (!raw || raw.conversationId !== conversationId || (raw.version !== 1 && raw.version !== 2)) return;
      void this.load(conversationId, raw).then((state) => {
        if (!disposed) callback(sorted(state.segments.flat()));
      }).catch(() => undefined);
    });
    return () => {
      disposed = true;
      off();
    };
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
      const current = await this.load(conversationId);
      const before = sorted(current.segments.flat());
      let messages = update(before);
      const oldIds = new Set(before.map((wire) => wire.id));
      const newUniqueCount = messages.filter((wire) => !oldIds.has(wire.id)).length;
      const prunedThroughCount = current.manifest.prunedThroughCount;
      const totalCount = Math.max(
        current.manifest.totalCount || prunedThroughCount + before.length,
        prunedThroughCount + before.length + newUniqueCount,
      );
      let lastCheckpointedCount = current.manifest.lastCheckpointedCount;
      let checkpoints = parseArray<LocalConversationCheckpoint>(current.manifest.checkpointsJson);

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
      checkpoints = checkpoints.slice(-Math.max(2, Math.ceil(this.retentionWindow / this.checkpointInterval) + 1));

      const segments = partition(messages, this.segmentSize);
      const changed = Math.max(current.segments.length, segments.length);
      const now = new Date().toISOString();
      const segmentWrites: Promise<void>[] = [];
      for (let index = 0; index < changed; index += 1) {
        // A v1 envelope has no segment records yet, even when its in-memory partition is byte-for-
        // byte identical. The first v2 commit must materialize every retained segment.
        if (!current.legacy && sameSegment(current.segments[index], segments[index])) continue;
        const segment: ConversationSegment | null = segments[index]
          ? {
            version: 2,
            conversationId,
            index,
            messagesJson: JSON.stringify(segments[index]),
            updatedAt: now,
          }
          : null;
        segmentWrites.push(this.gun.putPrivate(this.segmentKey(conversationId, index), segment));
      }
      await Promise.all(segmentWrites);

      const manifest: SegmentedConversationManifest = {
        version: 2,
        conversationId,
        segmentSize: this.segmentSize,
        segmentCount: segments.length,
        revision: current.manifest.revision + 1,
        checkpointsJson: JSON.stringify(checkpoints),
        totalCount,
        lastCheckpointedCount,
        prunedThroughCount: deletableThrough,
        updatedAt: now,
      };
      const nextState = { manifest, segments, legacy: false };
      this.loaded.set(conversationId, nextState);
      try {
        await this.gun.putPrivate(this.key(conversationId), manifest);
      } catch (error) {
        this.loaded.delete(conversationId);
        throw error;
      }
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
