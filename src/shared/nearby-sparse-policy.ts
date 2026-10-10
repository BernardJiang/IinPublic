import { NEARBY_MAX_WIDENING_LEVEL } from './nearby-rooms';

/**
 * Experimental release-wide defaults. They deliberately require a stable observation instead of
 * reacting to a transient empty roster during sync. These values can move in a later signed
 * protocol release after field measurements; they are not per-room attributes.
 */
export const NEARBY_SPARSE_MEMBER_MAX = 1;
export const NEARBY_DENSE_MEMBER_MIN = 12;
export const NEARBY_SPARSE_DWELL_MS = 3 * 60_000;
export const NEARBY_DENSE_DWELL_MS = 60_000;

export type NearbySparsePolicy = {
  sparseMemberMax: number;
  denseMemberMin: number;
  sparseDwellMs: number;
  denseDwellMs: number;
  maxWideningLevel: number;
};

export type NearbySparseState = {
  wideningLevel: number;
  sparseSinceMs: number | null;
  denseSinceMs: number | null;
};

export type NearbySparseDecision = {
  state: NearbySparseState;
  direction: 'hold' | 'widen' | 'narrow';
};

export const DEFAULT_NEARBY_SPARSE_POLICY: Readonly<NearbySparsePolicy> = Object.freeze({
  sparseMemberMax: NEARBY_SPARSE_MEMBER_MAX,
  denseMemberMin: NEARBY_DENSE_MEMBER_MIN,
  sparseDwellMs: NEARBY_SPARSE_DWELL_MS,
  denseDwellMs: NEARBY_DENSE_DWELL_MS,
  maxWideningLevel: NEARBY_MAX_WIDENING_LEVEL,
});

export function initialNearbySparseState(wideningLevel = 0): NearbySparseState {
  return {
    wideningLevel: Math.max(0, Math.min(NEARBY_MAX_WIDENING_LEVEL, Math.floor(wideningLevel))),
    sparseSinceMs: null,
    denseSinceMs: null,
  };
}

/**
 * Advance the single-room sparse-area state machine from one successful current-roster snapshot.
 * The dead band between sparse and dense resets both dwell clocks, which prevents oscillation.
 * Capacity-split children are intentionally ineligible: their small roster is evidence of a dense
 * parent, not evidence that the geographic area itself is sparse.
 */
export function advanceNearbySparseState(input: {
  state: NearbySparseState;
  activeMemberCount: number;
  nowMs: number;
  capacitySplitGeneration?: number;
  policy?: Readonly<NearbySparsePolicy>;
}): NearbySparseDecision {
  const policy = input.policy ?? DEFAULT_NEARBY_SPARSE_POLICY;
  const level = Math.max(0, Math.min(policy.maxWideningLevel, Math.floor(input.state.wideningLevel)));
  if (!Number.isSafeInteger(input.activeMemberCount) || input.activeMemberCount < 0
    || !Number.isFinite(input.nowMs) || (input.capacitySplitGeneration ?? 0) > 0) {
    return { state: initialNearbySparseState(level), direction: 'hold' };
  }

  if (input.activeMemberCount <= policy.sparseMemberMax) {
    const sparseSinceMs = input.state.sparseSinceMs ?? input.nowMs;
    if (level < policy.maxWideningLevel && input.nowMs - sparseSinceMs >= policy.sparseDwellMs) {
      return { state: initialNearbySparseState(level + 1), direction: 'widen' };
    }
    return {
      state: { wideningLevel: level, sparseSinceMs, denseSinceMs: null },
      direction: 'hold',
    };
  }

  if (input.activeMemberCount >= policy.denseMemberMin) {
    const denseSinceMs = input.state.denseSinceMs ?? input.nowMs;
    if (level > 0 && input.nowMs - denseSinceMs >= policy.denseDwellMs) {
      return { state: initialNearbySparseState(level - 1), direction: 'narrow' };
    }
    return {
      state: { wideningLevel: level, sparseSinceMs: null, denseSinceMs },
      direction: 'hold',
    };
  }

  return { state: initialNearbySparseState(level), direction: 'hold' };
}
