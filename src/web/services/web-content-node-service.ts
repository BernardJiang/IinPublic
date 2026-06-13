export type WebContentNode = {
  libp2p?: unknown;
  blockstore?: {
    put: (cid: unknown, bytes: Uint8Array) => Promise<void>;
    get?: (cid: unknown) => Promise<unknown>;
  };
  pins?: {
    add: (cid: unknown) => Promise<void>;
  };
};

import { getSEA, type GunPair } from '../sea-gun';
import type { IpfsAttachment } from '../../shared/types';
import { parseBootstrapPeerMultiaddrs } from './p2p-room-discovery';

type NodeFactory = (discoveryConfig: WebContentNodeDiscoveryConfig) => Promise<WebContentNode>;
type CidFactory = (bytes: Uint8Array) => Promise<unknown>;
type CidParser = (cid: string) => unknown | Promise<unknown>;

export type WebContentNodeDiscoveryConfig = {
  bootstrapPeers: string[];
  mdnsEnabled: boolean;
  dhtEnabled: boolean;
};

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
}

function resolveDiscoveryConfigFromEnv(): WebContentNodeDiscoveryConfig {
  return {
    bootstrapPeers: parseBootstrapPeerMultiaddrs(readEnv('IINPUBLIC_P2P_BOOTSTRAP_PEERS')),
    mdnsEnabled: parseBooleanFlag(readEnv('IINPUBLIC_P2P_MDNS_ENABLED'), true),
    dhtEnabled: parseBooleanFlag(readEnv('IINPUBLIC_P2P_DHT_ENABLED'), true),
  };
}

type Libp2pConfigLike = {
  peerDiscovery?: unknown[];
  services?: Record<string, unknown>;
};

type DiscoveryModules = {
  bootstrap?: (init: { list: string[]; timeout?: number; tagName?: string; tagTTL?: number }) => unknown;
  mdns?: () => unknown;
};

type PinnedAttachmentRecord = {
  talkId: string;
  pinnedAt: string;
  attachments: IpfsAttachment[];
};

type PublishedAttachmentBytes = {
  cid: string;
  bytes: Uint8Array;
  encrypted: boolean;
};

const PINNED_ATTACHMENTS_STORAGE = 'iinpublic_pinned_ipfs_attachments';

function pluginLooksLike(plugin: unknown, keyword: string): boolean {
  const text = String(plugin ?? '').toLowerCase();
  return text.includes(keyword);
}

async function normalizeBlockBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  const candidate = value as {
    toUint8Array?: () => Uint8Array;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
    [Symbol.iterator]?: () => Iterator<number>;
  } | null;
  if (typeof candidate?.toUint8Array === 'function') return candidate.toUint8Array();
  if (typeof candidate?.[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of candidate as AsyncIterable<unknown>) {
      const bytes = await normalizeBlockBytes(chunk);
      chunks.push(bytes);
      total += bytes.length;
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  }
  if (typeof candidate?.[Symbol.iterator] === 'function') {
    return Uint8Array.from(candidate as Iterable<number>);
  }
  throw new Error('Unsupported blockstore byte result');
}

/**
 * Applies runtime discovery toggles to a libp2p config object.
 * Best-effort keyword filtering is used because discovery plugin factories are opaque values.
 */
