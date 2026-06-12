export type WebContentNode = {
  libp2p?: unknown;
};

import { parseBootstrapPeerMultiaddrs } from './p2p-room-discovery';

type NodeFactory = () => Promise<WebContentNode>;

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

async function defaultNodeFactory(): Promise<WebContentNode> {
  const { createHelia } = await import('helia');
  const node = await createHelia();
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
      this.nodePromise = this.factory()
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
