import {
  BLOCK_SIGNAL_THRESHOLD,
  countReceivedBlockSignals,
  meetsBlockSignalThreshold,
  recordBlockSignal,
  recordSharedBlockSignal,
  resolveSharedSignalsForContact,
} from '../../shared/block-signal';
import type { KnownPerson } from '../../shared/types';

function person(overrides: Partial<KnownPerson> & { userId: string }): KnownPerson {
  return { labels: ['friend'], addedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

describe('BLOCK_SIGNAL_THRESHOLD', () => {
  it('is 3 — single-sourced from CONFIG.AGE_VERIFICATION_THRESHOLD, not redeclared', () => {
    expect(BLOCK_SIGNAL_THRESHOLD).toBe(3);
  });
});

describe('recordBlockSignal', () => {
  it('adds a first signal for a target identity', () => {
    const result = recordBlockSignal(undefined, 'target-1', 'sig-a');
    expect(result).toEqual({ 'target-1': ['sig-a'] });
  });

  it('does not mutate the input map', () => {
    const input = { 'target-1': ['sig-a'] };
    const result = recordBlockSignal(input, 'target-1', 'sig-b');
    expect(input).toEqual({ 'target-1': ['sig-a'] });
    expect(result).toEqual({ 'target-1': ['sig-a', 'sig-b'] });
  });

  it('dedupes a repeated signalId (e.g. a mailbox retry) instead of double-counting', () => {
    const input = { 'target-1': ['sig-a'] };
    const result = recordBlockSignal(input, 'target-1', 'sig-a');
    expect(result).toBe(input); // same reference — recognized no-op, not just equal
    expect(result).toEqual({ 'target-1': ['sig-a'] });
  });

  it('keeps different target identities independent', () => {
    let received = recordBlockSignal(undefined, 'target-1', 'sig-a');
    received = recordBlockSignal(received, 'target-2', 'sig-b');
    expect(received).toEqual({
      'target-1': ['sig-a'],
      'target-2': ['sig-b'],
    });
  });

  it('is a no-op for a missing targetIdentity or signalId', () => {
    expect(recordBlockSignal({ a: ['x'] }, '', 'sig')).toEqual({ a: ['x'] });
    expect(recordBlockSignal({ a: ['x'] }, 'a', '')).toEqual({ a: ['x'] });
  });
});

describe('countReceivedBlockSignals', () => {
  it('returns 0 for an unknown or undefined map', () => {
    expect(countReceivedBlockSignals(undefined, 'target-1')).toBe(0);
    expect(countReceivedBlockSignals({}, 'target-1')).toBe(0);
  });

  it('counts distinct signals for a target identity', () => {
    const received = { 'target-1': ['sig-a', 'sig-b', 'sig-c'] };
    expect(countReceivedBlockSignals(received, 'target-1')).toBe(3);
  });
});

describe('meetsBlockSignalThreshold', () => {
  it('is false below the threshold (2 of 3)', () => {
    const received = { 'target-1': ['sig-a', 'sig-b'] };
    expect(meetsBlockSignalThreshold(received, 'target-1')).toBe(false);
  });

  it('is true exactly at the threshold (3 of 3) — boundary case', () => {
    const received = { 'target-1': ['sig-a', 'sig-b', 'sig-c'] };
    expect(meetsBlockSignalThreshold(received, 'target-1')).toBe(true);
  });

  it('stays true above the threshold', () => {
    const received = { 'target-1': ['sig-a', 'sig-b', 'sig-c', 'sig-d'] };
    expect(meetsBlockSignalThreshold(received, 'target-1')).toBe(true);
  });

  it('never conflates counts across different target identities', () => {
    const received = {
      'target-1': ['sig-a', 'sig-b', 'sig-c'],
      'target-2': ['sig-d'],
    };
    expect(meetsBlockSignalThreshold(received, 'target-1')).toBe(true);
    expect(meetsBlockSignalThreshold(received, 'target-2')).toBe(false);
  });
});

describe('recordSharedBlockSignal', () => {
  it('records a first share scope for a target identity', () => {
    const result = recordSharedBlockSignal(undefined, 'target-1', 'coworker', 'sig-a');
    expect(result).toEqual({ 'target-1': { groupId: 'coworker', signalId: 'sig-a', sharedAt: expect.any(String) } });
  });

  it('does not mutate the input map', () => {
    const input = recordSharedBlockSignal(undefined, 'target-1', 'all', 'sig-a');
    const result = recordSharedBlockSignal(input, 'target-2', 'coworker', 'sig-b');
    expect(input).toEqual({ 'target-1': { groupId: 'all', signalId: 'sig-a', sharedAt: expect.any(String) } });
    expect(Object.keys(result)).toEqual(['target-1', 'target-2']);
  });

  it('is "status, not a log" — re-sharing the same target overwrites, not appends', () => {
    let shared = recordSharedBlockSignal(undefined, 'target-1', 'all', 'sig-a');
    shared = recordSharedBlockSignal(shared, 'target-1', 'coworker', 'sig-b');
    expect(shared).toEqual({ 'target-1': { groupId: 'coworker', signalId: 'sig-b', sharedAt: expect.any(String) } });
  });

  it('is a no-op for a missing targetIdentity, groupId, or signalId', () => {
    const base = { a: { groupId: 'all', signalId: 'x', sharedAt: '2026-01-01T00:00:00.000Z' } };
    expect(recordSharedBlockSignal(base, '', 'all', 'sig')).toEqual(base);
    expect(recordSharedBlockSignal(base, 'target-1', '', 'sig')).toEqual(base);
    expect(recordSharedBlockSignal(base, 'target-1', 'all', '')).toEqual(base);
  });
});

describe('resolveSharedSignalsForContact', () => {
  it('returns nothing when there are no shared signals', () => {
    expect(resolveSharedSignalsForContact(undefined, person({ userId: 'u1' }))).toEqual([]);
  });

  it('matches a contact against an "all" scope regardless of their labels', () => {
    const shared = { 'target-1': { groupId: 'all', signalId: 'sig-a', sharedAt: '2026-01-01T00:00:00.000Z' } };
    const contact = person({ userId: 'u1', labels: ['acquaintance'] });
    expect(resolveSharedSignalsForContact(shared, contact)).toEqual([{ targetIdentity: 'target-1', signalId: 'sig-a' }]);
  });

  it('matches a contact only when their current label matches the shared group', () => {
    const shared = { 'target-1': { groupId: 'coworker', signalId: 'sig-a', sharedAt: '2026-01-01T00:00:00.000Z' } };
    expect(resolveSharedSignalsForContact(shared, person({ userId: 'u1', labels: ['coworker'] })))
      .toEqual([{ targetIdentity: 'target-1', signalId: 'sig-a' }]);
    expect(resolveSharedSignalsForContact(shared, person({ userId: 'u2', labels: ['friend'] })))
      .toEqual([]);
  });

  it('is the "catch-up" case: a contact relabeled INTO a matching group now qualifies, even though the share predates them', () => {
    const shared = { 'target-1': { groupId: 'coworker', signalId: 'sig-a', sharedAt: '2020-01-01T00:00:00.000Z' } };
    // Tom was just added/relabeled as a coworker — the share happened long before, but the
    // pure check only looks at Tom's CURRENT labels, so he qualifies now.
    const tom = person({ userId: 'tom', labels: ['coworker'], addedAt: new Date() });
    expect(resolveSharedSignalsForContact(shared, tom)).toEqual([{ targetIdentity: 'target-1', signalId: 'sig-a' }]);
  });

  it('matches across multiple shared targets independently', () => {
    const shared = {
      'target-1': { groupId: 'coworker', signalId: 'sig-a', sharedAt: '2026-01-01T00:00:00.000Z' },
      'target-2': { groupId: 'friend', signalId: 'sig-b', sharedAt: '2026-01-01T00:00:00.000Z' },
    };
    const contact = person({ userId: 'u1', labels: ['coworker'] });
    expect(resolveSharedSignalsForContact(shared, contact)).toEqual([{ targetIdentity: 'target-1', signalId: 'sig-a' }]);
  });

  it('returns nothing for a contact with no userId', () => {
    expect(resolveSharedSignalsForContact({ 'target-1': { groupId: 'all', signalId: 'sig-a', sharedAt: '2026-01-01T00:00:00.000Z' } }, person({ userId: '' }))).toEqual([]);
  });
});