export function applyDiscoveryConfigToLibp2pConfig(
  base: Libp2pConfigLike,
  discoveryConfig: WebContentNodeDiscoveryConfig,
  modules: DiscoveryModules,
  browserLike: boolean,
): Libp2pConfigLike {
  const existingPeerDiscovery = Array.isArray(base.peerDiscovery) ? [...base.peerDiscovery] : [];
  const services = { ...(base.services || {}) };

  let peerDiscovery = [...existingPeerDiscovery];

  if (discoveryConfig.bootstrapPeers.length > 0 && typeof modules.bootstrap === 'function') {
    peerDiscovery = peerDiscovery.filter((plugin) => !pluginLooksLike(plugin, 'bootstrap'));
    peerDiscovery.push(
      modules.bootstrap({
        list: [...discoveryConfig.bootstrapPeers],
        timeout: 1_500,
        tagName: 'iinpublic-bootstrap',
        tagTTL: Number.POSITIVE_INFINITY,
      }),
    );
  }

  if (!discoveryConfig.mdnsEnabled) {
    peerDiscovery = peerDiscovery.filter((plugin) => !pluginLooksLike(plugin, 'mdns'));
  } else if (!browserLike && typeof modules.mdns === 'function') {
    const hasMdns = peerDiscovery.some((plugin) => pluginLooksLike(plugin, 'mdns'));
    if (!hasMdns) peerDiscovery.push(modules.mdns());
  }

  if (!discoveryConfig.dhtEnabled && services.dht !== undefined) {
    delete services.dht;
  }

  return {
    ...base,
    peerDiscovery,
    services,
  };
}

async function defaultNodeFactory(discoveryConfig: WebContentNodeDiscoveryConfig): Promise<WebContentNode> {
  const browserLike = typeof window !== 'undefined' && typeof document !== 'undefined';
  const [{ createHelia, libp2pDefaults }, bootstrapMod, mdnsMod] = await Promise.all([
    import('helia'),
    import('@libp2p/bootstrap'),
    browserLike ? Promise.resolve(undefined) : import('@libp2p/mdns'),
  ]);

  const baseLibp2p = libp2pDefaults();
  const libp2p = applyDiscoveryConfigToLibp2pConfig(
    baseLibp2p,
    discoveryConfig,
    {
      bootstrap: bootstrapMod.bootstrap,
      ...(mdnsMod ? { mdns: mdnsMod.mdns } : {}),
    },
    browserLike,
  );

  const node = await createHelia({ libp2p: libp2p as any });
  return node as unknown as WebContentNode;
}

async function defaultCidFactory(bytes: Uint8Array): Promise<unknown> {
  const [{ CID }, { sha256 }, raw] = await Promise.all([
    import('multiformats'),
    import('multiformats/hashes/sha2'),
    import('multiformats/codecs/raw'),
  ]);
  return CID.createV1(raw.code, await sha256.digest(bytes));
}

async function defaultCidParser(cid: string): Promise<unknown> {
  const { CID } = await import('multiformats');
  return CID.parse(cid);
}

/**
 * Lazy Helia/libp2p bootstrap for the browser content layer.
 *
 * We intentionally do not initialize this during first paint. The node is
 * created on first content-layer use only.
 */
export class WebContentNodeService {
  private readonly factory: NodeFactory;
  private readonly discoveryConfig: WebContentNodeDiscoveryConfig;
  private readonly cidFactory: CidFactory;
  private readonly cidParser: CidParser;
  private node: WebContentNode | null = null;
  private nodePromise: Promise<WebContentNode> | null = null;
  private pinnedAttachments = new Map<string, PinnedAttachmentRecord>();

  constructor(
    factory: NodeFactory = defaultNodeFactory,
    discoveryConfig: WebContentNodeDiscoveryConfig = resolveDiscoveryConfigFromEnv(),
    cidFactory: CidFactory = defaultCidFactory,
    cidParser: CidParser = defaultCidParser,
  ) {
    this.factory = factory;
    this.cidFactory = cidFactory;
    this.cidParser = cidParser;
    this.discoveryConfig = {
      bootstrapPeers: [...(discoveryConfig.bootstrapPeers || [])],
      mdnsEnabled: !!discoveryConfig.mdnsEnabled,
      dhtEnabled: !!discoveryConfig.dhtEnabled,
    };
  }

  getDiscoveryConfig(): WebContentNodeDiscoveryConfig {
    return {
      bootstrapPeers: [...this.discoveryConfig.bootstrapPeers],
      mdnsEnabled: this.discoveryConfig.mdnsEnabled,
      dhtEnabled: this.discoveryConfig.dhtEnabled,
    };
  }

  hasInitialized(): boolean {
    return this.node !== null;
  }

