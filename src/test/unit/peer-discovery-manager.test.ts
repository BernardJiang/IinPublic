import { PeerDiscoveryManager, validateAndNormalizeCandidate } from '../../shared/peer-discovery-manager';
import { AbstractPeerDiscoveryProvider, type ConnectivityCandidate, type PeerDiscoveryStartContext } from '../../shared/peer-discovery-provider';

class ManualProvider extends AbstractPeerDiscoveryProvider {
  constructor(id: string, private readonly fail = false) { super(id, 'known-peer'); }
  protected async onStart(_context: PeerDiscoveryStartContext): Promise<void> { if (this.fail) throw new Error('failed'); }
  protected async onStop(): Promise<void> { /* no-op */ }
  push(value: ConnectivityCandidate): void { this.emitCandidate(value); }
}

const now = new Date('2026-08-12T00:00:00.000Z');
function candidate(providerId: string, id: string, seaPub = 'bob-pub'): ConnectivityCandidate {
  return { version: 1, candidateId: id, source: 'known-peer', sourceInstanceId: providerId,
    observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), seaPub,
    addresses: [], capabilities: [], roomIds: [] };
}

describe('PeerDiscoveryManager', () => {
  test('one provider failure does not disable another', async () => {
    const failed = new ManualProvider('failed', true);
    const healthy = new ManualProvider('healthy');
    const manager = new PeerDiscoveryManager([failed, healthy], () => now);
    await manager.start({ localSeaPub: 'alice', roomIds: [] });
    healthy.push(candidate('healthy', 'bob'));
    expect(manager.getSnapshot().candidates).toHaveLength(1);
    expect(manager.getSnapshot().providers.map((p) => p.state)).toEqual(['failed', 'running']);
  });

  test('deduplicates the same SEA peer across providers and merges addresses', async () => {
    const first = new ManualProvider('first');
    const second = new ManualProvider('second');
    const manager = new PeerDiscoveryManager([first, second], () => now);
    await manager.start({ localSeaPub: 'alice', roomIds: [] });
    first.push({ ...candidate('first', 'one'), addresses: [{ kind: 'multiaddr', value: '/ip4/1.1.1.1/tcp/1' }] });
    second.push({ ...candidate('second', 'two'), addresses: [{ kind: 'multiaddr', value: '/ip4/2.2.2.2/tcp/2' }] });
    const [merged] = manager.getSnapshot().candidates;
    expect(manager.getSnapshot().candidates).toHaveLength(1);
    expect(merged?.addresses).toHaveLength(2);
  });

  test('invalid and expired candidates fail closed', () => {
    expect(validateAndNormalizeCandidate(candidate('p', 'x'), new Date(now.getTime() + 61_000))).toBeNull();
    expect(validateAndNormalizeCandidate({ ...candidate('p', 'x'), expiresAt: 'not-a-date' }, now)).toBeNull();
  });
});

