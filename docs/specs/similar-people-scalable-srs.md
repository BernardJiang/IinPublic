# SRS — Scalable "Find Similar People" by Matched Tags

Status: Draft (design of record for the generic tag-matching / similar-people feature)
Last updated: 2026-06-08
Related: `docs/TODO.md` (action items), `src/shared/talk-engine.ts`, `src/shared/talk-content-id.ts`, mesh-talk delivery (REQ-P2P-09–29)

---

## 1. Purpose and scope

Generalize the current "10 users × 20 tags, then find similar people" E2E scenario into a
production feature: given **N** users where each user *i* holds **Mᵢ** tags, after users exchange
tags, every user can rank all others by a **match score** derived from shared tags. The feature must
remain correct and responsive as the reachable population grows toward **N ≈ 100,000** (all users a
person can plausibly interact with over time), not just the 10-user test.

In scope: the tag data model, the match-scoring function, candidate generation at scale, incremental
update on churn/mutation, tag weighting, and a generic retrieve/sort/display API for the UI.

Out of scope: the talk-exchange transport itself (covered by the mesh-talk spec) beyond the
requirements this feature places on it.

## 2. Definitions

- **Tag set / tag map** `Tᵢ`: user *i*'s tags as `tag -> weight` (weight default 1; an "important"
  tag has weight > 1).
- **Shared tags** `Tᵢ ∩ Tⱼ`: tags present in both maps.
- **Match score** `score(viewer, other)`: a number computed from shared tags (see §5.1). May be
  asymmetric when weighted.
- **Candidate set**: the bounded subset of users a viewer actually scores and ranks (never all 100k).
- **Reachable population**: users in the viewer's chatrooms / region / proximity / exchange history —
  the practical universe for a given query.

## 3. Functional requirements

- **REQ-SIM-01** Each user publishes a versioned tag map to a location every reachable peer (or the
  rendezvous index) can read independently — no pairwise handshake.
- **REQ-SIM-02** A viewer can compute `score(viewer, other)` for any peer whose tag map it holds,
  using a single shared scoring function (also used by the existing match engine).
- **REQ-SIM-03** A viewer can retrieve the **top-K** peers by match score without materializing or
  sorting the entire reachable population.
- **REQ-SIM-04** Exchange is asynchronous and idempotent: a peer dropping out mid-exchange must not
  block any other pairwise score (Scenario 1, §6.1).
- **REQ-SIM-05** When a user mutates tags (add / modify / delete), the system updates all affected
  rankings with **minimum re-exchange** — one publish by the mutated user; peers patch incrementally
  (Scenario 2, §6.2).
- **REQ-SIM-06** A user may weight individual tags as more important; weighting is applied through the
  same scoring function and the same publish/delta path (Scenario 3, §6.3).
- **REQ-SIM-07** The retrieve→sort→display pipeline exposes pluggable, named sort strategies
  (matched-tags, distance, "their standard", …) selectable from the UI without code changes (§7).
- **REQ-SIM-08** All tag and weight data is treated as user content under the existing SEA encryption
  / privacy model; any score that requires another user's weights ("their standard") must be either
  computable from published data or delegated to a trusted compute path (§8.4).

## 4. Data model

```
user-tags/<userId> : {
  version:  number,            // monotonically increasing
  hash:     string,            // content hash of weights, for O(1) change detection
  weights:  { [tag: string]: number },   // tag -> weight (default 1)
  updatedAt: ISO8601
}
```

- Tags are a **map**, never a nested array (Gun.js cannot store nested arrays — same rule as
  `questionsJson`). Add / modify / delete are per-key operations.
- `hash` reuses the content-hash approach in `talk-content-id.ts` so a peer can detect "did X actually
  change?" without diffing the full map.
- A **delta** record carries only changed keys: `{ version, changed: { tag: weight | null } }`
  (`null` = delete).

### 4.1 Inverted index (scale-critical)

To avoid O(N²) comparison, maintain an inverted index from tag to holders:

```
tag-index/<tag> : Set<userId>          // who holds this tag
```

Maintained by the publisher on each tag add/remove (or rebuilt server-side from `user-tags`). A
viewer generates candidates as the union of `tag-index[t]` over the viewer's own tags — i.e. only
users who share ≥ 1 tag are ever scored. This is the single most important scaling lever.

## 5. Algorithms

### 5.1 Scoring (one function, all cases)

```ts
// combine() picks the policy; default = "viewer's standard" (asymmetric).
function matchScore(
  viewer: TagWeights,
  other: TagWeights,
  combine: (wViewer: number, wOther: number) => number = (wv) => wv,
): number {
  let s = 0;
  for (const tag in viewer) if (tag in other) s += combine(viewer[tag], other[tag]);
  return s;
}
```

- Unweighted "number of matched tags" = `combine = () => 1` with all weights 1.
- Mutual importance = `combine = (wv, wo) => wv * wo`.
- Conservative = `combine = (wv, wo) => Math.min(wv, wo)`.
- "Their standard" (how highly *they* rate the viewer) = `matchScore(other, viewer)` (args swapped).

This must live in `src/shared/` next to `checkIfMatch` so server and browser never diverge
(invariant: match logic is not duplicated in routes/UI).

### 5.2 Candidate generation + top-K

1. Read viewer's tags `Tᵥ`.
2. `candidates = ⋃ tag-index[t] for t in Tᵥ` (bounded by tag popularity; cap per tag if a tag is
   pathologically common).
3. Score each candidate with `matchScore`; keep a **bounded heap of size K** (top-K), not a full sort.
4. Return the K highest. Complexity ≈ O(C log K) where C = |candidates| ≪ N.

