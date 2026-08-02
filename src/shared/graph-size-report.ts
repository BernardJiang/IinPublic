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

/** One entry in a `topLocations`/`topUsers` breakdown. */
export type GraphSizeBreakdownEntry = {
  id: string;
  nodeCount: number;
};

/**
 * Histogram of node age at report time, bucketed off whatever timestamp field the
 * category's `timestampOf` extractor found. `unknown` covers missing/unparseable values —
 * a growing `unknown` share means the extractor (or the node schema) has drifted.
 */
export type GraphSizeAgeBuckets = {
  under1d: number;
  d1to7: number;
  d7to30: number;
  d30to90: number;
  over90d: number;
  unknown: number;
};

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
  /** Biggest room/conversation ids by node count — present only for categories with a location axis. */
  topLocations?: GraphSizeBreakdownEntry[];
  /** Biggest user ids by node count — present only for categories with a user axis. */
  topUsers?: GraphSizeBreakdownEntry[];
  /** Age histogram — present only for categories with a known timestamp field. */
  ageBuckets?: GraphSizeAgeBuckets;
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
  /** Room/conversation id this soul belongs to, when the category has one. */
  locationOf?: (soul: string) => string | null;
  /** User id this soul/value belongs to, when the category has one worth breaking down by. */
  userOf?: (soul: string, value: unknown) => string | null;
  /** Timestamp field on the node's value, when the category has a meaningful age. */
  timestampOf?: (value: unknown) => string | null;
};

/** The `<index>`th `/`-separated segment of a soul, or null if it doesn't have one. */
function soulSegment(soul: string, index: number): string | null {
  const parts = soul.split('/');
  return parts[index] ?? null;
}

/** A string-valued field off a Gun node, or null — never guesses at a different shape. */
function fieldOf(value: unknown, field: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === 'string' ? raw : null;
}

/**
 * Ordered — first match wins, so more specific patterns must come before their prefixes
 * (`chatrooms/<id>/visitCounter/<userId>` before `chatrooms/<id>/...`).
 *
 * `locationOf`/`userOf`/`timestampOf` are deliberately omitted wherever the id segment
 * IS the node's own key (e.g. `users/<userId>`, `conversations/<id>`) — a "top users"
 * breakdown of a category with exactly one node per user is always flat 1-per-id and
 * finds nothing. They're included only where a room/user can genuinely have more than
 * one node in that category, which is where "what to trim" actually has an answer
 * (docs/TODO.md L2, Bernard's 2026-08-01 size-report request).
 */
const MATCHERS: Matcher[] = [
  {
    key: 'room-visit-events',
    pattern: 'chatrooms/<id>/visits/<eventId>',
    growth: 'per-event',
    test: (s) => /^chatrooms\/[^/]+\/visits\/[^/]+$/.test(s),
    locationOf: (s) => soulSegment(s, 1),
  },
  {
    key: 'room-visit-counter',
    pattern: 'chatrooms/<id>/visitCounter/<userId>',
    growth: 'per-user',
    test: (s) => /^chatrooms\/[^/]+\/visitCounter\/[^/]+$/.test(s),
    locationOf: (s) => soulSegment(s, 1),
    userOf: (s) => soulSegment(s, 3),
    timestampOf: (v) => fieldOf(v, 'lastVisitedAt'),
  },
  {
    key: 'room-unique-visitors',
    pattern: 'chatrooms/<id>/uniqueVisitors/<userId>',
    growth: 'per-user',
    test: (s) => /^chatrooms\/[^/]+\/uniqueVisitors\/[^/]+$/.test(s),
    locationOf: (s) => soulSegment(s, 1),
    userOf: (s) => soulSegment(s, 3),
  },
  {
    key: 'room-members',
    pattern: 'chatrooms/<id>/users/<userId>',
    growth: 'per-user',
    test: (s) => /^chatrooms\/[^/]+\/users\/[^/]+$/.test(s),
    locationOf: (s) => soulSegment(s, 1),
    userOf: (s) => soulSegment(s, 3),
    timestampOf: (v) => fieldOf(v, 'lastSeen'),
  },
  {
    key: 'conversation-messages',
    pattern: 'conversations/<id>/messages/<messageId>',
    growth: 'per-event',
    test: (s) => /^conversations\/[^/]+\/messages\/[^/]+$/.test(s),
    locationOf: (s) => soulSegment(s, 1),
    userOf: (_s, v) => fieldOf(v, 'senderId'),
    timestampOf: (v) => fieldOf(v, 'timestamp'),
  },
  {
    key: 'conversations',
    pattern: 'conversations/<id>',
    growth: 'per-event',
    test: (s) => /^conversations\/[^/]+$/.test(s),
    timestampOf: (v) => fieldOf(v, 'createdAt'),
  },
  {
    key: 'talks',
    pattern: 'talks/<id>',
    growth: 'per-event',
    test: (s) => /^talks\/[^/]+$/.test(s),
    userOf: (_s, v) => fieldOf(v, 'authorId'),
    timestampOf: (v) => fieldOf(v, 'createdAt'),
  },
  {
    // docs/TODO.md §Y2 — this used to test the stale `incomingTalksByUser/<userId>/
    // <identityKey>` path name from CLAUDE.md's outdated description. The real,
    // client-side-only path is `ownerIncomingTalkIndex/<userId>/<identityKey>`
    // (`OWNER_INCOMING_TALK_INDEX_ROOT`, `src/shared/peer-talk-delivery.ts`); every
    // incoming-talk-cluster node was silently falling into `unclassifiedCount`.
    key: 'incoming-talks',
    pattern: 'ownerIncomingTalkIndex/<userId>/<identityKey>',
    growth: 'per-event',
    test: (s) => /^ownerIncomingTalkIndex\/[^/]+\/[^/]+$/.test(s),
    userOf: (s) => soulSegment(s, 1),
    timestampOf: (v) => fieldOf(v, 'updatedAt'),
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
    userOf: (s) => soulSegment(s, 1),
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
    userOf: (s) => soulSegment(s, 1),
  },
  {
    key: 'public-aggregates',
    pattern: 'public/<name>/<id>',
    growth: 'bounded',
    test: (s) => /^public\//.test(s),
  },
];

