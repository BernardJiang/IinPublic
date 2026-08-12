import {
  AbstractPeerDiscoveryProvider,
  type ConnectivityCandidate,
  type PeerDiscoveryStartContext,
} from '../../shared/peer-discovery-provider';

class TestProvider extends AbstractPeerDiscoveryProvider {
  starts = 0;
  stops = 0;
  failStart = false;

  constructor() {
    super('test-hub', 'hub-presence');
  }

  protected async onStart(_context: PeerDiscoveryStartContext): Promise<void> {
    this.starts += 1;
    if (this.failStart) throw new Error('hub unavailable');
  }

  protected async onStop(): Promise<void> {
    this.stops += 1;
  }

  emit(candidate: ConnectivityCandidate): void {
    this.emitCandidate(candidate);
  }
}

function candidate(overrides: Partial<ConnectivityCandidate> = {}): ConnectivityCandidate {
  return {
    version: 1,
    candidateId: 'candidate-1',
    source: 'hub-presence',
    sourceInstanceId: 'test-hub',
    observedAt: '2026-08-12T00:00:00.000Z',
    expiresAt: '2026-08-12T00:01:00.000Z',
    addresses: [],
    capabilities: [],
    roomIds: ['global'],
    ...overrides,
  };
}

const context: PeerDiscoveryStartContext = {
  localSeaPub: 'alice-sea-pub',
  localUserId: 'alice',
  roomIds: ['global'],
};

describe('PeerDiscoveryProvider common lifecycle', () => {
  test('start and stop are idempotent and publish status', async () => {
    const provider = new TestProvider();
    const states: string[] = [];
    provider.subscribeStatus((status) => states.push(status.state));

    await Promise.all([provider.start(context), provider.start(context)]);
    await Promise.all([provider.stop(), provider.stop()]);

    expect(provider.starts).toBe(1);
    expect(provider.stops).toBe(1);
    expect(states).toEqual(['stopped', 'starting', 'running', 'stopped']);
  });

  test('candidate subscription preserves source provenance and can unsubscribe', async () => {
    const provider = new TestProvider();
    const received: ConnectivityCandidate[] = [];
    const unsubscribe = provider.subscribeCandidates((value) => received.push(value));
    await provider.start(context);

    provider.emit(candidate());
    unsubscribe();
    provider.emit(candidate({ candidateId: 'candidate-2' }));

    expect(received.map((item) => item.candidateId)).toEqual(['candidate-1']);
    expect(provider.getStatus().candidateCount).toBe(2);
  });

  test('rejects candidates claiming another provider as their source', () => {
    const provider = new TestProvider();
    expect(() => provider.emit(candidate({ sourceInstanceId: 'spoofed-provider' })))
      .toThrow('candidate provenance does not match provider');
  });

  test('contains start failure in provider status', async () => {
    const provider = new TestProvider();
    provider.failStart = true;

    await expect(provider.start(context)).rejects.toThrow('hub unavailable');
    expect(provider.getStatus()).toMatchObject({ state: 'failed', lastError: 'hub unavailable' });
  });
});