  async ensureNode(): Promise<WebContentNode> {
    if (this.node) return this.node;
    if (!this.nodePromise) {
      this.nodePromise = this.factory(this.discoveryConfig)
        .then((node) => {
          this.node = node;
          return node;
        })
        .catch((error) => {
          this.nodePromise = null;
          throw error;
        });
    }
    return this.nodePromise;
  }

  async ensureLibp2p(): Promise<unknown> {
    const node = await this.ensureNode();
    return node.libp2p;
  }

  private normalizeAttachment(attachment: unknown): IpfsAttachment | null {
    const normalized = this.normalizeIpfsAttachments([attachment]);
    return normalized[0] || null;
  }

  private async storeRawBytes(bytes: Uint8Array): Promise<string> {
    const node = await this.ensureNode();
    const cid = await this.cidFactory(bytes);
    await node.blockstore?.put(cid, bytes);
    try {
      await node.pins?.add(cid);
    } catch {
      /* best-effort pinning; the local registry remains authoritative for E2E */
    }
    return String(cid);
  }

  async publishAttachmentBytes(params: {
    talkId: string;
    attachment: unknown;
    bytes: Uint8Array | string;
    senderPair?: GunPair;
    recipientEpub?: string;
    publicOptIn?: boolean;
  }): Promise<IpfsAttachment> {
    const descriptor = params.attachment as Partial<IpfsAttachment> | null | undefined;
    const name = String(descriptor?.name || '').trim();
    const mimeType = String(descriptor?.mimeType || '').trim();
    const sizeBytes = Number(descriptor?.sizeBytes);
    const enc = descriptor?.enc;
    if (!name || !mimeType || !Number.isFinite(sizeBytes) || (enc !== 'sea-pair' && enc !== 'none')) {
      throw new Error('publishAttachmentBytes requires a valid attachment descriptor');
    }
    const attachment: IpfsAttachment = {
      cid: String(descriptor?.cid || '').trim(),
      name,
      mimeType,
      sizeBytes,
      enc,
    };
    const sourceBytes = typeof params.bytes === 'string'
      ? new TextEncoder().encode(params.bytes)
      : params.bytes;
    let storedBytes = sourceBytes;

    if (attachment.enc === 'sea-pair') {
      const senderPair = params.senderPair;
      const recipientEpub = params.recipientEpub || senderPair?.epub;
      if (!senderPair?.epub || !senderPair?.priv) {
        throw new Error('SEA pair encryption requires a sender pair');
      }
      if (!recipientEpub) {
        throw new Error('SEA pair encryption requires a recipient epub or sender epub fallback');
      }
      const secret = await getSEA().secret(recipientEpub, senderPair);
      if (!secret) throw new Error('SEA.secret returned null — check epub and pair');
      const ciphertext = await getSEA().encrypt(JSON.stringify({ bytes: Array.from(sourceBytes) }), secret);
      storedBytes = new TextEncoder().encode(ciphertext);
    } else if (!params.publicOptIn) {
      throw new Error('plaintext attachment publication requires publicOptIn');
    }

    const cid = await this.storeRawBytes(storedBytes);
    this.pinTalkAttachments(params.talkId, [{ ...attachment, cid }]);
    return { ...attachment, cid };
  }

