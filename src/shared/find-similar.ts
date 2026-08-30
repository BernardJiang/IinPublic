/**
 * Scalable "Find Similar People" by matched tags — shared correctness core.
 *
 * Design of record: SRS §22 (Scalable "Find Similar People" by Matched Tags);
 * backlog: docs/TODO.md "P2 — Scalable Find Similar People", REQ-SIM-04/05/06,
 * REQ-SIM-NFR-01/02/05.
 *
 * This module is the single source of truth for similarity scoring and ranking,
 * mirroring the invariant that match logic lives in `src/shared/` and is never
 * duplicated in routes/UI. It is pure (no DOM, no Gun) so the entire ordering /
 * scaling logic is unit-tested without a browser.
 *
 *   §2 (REQ-SIM-04) Dropout-tolerant exchange: state is a set of independently
 *       published per-peer tag maps. Scoring reads whatever maps the viewer holds;
 *       a peer that never published (or dropped out) is simply absent and never
 *       blocks any other pairwise score. No pairwise barrier, no completion gate.
 *
 *   §3 (REQ-SIM-05/06) Incremental mutation + weighting: deltas are applied via
 *       `applyUserTagsDelta` (version-gated); a cached pairwise score is patched in
 *       O(|delta|) via `patchPairwiseScore`. Weighting rides the same path; combine
 *       policy is selectable and documented (asymmetry below).
 *
 *   §4 (REQ-SIM-NFR-01/02/05) Scale: an inverted `tag -> Set<userId>` index makes
 *       the candidate set the union over the viewer's tags (only ≥1-shared-tag users
 *       are ever scored). Retrieval uses a bounded top-K min-heap (never a full
 *       sort), with hot-tag capping, a min-shared-tags threshold, and an optional
 *       locality predicate to bound effective N per query.
 */

import { matchScore, MatchScoreCombine, WeightedTagInput } from './talk-engine';
import { LocationPrivacy } from './location';
import type { GPSCoordinate } from './types';

/** Minimal coordinate for distance ranking — callers needn't supply accuracy/timestamp. */
export type LatLon = { latitude: number; longitude: number };
import {
  applyUserTagsDelta,
  buildUserTagsEnvelope,
  hashUserTagWeightMap,
  UserTagsDelta,
  UserTagsEnvelope,
  UserTagWeightMap,
} from './user-tags';

// ─── Binary tag similarity ─────────────────────────────────────────────────────

/**
 * Accepted binary tag shapes. Weight-map values are deliberately ignored: these
 * metrics compare membership only, while the existing combine policies below
 * remain the weighted scoring path.
 */
export type TagCollection =
  | readonly string[]
  | ReadonlySet<string>
  | Readonly<Record<string, unknown>>;

export type TagSimilarityMetricId = 'jaccard' | 'cosine';
export type TagSimilarityMetric = (left: TagCollection, right: TagCollection) => number;

function toTagSet(tags: TagCollection): Set<string> {
  if (Array.isArray(tags)) return new Set(tags);
  if (typeof (tags as ReadonlySet<string>).has === 'function') {
    return new Set(tags as ReadonlySet<string>);
  }
  return new Set(Object.keys(tags));
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let common = 0;
  for (const tag of smaller) {
    if (larger.has(tag)) common++;
  }
  return common;
}

function jaccardFromSets(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const common = intersectionSize(left, right);
  const union = left.size + right.size - common;
  // No tags means no evidence of a match; avoid treating two empty profiles as identical.
  return union === 0 ? 0 : common / union;
}

function cosineFromSets(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const denominator = Math.sqrt(left.size * right.size);
  return denominator === 0 ? 0 : intersectionSize(left, right) / denominator;
}

/** Binary Jaccard similarity: intersection size divided by union size. */
export function jaccardSimilarity(left: TagCollection, right: TagCollection): number {
  return jaccardFromSets(toTagSet(left), toTagSet(right));
}

/** Binary cosine similarity: intersection size divided by the geometric mean of set sizes. */
export function cosineSimilarity(left: TagCollection, right: TagCollection): number {
  return cosineFromSets(toTagSet(left), toTagSet(right));
}

export const TAG_SIMILARITY_METRICS: Record<TagSimilarityMetricId, TagSimilarityMetric> = {
  jaccard: jaccardSimilarity,
  cosine: cosineSimilarity,
};