const MAX_BREAKDOWN_ENTRIES = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function topEntries(counts: Map<string, number>): GraphSizeBreakdownEntry[] {
  return Array.from(counts.entries())
    .map(([id, nodeCount]) => ({ id, nodeCount }))
    .sort((a, b) => b.nodeCount - a.nodeCount)
    .slice(0, MAX_BREAKDOWN_ENTRIES);
}

function emptyAgeBuckets(): GraphSizeAgeBuckets {
  return { under1d: 0, d1to7: 0, d7to30: 0, d30to90: 0, over90d: 0, unknown: 0 };
}

function bucketAge(buckets: GraphSizeAgeBuckets, timestamp: string | null, now: number): void {
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(parsed)) {
    buckets.unknown += 1;
    return;
  }
  const ageDays = (now - parsed) / MS_PER_DAY;
  if (ageDays < 1) buckets.under1d += 1;
  else if (ageDays < 7) buckets.d1to7 += 1;
  else if (ageDays < 30) buckets.d7to30 += 1;
  else if (ageDays < 90) buckets.d30to90 += 1;
  else buckets.over90d += 1;
}

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
 *
 * Reads node VALUES (not just soul keys) when a matcher declares `userOf`/`timestampOf`,
 * so a category can also answer "which room/user is this actually coming from" and "how
 * old is it" — the time/location/user/event breakdown docs/TODO.md L2 asked for, so a
 * retention policy can be argued from "these 3 rooms are 80% of this category and half of
 * it is over 90 days old", not a guess.
 *
 * `now` defaults to the real clock; tests pass a fixed value so age buckets are deterministic.
 */
export function buildGraphSizeReport(
  graph: Record<string, unknown> | undefined,
  now: number = Date.now(),
): GraphSizeReport {
  const counts = new Map<string, number>();
  const locationCounts = new Map<string, Map<string, number>>();
  const userCounts = new Map<string, Map<string, number>>();
  const ageBuckets = new Map<string, GraphSizeAgeBuckets>();
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

    const value = (graph as Record<string, unknown>)[soul];

    if (matcher.locationOf) {
      const location = matcher.locationOf(soul);
      if (location) {
        const perLocation = locationCounts.get(matcher.key) || new Map<string, number>();
        perLocation.set(location, (perLocation.get(location) || 0) + 1);
        locationCounts.set(matcher.key, perLocation);
      }
    }
    if (matcher.userOf) {
      const user = matcher.userOf(soul, value);
      if (user) {
        const perUser = userCounts.get(matcher.key) || new Map<string, number>();
        perUser.set(user, (perUser.get(user) || 0) + 1);
        userCounts.set(matcher.key, perUser);
      }
    }
    if (matcher.timestampOf) {
      const buckets = ageBuckets.get(matcher.key) || emptyAgeBuckets();
      bucketAge(buckets, matcher.timestampOf(value), now);
      ageBuckets.set(matcher.key, buckets);
    }
  }

  const categories: GraphSizeCategory[] = MATCHERS.filter((m) => counts.has(m.key)).map((m) => {
    const category: GraphSizeCategory = {
      key: m.key,
      pattern: m.pattern,
      growth: m.growth,
      nodeCount: counts.get(m.key) || 0,
      share: totalNodes > 0 ? (counts.get(m.key) || 0) / totalNodes : 0,
    };
    const locations = locationCounts.get(m.key);
    if (locations) category.topLocations = topEntries(locations);
    const users = userCounts.get(m.key);
    if (users) category.topUsers = topEntries(users);
    const ages = ageBuckets.get(m.key);
    if (ages) category.ageBuckets = ages;
    return category;
  });

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
