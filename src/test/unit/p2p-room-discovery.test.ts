import { P2PRoomDiscoveryService, parseBootstrapPeerMultiaddrs, roomRendezvousKey } from '../../web/services/p2p-room-discovery';

describe('P2PRoomDiscoveryService', () => {
  test('parses bootstrap multiaddrs from env-like list', () => {
    expect(parseBootstrapPeerMultiaddrs('')).toEqual([]);
    expect(parseBootstrapPeerMultiaddrs('  ')).toEqual([]);
    expect(parseBootstrapPeerMultiaddrs('/ip4/1.2.3.4/tcp/4001, /ip4/1.2.3.4/tcp/4001, /dns4/p.example/tcp/443/wss'))
      .toEqual(['/ip4/1.2.3.4/tcp/4001', '/dns4/p.example/tcp/443/wss']);
  });

  test('room rendezvous key is deterministic', async () => {
    const a = await roomRendezvousKey('Global');
    const b = await roomRendezvousKey(' global ');
    expect(a).toBe(b);
  });

  test('announceRoom calls contentRouting.provide', async () => {
    const provide = jest.fn(async () => undefined);
    const service = new P2PRoomDiscoveryService(async () => ({
      contentRouting: { provide },
    }));

    await service.announceRoom('global');

    expect(provide).toHaveBeenCalledTimes(1);
  });

  test('findRoomProviderPeerIds returns provider peer ids', async () => {
    const findProviders = jest.fn(async function* providers() {
      yield { id: 'peer-a' };
      yield { peerId: 'peer-b' };
      yield { id: 'peer-a' };
    });

    const service = new P2PRoomDiscoveryService(async () => ({
      contentRouting: { findProviders },
    }));

    const peers = await service.findRoomProviderPeerIds('global', { timeoutMs: 1000, limit: 10 });

    expect(peers).toEqual(['peer-a', 'peer-b']);
  });

  test('falls back to bootstrap peers when content routing is unavailable', async () => {
    const service = new P2PRoomDiscoveryService(async () => ({}), [
      '/dns4/bootstrap-1/tcp/443/wss',
      '/dns4/bootstrap-2/tcp/443/wss',
    ]);

    const peers = await service.findRoomProviderPeerIds('global');

    expect(peers).toEqual([
      '/dns4/bootstrap-1/tcp/443/wss',
      '/dns4/bootstrap-2/tcp/443/wss',
    ]);
  });
});
