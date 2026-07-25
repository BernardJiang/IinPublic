import {
  buildGraphSizeReport,
  classifySoul,
  unboundedGrowthCategories,
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
