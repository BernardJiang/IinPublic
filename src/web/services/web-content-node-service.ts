export type WebContentNode = {
  libp2p?: unknown;
};

import { parseBootstrapPeerMultiaddrs } from './p2p-room-discovery';

type NodeFactory = (discoveryConfig: WebContentNodeDiscoveryConfig) => Promise<WebContentNode>;

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

function pluginLooksLike(plugin: unknown, keyword: string): boolean {
  const text = String(plugin ?? '').toLowerCase();
  return text.includes(keyword);
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
  const [{ createHelia, libp2pDefaults }, bootstrapMod, mdnsMod] = await Promise.all([
    import('helia'),
    import('@libp2p/bootstrap'),
    import('@libp2p/mdns'),
  ]);

  const browserLike = typeof window !== 'undefined' && typeof document !== 'undefined';
  const baseLibp2p = libp2pDefaults();
  const libp2p = applyDiscoveryConfigToLibp2pConfig(
    baseLibp2p,
    discoveryConfig,
    {
      bootstrap: bootstrapMod.bootstrap,
      mdns: mdnsMod.mdns,
    },
    browserLike,
  );

  const node = await createHelia({ libp2p: libp2p as any });
  return node as unknown as WebContentNode;
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
  private node: WebContentNode | null = null;
  private nodePromise: Promise<WebContentNode> | null = null;

  constructor(
    factory: NodeFactory = defaultNodeFactory,
    discoveryConfig: WebContentNodeDiscoveryConfig = resolveDiscoveryConfigFromEnv(),
  ) {
    this.factory = factory;
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
}
