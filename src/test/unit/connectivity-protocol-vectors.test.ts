import vectors from '../../../docs/protocol/test-vectors/connectivity-v1.json';
import { isP2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import { isGunSyncDeltaShape } from '../../shared/selective-gun-sync';

describe('published connectivity protocol v1 vectors', () => {
  test.each(vectors.controlFrames)('$name', ({ value, valid }) => {
    expect(isP2PMeshFrame(value)).toBe(valid);
  });
  test.each(vectors.gunDeltas)('$name', ({ value, valid }) => {
    expect(isGunSyncDeltaShape(value)).toBe(valid);
  });
});
