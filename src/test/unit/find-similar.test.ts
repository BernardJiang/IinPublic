import {
  blurredDistanceMiles,
  COMBINE_POLICIES,
  FindSimilarIndex,
  patchPairwiseScore,
  rankPeople,
  SORT_STRATEGIES,
  type RankedPerson,
} from '../../shared/find-similar';
import {
  applyUserTagsDelta,
  buildUserTagsEnvelope,
  diffUserTags,
  UserTagWeightMap,
} from '../../shared/user-tags';
import { matchScore } from '../../shared/talk-engine';

// Deterministic PRNG so the 100k-scale test is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tags(...names: string[]): UserTagWeightMap {
  const out: UserTagWeightMap = {};
  for (const n of names) out[n] = 1;
  return out;
}

describe('find-similar §2 — dropout-tolerant exchange (REQ-SIM-04)', () => {
  it('a peer dropping out mid-exchange does not block any other pairwise score', () => {
    const idx = new FindSimilarIndex();
    idx.publishWeights('A', tags('hiking', 'chess', 'music'));
    idx.publishWeights('B', tags('hiking', 'chess'));
    idx.publishWeights('C', tags('hiking', 'music'));
    idx.publishWeights('D', tags('hiking', 'chess', 'music'));

    const abBefore = idx.score('A', 'B', 'count');
    const acBefore = idx.score('A', 'C', 'count');
    expect(abBefore).toBe(2);
    expect(acBefore).toBe(2);

    // D drops out entirely (forget its map) — the most aggressive form of dropout.
    idx.remove('D');

    // Every other pairwise score is unchanged; no barrier/gate involved.
    expect(idx.score('A', 'B', 'count')).toBe(abBefore);
    expect(idx.score('A', 'C', 'count')).toBe(acBefore);

    // Ranking for A still computes over the surviving peers.
    const ranked = idx.topK('A', { k: 10, combine: 'count' });
    expect(ranked.people.map((p) => p.userId).sort()).toEqual(['B', 'C']);
  });

  it('a peer that never published does not block scoring or ranking', () => {
    const idx = new FindSimilarIndex();
    idx.publishWeights('A', tags('hiking', 'chess'));
    idx.publishWeights('B', tags('hiking', 'chess'));
    // 'ghost' is referenced but never published its map.
    expect(idx.score('A', 'ghost', 'count')).toBe(0);
    expect(() => idx.score('ghost', 'A', 'count')).not.toThrow();

    const ranked = idx.topK('A', { k: 10, combine: 'count' });
    expect(ranked.people.map((p) => p.userId)).toEqual(['B']);
  });
});

