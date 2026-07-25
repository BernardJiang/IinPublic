import {
  incrementVisitSlot,
  legacyMigrationState,
  LEGACY_VISIT_SLOT_ID,
  mergeVisitCounters,
  mergeVisitSlot,
  readVisitCounterState,
  readVisitSlot,
  visitCounterMapPath,
  visitCounterPath,
  visitTotals,
  type VisitCounterSlot,
  type VisitCounterState,
} from '../../shared/visit-counter';

/**
 * docs/TODO.md L1 — visit metrics as a CRDT G-Counter.
 *
 * The properties that matter are the CRDT ones: merge must be commutative,
 * associative, and idempotent, and no writer may ever lose another writer's
 * increment. The old shared-scalar read-modify-write failed all of these.
 */

const T0 = '2026-07-25T10:00:00.000Z';
const T1 = '2026-07-25T11:00:00.000Z';
const T2 = '2026-07-25T12:00:00.000Z';

function slot(userId: string, count: number, first = T0, last = T0): VisitCounterSlot {
  return { userId, count, firstVisitedAt: first, lastVisitedAt: last };
}

describe('incrementVisitSlot', () => {
  it('starts a new visitor at 1', () => {
    expect(incrementVisitSlot(null, 'u1', T0)).toEqual(slot('u1', 1));
  });

  it('increments monotonically and keeps the first-seen timestamp', () => {
    const first = incrementVisitSlot(null, 'u1', T0);
    const second = incrementVisitSlot(first, 'u1', T1);
    expect(second.count).toBe(2);
    expect(second.firstVisitedAt).toBe(T0);
    expect(second.lastVisitedAt).toBe(T1);
  });

  it('never regresses lastVisitedAt when an out-of-order write arrives', () => {
    const current = slot('u1', 2, T0, T2);
    expect(incrementVisitSlot(current, 'u1', T1).lastVisitedAt).toBe(T2);
  });

  it('ignores a slot belonging to a different user rather than inheriting its count', () => {
    expect(incrementVisitSlot(slot('other', 99), 'u1', T0).count).toBe(1);
  });

  it('treats a corrupt or negative count as 0 instead of propagating it', () => {
    expect(incrementVisitSlot({ ...slot('u1', -5) }, 'u1', T0).count).toBe(1);
    expect(incrementVisitSlot({ ...slot('u1', NaN) }, 'u1', T0).count).toBe(1);
  });

  it('a stale read cannot clobber a real count below what the owner already wrote', () => {
    // The old readNumericRoomMetric resolved 0 after a 700ms timeout and then wrote 1,
    // destroying the real total. Here a stale read only ever produces a LOWER slot value,
    // which merge discards in favour of the higher one.
    const real = slot('u1', 4000);
    const fromStaleRead = incrementVisitSlot(null, 'u1', T1); // count 1
    expect(mergeVisitSlot(real, fromStaleRead).count).toBe(4000);
  });
});

describe('mergeVisitCounters — CRDT properties', () => {
  const a: VisitCounterState = { u1: slot('u1', 2), u2: slot('u2', 1) };
  const b: VisitCounterState = { u1: slot('u1', 5), u3: slot('u3', 3) };
  const c: VisitCounterState = { u2: slot('u2', 7) };

  it('is commutative', () => {
    expect(mergeVisitCounters(a, b)).toEqual(mergeVisitCounters(b, a));
  });

  it('is associative', () => {
    expect(mergeVisitCounters(mergeVisitCounters(a, b), c)).toEqual(
      mergeVisitCounters(a, mergeVisitCounters(b, c)),
    );
  });

  it('is idempotent', () => {
    const once = mergeVisitCounters(a, b);
    expect(mergeVisitCounters(once, once)).toEqual(once);
    expect(mergeVisitCounters(once, b)).toEqual(once);
  });

  it('takes the max per slot, never the sum, so a replay cannot double-count', () => {
    expect(mergeVisitCounters(a, b).u1.count).toBe(5);
  });

  it('does not mutate its inputs', () => {
    mergeVisitCounters(a, b);
    expect(a.u1.count).toBe(2);
    expect(b.u1.count).toBe(5);
  });

  it('handles undefined operands', () => {
    expect(mergeVisitCounters(undefined, undefined)).toEqual({});
    expect(mergeVisitCounters(a, undefined)).toEqual(a);
    expect(mergeVisitCounters(undefined, b)).toEqual(b);
  });
});