For very hot tags, cap contribution (e.g. sample, or require ≥ 2 shared tags before a candidate is
considered) to keep C bounded.

## 6. Scenarios

### 6.1 Scenario 1 — dropouts during exchange (REQ-SIM-04)

Model exchange as **publish + independent local read**, never a pairwise barrier. Each user's tag map
lives at `user-tags/<id>` with a version; scoring reads whatever maps the viewer currently holds. A
peer going offline mid-exchange is indistinguishable from "not synced yet": every other pairwise score
still computes. This mirrors the existing authoritative-`incomingTalksMap` + eventual-Gun-mirror
pattern. No global completion gate is required for ranking to be usable.

### 6.2 Scenario 2 — tag mutation with minimum re-exchange (REQ-SIM-05)

Because every score is computed locally from per-peer published maps, a change requires **only the
mutated user to re-publish**:

- Publish a **delta** (`changed` keys + new `version`/`hash`), not the full map.
- Peers detect the change in O(1) via `hash`; if unchanged, skip.
- A peer holding a cached pairwise contribution patches its single affected score in O(|delta|), and
  only the **one row** for the mutated user is recomputed — O(N) single-pair patches across the
  network, never O(N²).
- The publisher updates `tag-index` for added/removed tags only.

Floor: 1 publish by the mutated user → each peer does an O(|delta|) local patch + an index touch.

### 6.3 Scenario 3 — weighting important tags (REQ-SIM-06)

Marking a tag "important" writes a weight ≠ 1 into the same `weights` map and rides the identical
delta/publish path as §6.2 — no separate mechanism. Choose the combine policy deliberately (§5.1).
Note weighting makes the relation **asymmetric**: A may rank B highly while B ranks A low. The UI must
state which score it shows ("my ranking of them" vs. a symmetrized score), because assertions and user
expectations differ.

## 7. Generic retrieve → sort → display (REQ-SIM-07)

Separate three concerns and drive the UI from a strategy registry:

```ts
interface SortStrategy {
  id: string;                 // "matchedTags" | "distance" | "theirStandard"
  label: string;              // UI dropdown text
  key: (viewer: User, other: User, ctx: Ctx) => number;
  dir?: 'asc' | 'desc';
}
```

- **Filter** (predicate): blocked, chatroom, region, `matchedTags >= k`.
- **Sort** (named strategy): registry of `key` functions; "their standard" is `matchScore` with args
  swapped — same primitive, which signals the abstraction is right.
- **Project** (display fields).

Pipeline: `rankPeople(viewer, candidates, sortId, filters)` filters, then ranks via the selected
strategy. **Materialize the candidate set once, then sort in memory** — the candidate set is bounded
(§5.2), so re-sorting by any strategy (distance, score, their-standard) is microseconds and needs zero
extra reads. The UI builds its sort dropdown by iterating the registry, so adding a sort is a one-line
entry, not a view change. This fits the existing `ContactsViewDeps` injection (add `sortStrategies` +
`activeSortId`; three call sites in `ui-manager.ts`). Distance uses blurred location
(`LocationPrivacy.blurLocation`) — approximate is acceptable.

## 8. Non-functional requirements

- **REQ-SIM-NFR-01 (scale)** Correct and responsive at N ≈ 100k reachable users. No code path may be
  O(N²) in the reachable population, hold all peers' tag maps in memory, or fully sort the population.
- **REQ-SIM-NFR-02 (latency)** Top-K (K ≤ 50) ranking returns in < 200 ms client-side over a candidate
  set bounded by the inverted index.
- **REQ-SIM-NFR-03 (incremental)** A single-tag mutation propagates as one delta; no full re-exchange.
- **REQ-SIM-NFR-04 (privacy)** Tag maps and weights follow the SEA encryption model. Decide explicitly
  whether weights are public: "their standard" sorting requires *their* weights client-side; if weights
  must stay private, that score must be computed by a trusted/server path instead (§8.4 open question).
- **REQ-SIM-NFR-05 (locality)** Effective N per query is bounded by chatroom/region/proximity scoping,
  keeping candidate sets small even as global N grows.

### 8.4 Open questions / risks

- **Weight visibility vs. "their standard" sort.** Publishing weights enables fully client-side
  asymmetric ranking but leaks importance signals. Private weights force a server-computed score.
- **Hot tags.** A tag held by a large fraction of users inflates the candidate set; needs capping /
  min-shared-tags threshold / sampling.
- **Index authority.** Inverted index can be publisher-maintained (P2P, eventually consistent) or
  server-rebuilt from `user-tags` (simpler, central). Pick per the mesh-vs-server trajectory.
- **Consistency of cached pairwise scores** across deltas (versioning + idempotent patch required).

## 9. Phasing

1. **P1 — Generalize correctness:** weighted `matchScore` + `user-tags` map in `src/shared/`; replace
   the hardcoded 10×20 logic; parametrize the E2E to arbitrary N / Mᵢ. (No index yet; fine ≤ ~10³.)
2. **P2 — Incremental + weights:** versioned delta publish, O(1) hash change-detect, incremental
   pairwise patch, tag weighting end to end (Scenarios 2 & 3).
3. **P3 — Scale:** inverted `tag-index`, candidate generation, bounded top-K heap, hot-tag capping,
   locality scoping (NFR-01/02/05).
4. **P4 — Generic UI pipeline:** `SortStrategy` registry wired through `ContactsViewDeps`; distance /
   matched-tags / their-standard strategies; in-memory re-sort.