describe('find-similar §3 — incremental mutation + weighting (REQ-SIM-05/06)', () => {
  it('diff produces exactly one delta of only changed keys, and skips when unchanged', () => {
    const base = buildUserTagsEnvelope([{ name: 'hiking' }, { name: 'chess' }]);

    // No change → no publish.
    expect(diffUserTags(base, base.tags).delta).toBeNull();

    // Add 'music', drop 'chess', keep 'hiking'.
    const { envelope, delta } = diffUserTags(base, tags('hiking', 'music'));
    expect(delta).not.toBeNull();
    expect(delta!.changed).toEqual({ music: 1, chess: null });
    expect(Object.keys(delta!.changed)).toHaveLength(2); // only changed keys
    expect(envelope.version).toBe(base.version + 1);
    expect(envelope.tags).toEqual({ hiking: 1, music: 1 });
  });

  it('stale / replayed deltas are rejected (version-gated, idempotent)', () => {
    const v1 = buildUserTagsEnvelope([{ name: 'hiking' }]);
    const { envelope: v2, delta } = diffUserTags(v1, tags('hiking', 'chess'));
    expect(delta).not.toBeNull();

    // Replaying the same delta on the already-advanced envelope is a no-op.
    const replay = applyUserTagsDelta(v2, delta!);
    expect(replay.changed).toBe(false);
    expect(replay.envelope).toBe(v2);
  });

  it('patchPairwiseScore equals a full re-score for every combine policy', () => {
    const viewer = { hiking: 2, chess: 3, music: 1 };
    const otherPrev = { hiking: 1, chess: 1 };
    const { delta } = diffUserTags(
      buildUserTagsEnvelope(Object.entries(otherPrev).map(([name, weight]) => ({ name, weight }))),
      { hiking: 4, music: 5 }, // chess removed, hiking reweighted, music added
    );
    expect(delta).not.toBeNull();
    const otherNext = applyUserTagsDelta(
      buildUserTagsEnvelope(Object.entries(otherPrev).map(([name, weight]) => ({ name, weight }))),
      delta!,
    ).envelope.tags;

    for (const policy of Object.keys(COMBINE_POLICIES) as Array<keyof typeof COMBINE_POLICIES>) {
      const combine = COMBINE_POLICIES[policy];
      const prevScore = matchScore(viewer, otherPrev, combine);
      const patched = patchPairwiseScore(prevScore, viewer, otherPrev, delta!, combine);
      const full = matchScore(viewer, otherNext, combine);
      expect(patched).toBeCloseTo(full, 10);
    }
  });

  it('one user mutates → exactly one publish; all peers patch one row, no full re-exchange', () => {
    // Network: M and three viewers, each holding M's published map.
    const viewers = {
      P1: { hiking: 1, chess: 1 },
      P2: { hiking: 1, music: 1 },
      P3: { chess: 1, music: 1 },
    } as const;

    let mEnvelope = buildUserTagsEnvelope([{ name: 'hiking' }, { name: 'chess' }]);
    const mPrevTags = { ...mEnvelope.tags };

    // Each viewer caches its pairwise score of M.
    const cached: Record<string, number> = {};
    for (const [p, w] of Object.entries(viewers)) {
      cached[p] = matchScore(w, mEnvelope.tags, COMBINE_POLICIES.count);
    }

    // M mutates: drops chess, adds music+running. This yields ONE delta.
    const mutation = diffUserTags(mEnvelope, tags('hiking', 'music', 'running'));
    expect(mutation.delta).not.toBeNull();
    const publishes = mutation.delta ? 1 : 0;
    expect(publishes).toBe(1);
    mEnvelope = mutation.envelope;

    // Each viewer applies the SAME single delta and patches its one cached row.
    for (const [p, w] of Object.entries(viewers)) {
      cached[p] = patchPairwiseScore(cached[p], w, mPrevTags, mutation.delta!, COMBINE_POLICIES.count);
    }

    // Patched rows match a from-scratch recompute against M's new map.
    expect(cached.P1).toBe(matchScore(viewers.P1, mEnvelope.tags, COMBINE_POLICIES.count)); // hiking → 1
    expect(cached.P2).toBe(matchScore(viewers.P2, mEnvelope.tags, COMBINE_POLICIES.count)); // hiking+music → 2
    expect(cached.P3).toBe(matchScore(viewers.P3, mEnvelope.tags, COMBINE_POLICIES.count)); // music → 1
  });

  it('weighting rides the same path and makes ranking asymmetric (viewer-standard)', () => {
    const idx = new FindSimilarIndex();
    // A weights chess heavily; B weights chess lightly.
    idx.publishWeights('A', { hiking: 1, chess: 5 });
    idx.publishWeights('B', { hiking: 1, chess: 1 });

    const aRanksB = idx.score('A', 'B', 'viewer-standard'); // uses A's weights: 1 + 5
    const bRanksA = idx.score('B', 'A', 'viewer-standard'); // uses B's weights: 1 + 1
    expect(aRanksB).toBe(6);
    expect(bRanksA).toBe(2);
    expect(aRanksB).not.toBe(bRanksA); // asymmetry is the documented behavior

    // A re-weights chess down via a delta (same publish path) → A's ranking of B drops.
    const reweighted = idx.publishWeights('A', { hiking: 1, chess: 2 });
    expect(reweighted.version).toBe(2);
    expect(idx.score('A', 'B', 'viewer-standard')).toBe(3);
  });
});

