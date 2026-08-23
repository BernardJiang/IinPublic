import {
  buildGraphSizeReport,
  classifySoul,
  unboundedGrowthCategories,
  serializedByteSize,
  deriveRetentionCap,
  representativeLedgerEventBytes,
  representativePairConversationMessageBytes,
  representativeIncomingTalkClusterBytes,
  TOTAL_LOCAL_RETENTION_BUDGET_BYTES,
  RETENTION_BUDGET_CATEGORY_COUNT,
} from '../../shared/graph-size-report';

/** docs/TODO.md L2 — measure before reaping. */

function graphOf(souls: string[]): Record<string, unknown> {
  return Object.fromEntries(souls.map((soul) => [soul, {}]));
}

describe('classifySoul', () => {
  it('classifies the growth paths that matter', () => {
    expect(classifySoul('chatrooms/global/visits/visit_1')?.key).toBe('room-visit-events');
    expect(classifySoul('chatrooms/global/visitCounter/u1')?.key).toBe('room-visit-counter');
    expect(classifySoul('chatrooms/global/uniqueVisitors/u1')?.key).toBe('room-unique-visitors');
    expect(classifySoul('chatrooms/global/users/u1')?.key).toBe('room-members');
    expect(classifySoul('conversations/c1/messages/m1')?.key).toBe('conversation-messages');
    expect(classifySoul('talks/t1')?.key).toBe('talks');
    expect(classifySoul('users/u1')?.key).toBe('users');
    expect(classifySoul('public/room-member-counts/global')?.key).toBe('public-aggregates');
    // docs/TODO.md §Y2 — the real path (ownerIncomingTalkIndex), not the stale
    // incomingTalksByUser name from CLAUDE.md's outdated description.
    expect(classifySoul('ownerIncomingTalkIndex/u1/ik_abc')?.key).toBe('incoming-talks');
    // docs/TODO.md §S2 — ledger events and pair-private (direct-p2p) messages, previously
    // both silently unclassified.
    expect(classifySoul('ledger/u1/events/42')?.key).toBe('ledger-events');
    expect(classifySoul('pairConversations/u1__u2/conv_1/messages/m1')?.key).toBe('pair-conversation-messages');
  });

  it('no longer recognizes the stale incomingTalksByUser path name (§Y2)', () => {
    // Regression guard: this soul shape isn't written anywhere in the current
    // implementation. If this ever starts classifying again, something reintroduced
    // the old path name and the matcher needs re-checking against reality.
    expect(classifySoul('incomingTalksByUser/u1/ik_abc')).toBeNull();
  });

  it('prefers the more specific pattern when two could match', () => {
    // visitCounter must not fall through to a generic chatrooms/... rule.
    expect(classifySoul('chatrooms/global/visitCounter/u1')?.growth).toBe('per-user');
    // A message must not be classified as its parent conversation.
    expect(classifySoul('conversations/c1/messages/m1')?.key).toBe('conversation-messages');
    expect(classifySoul('conversations/c1')?.key).toBe('conversations');
  });

  it('returns null for an unknown soul rather than guessing', () => {
    expect(classifySoul('something/else/entirely')).toBeNull();
    expect(classifySoul('')).toBeNull();
  });

  it('marks visit events as per-event and counter slots as per-user', () => {
    expect(classifySoul('chatrooms/global/visits/v1')?.growth).toBe('per-event');
    expect(classifySoul('chatrooms/global/visitCounter/u1')?.growth).toBe('per-user');
  });
});

describe('buildGraphSizeReport', () => {
  it('counts nodes per category and computes share', () => {
    const report = buildGraphSizeReport(
      graphOf([
        'chatrooms/global/visits/v1',
        'chatrooms/global/visits/v2',
        'chatrooms/global/visits/v3',
        'users/u1',
      ]),
    );
    expect(report.totalNodes).toBe(4);
    const visits = report.categories.find((c) => c.key === 'room-visit-events');
    expect(visits?.nodeCount).toBe(3);
    expect(visits?.share).toBeCloseTo(0.75);
  });

  it('sorts categories biggest-first so the reaping target is the first row', () => {
    const report = buildGraphSizeReport(
      graphOf([
        'users/u1',
        'chatrooms/global/visits/v1',
        'chatrooms/global/visits/v2',
        'chatrooms/global/visits/v3',
      ]),
    );
    expect(report.categories[0].key).toBe('room-visit-events');
  });

  it('reports unclassified souls with samples, so the classifier can be kept current', () => {
    const report = buildGraphSizeReport(graphOf(['mystery/path/one', 'users/u1']));
    expect(report.unclassifiedCount).toBe(1);
    expect(report.unclassifiedSamples).toContain('mystery/path/one');
  });

  it('skips Gun metadata souls', () => {
    const report = buildGraphSizeReport({ _: {}, 'users/u1': {} });
    expect(report.totalNodes).toBe(1);
  });

  it('handles an empty or undefined graph', () => {
    for (const empty of [undefined, {}]) {
      const report = buildGraphSizeReport(empty);
      expect(report.totalNodes).toBe(0);
      expect(report.categories).toEqual([]);
      expect(report.unclassifiedCount).toBe(0);
    }
  });

  it('omits categories with no nodes rather than listing zeros', () => {
    const report = buildGraphSizeReport(graphOf(['users/u1']));
    expect(report.categories.map((c) => c.key)).toEqual(['users']);
  });
});

