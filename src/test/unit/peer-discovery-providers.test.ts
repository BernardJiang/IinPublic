import SEA from 'gun/sea';
import { ConnectivityBindingVerifier, issueConnectivityBinding } from '../../shared/connectivity-binding';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { authenticatedGossipPoll, PollingPeerDiscoveryProvider, presenceRecordCandidate, transportCandidate } from '../../web/services/peer-discovery-providers';

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

  test.each(['hub-presence', 'known-peer', 'libp2p-dht', 'libp2p-bootstrap', 'mdns', 'discovery-gossip'] as const)(
    'common provider contract: %s', async (source) => {
      const providerId = `${source}-contract`;
      const baseSource = source === 'hub-presence' ? 'known-peer' : source;
      const value = { ...transportCandidate({ providerId, source: baseSource, transportId: 'peer' }), source };
      const provider = new PollingPeerDiscoveryProvider({ providerId, source, poll: async () => [value], intervalMs: 60_000 });
      const received: string[] = [];
      const unsubscribe = provider.subscribeCandidates((item) => received.push(item.candidateId));
      await provider.start({ localSeaPub: 'alice', roomIds: [] });
      unsubscribe();
      await provider.stop();
      expect(received).toEqual([value.candidateId]);
      expect(provider.getStatus().state).toBe('stopped');
    },
  );

  test('authenticated gossip drops a forged SEA binding', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const now = new Date();
    const valid = await issueConnectivityBinding({ pair, connectivityKind: 'libp2p-peer', connectivityId: 'peer-ok', sequence: 1, issuedAt: now });
    const forged = { ...valid, connectivityId: 'peer-attacker', sequence: 2 };
    const poll = authenticatedGossipPoll('gossip', async () => [forged, valid], new ConnectivityBindingVerifier(() => true), () => now);
    const candidates = await poll({ localSeaPub: 'local', roomIds: ['global'] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ seaPub: pair.pub, transportId: 'peer-ok', source: 'discovery-gossip' });
  });
});