// ─── Combine policies (spec §22.5.1) ────────────────────────────────────────────
//
// `combine(viewerWeight, otherWeight, tag)` decides how a shared tag contributes.
//
//   count             unweighted overlap — "number of matched tags"
//   viewer-standard   viewer's own importance ("MY ranking of them"); ASYMMETRIC
//   mutual-importance product of both weights; symmetric
//   conservative      min of both weights; symmetric
//
// ASYMMETRY (REQ-SIM-06): with `viewer-standard`, score(A,B) need not equal
// score(B,A). A may rank B highly while B ranks A low, because each side scores by
// its OWN weights. "Their standard" — how highly THEY rate the viewer — is just the
// same primitive with arguments swapped: `score(other, viewer)`. The UI must label
// which direction it shows; ranking assertions must pick a direction deliberately.

export type CombinePolicyId = 'count' | 'viewer-standard' | 'mutual-importance' | 'conservative';

export const COMBINE_POLICIES: Record<CombinePolicyId, MatchScoreCombine> = {
  count: () => 1,
  'viewer-standard': (viewerWeight) => viewerWeight,
  'mutual-importance': (viewerWeight, otherWeight) => viewerWeight * otherWeight,
  conservative: (viewerWeight, otherWeight) => Math.min(viewerWeight, otherWeight),
};

/** Default policy: viewer's standard (asymmetric, "my ranking of them"). */
export const DEFAULT_COMBINE: MatchScoreCombine = COMBINE_POLICIES['viewer-standard'];

export function resolveCombine(policy?: CombinePolicyId | MatchScoreCombine): MatchScoreCombine {
  if (typeof policy === 'function') return policy;
  if (policy && policy in COMBINE_POLICIES) return COMBINE_POLICIES[policy];
  return DEFAULT_COMBINE;
}

// ─── Incremental pairwise patch (REQ-SIM-05, spec §22.6.2) ──────────────────────

/**
 * Patch a single cached pairwise score after `other` mutated its tags, touching
 * only the changed keys — O(|delta.changed|), never a full re-score.
 *
 * `prevScore` is the viewer's cached score of `other` BEFORE the delta;
 * `otherPrevWeights` is `other`'s weight map BEFORE the delta. Returns the new
 * score; mathematically identical to a full re-score, by construction.
 */
export function patchPairwiseScore(
  prevScore: number,
  viewerWeights: UserTagWeightMap,
  otherPrevWeights: UserTagWeightMap,
  delta: UserTagsDelta,
  combine: MatchScoreCombine = DEFAULT_COMBINE,
): number {
  let score = prevScore;
  for (const [tag, nextWeight] of Object.entries(delta.changed)) {
    const viewerWeight = viewerWeights[tag];
    if (viewerWeight === undefined) continue; // not a shared tag → no contribution either way
    const prevOther = otherPrevWeights[tag];
    const oldContribution = prevOther === undefined ? 0 : Number(combine(viewerWeight, prevOther, tag));
    const newContribution = nextWeight === null ? 0 : Number(combine(viewerWeight, nextWeight, tag));
    if (Number.isFinite(oldContribution)) score -= oldContribution;
    if (Number.isFinite(newContribution)) score += newContribution;
  }
  return score;
}

// ─── Bounded top-K min-heap (REQ-SIM-NFR-01/02, spec §22.5.2) ────────────────────
//
// Keeps the K highest-scoring candidates without sorting the population. Ordered by
// score asc at the root (so the root is the weakest of the current top-K and is the
// one evicted); ties broken by userId desc so eviction/keep is deterministic.

export type RankedPerson = {
  userId: string;
  score: number;
  /** number of the viewer's tags this candidate shares (for min-shared-tags / display) */
  sharedTags: number;
  /** blurred-location distance in miles, populated when sorting by distance (§22.7) */
  distance?: number;
};

const METERS_PER_MILE = 1609.344;
const BLUR_GRID = 0.01; // matches LocationPrivacy.blurLocation's ~2km grid

/** Snap a coordinate to the center of its privacy grid cell (never use exact GPS). */
function snapToBlurGrid(coord: LatLon): GPSCoordinate {
  return {
    latitude: Math.floor(coord.latitude / BLUR_GRID) * BLUR_GRID + BLUR_GRID / 2,
    longitude: Math.floor(coord.longitude / BLUR_GRID) * BLUR_GRID + BLUR_GRID / 2,
    accuracy: 0,
    timestamp: new Date(0),
  };
}

