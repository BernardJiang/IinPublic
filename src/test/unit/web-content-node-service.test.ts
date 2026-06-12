import { WebContentNodeService, type WebContentNode } from '../../web/services/web-content-node-service';

describe('WebContentNodeService', () => {
  test('lazy initializes only on first use and exposes libp2p', async () => {
    let calls = 0;
    const node: WebContentNode = { libp2p: { id: 'peer-1' } };
    const service = new WebContentNodeService(async () => {
      calls += 1;
      return node;
    });

    expect(service.hasInitialized()).toBe(false);

    const libp2p = await service.ensureLibp2p();

    expect(libp2p).toEqual({ id: 'peer-1' });
    expect(service.hasInitialized()).toBe(true);
    expect(calls).toBe(1);

    const nodeAgain = await service.ensureNode();
    expect(nodeAgain).toBe(node);
    expect(calls).toBe(1);
  });

  test('retries after failed initialization', async () => {
    let attempt = 0;
    const service = new WebContentNodeService(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('boom');
      }
      return { libp2p: { id: 'peer-2' } };
    });

    await expect(service.ensureNode()).rejects.toThrow('boom');
    expect(service.hasInitialized()).toBe(false);

    const node = await service.ensureNode();
    expect(node.libp2p).toEqual({ id: 'peer-2' });
    expect(service.hasInitialized()).toBe(true);
    expect(attempt).toBe(2);
  });

  test('reads discovery config from environment by default', () => {
    const prevPeers = process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS;
    const prevMdns = process.env.IINPUBLIC_P2P_MDNS_ENABLED;
    const prevDht = process.env.IINPUBLIC_P2P_DHT_ENABLED;
    process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS = '/dns4/bootstrap-a/tcp/443/wss, /dns4/bootstrap-b/tcp/443/wss';
    process.env.IINPUBLIC_P2P_MDNS_ENABLED = 'false';
    process.env.IINPUBLIC_P2P_DHT_ENABLED = 'true';

    try {
      const service = new WebContentNodeService(async () => ({ libp2p: null }));
      expect(service.getDiscoveryConfig()).toEqual({
        bootstrapPeers: ['/dns4/bootstrap-a/tcp/443/wss', '/dns4/bootstrap-b/tcp/443/wss'],
        mdnsEnabled: false,
        dhtEnabled: true,
      });
    } finally {
      if (prevPeers === undefined) delete process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS;
      else process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS = prevPeers;
      if (prevMdns === undefined) delete process.env.IINPUBLIC_P2P_MDNS_ENABLED;
      else process.env.IINPUBLIC_P2P_MDNS_ENABLED = prevMdns;
      if (prevDht === undefined) delete process.env.IINPUBLIC_P2P_DHT_ENABLED;
      else process.env.IINPUBLIC_P2P_DHT_ENABLED = prevDht;
    }
  });
});
