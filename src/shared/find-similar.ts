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
import {
  applyUserTagsDelta,
  buildUserTagsEnvelope,
  hashUserTagWeightMap,
  UserTagsDelta,
  UserTagsEnvelope,
  UserTagWeightMap,
} from './user-tags';

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
};

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

  /**
   * Candidate generation: union of the inverted index over the viewer's tags,
   * with per-tag hot capping and a min-shared-tags threshold. Only users sharing
   * ≥1 tag are ever returned, so |candidates| ≪ N (spec §22.5.2).
   */
  candidatesFor(viewerId: string, opts: Omit<TopKOptions, 'k' | 'combine'> = {}): Map<string, number> {
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
    const candidates = this.candidatesFor(viewerId, opts);
    const heap = new TopKHeap(opts.k);
    let scored = 0;

    for (const [userId, sharedTags] of candidates) {
      const otherTags = this.maps.get(userId)?.tags;
      if (!otherTags) continue; // candidate present in index but map evicted → skip, don't block
      const score = matchScore(viewerTags, otherTags, combine);
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