/**
 * Approximate distance in miles between two users, computed from BLURRED locations
 * (spec §22.7: "Distance uses blurred location — approximate is acceptable"). Both
 * coordinates are snapped to their grid-cell centers before the Haversine distance,
 * so exact GPS is never used in the ranking.
 */
export function blurredDistanceMiles(a: LatLon, b: LatLon): number {
  const meters = LocationPrivacy.calculateDistance(snapToBlurGrid(a), snapToBlurGrid(b));
  return meters / METERS_PER_MILE;
}

/** A is "weaker" than B (and thus closer to the heap root / eviction). */
function weaker(a: RankedPerson, b: RankedPerson): boolean {
  if (a.score !== b.score) return a.score < b.score;
  return a.userId > b.userId; // deterministic tiebreak
}

class TopKHeap {
  private readonly items: RankedPerson[] = [];

  constructor(private readonly k: number) {}

  /** Offer a candidate; kept only if it belongs in the current top-K. */
  offer(candidate: RankedPerson): void {
    if (this.k <= 0) return;
    if (this.items.length < this.k) {
      this.items.push(candidate);
      this.siftUp(this.items.length - 1);
      return;
    }
    // Heap full: replace the weakest root iff the candidate beats it.
    if (weaker(this.items[0], candidate)) {
      this.items[0] = candidate;
      this.siftDown(0);
    }
  }

  /** Drain to a descending-by-score list (strongest first). */
  toSortedDesc(): RankedPerson[] {
    return [...this.items].sort((a, b) => (weaker(a, b) ? 1 : -1));
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (weaker(this.items[i], this.items[parent])) {
        [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
        i = parent;
      } else break;
    }
  }

  private siftDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && weaker(this.items[l], this.items[smallest])) smallest = l;
      if (r < n && weaker(this.items[r], this.items[smallest])) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

// ─── The index (publish + independent local read) ───────────────────────────────

export type TopKOptions = {
  k: number;
  combine?: CombinePolicyId | MatchScoreCombine;
  /** Optional binary metric. When present, it takes precedence over `combine`. */
  metric?: TagSimilarityMetricId;
  /** Only score candidates sharing at least this many of the viewer's tags. */
  minSharedTags?: number;
  /**
   * Hot-tag cap: a tag held by more than this many users contributes at most this
   * many candidates (it is sampled, not expanded fully). Bounds the candidate set
   * even when a tag is pathologically common (spec §22.5.2). 0/undefined = no cap.
   */
  hotTagCap?: number;
  /** Locality scoping (REQ-SIM-NFR-05): only candidates passing this are considered. */
  withinScope?: (userId: string) => boolean;
};

export type TopKResult = {
  people: RankedPerson[];
  /** number of distinct candidates actually scored (≪ N when the index is doing its job) */
  candidatesScored: number;
};

/**
 * Holds independently-published per-peer tag maps plus the inverted tag index.
 *
 * Publishing (`upsert`/`applyDelta`) and reading (`topK`/`score`) are decoupled:
 * a peer that has not published is absent, and a peer that drops out leaves its
 * last-published map in place — either way, no other pairwise score is blocked
 * (REQ-SIM-04).
 */
export class FindSimilarIndex {
  /** userId -> last-known envelope (version-gated). */
  private readonly maps = new Map<string, UserTagsEnvelope>();
  /** tag -> set of userIds holding it (inverted index, spec §22.4.1). */
  private readonly inverted = new Map<string, Set<string>>();

  get size(): number {
    return this.maps.size;
  }

  has(userId: string): boolean {
    return this.maps.has(userId);
  }

  getEnvelope(userId: string): UserTagsEnvelope | undefined {
    return this.maps.get(userId);
  }

  getWeights(userId: string): UserTagWeightMap {
    return this.maps.get(userId)?.tags ?? {};
  }

  /** Full publish: replace a user's map and reconcile the inverted index. */
  upsert(userId: string, envelope: UserTagsEnvelope): void {
    const prev = this.maps.get(userId);
    if (prev && envelope.version < prev.version) return; // stale full publish ignored
    this.reconcileInverted(userId, prev?.tags ?? {}, envelope.tags);
    this.maps.set(userId, envelope);
  }

  /** Convenience: publish from a raw weight map (assigns the next version). */
  publishWeights(userId: string, tags: UserTagWeightMap, now: Date = new Date()): UserTagsEnvelope {
    const prev = this.maps.get(userId);
    const envelope: UserTagsEnvelope = {
      version: (prev?.version ?? 0) + 1,
      hash: hashUserTagWeightMap(tags),
      tags: { ...tags },
      updatedAt: now.toISOString(),
    };
    this.upsert(userId, envelope);
    return envelope;
  }

