import {
  advanceNearbySparseState,
  initialNearbySparseState,
  type NearbySparsePolicy,
} from '../../shared/nearby-sparse-policy';

const policy: NearbySparsePolicy = {
  sparseMemberMax: 1,
  denseMemberMin: 5,
  sparseDwellMs: 1_000,
  denseDwellMs: 500,
  maxWideningLevel: 3,
};

describe('Nearby sparse-area hysteresis', () => {
  test('widens only after one continuous sparse dwell and only one level per decision', () => {
    const started = advanceNearbySparseState({
      state: initialNearbySparseState(), activeMemberCount: 1, nowMs: 10_000, policy,
    });
    expect(started.direction).toBe('hold');
    const early = advanceNearbySparseState({
      state: started.state, activeMemberCount: 1, nowMs: 10_999, policy,
    });
    expect(early.direction).toBe('hold');
    const widened = advanceNearbySparseState({
      state: early.state, activeMemberCount: 1, nowMs: 11_000, policy,
    });
    expect(widened.direction).toBe('widen');
    expect(widened.state).toEqual(initialNearbySparseState(1));
  });

  test('dead-band observations break a sparse dwell', () => {
    const started = advanceNearbySparseState({
      state: initialNearbySparseState(), activeMemberCount: 1, nowMs: 1_000, policy,
    });
    const reset = advanceNearbySparseState({
      state: started.state, activeMemberCount: 3, nowMs: 1_900, policy,
    });
    const later = advanceNearbySparseState({
      state: reset.state, activeMemberCount: 1, nowMs: 2_100, policy,
    });
    expect(later.direction).toBe('hold');
    expect(later.state.sparseSinceMs).toBe(2_100);
  });

  test('narrows only after the separate dense dwell', () => {
    const started = advanceNearbySparseState({
      state: initialNearbySparseState(2), activeMemberCount: 5, nowMs: 4_000, policy,
    });
    const narrowed = advanceNearbySparseState({
      state: started.state, activeMemberCount: 8, nowMs: 4_500, policy,
    });
    expect(narrowed.direction).toBe('narrow');
    expect(narrowed.state.wideningLevel).toBe(1);
  });

  test('holds at bounds and ignores capacity-split child rosters', () => {
    const maximum = advanceNearbySparseState({
      state: { wideningLevel: 3, sparseSinceMs: 0, denseSinceMs: null },
      activeMemberCount: 1,
      nowMs: 10_000,
      policy,
    });
    expect(maximum.direction).toBe('hold');
    expect(maximum.state.wideningLevel).toBe(3);

    const splitChild = advanceNearbySparseState({
      state: { wideningLevel: 2, sparseSinceMs: 0, denseSinceMs: null },
      activeMemberCount: 1,
      nowMs: 10_000,
      capacitySplitGeneration: 1,
      policy,
    });
    expect(splitChild.direction).toBe('hold');
    expect(splitChild.state.sparseSinceMs).toBeNull();
  });
});
