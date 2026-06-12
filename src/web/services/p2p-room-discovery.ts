type ContentRoutingLike = {
  provide?: (key: unknown) => Promise<void>;
  findProviders?: (key: unknown, options?: { timeout?: number; limit?: number }) => AsyncIterable<unknown>;
};

type Libp2pLike = {
  contentRouting?: ContentRoutingLike;
};

type EnsureLibp2p = () => Promise<unknown>;

type FindOptions = {
  timeoutMs?: number;
  limit?: number;
};

function normalizeRoomId(roomId: string): string {
  return String(roomId || '').trim().toLowerCase();
}

function providerPeerId(provider: unknown): string {
  const obj = provider as any;
  const rawId = obj?.id ?? obj?.peerId ?? obj;
  if (!rawId) return '';
  if (typeof rawId === 'string') return rawId;
  if (typeof rawId?.toString === 'function') return String(rawId.toString());
  return '';
}

export function parseBootstrapPeerMultiaddrs(rawList?: string): string[] {
  if (!rawList) return [];
  const deduped = new Set<string>();
  for (const item of rawList.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return [...deduped];
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('WebCrypto SHA-256 is not available');
}

export async function roomRendezvousKey(roomId: string): Promise<string> {
  const normalized = normalizeRoomId(roomId);
  return `iinpublic-room:${await sha256Hex(normalized)}`;
}

/**
 * L3 foundation: room rendezvous discovery over libp2p content routing.
 * Uses deterministic room-key CID so all peers converge on the same discovery key.
 */
export class P2PRoomDiscoveryService {
  private readonly ensureLibp2p: EnsureLibp2p;
  private readonly bootstrapPeers: string[];

  constructor(ensureLibp2p: EnsureLibp2p, bootstrapPeers: string[] = []) {
    this.ensureLibp2p = ensureLibp2p;
    this.bootstrapPeers = [...bootstrapPeers];
  }

  static fromEnv(ensureLibp2p: EnsureLibp2p): P2PRoomDiscoveryService {
    const raw =
      typeof process !== 'undefined' && process.env
        ? process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS
        : undefined;
    return new P2PRoomDiscoveryService(ensureLibp2p, parseBootstrapPeerMultiaddrs(raw));
  }

  getBootstrapPeers(): string[] {
    return [...this.bootstrapPeers];
  }

  async announceRoom(roomId: string): Promise<void> {
    const libp2p = (await this.ensureLibp2p()) as Libp2pLike | null;
    const contentRouting = libp2p?.contentRouting;
    const provide = contentRouting?.provide;
    if (typeof provide !== 'function') return;
    const key = await roomRendezvousKey(roomId);
    await provide.call(contentRouting, key);
  }

  async findRoomProviderPeerIds(roomId: string, options?: FindOptions): Promise<string[]> {
    const libp2p = (await this.ensureLibp2p()) as Libp2pLike | null;
    const contentRouting = libp2p?.contentRouting;
    const findProviders = contentRouting?.findProviders;
    if (typeof findProviders !== 'function') {
      return this.getBootstrapPeers();
    }

    const key = await roomRendezvousKey(roomId);
    const timeoutMs = Math.max(1, options?.timeoutMs ?? 2000);
    const limit = Math.max(1, options?.limit ?? 20);
    const found = new Set<string>();
    const deadline = Date.now() + timeoutMs;

    const providers = findProviders.call(contentRouting, key, {
      timeout: timeoutMs,
      limit,
    });

    for await (const provider of providers) {
      const peerId = providerPeerId(provider);
      if (peerId) found.add(peerId);
      if (found.size >= limit) break;
      if (Date.now() >= deadline) break;
    }

    if (found.size === 0) {
      for (const peer of this.bootstrapPeers) found.add(peer);
    }

    return [...found];
  }
}
