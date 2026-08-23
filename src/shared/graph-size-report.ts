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
 *
 * docs/TODO.md §S2 also puts the retention-budget derivation here: `deriveRetentionCap`
 * (the `floor(categoryShare / measuredAverageBytes)` formula) and the representative-sample
 * byte measurements each of ledger/web-ledger-service.ts, web/gun-message-store.ts, and
 * shared/peer-talk-delivery.ts derive their own retention cap from.
 *
 * §S2 bugfix: the representative ledger-event sample below uses the literal string
 * `'TALK_ANSWERED'` rather than `InteractionKind.TALK_ANSWERED` (`InteractionKind`
 * unimported here on purpose), and `REPRESENTATIVE_INCOMING_TALK_CLUSTER` is a plain
 * structurally-typed literal rather than importing `IncomingTalkClusterWire` from
 * `./peer-talk-delivery`. Empirically found (isolated to a two-line probe spec, unrelated to
 * this file's own logic or to the real `peer-talk-delivery.ts` ↔ `graph-size-report.ts`
 * value-level edge that exists for the incoming-talk-cluster cap): referencing an *imported*
 * TS enum's member at a file's top level (outside any function) breaks under Playwright's
 * own Node-side esbuild-based test-file transform — the imported binding reads as
 * `undefined` at that module's own evaluation time, even with zero other shared imports and
 * zero cycles anywhere in the graph. Since `InteractionKind` is a string enum whose member
 * values equal their names, the literal string is exactly equivalent at runtime and sidesteps
 * the whole class of fragility — this file is reached directly by
 * `30-ledger-message-pruning-e2e.spec.ts`'s own top-level import of
 * `web-ledger-service.ts` for its `LEDGER_CHECKPOINT_INTERVAL`/`LEDGER_RETENTION_WINDOW`
 * constants, so it must survive Playwright's transform, not just webpack's and ts-jest's.
 */

import type { TalkAnsweredContent } from './types';

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
  /**
   * docs/TODO.md §S2 — total/average UTF-8 serialized byte size of this category's node
   * values (`serializedByteSize`), the input a retention-budget derivation needs
   * (`deriveRetentionCaps`). Always present: unlike `topLocations`/`topUsers`/`ageBuckets`,
   * every category has node values to measure regardless of whether it has a location/user/
   * timestamp axis.
   */
  totalBytes: number;
  avgBytes: number;
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
    // docs/TODO.md §S2 — direct-p2p DM bodies live ONLY under `pairConversations/...`
    // (CLAUDE.md's "Direct P2P conversation transport" section; `conversation-messages`
    // above is the legacy/star-relay path, effectively empty in the ordinary direct-p2p
    // case). Without this matcher every real message in the app was silently falling into
    // `unclassifiedCount`, and any byte-budget derivation over `conversation-messages`
    // alone would have been measuring the wrong (near-empty) category.
    key: 'pair-conversation-messages',
    pattern: 'pairConversations/<pairId>/<convId>/messages/<messageId>',
    growth: 'per-event',
    test: (s) => /^pairConversations\/[^/]+\/[^/]+\/messages\/[^/]+$/.test(s),
    locationOf: (s) => soulSegment(s, 2),
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
    // docs/TODO.md §S2 — `ledger/<userId>/events/<seq>` (WebLedgerService, spec §20) was
    // never classified: every ledger event soul was silently falling into
    // `unclassifiedCount`, and the retention-cap byte budget needs this category measured
    // like any other. This is a flat compound-string soul key (one `.get(path)` call, not
    // a nested `.get().get()` chain — see `writeEventToGun`'s own doc comment), so unlike
    // `incoming-talks` above it has no separate `<userId>` graph edge to walk; the userId
    // is just the path's own first segment.
    key: 'ledger-events',
    pattern: 'ledger/<userId>/events/<seq>',
    growth: 'per-event',
    test: (s) => /^ledger\/[^/]+\/events\/[^/]+$/.test(s),
    userOf: (s) => soulSegment(s, 1),
    timestampOf: (v) => fieldOf(v, 'timestamp'),
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

/**
 * docs/TODO.md §S2 — UTF-8 byte size of a node's value, serialized the same way it's
 * written to Gun (JSON). `Buffer`/`TextEncoder` both give the correct byte count for
 * non-ASCII content (e.g. ciphertext); `.length` on the JS string would undercount any
 * multi-byte character. Falls back to 0 for values that don't serialize (shouldn't happen
 * for real Gun node values, which are always plain objects).
 */
