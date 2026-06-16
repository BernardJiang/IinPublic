import { pruneSignalingMap, startSignalingPruning } from '../../server/routes/system-routes';
import type { P2PSignalingEnvelope } from '../../shared/p2p-runtime';

function makeEnvelope(expiresAt: Date): P2PSignalingEnvelope {
  return {
    version: 1,
    conversationId: 'conv-test',
    kind: 'offer',
    senderPeerId: 'peer-a',
    senderPub: 'pub-a',
    recipientPub: 'pub-b',
    signalCiphertext: 'SEA{ciphertext}',
    timestamp: new Date().toISOString(),
    payloadHash: 'hash',
    signature: 'sig',
    nonce: 'nonce',
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

describe('pruneSignalingMap', () => {
  it('removes entries whose expiresAt is in the past', () => {
    const map = new Map<string, P2PSignalingEnvelope[]>();
    const past = new Date(Date.now() - 1000);
    map.set('conv-1', [makeEnvelope(past)]);
    map.set('conv-2', [makeEnvelope(past), makeEnvelope(past)]);

    pruneSignalingMap(map);

    expect(map.size).toBe(0);
  });

  it('retains entries whose expiresAt is in the future', () => {
    const map = new Map<string, P2PSignalingEnvelope[]>();
    const future = new Date(Date.now() + 60_000);
    map.set('conv-1', [makeEnvelope(future)]);

    pruneSignalingMap(map);

    expect(map.size).toBe(1);
    expect(map.get('conv-1')).toHaveLength(1);
  });

  it('keeps only fresh envelopes when a conversation has mixed expiry', () => {
    const map = new Map<string, P2PSignalingEnvelope[]>();
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);
    map.set('conv-1', [makeEnvelope(past), makeEnvelope(future)]);

    pruneSignalingMap(map);

    expect(map.size).toBe(1);
    expect(map.get('conv-1')).toHaveLength(1);
  });

  it('uses the provided `now` timestamp for TTL comparison', () => {
    const map = new Map<string, P2PSignalingEnvelope[]>();
    const expiresAt = new Date('2030-01-01T00:02:00Z');
    map.set('conv-1', [makeEnvelope(expiresAt)]);

    // Simulating "now" is after expiry
    pruneSignalingMap(map, new Date('2030-01-01T00:03:00Z'));
    expect(map.size).toBe(0);

    // Simulating "now" is before expiry
    map.set('conv-1', [makeEnvelope(expiresAt)]);
    pruneSignalingMap(map, new Date('2030-01-01T00:01:00Z'));
    expect(map.size).toBe(1);
  });
});

describe('startSignalingPruning', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls pruneSignalingMap on the 60-second interval', () => {
    const map = new Map<string, P2PSignalingEnvelope[]>();
    const past = new Date(Date.now() - 1000);
    map.set('conv-1', [makeEnvelope(past)]);
    map.set('conv-2', [makeEnvelope(past)]);

    const stop = startSignalingPruning(map);

    // Before the interval fires, map is untouched
    expect(map.size).toBe(2);

    // Advance past the 60-second interval
    jest.advanceTimersByTime(60_000);

    expect(map.size).toBe(0);

    stop();
  });

  it('stops pruning after cleanup is called', () => {
    const map = new Map<string, P2PSignalingEnvelope[]>();
    const past = new Date(Date.now() - 1000);

    const stop = startSignalingPruning(map);
    stop();

    map.set('conv-1', [makeEnvelope(past)]);
    jest.advanceTimersByTime(120_000);

    // Interval was cleared — map unchanged
    expect(map.size).toBe(1);
  });
});