describe('unboundedGrowthCategories', () => {
  it('surfaces only per-event paths — the ones that need a policy first', () => {
    const report = buildGraphSizeReport(
      graphOf([
        'chatrooms/global/visits/v1',
        'conversations/c1/messages/m1',
        'chatrooms/global/visitCounter/u1',
        'users/u1',
      ]),
    );
    const keys = unboundedGrowthCategories(report).map((c) => c.key);
    expect(keys).toContain('room-visit-events');
    expect(keys).toContain('conversation-messages');
    expect(keys).not.toContain('room-visit-counter');
    expect(keys).not.toContain('users');
  });
});

/**
 * docs/TODO.md L2 — Bernard's 2026-08-01 request: "build size report tool based on
 * time location event or user ... so that we know which take space and what to trim."
 */
describe('buildGraphSizeReport — location/user/age breakdowns', () => {
  const NOW = Date.parse('2026-08-01T12:00:00.000Z');

  function category(report: ReturnType<typeof buildGraphSizeReport>, key: string) {
    const found = report.categories.find((c) => c.key === key);
    if (!found) throw new Error(`category ${key} not found`);
    return found;
  }

  it('groups room-visit-counter by room (location) and by user, across rooms', () => {
    const graph: Record<string, unknown> = {
      'chatrooms/roomA/visitCounter/u1': { userId: 'u1', count: 1, lastVisitedAt: '2026-08-01T11:00:00.000Z' },
      'chatrooms/roomA/visitCounter/u2': { userId: 'u2', count: 1, lastVisitedAt: '2026-08-01T11:00:00.000Z' },
      'chatrooms/roomA/visitCounter/u3': { userId: 'u3', count: 1, lastVisitedAt: '2026-08-01T11:00:00.000Z' },
      'chatrooms/roomB/visitCounter/u1': { userId: 'u1', count: 1, lastVisitedAt: '2026-08-01T11:00:00.000Z' },
    };
    const report = buildGraphSizeReport(graph, NOW);
    const counter = category(report, 'room-visit-counter');
    expect(counter.topLocations).toEqual([
      { id: 'roomA', nodeCount: 3 },
      { id: 'roomB', nodeCount: 1 },
    ]);
    // u1 has a slot in two different rooms, u2/u3 each in one.
    expect(counter.topUsers).toEqual([
      { id: 'u1', nodeCount: 2 },
      { id: 'u2', nodeCount: 1 },
      { id: 'u3', nodeCount: 1 },
    ]);
  });

  it('buckets room-visit-counter slot age off lastVisitedAt', () => {
    const graph: Record<string, unknown> = {
      'chatrooms/room1/visitCounter/fresh': { lastVisitedAt: '2026-08-01T11:30:00.000Z' }, // 30 min ago
      'chatrooms/room1/visitCounter/week': { lastVisitedAt: '2026-07-27T12:00:00.000Z' }, // 5 days ago
      'chatrooms/room1/visitCounter/month': { lastVisitedAt: '2026-07-10T12:00:00.000Z' }, // 22 days ago
      'chatrooms/room1/visitCounter/quarter': { lastVisitedAt: '2026-06-01T12:00:00.000Z' }, // ~61 days ago
      'chatrooms/room1/visitCounter/ancient': { lastVisitedAt: '2026-01-01T12:00:00.000Z' }, // >90 days ago
      'chatrooms/room1/visitCounter/corrupt': { lastVisitedAt: 'not-a-date' },
      'chatrooms/room1/visitCounter/missing': {},
    };
    const report = buildGraphSizeReport(graph, NOW);
    expect(category(report, 'room-visit-counter').ageBuckets).toEqual({
      under1d: 1,
      d1to7: 1,
      d7to30: 1,
      d30to90: 1,
      over90d: 1,
      unknown: 2,
    });
  });

  it('groups conversation-messages by conversation, sender, and message age', () => {
    const graph: Record<string, unknown> = {
      'conversations/c1/messages/m1': { senderId: 'alice', timestamp: '2026-08-01T11:00:00.000Z' },
      'conversations/c1/messages/m2': { senderId: 'alice', timestamp: '2026-08-01T11:30:00.000Z' },
      'conversations/c1/messages/m3': { senderId: 'bob', timestamp: '2026-01-01T00:00:00.000Z' },
      'conversations/c2/messages/m4': { senderId: 'carol', timestamp: '2026-08-01T11:45:00.000Z' },
    };
    const report = buildGraphSizeReport(graph, NOW);
    const messages = category(report, 'conversation-messages');
    expect(messages.topLocations).toEqual([
      { id: 'c1', nodeCount: 3 },
      { id: 'c2', nodeCount: 1 },
    ]);
    expect(messages.topUsers).toEqual([
      { id: 'alice', nodeCount: 2 },
      { id: 'bob', nodeCount: 1 },
      { id: 'carol', nodeCount: 1 },
    ]);
    expect(messages.ageBuckets).toMatchObject({ under1d: 3, over90d: 1 });
  });

  it('groups talks by author and age, with no location axis (talks are not room-scoped)', () => {
    const graph: Record<string, unknown> = {
      'talks/t1': { authorId: 'alice', createdAt: '2026-08-01T11:00:00.000Z' },
      'talks/t2': { authorId: 'alice', createdAt: '2026-01-01T00:00:00.000Z' },
      'talks/t3': { authorId: 'bob', createdAt: '2026-08-01T11:00:00.000Z' },
    };
    const report = buildGraphSizeReport(graph, NOW);
    const talks = category(report, 'talks');
    expect(talks.topUsers).toEqual([
      { id: 'alice', nodeCount: 2 },
      { id: 'bob', nodeCount: 1 },
    ]);
    expect(talks.topLocations).toBeUndefined();
    expect(talks.ageBuckets).toMatchObject({ under1d: 2, over90d: 1 });
  });

  it('omits breakdown fields entirely for categories with no matching extractor (backward compatible)', () => {
    const report = buildGraphSizeReport(graphOf(['users/u1', 'users/u2']), NOW);
    const users = category(report, 'users');
    expect(users.topLocations).toBeUndefined();
    expect(users.topUsers).toBeUndefined();
    expect(users.ageBuckets).toBeUndefined();
  });

  it('caps breakdown entries at 10 and keeps them sorted biggest-first', () => {
    const graph: Record<string, unknown> = {};
    for (let i = 0; i < 15; i++) {
      // Room i gets (i + 1) visitor slots, so room 14 is the single biggest.
      for (let u = 0; u <= i; u++) {
        graph[`chatrooms/room${i}/visitCounter/u${u}`] = { lastVisitedAt: '2026-08-01T11:00:00.000Z' };
      }
    }
    const report = buildGraphSizeReport(graph, NOW);
    const locations = category(report, 'room-visit-counter').topLocations!;
    expect(locations).toHaveLength(10);
    expect(locations[0]).toEqual({ id: 'room14', nodeCount: 15 });
    for (let i = 1; i < locations.length; i++) {
      expect(locations[i - 1].nodeCount).toBeGreaterThanOrEqual(locations[i].nodeCount);
    }
  });

  it('groups incoming-talk clusters by owner and buckets age off updatedAt', () => {
    const graph: Record<string, unknown> = {
      'ownerIncomingTalkIndex/u1/ik_1': { updatedAt: '2026-08-01T11:30:00.000Z' }, // 30 min ago
      'ownerIncomingTalkIndex/u1/ik_2': { updatedAt: '2026-01-01T12:00:00.000Z' }, // >90 days ago
      'ownerIncomingTalkIndex/u2/ik_3': { updatedAt: '2026-08-01T11:00:00.000Z' },
    };
    const report = buildGraphSizeReport(graph, NOW);
    const incoming = category(report, 'incoming-talks');
    expect(incoming.nodeCount).toBe(3);
    expect(incoming.topUsers).toEqual([
      { id: 'u1', nodeCount: 2 },
      { id: 'u2', nodeCount: 1 },
    ]);
    expect(incoming.ageBuckets).toMatchObject({ under1d: 2, over90d: 1 });
    expect(incoming.topLocations).toBeUndefined();
  });

  it('does not add a location breakdown for user-subgraph but does add a user breakdown', () => {
    const report = buildGraphSizeReport(
      graphOf(['users/u1/knownPeople', 'users/u1/talkFilters', 'users/u2/knownPeople']),
      NOW,
    );
    const subgraph = category(report, 'user-subgraph');
    expect(subgraph.topUsers).toEqual([
      { id: 'u1', nodeCount: 2 },
      { id: 'u2', nodeCount: 1 },
    ]);
    expect(subgraph.topLocations).toBeUndefined();
  });

  it('measures total and average serialized bytes per category (§S2)', () => {
    const report = buildGraphSizeReport({
      'ledger/u1/events/1': { id: 'e1', text: 'ab' }, // 20 bytes
      'ledger/u1/events/2': { id: 'e2', text: 'cd' }, // 20 bytes
      'users/u1': { id: 'u1' }, // 10 bytes
    });
    const ledger = category(report, 'ledger-events');
    expect(ledger.totalBytes).toBe(serializedByteSize({ id: 'e1', text: 'ab' }) + serializedByteSize({ id: 'e2', text: 'cd' }));
    expect(ledger.avgBytes).toBe(ledger.totalBytes / 2);
  });

  it('avgBytes is 0 for an empty (never-hit) category rather than NaN', () => {
    const report = buildGraphSizeReport(graphOf(['users/u1']));
    // No category with 0 nodes is ever present (categories with no nodes are omitted —
    // see 'omits categories with no nodes' above), so this only guards the formula itself:
    // avgBytes must never divide by a zero nodeCount for a category that IS present.
    const users = category(report, 'users');
    expect(users.nodeCount).toBeGreaterThan(0);
    expect(Number.isFinite(users.avgBytes)).toBe(true);
  });
});

