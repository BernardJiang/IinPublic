import {
  WebContentNodeService,
  applyDiscoveryConfigToLibp2pConfig,
  type WebContentNode,
} from '../../web/services/web-content-node-service';
import SEA from 'gun/sea';

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

  test('passes discovery config into node factory', async () => {
    const factory = jest.fn(async () => ({ libp2p: { id: 'peer-x' } as any }));
    const service = new WebContentNodeService(factory, {
      bootstrapPeers: ['/dns4/bootstrap-a/tcp/443/wss'],
      mdnsEnabled: false,
      dhtEnabled: true,
    });

    await service.ensureNode();

    expect(factory).toHaveBeenCalledWith({
      bootstrapPeers: ['/dns4/bootstrap-a/tcp/443/wss'],
      mdnsEnabled: false,
      dhtEnabled: true,
    });
  });

  test('applyDiscoveryConfigToLibp2pConfig overrides bootstrap and dht flags', () => {
    const out = applyDiscoveryConfigToLibp2pConfig(
      {
        peerDiscovery: ['bootstrap-default', 'mdns-default'],
        services: { dht: { enabled: true }, ping: { enabled: true } },
      },
      {
        bootstrapPeers: ['/dns4/bootstrap-custom/tcp/443/wss'],
        mdnsEnabled: false,
        dhtEnabled: false,
      },
      {
        bootstrap: (init) => ({ kind: 'bootstrap-custom', init }),
        mdns: () => ({ kind: 'mdns-custom' }),
      },
      false,
    );

    expect(out.peerDiscovery).toEqual([
      {
        kind: 'bootstrap-custom',
        init: {
          list: ['/dns4/bootstrap-custom/tcp/443/wss'],
          timeout: 1500,
          tagName: 'iinpublic-bootstrap',
          tagTTL: Number.POSITIVE_INFINITY,
        },
      },
    ]);
    expect(out.services).toEqual({ ping: { enabled: true } });
  });

  test('normalizes and pins attachment descriptors locally', () => {
    const service = new WebContentNodeService(async () => ({ libp2p: null }));

    const normalized = service.pinTalkAttachments('talk-1', [
      { cid: 'bafy1', name: 'private.bin', sizeBytes: 10, mimeType: 'application/octet-stream', enc: 'sea-pair' },
      { cid: 'bafy2', name: 'public.txt', sizeBytes: 4, mimeType: 'text/plain', enc: 'none' },
      { cid: '', name: 'ignored.txt', sizeBytes: 1, mimeType: 'text/plain', enc: 'none' },
    ]);

    expect(normalized).toEqual([
      { cid: 'bafy1', name: 'private.bin', sizeBytes: 10, mimeType: 'application/octet-stream', enc: 'sea-pair' },
      { cid: 'bafy2', name: 'public.txt', sizeBytes: 4, mimeType: 'text/plain', enc: 'none' },
    ]);
    expect(service.getPinnedTalkAttachments('talk-1')).toEqual(normalized);
  });

  test('publishes plaintext only with explicit opt-in and encrypts private bytes before add', async () => {
    const putCalls: Array<{ cid: string; bytes: Uint8Array }> = [];
    const pinCalls: string[] = [];
    const fakeNode: WebContentNode = {
      libp2p: null,
      blockstore: {
        put: async (cid, bytes) => {
          putCalls.push({ cid: String(cid), bytes: new Uint8Array(bytes) });
        },
      },
      pins: {
        add: async (cid) => {
          pinCalls.push(String(cid));
        },
      },
    };
    const service = new WebContentNodeService(async () => fakeNode, undefined, async (bytes) => `cid-${bytes.length}`);
    const senderPair = await SEA.pair();

    await expect(
      service.publishAttachmentBytes({
        talkId: 'talk-public',
        attachment: { cid: '', name: 'public.txt', sizeBytes: 5, mimeType: 'text/plain', enc: 'none' },
        bytes: 'hello',
        publicOptIn: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'public.txt',
        enc: 'none',
      }),
    );
    expect(new TextDecoder().decode(putCalls[0].bytes)).toBe('hello');
    expect(pinCalls).toHaveLength(1);

    await expect(
      service.publishAttachmentBytes({
        talkId: 'talk-private',
        attachment: { cid: '', name: 'private.txt', sizeBytes: 6, mimeType: 'text/plain', enc: 'sea-pair' },
        bytes: 'secret',
        senderPair,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'private.txt',
        enc: 'sea-pair',
      }),
    );
    expect(new TextDecoder().decode(putCalls[1].bytes)).not.toBe('secret');
    expect(pinCalls).toHaveLength(2);

    await expect(
      service.publishAttachmentBytes({
        talkId: 'talk-denied',
        attachment: { cid: '', name: 'denied.txt', sizeBytes: 4, mimeType: 'text/plain', enc: 'none' },
        bytes: 'oops',
      }),
    ).rejects.toThrow('publicOptIn');
  });

  test('fetches plaintext attachment bytes by cid', async () => {
    const byCid = new Map<string, Uint8Array>();
    byCid.set('cid-plain', new TextEncoder().encode('plain-bytes'));
    const fakeNode: WebContentNode = {
      libp2p: null,
      blockstore: {
        put: async () => undefined,
        get: async (cid) => byCid.get(String(cid)) || new Uint8Array(),
      },
    };
    const service = new WebContentNodeService(
      async () => fakeNode,
      undefined,
      async (bytes) => `cid-${bytes.length}`,
      (cid) => cid,
    );

    const out = await service.fetchAttachmentBytes({
      cid: 'cid-plain',
      enc: 'none',
    });

    expect(new TextDecoder().decode(out || new Uint8Array())).toBe('plain-bytes');
  });

  test('fetches and decrypts sea-pair attachment bytes by cid', async () => {
    const senderPair = await SEA.pair();
    const recipientPair = await SEA.pair();
    const secret = await SEA.secret(recipientPair.epub, senderPair as any);
    if (!secret) throw new Error('Expected SEA secret for test fixture');
    const ciphertext = await SEA.encrypt(JSON.stringify({ bytes: [1, 2, 3, 4] }), secret);
    const byCid = new Map<string, Uint8Array>();
    byCid.set('cid-private', new TextEncoder().encode(ciphertext));

    const fakeNode: WebContentNode = {
      libp2p: null,
      blockstore: {
        put: async () => undefined,
        get: async (cid) => byCid.get(String(cid)) || new Uint8Array(),
      },
    };
    const service = new WebContentNodeService(
      async () => fakeNode,
      undefined,
      async (bytes) => `cid-${bytes.length}`,
      (cid) => cid,
    );

    const out = await service.fetchAttachmentBytes({
      cid: 'cid-private',
      enc: 'sea-pair',
      senderEpub: senderPair.epub,
      recipientPair: recipientPair as any,
    });

    expect(Array.from(out || new Uint8Array())).toEqual([1, 2, 3, 4]);
  });
});
