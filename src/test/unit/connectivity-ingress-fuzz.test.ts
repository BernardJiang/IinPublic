import { isConnectivityBindingShape } from '../../shared/connectivity-binding';
import { isP2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import { validateAndNormalizeCandidate } from '../../shared/peer-discovery-manager';
import { isGunSyncDeltaShape } from '../../shared/selective-gun-sync';

function malformedCorpus(): unknown[] {
  const primitives: unknown[] = [null, undefined, true, false, 0, 1, '', 'x'.repeat(100_000), [], {}, { proof: null }];
  let seed = 0x1a2b3c4d;
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 1_000; i += 1) {
    primitives.push({
      version: random() % 4,
      candidateId: random() % 3 ? String(random()) : null,
      sourceInstanceId: random() % 2 ? String(random()) : {},
      observedAt: random() % 2 ? new Date(random() * 1000).toISOString() : 'invalid',
      expiresAt: random() % 2 ? new Date(random() * 2000).toISOString() : null,
      addresses: random() % 2 ? [{ kind: random(), value: random() }] : null,
      capabilities: random() % 2 ? [random()] : {},
      roomIds: random() % 2 ? [random()] : null,
      proof: random() % 2 ? { pub: random() } : null,
      ttlHops: random(), payload: random() % 2 ? {} : null,
    });
  }
  return primitives;
}

describe('connectivity pre-auth ingress fuzz corpus', () => {
  test('candidate, binding and control-frame validators never throw', () => {
    for (const value of malformedCorpus()) {
      expect(() => validateAndNormalizeCandidate(value as never, new Date('2026-08-12T00:00:00Z'))).not.toThrow();
      expect(() => isConnectivityBindingShape(value)).not.toThrow();
      expect(() => isP2PMeshFrame(value)).not.toThrow();
      expect(() => isGunSyncDeltaShape(value)).not.toThrow();
    }
  });

  test('oversized and malformed values fail closed', () => {
    expect(isP2PMeshFrame({ version: 1, kind: 'mesh-ping', msgId: 'x'.repeat(257), roomId: '', originUserId: '', originPub: '', createdAt: 'no', ttlHops: 999, payload: {} })).toBe(false);
    expect(isConnectivityBindingShape({ version: 1, seaPub: 'a', connectivityId: 'b', proof: null })).toBe(false);
    expect(validateAndNormalizeCandidate({ version: 1, candidateId: 'a', sourceInstanceId: 'p' } as never)).toBeNull();
    expect(isGunSyncDeltaShape({ version: 1, valueJson: 'x'.repeat(2 * 1024 * 1024 + 1) })).toBe(false);
  });
});
