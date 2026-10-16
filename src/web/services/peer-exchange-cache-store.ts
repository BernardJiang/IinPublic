import {
  PEER_EXCHANGE_CACHE_MAX_RECORDS_PER_ROOM,
  verifyCachedPeerExchangeEntry,
  type PeerExchangeCacheEntry,
} from '../../shared/peer-exchange';

type PrivateStore = {
  getPrivate(key: string): Promise<unknown>;
  getPrivateLocal?(key: string): Promise<unknown>;
  putPrivate(key: string, value: unknown): Promise<void>;
};

type PeerExchangeCacheDocument = {
  version: 1;
  entries: PeerExchangeCacheEntry[];
};

const ROOT = 'peerExchangeCache/v1';

/** Device-local, owner-encrypted PEX cache. Nothing here is written to peered Gun. */
export class PeerExchangeCacheStore {
  constructor(private readonly store: PrivateStore) {}

  async load(roomId: string, now = new Date()): Promise<PeerExchangeCacheEntry[]> {
    let raw: unknown;
    try {
      raw = this.store.getPrivateLocal
        ? await this.store.getPrivateLocal(this.key(roomId))
        : await this.store.getPrivate(this.key(roomId));
    } catch {
      return [];
    }
    if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return [];
    const values = Array.isArray((raw as Partial<PeerExchangeCacheDocument>).entries)
      ? (raw as PeerExchangeCacheDocument).entries
      : [];
    const accepted: PeerExchangeCacheEntry[] = [];
    for (const value of values.slice(0, PEER_EXCHANGE_CACHE_MAX_RECORDS_PER_ROOM * 2)) {
      const checked = await verifyCachedPeerExchangeEntry(value, { expectedRoomId: roomId, now });
      if (checked.ok) accepted.push(checked.entry);
    }
    return this.bounded(accepted);
  }

  async save(roomId: string, entries: readonly PeerExchangeCacheEntry[]): Promise<void> {
    const document: PeerExchangeCacheDocument = {
      version: 1,
      entries: this.bounded(entries.filter((entry) => entry.record.roomId === roomId)),
    };
    await this.store.putPrivate(this.key(roomId), document);
  }

  private bounded(entries: readonly PeerExchangeCacheEntry[]): PeerExchangeCacheEntry[] {
    const byUser = new Map<string, PeerExchangeCacheEntry>();
    for (const entry of entries) {
      const prior = byUser.get(entry.record.userId);
      if (!prior || Date.parse(entry.verifiedAt) > Date.parse(prior.verifiedAt)) {
        byUser.set(entry.record.userId, entry);
      }
    }
    return [...byUser.values()]
      .sort((left, right) => {
        const leftConnected = Date.parse(left.lastConnectedAt || left.verifiedAt);
        const rightConnected = Date.parse(right.lastConnectedAt || right.verifiedAt);
        return rightConnected - leftConnected || left.record.userId.localeCompare(right.record.userId);
      })
      .slice(0, PEER_EXCHANGE_CACHE_MAX_RECORDS_PER_ROOM);
  }

  private key(roomId: string): string {
    return `${ROOT}/${encodeURIComponent(roomId)}`;
  }
}
