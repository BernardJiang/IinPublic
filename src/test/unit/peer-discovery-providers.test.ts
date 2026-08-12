import { presenceRecordCandidate, transportCandidate } from '../../web/services/peer-discovery-providers';

describe('peer discovery provider adapters', () => {
  test('wraps hub presence without treating userId as a transport identity', () => {
    const value = presenceRecordCandidate({ version: 1, userId: 'bob', pub: 'bob-sea', lastSeen: '2026-08-12T00:00:00.000Z', expiresAt: '2026-08-12T00:01:00.000Z' });
    expect(value).toMatchObject({ seaPub: 'bob-sea', userId: 'bob', source: 'hub-presence' });
    expect(value.transportId).toBeUndefined();
  });

  test.each(['known-peer', 'libp2p-dht', 'libp2p-bootstrap', 'mdns', 'discovery-gossip'] as const)(
    'normalizes %s transport candidates with provenance', (source) => {
      const value = transportCandidate({ providerId: `${source}-1`, source, transportId: '12D3peer', multiaddrs: ['/ip4/127.0.0.1/tcp/1'] });
      expect(value).toMatchObject({ source, sourceInstanceId: `${source}-1`, transportId: '12D3peer' });
      expect(value.addresses).toEqual([{ kind: 'multiaddr', value: '/ip4/127.0.0.1/tcp/1' }]);
    });
});