  /**
   * Apply an incremental delta (REQ-SIM-05). Version-gated and idempotent: a
   * stale/replayed delta is a no-op. Returns whether the index advanced.
   */
  applyDelta(userId: string, delta: UserTagsDelta): boolean {
    const current = this.maps.get(userId) ?? buildUserTagsEnvelope([], new Date(0));
    const { envelope, changed } = applyUserTagsDelta(current, delta);
    if (!changed) return false;
    this.reconcileInverted(userId, current.tags, envelope.tags);
    this.maps.set(userId, envelope);
    return true;
  }

  /** A user dropping out keeps its last map by default; call this to forget it. */
  remove(userId: string): void {
    const prev = this.maps.get(userId);
    if (!prev) return;
    this.reconcileInverted(userId, prev.tags, {});
    this.maps.delete(userId);
  }

  /** Direct pairwise score (independent local read — never blocked by dropouts). */
  score(viewerId: string, otherId: string, combine?: CombinePolicyId | MatchScoreCombine): number {
    return matchScore(this.getWeights(viewerId), this.getWeights(otherId), resolveCombine(combine));
  }

  /** Direct pairwise binary similarity, independent of tag weights. */
  similarity(viewerId: string, otherId: string, metric: TagSimilarityMetricId): number {
    return TAG_SIMILARITY_METRICS[metric](this.getWeights(viewerId), this.getWeights(otherId));
  }

  /**
   * Candidate generation: union of the inverted index over the viewer's tags,
   * with per-tag hot capping and a min-shared-tags threshold. Only users sharing
   * ≥1 tag are ever returned, so |candidates| ≪ N (spec §22.5.2).
   */
  candidatesFor(
    viewerId: string,
    opts: Omit<TopKOptions, 'k' | 'combine' | 'metric'> = {},
  ): Map<string, number> {
    const viewerTags = this.maps.get(viewerId)?.tags ?? {};
    const minShared = Math.max(1, opts.minSharedTags ?? 1);
    const sharedCount = new Map<string, number>();

    for (const tag of Object.keys(viewerTags)) {
      const holders = this.inverted.get(tag);
      if (!holders) continue;
      let taken = 0;
      for (const holder of holders) {
        if (holder === viewerId) continue;
        if (opts.withinScope && !opts.withinScope(holder)) continue;
        sharedCount.set(holder, (sharedCount.get(holder) ?? 0) + 1);
        if (opts.hotTagCap && ++taken >= opts.hotTagCap) break; // hot-tag cap
      }
    }

    if (minShared > 1) {
      for (const [userId, count] of sharedCount) {
        if (count < minShared) sharedCount.delete(userId);
      }
    }
    return sharedCount;
  }

  /**
   * Bounded top-K ranking. Materializes the candidate set once (via the inverted
   * index), scores each candidate, and keeps the K best in a heap — never sorts
   * the population (REQ-SIM-NFR-01/02).
   */
  topK(viewerId: string, opts: TopKOptions): TopKResult {
    const combine = resolveCombine(opts.combine);
    const viewerTags = this.maps.get(viewerId)?.tags ?? {};
    const viewerTagSet = opts.metric ? toTagSet(viewerTags) : undefined;
    const candidates = this.candidatesFor(viewerId, opts);
    const heap = new TopKHeap(opts.k);
    let scored = 0;

    for (const [userId, sharedTags] of candidates) {
      const otherTags = this.maps.get(userId)?.tags;
      if (!otherTags) continue; // candidate present in index but map evicted → skip, don't block
      const score = opts.metric
        ? opts.metric === 'jaccard'
          ? jaccardFromSets(viewerTagSet!, toTagSet(otherTags))
          : cosineFromSets(viewerTagSet!, toTagSet(otherTags))
        : matchScore(viewerTags, otherTags, combine);
      scored++;
      heap.offer({ userId, score, sharedTags });
    }
    return { people: heap.toSortedDesc(), candidatesScored: scored };
  }