export function serializedByteSize(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return 0;
    return new TextEncoder().encode(json).length;
  } catch {
    return 0;
  }
}

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
  const totalBytes = new Map<string, number>();
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
    totalBytes.set(matcher.key, (totalBytes.get(matcher.key) || 0) + serializedByteSize(value));

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
    const nodeCount = counts.get(m.key) || 0;
    const categoryBytes = totalBytes.get(m.key) || 0;
    const category: GraphSizeCategory = {
      key: m.key,
      pattern: m.pattern,
      growth: m.growth,
      nodeCount,
      share: totalNodes > 0 ? nodeCount / totalNodes : 0,
      totalBytes: categoryBytes,
      avgBytes: nodeCount > 0 ? categoryBytes / nodeCount : 0,
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

// ─── Retention budget (docs/TODO.md §S2) ───────────────────────────────────────

/** Adjustable total local-storage budget across every unbounded retention category. */
export const TOTAL_LOCAL_RETENTION_BUDGET_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * Ledger events, pair-conversation messages, and incoming-talk clusters — the three
 * `per-event`-growth categories docs/TODO.md §S2 names. The budget is split evenly across
 * them, not weighted by observed volume: a fixed, simple split is what §S2 asks for
 * ("divide the budget evenly by category"); a usage-weighted split is a future refinement,
 * not this item.
 */
export const RETENTION_BUDGET_CATEGORY_COUNT = 3;

/**
 * `floor(categoryShare / measuredAverageBytes)` (docs/TODO.md §S2), for one category.
 * `categoryShare = totalBudgetBytes / categoryCount`.
 *
 * Falls back to `fallbackCap` — the caller's own previous flat constant — whenever the
 * measurement can't produce a usable cap: no/zero/negative `avgBytes` (nothing measured,
 * or a malformed sample), or a `categoryShare` so small relative to `avgBytes` that the
 * floor rounds to 0 (an oversized average shouldn't zero out retention entirely, it should
 * just not shrink it below what already existed). This mirrors `planMessagePruning`'s own
 * "never derive a policy that's obviously wrong, degrade to the safe prior behavior"
 * instinct rather than letting a bad measurement silently produce `maxSlots: 0`.
 */
export function deriveRetentionCap(
  avgBytes: number,
  fallbackCap: number,
  totalBudgetBytes: number = TOTAL_LOCAL_RETENTION_BUDGET_BYTES,
  categoryCount: number = RETENTION_BUDGET_CATEGORY_COUNT,
): number {
  if (!(avgBytes > 0) || !(categoryCount > 0) || !(totalBudgetBytes > 0)) return fallbackCap;
  const categoryShare = totalBudgetBytes / categoryCount;
  const cap = Math.floor(categoryShare / avgBytes);
  return cap > 0 ? cap : fallbackCap;
}

/**
 * Representative sample of one `ledger/<userId>/events/<seq>` node (the wire shape
 * `WebLedgerService.writeEventToGun` actually persists — `contentJson`, not `content`;
 * `InteractionEvent`'s own shape is used only to build a realistic `TalkAnsweredContent`
 * payload before stringifying it, matching one of the ledger's own most common event
 * kinds). CIDv1/SEA pubkey/signature fields are realistic-*length* placeholders, not real
 * cryptographic output — the byte count is what this measures, not correctness of the
 * values themselves.
 */
const REPRESENTATIVE_LEDGER_EVENT_CONTENT: TalkAnsweredContent = {
  talkId: 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l5',
  responseId: 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l6',
  outcome: 'match',
};
const REPRESENTATIVE_LEDGER_EVENT_WIRE = {
  id: 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l7',
  seq: 1234,
  prev: 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l8',
  // 'TALK_ANSWERED' literal, not InteractionKind.TALK_ANSWERED — see this file's own top
  // doc comment for why an imported enum member can't be read at module top level here.
  kind: 'TALK_ANSWERED',
  pubkey: 'k3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9.h3j7k1l5m9n3o7p1q5r9s3t7u1v5w9x3y7z1',
  timestamp: '2026-08-22T12:00:00.000Z',
  contentJson: JSON.stringify(REPRESENTATIVE_LEDGER_EVENT_CONTENT),
  sig: 'SEA{"m":"k3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l5m9n3o7p1q5r9s3t7u1v5w9x3y7z1","s":"a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"}',
};

/**
 * Representative sample of one `pairConversations/<pairId>/<convId>/messages/<messageId>`
 * node (the wire shape `GunMessageStore.putMessageRecord` actually persists). `text` is a
 * realistic-length SEA-ciphertext placeholder for a short chat message.
 */
const REPRESENTATIVE_MESSAGE_WIRE = {
  id: 'msg-a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
  senderId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
  text: 'SEA{"ct":"k3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l5m9n3o7p1","iv":"q5r9s3t7u1v5w9x3","s":"y7z1a1b2c3d4e5f6"}',
  timestamp: '2026-08-22T12:00:00.000Z',
  channel: 'public',
  transport: 'direct-p2p',
  encryption: 'sea-ecdh-v1',
};

/**
 * Representative sample of one `ownerIncomingTalkIndex/<userId>/<identityKey>` node
 * (`IncomingTalkClusterWire`, `peer-talk-delivery.ts`), with one sender.
 */
const REPRESENTATIVE_INCOMING_TALK_CLUSTER = {
  identityKey: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234',
  title: 'Representative talk title for byte-size estimation',
  type: 'flow',
  language: 'en',
  senders: {
    'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7': {
      senderId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
      senderName: 'Representative Sender',
      lastTalkId: 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l9',
      lastReceivedAt: '2026-08-22T12:00:00.000Z',
    },
  },
  talkIds: { 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7': 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l9' },
  questionsJson: JSON.stringify([{ id: 'q1', text: 'Representative question text for byte-size estimation?' }]),
  questionCount: 1,
  latestTalkId: 'bafyreighk3s7z6q4x2n8p1v5w9r0m3c7l6y8t4u2i1o5e9a3s7d1f5g9h3j7k1l9',
  updatedAt: '2026-08-22T12:00:00.000Z',
  identityAliases: { 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234': true },
};

export function representativeLedgerEventBytes(): number {
  return serializedByteSize(REPRESENTATIVE_LEDGER_EVENT_WIRE);
}
export function representativePairConversationMessageBytes(): number {
  return serializedByteSize(REPRESENTATIVE_MESSAGE_WIRE);
}
export function representativeIncomingTalkClusterBytes(): number {
  return serializedByteSize(REPRESENTATIVE_INCOMING_TALK_CLUSTER);
}