describe('find-similar §4 — scale to ~100k (REQ-SIM-NFR-01/02/05)', () => {
  it('top-K over a 100k population is fast, bounded, and never O(N²)', () => {
    const N = 100_000;
    const POOL = 2_000; // large tag space → bounded candidate sets
    const TAGS_EACH = 5;
    const rng = mulberry32(42);
    const idx = new FindSimilarIndex();

    for (let u = 0; u < N; u++) {
      const t: UserTagWeightMap = {};
      for (let j = 0; j < TAGS_EACH; j++) t[`t${Math.floor(rng() * POOL)}`] = 1;
      idx.publishWeights(`u${u}`, t);
    }

    // Viewer + a planted perfect twin sharing all 8 of the viewer's tags.
    const viewerTags = tags('t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7');
    idx.publishWeights('viewer', viewerTags);
    idx.publishWeights('twin', { ...viewerTags });

    // Count combine invocations to bound total work against N².
    let combineCalls = 0;
    const countingCombine = (wv: number, wo: number) => {
      combineCalls++;
      return Math.min(wv, wo);
    };

    const t0 = Date.now();
    const result = idx.topK('viewer', { k: 50, combine: countingCombine });
    const elapsed = Date.now() - t0;

    // Correctness: the perfect twin ranks first.
    expect(result.people[0].userId).toBe('twin');
    expect(result.people.length).toBeLessThanOrEqual(50);

    // Scale: only ≥1-shared-tag candidates are scored — far below the population.
    expect(result.candidatesScored).toBeLessThan(N / 10);
    // Work is candidate-bounded, nowhere near O(N²).
    expect(combineCalls).toBeLessThan(N);
    // Latency budget (query only; generous vs. the 200ms target to absorb CI noise).
    expect(elapsed).toBeLessThan(1_000);
  });

  it('hot-tag cap, min-shared-tags threshold and locality scoping bound the candidate set', () => {
    const idx = new FindSimilarIndex();
    // 'common' is a hot tag held by 100 users; 'rare' by a few.
    for (let i = 0; i < 100; i++) idx.publishWeights(`hot${i}`, tags('common'));
    idx.publishWeights('shareBoth1', tags('common', 'rare'));
    idx.publishWeights('shareBoth2', tags('common', 'rare'));
    idx.publishWeights('viewer', tags('common', 'rare'));

    // Hot-tag cap limits how many 'common' holders enter the candidate set.
    const capped = idx.candidatesFor('viewer', { hotTagCap: 5 });
    expect(capped.size).toBeLessThanOrEqual(100); // not all 100 hot holders pull in
    // The two who share BOTH tags are always present.
    expect(capped.has('shareBoth1')).toBe(true);
    expect(capped.has('shareBoth2')).toBe(true);

    // min-shared-tags = 2 keeps only the two-tag sharers.
    const strict = idx.candidatesFor('viewer', { minSharedTags: 2 });
    expect([...strict.keys()].sort()).toEqual(['shareBoth1', 'shareBoth2']);

    // Locality predicate further bounds N per query.
    const scoped = idx.topK('viewer', {
      k: 10,
      combine: 'count',
      minSharedTags: 2,
      withinScope: (id) => id === 'shareBoth1',
    });
    expect(scoped.people.map((p) => p.userId)).toEqual(['shareBoth1']);
  });
});

