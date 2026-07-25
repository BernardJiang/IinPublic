/**
 * Per-path node accounting for a Gun graph (docs/TODO.md L2).
 *
 * Retention policy should be chosen against real numbers, not guesses — "the visits
 * table is probably big" is how the wrong path gets reaped. This classifies every soul
 * in a graph into a growth category and reports counts, so a policy argument can start
 * from "this is 400k nodes and 60% of the graph".
 *
 * Pure and synchronous: it takes a graph object (e.g. the one behind
 * `/api/test/export-snapshot`) and returns a report. It never deletes anything —
 * measurement and reaping are deliberately separate, because a reaper is only safe once
 * the policy it enforces has been agreed.
 */

export type GrowthBound = 'bounded' | 'per-user' | 'per-event';

export type GraphSizeCategory = {
  /** Stable id used in the report and in any future retention policy. */
  key: string;
  /** Human-readable path shape, e.g. `chatrooms/<id>/visits/<eventId>`. */
  pattern: string;
  /** How this path grows — `per-event` is the class that needs a reaper first. */
  growth: GrowthBound;
  nodeCount: number;
  /** Share of all classified souls, 0–1. Useful for "what is actually big". */
  share: number;
};

export type GraphSizeReport = {
  totalNodes: number;
  categories: GraphSizeCategory[];
  /** Souls that matched no known pattern — a growing number here means this file is stale. */
  unclassifiedCount: number;
  unclassifiedSamples: string[];
};

type Matcher = {
  key: string;
  pattern: string;
  growth: GrowthBound;
  test: (soul: string) => boolean;
};

/**
 * Ordered — first match wins, so more specific patterns must come before their prefixes
 * (`chatrooms/<id>/visitCounter/<userId>` before `chatrooms/<id>/...`).
 */
const MATCHERS: Matcher[] = [
  {
    key: 'room-visit-events',
    pattern: 'chatrooms/<id>/visits/<eventId>',
    growth: 'per-event',
    test: (s) => /^chatrooms\/[^/]+\/visits\/[^/]+$/.test(s),
  },
  {
    key: 'room-visit-counter',
    pattern: 'chatrooms/<id>/visitCounter/<userId>',
    growth: 'per-user',
    test: (s) => /^chatrooms\/[^/]+\/visitCounter\/[^/]+$/.test(s),
  },
  {
    key: 'room-unique-visitors',
    pattern: 'chatrooms/<id>/uniqueVisitors/<userId>',
    growth: 'per-user',
    test: (s) => /^chatrooms\/[^/]+\/uniqueVisitors\/[^/]+$/.test(s),
  },
  {
    key: 'room-members',
    pattern: 'chatrooms/<id>/users/<userId>',
    growth: 'per-user',
    test: (s) => /^chatrooms\/[^/]+\/users\/[^/]+$/.test(s),
  },
  {
    key: 'conversation-messages',
    pattern: 'conversations/<id>/messages/<messageId>',
    growth: 'per-event',
    test: (s) => /^conversations\/[^/]+\/messages\/[^/]+$/.test(s),
  },
  {
    key: 'conversations',
    pattern: 'conversations/<id>',
    growth: 'per-event',
    test: (s) => /^conversations\/[^/]+$/.test(s),
  },
  {
    key: 'talks',
    pattern: 'talks/<id>',
    growth: 'per-event',
    test: (s) => /^talks\/[^/]+$/.test(s),
  },
  {
    key: 'incoming-talks',
    pattern: 'incomingTalksByUser/<userId>/<identityKey>',
    growth: 'per-event',
    test: (s) => /^incomingTalksByUser\/[^/]+\/[^/]+$/.test(s),
  },
  {
    key: 'users',
    pattern: 'users/<userId>',
    growth: 'per-user',
    test: (s) => /^users\/[^/]+$/.test(s),
  },
  {
    key: 'user-subgraph',
    pattern: 'users/<userId>/<field>',
    growth: 'per-user',
    test: (s) => /^users\/[^/]+\/[^/]+/.test(s),
  },
  {
    key: 'user-public-profile',
    pattern: 'user-public-profile/<userId>',
    growth: 'per-user',
    test: (s) => /^user-public-profile\/[^/]+$/.test(s),
  },
  {
    key: 'blocks',
    pattern: 'user-blocks|user-blocked-by/<id>/<id>',
    growth: 'per-user',
    test: (s) => /^user-block(s|ed-by)\/[^/]+\/[^/]+$/.test(s),
  },
  {
    key: 'public-aggregates',
    pattern: 'public/<name>/<id>',
    growth: 'bounded',
    test: (s) => /^public\//.test(s),
  },
];

const MAX_UNCLASSIFIED_SAMPLES = 20;

/** Classify one soul, or null when nothing matches. */
export function classifySoul(soul: string): Matcher | null {
  if (!soul) return null;
  for (const matcher of MATCHERS) {
    if (matcher.test(soul)) return matcher;
  }
  return null;
}

/**
 * Build a size report from a Gun graph. Categories are sorted by node count descending,
 * so the first row is the thing worth reaping first.
 */
export function buildGraphSizeReport(graph: Record<string, unknown> | undefined): GraphSizeReport {
  const counts = new Map<string, number>();
  const unclassifiedSamples: string[] = [];
  let unclassifiedCount = 0;
  let totalNodes = 0;

  for (const soul of Object.keys(graph || {})) {
    if (!soul || soul.startsWith('_')) continue;
    totalNodes += 1;
    const matcher = classifySoul(soul);
    if (!matcher) {
      unclassifiedCount += 1;
      if (unclassifiedSamples.length < MAX_UNCLASSIFIED_SAMPLES) unclassifiedSamples.push(soul);
      continue;
    }
    counts.set(matcher.key, (counts.get(matcher.key) || 0) + 1);
  }

  const categories: GraphSizeCategory[] = MATCHERS.filter((m) => counts.has(m.key)).map((m) => ({
    key: m.key,
    pattern: m.pattern,
    growth: m.growth,
    nodeCount: counts.get(m.key) || 0,
    share: totalNodes > 0 ? (counts.get(m.key) || 0) / totalNodes : 0,
  }));

  categories.sort((a, b) => b.nodeCount - a.nodeCount);

  return { totalNodes, categories, unclassifiedCount, unclassifiedSamples };
}

/**
 * Categories that grow per event and therefore need a retention policy before they
 * need a reaper. Sorted biggest-first — the head of this list is where to start.
 */
export function unboundedGrowthCategories(report: GraphSizeReport): GraphSizeCategory[] {
  return report.categories.filter((category) => category.growth === 'per-event');
}