describe('concurrent visitors — the bug this replaces', () => {
  it('two users joining simultaneously both count (the old shared scalar lost one)', () => {
    // Each writer only ever touches its own slot, so there is no shared cell to race on.
    const fromBrowserA: VisitCounterState = { u1: incrementVisitSlot(null, 'u1', T0) };
    const fromBrowserB: VisitCounterState = { u2: incrementVisitSlot(null, 'u2', T0) };
    const converged = mergeVisitCounters(fromBrowserA, fromBrowserB);
    expect(visitTotals(converged)).toEqual({ visitCount: 2, uniqueVisitorCount: 2 });
  });

  it('the same visit delivered by both server and client counts once, not twice', () => {
    const written = incrementVisitSlot(null, 'u1', T0);
    const serverView: VisitCounterState = { u1: written };
    const clientView: VisitCounterState = { u1: written };
    expect(visitTotals(mergeVisitCounters(serverView, clientView)).visitCount).toBe(1);
  });

  it('one user visiting repeatedly raises visits but not unique visitors', () => {
    let s = incrementVisitSlot(null, 'u1', T0);
    s = incrementVisitSlot(s, 'u1', T1);
    s = incrementVisitSlot(s, 'u1', T2);
    expect(visitTotals({ u1: s })).toEqual({ visitCount: 3, uniqueVisitorCount: 1 });
  });
});

describe('visitTotals', () => {
  it('returns zeros for empty/undefined state', () => {
    expect(visitTotals(undefined)).toEqual({ visitCount: 0, uniqueVisitorCount: 0 });
    expect(visitTotals({})).toEqual({ visitCount: 0, uniqueVisitorCount: 0 });
  });

  it('excludes zero-count slots from unique visitors', () => {
    expect(visitTotals({ u1: slot('u1', 0), u2: slot('u2', 2) })).toEqual({
      visitCount: 2,
      uniqueVisitorCount: 1,
    });
  });
});

describe('readVisitCounterState', () => {
  it('skips Gun metadata keys', () => {
    const raw = { _: { '#': 'x' }, '#': 'y', u1: { userId: 'u1', count: 2 } };
    expect(Object.keys(readVisitCounterState(raw))).toEqual(['u1']);
  });

  it('coerces malformed children instead of throwing', () => {
    const state = readVisitCounterState({ u1: { count: 'not-a-number' }, u2: null, u3: 7 });
    expect(state.u1.count).toBe(0);
    expect(state.u2).toBeUndefined();
    expect(state.u3).toBeUndefined();
  });

  it('returns empty for non-object input', () => {
    expect(readVisitCounterState(null)).toEqual({});
    expect(readVisitCounterState('nope')).toEqual({});
  });

  it('rejects a slot whose key is metadata', () => {
    expect(readVisitSlot('_', { count: 1 })).toBeNull();
  });
});

describe('paths', () => {
  it('are stable and namespaced per room', () => {
    expect(visitCounterPath('global', 'u1')).toEqual(['chatrooms', 'global', 'visitCounter', 'u1']);
    expect(visitCounterMapPath('global')).toEqual(['chatrooms', 'global', 'visitCounter']);
  });
});

describe('legacy migration', () => {
  it('parks an existing scalar total in one synthetic slot so rooms do not reset to zero', () => {
    const state = legacyMigrationState(4000, T0);
    expect(visitTotals(state).visitCount).toBe(4000);
    expect(state[LEGACY_VISIT_SLOT_ID].count).toBe(4000);
  });

  it('is a no-op for a zero/absent legacy count', () => {
    expect(legacyMigrationState(0, T0)).toEqual({});
    expect(legacyMigrationState(undefined, T0)).toEqual({});
  });

  it('merges with real slots without double counting on replay', () => {
    const migrated = legacyMigrationState(10, T0);
    const withUser = mergeVisitCounters(migrated, { u1: incrementVisitSlot(null, 'u1', T1) });
    expect(visitTotals(withUser)).toEqual({ visitCount: 11, uniqueVisitorCount: 2 });
    expect(visitTotals(mergeVisitCounters(withUser, migrated)).visitCount).toBe(11);
  });
});