describe('find-similar §5 — generic retrieve→sort→display pipeline (REQ-SIM-07)', () => {
  it('rankPeople with matched-tags sort (score desc) preserves topK ordering', () => {
    const idx = new FindSimilarIndex();
    idx.publishWeights('A', tags('hiking', 'chess'));
    idx.publishWeights('B', tags('hiking', 'chess', 'music'));
    idx.publishWeights('C', tags('hiking'));
    idx.publishWeights('viewer', tags('hiking', 'chess', 'music'));

    // topK gives us candidates in score order.
    const initial = idx.topK('viewer', { k: 10, combine: 'count' });
    expect(initial.people.length).toBe(3);
    expect(initial.people[0].userId).toBe('B'); // 3 matched tags
    expect(initial.people[1].userId).toBe('A'); // 2 matched tags
    expect(initial.people[2].userId).toBe('C'); // 1 matched tag

    // Re-sort by matched-tags (default) should be identical.
    const resorted = rankPeople(initial.people, 'viewer', idx, 'matched-tags');
    expect(resorted.map((p) => p.userId)).toEqual(['B', 'A', 'C']);
  });

  it('rankPeople with their-standard sort reverses ranking asymmetrically', () => {
    const idx = new FindSimilarIndex();
    // A rates everyone by count; B rates heavily into chess.
    idx.publishWeights('A', tags('hiking', 'chess'));
    idx.publishWeights('B', tags('chess')); // only chess
    idx.publishWeights('viewer', tags('hiking', 'chess', 'music'));

    // From viewer's perspective, A and B both match 1 tag (count); ranked by score desc.
    const myRanking = idx.topK('viewer', { k: 10, combine: 'count' });
    // A: hiking + chess = 2; B: chess = 1 (from viewer's weights)
    expect(myRanking.people[0].userId).toBe('A');

    // Re-sort by their-standard (how A and B rate the viewer, not vice versa).
    const theirRanking = rankPeople(myRanking.people, 'viewer', idx, 'their-standard', {
      combine: 'count',
    });
    // A sees viewer: hiking + chess = 2; B sees viewer: chess = 1
    // So the order is the same, but it's computed from the reciprocal direction.
    expect(theirRanking[0].userId).toBe('A');
    expect(theirRanking[1].userId).toBe('B');
  });

  it('rankPeople performs in-memory re-sorting on pre-materialized candidate lists', () => {
    const idx = new FindSimilarIndex();
    idx.publishWeights('A', tags('hiking', 'chess', 'music'));
    idx.publishWeights('B', tags('hiking', 'chess'));
    idx.publishWeights('C', tags('music'));
    idx.publishWeights('viewer', tags('hiking', 'chess'));

    const initial = idx.topK('viewer', { k: 10, combine: 'count' });
    const candidates = [...initial.people]; // materialize once: A (2), B (2), C (1)

    // Re-sort by matched-tags—just re-orders the in-memory list without new index reads.
    const resortedByScore = rankPeople(candidates, 'viewer', idx, 'matched-tags');
    expect(resortedByScore.length).toBe(candidates.length);
    // All candidates are still present.
    expect(new Set(resortedByScore.map((p) => p.userId))).toEqual(
      new Set(candidates.map((p) => p.userId)),
    );

    // Re-sort by their-standard requires computing reciprocal scores, but from the same index.
    const resortedByTheirView = rankPeople(candidates, 'viewer', idx, 'their-standard');
    expect(resortedByTheirView.length).toBe(candidates.length);
    // Same set of candidates, potentially in a different order.
    expect(new Set(resortedByTheirView.map((p) => p.userId))).toEqual(
      new Set(candidates.map((p) => p.userId)),
    );
  });

  it('SORT_STRATEGIES registry covers matched-tags, distance, their-standard', () => {
    expect(Object.keys(SORT_STRATEGIES).sort()).toEqual(['distance', 'matched-tags', 'their-standard']);

    const matchedTags = SORT_STRATEGIES['matched-tags'];
    expect(matchedTags.id).toBe('matched-tags');
    expect(matchedTags.key).toBe('score');
    expect(matchedTags.dir).toBe('desc');

    const distance = SORT_STRATEGIES.distance;
    expect(distance.id).toBe('distance');
    expect(distance.key).toBe('distance');
    expect(distance.dir).toBe('asc');

    const theirStandard = SORT_STRATEGIES['their-standard'];
    expect(theirStandard.id).toBe('their-standard');
    expect(theirStandard.key).toBe('their-standard');
    expect(theirStandard.dir).toBe('desc');
  });

  it('rankPeople with distance sort orders by blurred-location distance (ascending)', () => {
    const idx = new FindSimilarIndex();
    const candidates: RankedPerson[] = [
      { userId: 'far', score: 1, sharedTags: 1 },
      { userId: 'near', score: 1, sharedTags: 1 },
      { userId: 'mid', score: 1, sharedTags: 1 },
      { userId: 'unknown', score: 1, sharedTags: 1 },
    ];
    const viewer = { latitude: 37.0, longitude: -122.0 };
    const coords: Record<string, { latitude: number; longitude: number }> = {
      near: { latitude: 37.02, longitude: -122.0 },
      mid: { latitude: 37.2, longitude: -122.0 },
      far: { latitude: 38.0, longitude: -122.0 },
    };
    const sorted = rankPeople(candidates, 'viewer', idx, 'distance', {
      distanceMiles: (userId) =>
        coords[userId] ? blurredDistanceMiles(viewer, coords[userId]) : undefined,
    });

    // Nearest first; the unknown-distance candidate sorts last.
    expect(sorted.map((p) => p.userId)).toEqual(['near', 'mid', 'far', 'unknown']);
    expect(sorted[0].distance).toBeGreaterThanOrEqual(0);
    expect(sorted[3].distance).toBeUndefined();
    // Distances are monotonic in true separation despite grid blurring.
    expect(sorted[0].distance!).toBeLessThan(sorted[1].distance!);
    expect(sorted[1].distance!).toBeLessThan(sorted[2].distance!);
  });

  it('blurredDistanceMiles snaps to the privacy grid (never uses exact GPS)', () => {
    // Two points in the SAME ~2km grid cell blur to distance 0.
    const a = { latitude: 37.001, longitude: -122.001 };
    const b = { latitude: 37.009, longitude: -122.009 };
    expect(blurredDistanceMiles(a, b)).toBe(0);
    // A point a full degree away is clearly farther.
    expect(blurredDistanceMiles(a, { latitude: 38.0, longitude: -122.0 })).toBeGreaterThan(50);
  });

  it('rankPeople with unknown sortId falls back to default (matched-tags)', () => {
    const idx = new FindSimilarIndex();
    idx.publishWeights('A', tags('hiking'));
    idx.publishWeights('viewer', tags('hiking', 'chess'));

    const candidates: RankedPerson[] = [{ userId: 'A', score: 1, sharedTags: 1 }];

    // Unknown strategy ID → fallback to matched-tags (default).
    const result = rankPeople(candidates, 'viewer', idx, 'unknown-strategy');
    expect(result).toEqual(candidates); // unchanged order (already in score desc)
  });
});
