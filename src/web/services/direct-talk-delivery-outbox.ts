import type { P2PMeshTalkBodyPayload } from '../../shared/p2p-mesh-protocol';
import type { WebGunService } from './web-gun-service';

export type DirectTalkDeliveryEntry = {
  version: 1;
  key: string;
  roomId: string;
  recipientUserId: string;
  talkId: string;
  contentHash: string;
  payload: P2PMeshTalkBodyPayload;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastAttemptAt?: string;
};

type DirectTalkDeliveryEnvelope = {
  version: 1;
  entriesJson: string;
  updatedAt: string;
};

const PRIVATE_KEY = 'directTalkDeliveryOutbox';
/** A receiver who has not come back for this long is not waited on any more. */
export const DIRECT_TALK_OUTBOX_TTL_MS = 14 * 24 * 60 * 60_000;
/** Hard bound on the whole queue (it is rewritten as one encrypted record). Oldest go first. */
export const DIRECT_TALK_OUTBOX_MAX_ENTRIES = 5_000;

/** Drop expired entries and enforce the size bound. */
function boundedEntries(entries: DirectTalkDeliveryEntry[], nowMs: number): DirectTalkDeliveryEntry[] {
  const fresh = entries.filter((entry) => {
    const createdAt = Date.parse(entry.createdAt);
    return !Number.isFinite(createdAt) || nowMs - createdAt <= DIRECT_TALK_OUTBOX_TTL_MS;
  });
  if (fresh.length <= DIRECT_TALK_OUTBOX_MAX_ENTRIES) return fresh;
  return [...fresh]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key))
    .slice(fresh.length - DIRECT_TALK_OUTBOX_MAX_ENTRIES);
}
const writeQueues = new WeakMap<WebGunService, Promise<void>>();

function deliveryKey(roomId: string, recipientUserId: string, talkId: string, contentHash: string): string {
  return [roomId, recipientUserId, talkId, contentHash].map((part) => encodeURIComponent(part)).join('|');
}

function parseEntries(raw: unknown): DirectTalkDeliveryEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const envelope = raw as Partial<DirectTalkDeliveryEnvelope>;
  if (envelope.version !== 1 || typeof envelope.entriesJson !== 'string') return [];
  try {
    const parsed = JSON.parse(envelope.entriesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DirectTalkDeliveryEntry => {
      const candidate = entry as Partial<DirectTalkDeliveryEntry>;
      return candidate?.version === 1
        && typeof candidate.key === 'string'
        && typeof candidate.roomId === 'string'
        && typeof candidate.recipientUserId === 'string'
        && typeof candidate.talkId === 'string'
        && !!candidate.payload;
    });
  } catch {
    return [];
  }
}

/** Author-owned encrypted local queue. No Talk body is written to peered Gun. */
export class DirectTalkDeliveryOutbox {
  constructor(private readonly gun: WebGunService, private readonly now: () => number = Date.now) {}

  async list(roomId?: string): Promise<DirectTalkDeliveryEntry[]> {
    const entries = boundedEntries(parseEntries(await this.gun.getPrivate(PRIVATE_KEY).catch(() => null)), this.now());
    return entries
      .filter((entry) => !roomId || entry.roomId === roomId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key));
  }

  async enqueue(
    roomId: string,
    recipientUserId: string,
    payload: P2PMeshTalkBodyPayload,
  ): Promise<DirectTalkDeliveryEntry> {
    const now = new Date(this.now()).toISOString();
    const contentHash = String(payload.contentHash || 'legacy');
    const key = deliveryKey(roomId, recipientUserId, payload.talkId, contentHash);
    let result: DirectTalkDeliveryEntry | null = null;
    await this.mutate((entries) => {
      const existing = entries.find((entry) => entry.key === key);
      result = {
        version: 1,
        key,
        roomId,
        recipientUserId,
        talkId: payload.talkId,
        contentHash,
        payload,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        attemptCount: existing?.attemptCount || 0,
        ...(existing?.lastAttemptAt ? { lastAttemptAt: existing.lastAttemptAt } : {}),
      };
      return [...entries.filter((entry) => entry.key !== key), result!];
    });
    return result!;
  }

  async markAttempt(key: string): Promise<void> {
    await this.mutate((entries) => entries.map((entry) => entry.key === key
      ? {
          ...entry,
          attemptCount: entry.attemptCount + 1,
          lastAttemptAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : entry));
  }

  async acknowledge(params: {
    roomId: string;
    recipientUserId: string;
    talkId: string;
    contentHash?: string;
  }): Promise<DirectTalkDeliveryEntry[]> {
    const removed: DirectTalkDeliveryEntry[] = [];
    await this.mutate((entries) => entries.filter((entry) => {
      const matches = entry.roomId === params.roomId
        && entry.recipientUserId === params.recipientUserId
        && entry.talkId === params.talkId
        && (!params.contentHash || entry.contentHash === params.contentHash);
      if (matches) removed.push(entry);
      return !matches;
    }));
    return removed;
  }

  async removeTalk(talkId: string): Promise<void> {
    await this.mutate((entries) => entries.filter((entry) => entry.talkId !== talkId));
  }

  private mutate(update: (entries: DirectTalkDeliveryEntry[]) => DirectTalkDeliveryEntry[]): Promise<void> {
    const previous = writeQueues.get(this.gun) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const current = parseEntries(await this.gun.getPrivate(PRIVATE_KEY).catch(() => null));
      const entries = boundedEntries(update(current), this.now());
      await this.gun.putPrivate(PRIVATE_KEY, {
        version: 1,
        entriesJson: JSON.stringify(entries),
        updatedAt: new Date().toISOString(),
      } satisfies DirectTalkDeliveryEnvelope);
    });
    writeQueues.set(this.gun, next);
    void next.finally(() => {
      if (writeQueues.get(this.gun) === next) writeQueues.delete(this.gun);
    }).catch(() => undefined);
    return next;
  }
}