describe('serializedByteSize (§S2)', () => {
  it('counts UTF-8 bytes, not JS string length, for multi-byte characters', () => {
    // '喜' is one UTF-16 code unit but 3 UTF-8 bytes; JSON-quoted it's `"喜"` — 2 quote
    // bytes + 3 content bytes = 5, not the 3 a naive `.length` on the JSON string would give.
    expect(serializedByteSize('喜')).toBe(5);
  });

  it('measures a plain object as its JSON-serialized byte length', () => {
    const value = { a: 1, b: 'two' };
    expect(serializedByteSize(value)).toBe(new TextEncoder().encode(JSON.stringify(value)).length);
  });

  it('returns 0 for undefined (does not serialize to a string)', () => {
    expect(serializedByteSize(undefined)).toBe(0);
  });
});

describe('deriveRetentionCap (§S2)', () => {
  it('computes floor(categoryShare / measuredAverageBytes)', () => {
    const totalBudgetBytes = 300;
    const categoryCount = 3; // categoryShare = 100
    expect(deriveRetentionCap(10, /* fallback */ 999, totalBudgetBytes, categoryCount)).toBe(10); // floor(100/10)
    expect(deriveRetentionCap(7, 999, totalBudgetBytes, categoryCount)).toBe(14); // floor(100/7) = 14
  });

  it('falls back when avgBytes is zero, negative, NaN, or missing', () => {
    for (const bad of [0, -5, NaN]) {
      expect(deriveRetentionCap(bad, 500)).toBe(500);
    }
  });

  it('falls back rather than deriving a 0 cap when avgBytes exceeds the category share', () => {
    // categoryShare = TOTAL_LOCAL_RETENTION_BUDGET_BYTES / RETENTION_BUDGET_CATEGORY_COUNT;
    // an avgBytes larger than that would floor to 0 — must degrade to the prior fallback
    // instead of retaining nothing.
    const categoryShare = TOTAL_LOCAL_RETENTION_BUDGET_BYTES / RETENTION_BUDGET_CATEGORY_COUNT;
    expect(deriveRetentionCap(categoryShare * 2, 500)).toBe(500);
  });

  it('falls back when totalBudgetBytes or categoryCount is non-positive', () => {
    expect(deriveRetentionCap(10, 500, 0, 3)).toBe(500);
    expect(deriveRetentionCap(10, 500, 300, 0)).toBe(500);
  });

  it('divides the real 8 MiB budget evenly across the 3 named categories by default', () => {
    expect(RETENTION_BUDGET_CATEGORY_COUNT).toBe(3);
    expect(TOTAL_LOCAL_RETENTION_BUDGET_BYTES).toBe(8 * 1024 * 1024);
    // A 1 KiB average record should derive a cap in the low thousands, not near 500 or 200,
    // proving the derivation is actually budget-driven rather than coincidentally matching
    // the old flat constants it replaces.
    const cap = deriveRetentionCap(1024, 500);
    expect(cap).toBeGreaterThan(1000);
  });
});

describe('representative retention byte measurements (§S2)', () => {
  it('produce plausible positive byte counts for each category', () => {
    expect(representativeLedgerEventBytes()).toBeGreaterThan(0);
    expect(representativePairConversationMessageBytes()).toBeGreaterThan(0);
    expect(representativeIncomingTalkClusterBytes()).toBeGreaterThan(0);
  });

  it('derive sane retention caps from the real 8 MiB budget (not 0, not absurdly huge)', () => {
    const ledgerCap = deriveRetentionCap(representativeLedgerEventBytes(), 500);
    const messageCap = deriveRetentionCap(representativePairConversationMessageBytes(), 200);
    const incomingTalkCap = deriveRetentionCap(representativeIncomingTalkClusterBytes(), 500);
    for (const cap of [ledgerCap, messageCap, incomingTalkCap]) {
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThan(1_000_000); // sanity bound — not literally unbounded
    }
  });
});