  private reconcileInverted(userId: string, prevTags: UserTagWeightMap, nextTags: UserTagWeightMap): void {
    for (const tag of Object.keys(prevTags)) {
      if (tag in nextTags) continue;
      const holders = this.inverted.get(tag);
      if (!holders) continue;
      holders.delete(userId);
      if (holders.size === 0) this.inverted.delete(tag);
    }
    for (const tag of Object.keys(nextTags)) {
      let holders = this.inverted.get(tag);
      if (!holders) {
        holders = new Set<string>();
        this.inverted.set(tag, holders);
      }
      holders.add(userId);
    }
  }
}

/** Re-export for callers building viewer/other inputs from arbitrary tag shapes. */
export type { WeightedTagInput };

// ─── Sort strategies for retrieve→sort→display pipeline (REQ-SIM-07) ────────────

/**
 * Describes how to sort a set of candidates. The registry lets UI present a dropdown
 * without hard-coding sort logic.
 */
export type SortStrategy = {
  /** Stable identifier: 'matched-tags', 'distance', 'their-standard' */
  id: string;
  /** Display label for UI dropdown */
  label: string;
  /**
   * Sort key: 'score' for matched-tags, 'distance' for proximity, 'their-standard' for reciprocal.
   * Used by rankPeople to select the comparison field.
   */
  key: 'score' | 'distance' | 'their-standard';
  /** Sort direction: 'desc' for descending (best first), 'asc' for ascending */
  dir: 'asc' | 'desc';
};

export const SORT_STRATEGIES: Record<string, SortStrategy> = {
  'matched-tags': {
    id: 'matched-tags',
    label: 'Matched Tags',
    key: 'score',
    dir: 'desc',
  },
  distance: {
    id: 'distance',
    label: 'Distance',
    key: 'distance',
    dir: 'asc',
  },
  'their-standard': {
    id: 'their-standard',
    label: "How They Rate You",
    key: 'their-standard',
    dir: 'desc',
  },
};

export const DEFAULT_SORT_STRATEGY: SortStrategy = SORT_STRATEGIES['matched-tags'];

/**
 * Materialize a candidate set once, then re-sort in memory by the selected strategy
 * (REQ-SIM-07). No extra reads — the operation is pure in-memory re-ordering.
 *
 * `candidates`: the RankedPerson[] results from topK() or similar
 * `viewerId`: current user (needed for 'their-standard' reciprocal scoring)
 * `index`: FindSimilarIndex for computing reciprocal scores
 * `sortId`: the strategy id (from SortStrategy.id)
 * `filters`: optional location/proximity filter (future expansion)
 *
 * Returns the same candidate array, sorted by the strategy's key/dir.
 */
export function rankPeople(
  candidates: RankedPerson[],
  viewerId: string,
  index: FindSimilarIndex,
  sortId: string = 'matched-tags',
  filters?: {
    combine?: CombinePolicyId | MatchScoreCombine;
    /**
     * Distance resolver for the 'distance' strategy: returns the blurred-location
     * distance (miles) from the viewer to `userId`, or undefined if unknown.
     * Build it with `blurredDistanceMiles(viewerCoord, candidateCoord)`.
     */
    distanceMiles?: (userId: string) => number | undefined;
  },
): RankedPerson[] {
  const strategy = SORT_STRATEGIES[sortId] ?? DEFAULT_SORT_STRATEGY;
  const combine = resolveCombine(filters?.combine);

  if (strategy.key === 'score') {
    // Already scored by topK; just re-sort by score.
    return candidates.sort((a, b) => (strategy.dir === 'desc' ? b.score - a.score : a.score - b.score));
  }

  if (strategy.key === 'their-standard') {
    // Compute reciprocal score: how they rate the viewer, not vice versa.
    const reciprocal = candidates.map((candidate) => ({
      ...candidate,
      theirScore: index.score(candidate.userId, viewerId, combine),
    }));
    return reciprocal.sort((a, b) =>
      strategy.dir === 'desc' ? b.theirScore - a.theirScore : a.theirScore - b.theirScore,
    );
  }

  if (strategy.key === 'distance') {
    const resolve = filters?.distanceMiles;
    if (!resolve) return candidates; // no location data → preserve order (caller opt-in)
    const withDistance = candidates.map((candidate) => {
      const miles = resolve(candidate.userId);
      return miles === undefined ? candidate : { ...candidate, distance: miles };
    });
    return withDistance.sort((a, b) => {
      // Candidates with unknown distance sort last regardless of direction.
      const da = a.distance ?? Infinity;
      const db = b.distance ?? Infinity;
      return strategy.dir === 'asc' ? da - db : db - da;
    });
  }

  // Fallback: return as-is.
  return candidates;
}