  normalizeIpfsAttachments(attachments: unknown): IpfsAttachment[] {
    if (!Array.isArray(attachments)) return [];
    const normalized: IpfsAttachment[] = [];
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      const cid = String((attachment as { cid?: unknown }).cid || '').trim();
      const name = String((attachment as { name?: unknown }).name || '').trim();
      const mimeType = String((attachment as { mimeType?: unknown }).mimeType || '').trim();
      const sizeBytes = Number((attachment as { sizeBytes?: unknown }).sizeBytes);
      const enc = (attachment as { enc?: unknown }).enc;
      if (!cid || !name || !mimeType || !Number.isFinite(sizeBytes)) continue;
      if (enc !== 'sea-pair' && enc !== 'none') continue;
      normalized.push({ cid, name, mimeType, sizeBytes, enc });
    }
    return normalized;
  }

  async fetchAttachmentBytes(params: {
    cid: string;
    enc: 'sea-pair' | 'none';
    senderEpub?: string;
    recipientPair?: GunPair;
  }): Promise<Uint8Array | null> {
    const cidString = String(params.cid || '').trim();
    if (!cidString) return null;
    const node = await this.ensureNode();
    if (!node.blockstore?.get) return null;

    const cid = await this.cidParser(cidString);
    const storedBytes = await normalizeBlockBytes(await node.blockstore.get(cid));
    if (params.enc === 'none') return storedBytes;

    const senderEpub = String(params.senderEpub || '').trim();
    if (!senderEpub || !params.recipientPair?.priv) {
      throw new Error('SEA decrypt requires senderEpub and recipientPair');
    }
    const ciphertext = new TextDecoder().decode(storedBytes);
    const secret = await getSEA().secret(senderEpub, params.recipientPair);
    if (!secret) throw new Error('SEA.secret returned null while decrypting attachment bytes');
    const decrypted = await getSEA().decrypt(ciphertext, secret);
    if (!decrypted) throw new Error('Attachment decrypt failed');

    const payload = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    const bytes = Array.isArray((payload as any)?.bytes)
      ? (payload as any).bytes
      : null;
    if (!bytes) throw new Error('Attachment payload missing bytes array');
    return Uint8Array.from(bytes as number[]);
  }

  getPublishedAttachmentBytesMetadata(params: {
    talkId: string;
    attachment: unknown;
    bytes: Uint8Array | string;
    senderPair?: GunPair;
    recipientEpub?: string;
    publicOptIn?: boolean;
  }): PublishedAttachmentBytes {
    const attachment = this.normalizeAttachment(params.attachment);
    if (!attachment) {
      throw new Error('publishAttachmentBytes requires a valid attachment descriptor');
    }
    const sourceBytes = typeof params.bytes === 'string'
      ? new TextEncoder().encode(params.bytes)
      : params.bytes;
    const encrypted = attachment.enc === 'sea-pair';
    return {
      cid: '',
      bytes: sourceBytes,
      encrypted,
    };
  }

  pinTalkAttachments(talkId: string, attachments: unknown): IpfsAttachment[] {
    const normalized = this.normalizeIpfsAttachments(attachments);
    if (!talkId || normalized.length === 0) return normalized;
    const record: PinnedAttachmentRecord = {
      talkId,
      pinnedAt: new Date().toISOString(),
      attachments: normalized,
    };
    this.pinnedAttachments.set(talkId, record);
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(PINNED_ATTACHMENTS_STORAGE);
        const store = raw ? JSON.parse(raw) as Record<string, PinnedAttachmentRecord> : {};
        store[talkId] = record;
        localStorage.setItem(PINNED_ATTACHMENTS_STORAGE, JSON.stringify(store));
      }
    } catch {
      /* best-effort local pin registry */
    }
    return normalized;
  }

  getPinnedTalkAttachments(talkId: string): IpfsAttachment[] {
    const inMemory = this.pinnedAttachments.get(talkId);
    if (inMemory) return [...inMemory.attachments];
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(PINNED_ATTACHMENTS_STORAGE);
      if (!raw) return [];
      const store = JSON.parse(raw) as Record<string, PinnedAttachmentRecord>;
      return this.normalizeIpfsAttachments(store[talkId]?.attachments);
    } catch {
      return [];
    }
  }

  unpinTalkAttachments(talkId: string): void {
    if (!talkId) return;
    this.pinnedAttachments.delete(talkId);
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(PINNED_ATTACHMENTS_STORAGE);
      if (!raw) return;
      const store = JSON.parse(raw) as Record<string, PinnedAttachmentRecord>;
      if (store[talkId] === undefined) return;
      delete store[talkId];
      localStorage.setItem(PINNED_ATTACHMENTS_STORAGE, JSON.stringify(store));
    } catch {
      /* best-effort local unpin registry */
    }
  }
}
