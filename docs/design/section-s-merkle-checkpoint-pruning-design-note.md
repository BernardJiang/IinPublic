# Section S Design Note — Merkle-checkpoint pruning for the ledger and conversation messages

Implementation guide for TODO.md **Section S** ("Adopt merkle-checkpoint pruning for the ledger
and conversation messages"). The target design already exists in full in
`docs/specs/iinpublic-technical-specifications.md` §28.9 (Blockchain-Style Integrity Preservation
During Trim) — this note does not re-derive that design, it grounds it in the actual current code
(which the spec text does not reference directly) and turns it into concrete edits, file by file,
in the style of the earlier K1–K3 design notes (`docs/archive/consolidated-2026-07-29/`).

Audience: the implementing engineer. Every item gives **Where** (file + function), **What
changes**, and **Risks** found by reading the real code, not just the spec prose.

---

## What the spec assumes vs. what the code actually does

Two corrections to make before implementing, both found by reading the code rather than trusting
the spec's abstract description:

1. **The ledger is currently write-mostly and has no external readers.** `WebLedgerService`'s three
   read methods (`getEventBySeq`, `getEventsByTalkId`, `isTalkWithdrawn`) are called **only from
   inside the class itself** (`syncWithPeer` uses `getEventBySeq`) — grep confirms no other file
   calls any of them. `app.ts` only calls `loadOwnFeedHead`, `startDeltaSync`, and `appendEvent`.
   Nothing in the product UI renders ledger history back to the user (that's `localTalkExchanges`/
   `myTalks`, a completely separate local store — see `CLAUDE.md`). **This significantly lowers the
   blast radius of pruning**: deleting old ledger event nodes cannot break any live UI feature
   today; the only consumer of old events is a peer catching up via delta-sync.
2. **Message pruning's proposed retention window (K_retain=200) is already compatible with the
   existing reconciliation window.** Phase 5 peer↔peer reconciliation
   (`direct-p2p-conversation-transport.ts` → `gunStore.listLocalWires`) already bounds itself to
   `DEFAULT_RECONCILE_WINDOW = 500` messages (`conversation-reconcile.ts:42`) — it was never
   full-history. Since 200 < 500, pruning to keep the last 200 messages doesn't newly break
   anything reconciliation depends on; it just means the digest reconciliation builds has fewer
   entries once a conversation exceeds the window, which is the intended, accepted consequence of
   pruning (SRS §9.4's own "provably committed but not reconstructible" property), not a new bug.

---

## Recommended implementation order

1. **Item 0 first (shared merkle module).** Both the ledger and message checkpoints need the exact
   same three primitives — root computation, proof generation, proof verification — and the spec
   describes them identically for both (§9.2 vs §9.4 differ only in what's hashed into the leaves,
   not in the tree math). One pure, dependency-free module avoids the K1-era "three near-identical
   builders" problem this codebase has already hit once (see the K1 design note's Item 5).
2. **Item 1 (ledger checkpoint event kind + creation).** Additive only — writes a new event kind
   alongside existing ones, no deletion yet. Safe to land and observe in isolation before any data
   can be lost.
3. **Item 2 (ledger pruning) only after Item 1 has been observed writing correct checkpoints.**
   This item deletes data; sequencing it after 1 is confirmed correct is the whole point of the
   checkpoint-then-delete ordering SRS §8.3 requires.
4. **Item 3 (delta-sync proof-instead-of-raw-event).** Depends on 1 and 2 both existing — there is
   nothing to prove until something has actually been pruned.
5. **Item 4 (message-side checkpoint + pruning), same order internally (create → observe → prune →
   delta-sync).** Deliberately after the ledger side is proven, since messages add the
   ciphertext-hash commitment and interact with an existing reconciliation path the ledger doesn't
   have.
6. **Item 5 (numeric retention windows) is a decision, not a coding step** — flag it to Bernard
   before Item 2/4 ship to production; the spec's N/M/K/K_retain values are explicitly "starting
   points, not settled production values" (TODO.md's own words). Implement 1–4 with the spec's
   example numbers as defaults so the mechanism itself is provable in tests immediately; wire them
   through named constants (`LEDGER_CHECKPOINT_INTERVAL`, `LEDGER_RETENTION_WINDOW`,
   `MESSAGE_CHECKPOINT_INTERVAL`, `MESSAGE_RETENTION_WINDOW`) so the eventual real numbers are a
   one-line change, not a re-implementation.
7. **Items 6 + 7 (tests) alongside 1–4, not after.** Given this is cryptographic/data-loss-adjacent
   code, write the proof-correctness unit test (item 6) *before* item 2 ever deletes anything in a
   real run, and the stage2/stage3 delta-sync test (item 7) before item 3 ships.

---

## Item 0 — Shared merkle module

> **Done 2026-07-31.** `src/shared/merkle-checkpoint.ts`. One refinement made while
> implementing: `buildMerkleProof`/`verifyMerkleProof` ended up async (this note's original
> sketch showed them sync) — they hash pairs internally via Web Crypto, which is inherently
> async, so there was no way to keep them sync without precomputing every level's hashes
> some other way. Also confirmed and documented in the module's own header: SRS §9.2's
> literal "root = SHA-256(JSON.stringify(ordered))" formula is a single flat hash, which
> cannot support the O(log N) proof §9.3 claims — implemented an actual binary Merkle tree
> instead (pairwise SHA-256 up the levels, odd levels padded by self-pairing the last
> node), which is what makes the O(log N) claim true. See Item 6 below for the tests
> proving this against the real spec numbers (100 leaves → ≤7 proof steps, per §9.3).

**Where**

- New file: `src/shared/merkle-checkpoint.ts`. Pure functions, no Gun/SEA dependency (mirrors how
  `src/shared/cid.ts` is a pure module the ledger/message code both already import).

**What changes**

```ts
/** Deterministic leaf ordering — same rule for both ledger CIDv1s and message-checkpoint pairs. */
export function sortedLeaves(ids: string[]): string[] {
  return [...ids].sort(); // lexicographic, matches SRS §9.2's "lexicographic_sort"
}

/** SHA-256 hex of the canonically-sorted, JSON-serialized leaf array (SRS §9.2's merkleRoot). */
export async function computeMerkleRoot(ids: string[]): Promise<string> { ... }

/** One Merkle proof step: sibling hash + which side it's on. */
export type MerkleProofStep = { sibling: string; side: 'left' | 'right' };

/** Build an O(log N) inclusion proof for `leaf` within `ids` (must include leaf). */
export function buildMerkleProof(ids: string[], leaf: string): MerkleProofStep[] { ... }

/** Recompute the root from `leaf` + `proof` and compare against `root`. */
export function verifyMerkleProof(root: string, leaf: string, proof: MerkleProofStep[]): boolean { ... }
```

Reuse `canonicalSerialize`/hashing conventions from `src/shared/cid.ts` for consistency (both
already use Web Crypto `SHA-256`), but do **not** reuse `computeCIDv1` itself for the root — the
spec's `merkleRoot` is a plain SHA-256 hex digest of the sorted array, not a CIDv1 (no multihash/
multibase wrapping needed for something that isn't itself a content-addressed reference). Ledger
event ids and message ids are *already* CIDv1/opaque-id strings today — they become the merkle
**leaves** unchanged; only the root/proof math is new.

Build the tree as a standard bottom-up binary Merkle tree over the sorted leaf array (pad an odd
level by duplicating the last node, the conventional approach — document the choice in a comment
since it affects proof verification symmetry).

**Risks / gotchas**

- **Determinism is everything.** `sortedLeaves` must produce byte-identical output for the same
  input set on every peer, or two honest peers computing the "same" checkpoint disagree on the
  root. Lexicographic string sort on the raw CIDv1/messageId strings (no locale-aware collation)
  is the only safe choice — confirm `Array.prototype.sort()` default (UTF-16 code unit order) is
  used, not `localeCompare`.
- Keep this module **framework-free and side-effect-free** (no Gun, no SEA) so it's trivially unit
  testable in isolation (item 6) without any Gun server or browser context — matches the existing
  `src/shared/*.ts` convention (e.g. `talk-engine.ts`, `find-similar.ts`).

---

## Item 1 — Ledger: `CHECKPOINT_CREATED` event kind + checkpoint creation

> **Done 2026-07-31.** `leafIds: string[]` added to `CheckpointCreatedContent` from the
> start (resolving the Item 3 gap noted below immediately, rather than deferring it).
> `pendingWindowIds`/`lastCheckpointSeq`/`checkpointInFlight` implemented as designed;
> `rebuildPendingWindow()` added to `loadOwnFeedHead()` for the reload-recovery case.
>
> **Two real pre-existing bugs found and fixed while writing this — not introduced by
> this change, but this is what surfaced them** (nothing previously exercised the
> ledger's read-after-write path end to end; see the "write-mostly, no external readers"
> finding at the top of this note):
> 1. `writeEventToGun` computed its Gun path from `event.pubkey`, while every other method
>    (`loadOwnFeedHead`, `peerState[this.userId]`, this class's own doc comments, the
>    spec's own `ledger/<userId>/events/<seq>` path) addresses a feed by `userId` —  a
>    different string from `pubkey` in the real app (`app.ts`'s `initLedger` constructs
>    this service with `currentUser.id` and `pair.pub`, never equal). Concretely,
>    `if (event.pubkey === this.userId)` was **always false**, so `ledger/<userId>/head`
>    was never written for anyone, so `loadOwnFeedHead` always found nothing, so every
>    session's own feed silently restarted from seq 1 — **overwriting the previous
>    session's events at the same Gun path.** Fixed by having `writeEventToGun` take an
>    explicit `feedKey` from the caller instead of inferring it from the event
>    (`this.userId` for self-authored events, `event.pubkey` for remotely-ingested ones,
>    which have no separate userId available).
> 2. `verifyEvent`'s signature check compared `verified !== message` where `verified` is
>    `SEA.verify(...)`'s return value — but Gun's SEA auto-`JSON.parse`s the verified
>    payload back into an object whenever it looks like JSON, which `canonicalSerialize`'s
>    output always does. Comparing an object to a string was always unequal, so **no
>    event's signature has ever verified successfully through this path** — the only
>    caller, `ingestRemoteEvent`, silently rejected every incoming delta-sync event as a
>    result. Fixed by normalizing `verified` back to a string (`JSON.stringify` if it
>    isn't already one) before comparing.
>
> Both were caught by the new unit tests (`web-ledger-service.test.ts`, 4 tests) — not by
> any existing test, since nothing previously exercised this path far enough to notice.
> Confirmed no E2E regression: full Jest suite green (1078/1079, +4 new), plus a targeted
> E2E sanity check (`00-ui-navigation-settings.spec.ts` full file +
> `00i-p0-direct-talk-delivery.spec.ts`) both green, since nothing in the E2E suite reads
> ledger internals directly (same finding as the "no external readers" note above).

**Where**

- `src/shared/types.ts` — add `CHECKPOINT_CREATED` to the `InteractionKind` enum (line 464) and a
  `CheckpointCreatedContent` interface alongside the other per-kind content types (line 511+), add
  it to the `InteractionEventContent` union (line 501).
- `src/web/services/web-ledger-service.ts` — `appendEvent()` (line 74) needs a hook after a
  successful append; new private method `maybeCreateCheckpoint()`.

**What changes**

```ts
export interface CheckpointCreatedContent {
  rangeStart: number;
  rangeEnd: number;
  merkleRoot: string;
  count: number;
}
```

The checkpoint is itself a ledger event — it gets the **next** seq number after the range it
covers, not a seq inside that range (SRS §9.2: "written as a ledger event of kind
`CHECKPOINT_CREATED` carrying its own `prev` pointer to event seq N"). So after `appendEvent`
advances `this.ownFeed` to `{ seq, prevCid: id }`, check `seq % LEDGER_CHECKPOINT_INTERVAL === 0`
(default 100); if true, gather the CIDv1 `id` of every event in `[seq - 99, seq]`, compute the
root, and call `appendEvent(InteractionKind.CHECKPOINT_CREATED, { rangeStart, rangeEnd, merkleRoot,
count })` — a **second**, recursive `appendEvent` call that lands at `seq + 1`.

Two ways to gather the range's ids — pick the first:
- **In-memory (preferred, avoids N Gun reads every 100 appends):** keep a small rolling array of
  `{seq, id}` for the current uncheckpointed window (reset after each checkpoint). Since
  `appendEvent` already builds the full `event` object before writing, push `event.id` here at
  zero extra Gun cost.
- **Gun re-read fallback:** call the already-existing `getEventBySeq(this.userId, seq)` for each
  seq in range. Correct but does 100 Gun reads per checkpoint — only fall back to this if the
  service can restart mid-window and lose the in-memory array (see Risks).

Store the checkpoint node itself at `ledger/<userId>/checkpoints/seq_<rangeEnd>` (SRS §9.2's own
path), in addition to it being a normal chained event at `ledger/<userId>/events/<seq+1>` — the
`checkpoints/` path is the fast lookup index a peer/verifier uses to find "the checkpoint covering
seq N" (§9.3 step 1) without walking the whole event chain.

**Risks / gotchas**

- **In-memory rolling-window loss on reload.** If the browser reloads mid-window (say at seq 137,
  37 events into the next 100-window), the in-memory id array is gone. `loadOwnFeedHead()` only
  restores `{seq, prevCid}`, not the per-event id list. On reload, re-derive the current window's
  ids via the Gun re-read fallback (`getEventBySeq` for `[checkpointedThrough+1, currentSeq]`) once,
  at startup, rather than trying to persist the rolling array — simpler and only pays the Gun-read
  cost once per session, not per append.
- **Checkpoint-of-checkpoint ambiguity.** Once seq 101 (the checkpoint event) exists, the *next*
  window is seqs 102–201, and 101 itself must not be counted as part of that window's leaves — it's
  a separate audit event, not part of the range it attests to. Keep the window boundary strictly
  the events *before* the checkpoint event, never including it.
- **Write ordering.** `writeEventToGun` currently has no failure recovery beyond a `console.warn`
  (line 228). A checkpoint write failing silently would leave the in-memory rolling window
  advanced past a window whose checkpoint never actually landed — guard `maybeCreateCheckpoint` so
  it only clears its rolling array *after* `appendEvent` for the checkpoint resolves successfully;
  on failure, leave the window intact and retry on the next append (don't silently drop it, since
  Item 2's pruning depends on a confirmed checkpoint existing first).

---

## Item 2 — Ledger: prune events once their checkpoint is confirmed

> **Done 2026-07-31.** `pruneLedgerEvents()` implemented as designed, called from
> `maybeCreateCheckpoint()` after `writeCheckpointIndex` resolves. Added
> `prunedThroughSeq` (persisted on the head node, restored via `loadOwnFeedHead`) so a
> reload doesn't re-attempt deleting the whole history again.
>
> **A real design subtlety confirmed by writing the tests, not just theorized:**
> checkpoint events are themselves ordinary chain events and get pruned like anything
> else once *they* fall behind the retention window — checkpoint #1 (covering seqs
> 1–100) sits at seq 101, which checkpoint #2's window (101–200) covers, so checkpoint
> #1's own existence stays provable via checkpoint #2's retained `leafIds` even after
> checkpoint #1's raw node is deleted. My first draft test wrongly assumed checkpoint
> events are specially exempt from pruning — they aren't, and shouldn't be, since a
> later checkpoint's leaf set is exactly what makes deleting an earlier one safe.
>
> Also confirmed empirically: pruning only re-evaluates when a *new* checkpoint fires
> (using the head at that exact moment), not continuously as later plain events
> accumulate — so the deletable boundary can lag by up to one checkpoint interval's
> worth of headroom behind the "true" current head. This is a natural, acceptable
> consequence of tying pruning to checkpoint cadence (matches the "run pruning after a
> checkpoint" ordering SRS §8.3 requires), not a bug — but worth knowing when reasoning
> about exactly how far behind the retention window a given prune pass will reach.
>
> 3 new unit tests (`web-ledger-service.test.ts`, now 7 total for this file): no pruning
> before the window is exceeded, exact-boundary deletion once it is (including the
> checkpoint-pruning-checkpoint case above), and watermark persistence across a
> simulated reload. Full Jest suite 1081/1082 (was 1078, +3, 0 regressions).

**Where**

- `src/web/services/web-ledger-service.ts` — new method `pruneLedgerEvents()`, called from
  `maybeCreateCheckpoint()` after the checkpoint event write resolves.

**What changes**

Per SRS §9.2's pruning window: keep the last `LEDGER_RETENTION_WINDOW` (default M=500) events in
full detail. After confirming the checkpoint write, compute `deletableThrough = currentSeq -
LEDGER_RETENTION_WINDOW`; for every already-checkpointed seq `<= deletableThrough` that still has a
full Gun node, delete it: `gun.get('ledger/<userId>/events/<seq>').put(null)` — the established
deletion pattern already used once in this codebase (`web-chatroom-service.ts:1127`,
`.get('locations').get(userId).put(null)`).

Concretely, with N=100 and M=500: nothing is actually deletable until at least 6 checkpoints exist
(600 events in), since the 500-event retention window is larger than one checkpoint interval —
don't implement "delete everything this checkpoint just covered," implement "delete anything more
than 500 events behind the current head that has *any* confirmed checkpoint covering it."

**Risks / gotchas**

- **The two index paths (`ledger/<userId>/index/talkId/<talkId>`, `.../index/withdrawn/<talkId>`)
  keep referencing event ids by string** (`eventIds: "id1,id2,..."`) — pruning the underlying event
  node does **not** clean up these indexes, and `getEventsByTalkId`/`isTalkWithdrawn` would then
  return an id that resolves to nothing. Confirmed via grep that neither is called from outside
  the service today (see the correction above), so this is not a live-UI risk right now — but
  document it as a known limitation (the index entry becomes a "this id existed, ask for its proof"
  pointer once pruned, not a dead reference) rather than silently leaving it unhandled.
- **This is genuinely deleting data with no application-level undo.** Even though the checkpoint
  preserves provability, the actual event content is gone. Do not skip item 6's forged-proof
  rejection test — a bug in `verifyMerkleProof` that silently accepts anything would mean the
  "provably existed" guarantee is fake exactly when it's needed (after real deletion).
- Only prune **our own feed** (`ledger/<userId>/...`, `userId === this.userId`). Never prune a
  different feed's events cached from `ingestRemoteEvent` — this service doesn't currently persist
  other users' full histories locally anyway (it writes to Gun, which is shared, so "our own feed"
  is the only one this device is authoritative for pruning).

---

## Item 3 — Ledger: delta-sync serves a proof instead of a raw event for pruned ranges

**Where**

- `src/web/services/web-ledger-service.ts` — `syncWithPeer()` (line 328) and `getEventBySeq()`
  (line 299); `subscribeToInbox()`'s ingest callback (line 369) and `ingestRemoteEvent()` (line 169).

**What changes**

`syncWithPeer` currently does, per missing seq: `const event = await this.getEventBySeq(...); if
(!event) continue;` — silently skipping anything pruned. Change to: if `getEventBySeq` returns
null, check whether a checkpoint covers that seq (read `ledger/<userId>/checkpoints/seq_<N>` for
the window containing it); if so, build a merkle proof (`buildMerkleProof`) for that seq's known
event id (the id is still recoverable — it's a leaf of the checkpoint's own committed set, which
the checkpoint node's `merkleRoot` doesn't literally store per-leaf, so the **id itself must be
tracked separately** — see Risks) and push `{ proofJson, checkpointJson, deliveredAt }` to the
peer's inbox instead of `{ eventJson, deliveredAt }`.

The inbox subscriber (`subscribeToInbox`) needs a second branch: entries with `proofJson` (not
`eventJson`) don't get `ingestRemoteEvent`'d as a full event — instead, verify the proof against
the checkpoint's SEA signature + merkle root, and if valid, record "seq N of feed X is proven, not
held in full" in `peerState` (advance past it) without a corresponding `events/<seq>` write. A
peer that only has proofs, not full events, for a range is in the **exact same position the
pruning device itself is** — this is the intended end state, not a degraded one.

**Risks / gotchas**

- **The checkpoint node's `merkleRoot` alone cannot regenerate a lost id.** A merkle root commits to
  a set of leaves but is not invertible — you cannot recover "the id at position K" from the root
  alone. **The full sorted leaf array must be retained somewhere even after the individual event
  nodes are pruned**, or no proof can ever be built again after the fact. Store it: either (a) as
  part of the checkpoint node itself (`leafIds: string[]` field, adding ~3.5KB for 100 CIDv1
  strings — this changes SRS §9.2's minimal ~256B checkpoint size, worth flagging to Bernard as a
  real tradeoff against the spec's own storage-savings table in §9.5), or (b) keep the pruning
  window's `eventIds` CSV already sitting in the talkId index (only covers events with a talkId,
  not universal) — (a) is the only fully general option. **This is a real gap in the spec text
  itself**, not just an implementation detail — flag it explicitly when this note is reviewed,
  since it changes the storage-savings numbers in SRS §9.5.
- `syncWithPeer`'s loop currently iterates `seq = theirSeq + 1` to `ourSeq` one at a time
  (line 332) — for a peer far behind a heavily-pruned feed, most of that range is now "return a
  proof" instead of "return an event," which is far cheaper per-item but still O(range) round
  trips; batching multiple proofs per Gun write is a reasonable follow-up, not required for
  correctness.

> **Done 2026-07-31.** Implemented with one deliberate simplification from the sketch above:
> `syncWithPeer` now uses a `while` loop with a variable step. On a missing seq it calls a new
> private `findCheckpointCoveringSeq(feedKey, seq)` — computed directly as
> `Math.ceil(seq / LEDGER_CHECKPOINT_INTERVAL) * LEDGER_CHECKPOINT_INTERVAL`, then a read of
> `ledger/<feedKey>/checkpoints/seq_<rangeEnd>` (Item 1's index) — and, if found, fetches the
> *whole checkpoint event* via `getEventBySeq(feedKey, checkpoint.eventSeq)` and pushes **that**
> to the peer's inbox, then jumps `seq` straight to `checkpoint.rangeEnd + 1` instead of
> revisiting every seq in the covered range.
>
> **Why "whole checkpoint" instead of a per-leaf `buildMerkleProof`, contra the original sketch
> above:** the risk section's own worry — "the id at seq N must be tracked separately from the
> root" — turned out to have no clean answer for a *per-seq* proof. `leafIds` (added in Item 1)
> is retained in **sorted** order (required for the tree math), not append/seq order, so once the
> raw event at seq N is gone there is no surviving map from "seq N" to "which entry in `leafIds`
> was it." A per-leaf proof needs to name a specific leaf; nothing after pruning can name it.
> Sending the entire checkpoint sidesteps this: it already carries the full sorted leaf set, the
> committed root, and a SEA signature over all of it — sufficient to prove the whole covered range
> at once, without targeting any single seq. `buildMerkleProof`/`verifyMerkleProof` (Items 0/6)
> remain correct and tested infrastructure for a genuinely different case — a third party proving
> *one specific claimed event id* against a checkpoint without holding the whole leaf array — but
> that case doesn't arise in delta-sync, since a peer catching up wants "am I missing anything,"
> not "prove event X specifically."
>
> Since a `CHECKPOINT_CREATED` event is just an ordinary, already-signed `InteractionEvent`, it
> travels the inbox in the **same existing shape** (`{eventJson, deliveredAt}`) and through the
> **same existing `ingestRemoteEvent` path** as any other event — no `proofJson`/`checkpointJson`
> wire format, no new `subscribeToInbox` branch was needed. `ingestRemoteEvent` advances
> `peerState[event.pubkey]` to the checkpoint's own seq (e.g. 101 for the 1-100 window), which is
> sufficient for `syncWithPeer`'s own gap check (`ourSeq <= theirSeq`) to recognize the peer no
> longer needs anything in that range.
>
> **One gap found and closed while testing:** `verifyEvent`'s SEA check proves *who* signed an
> event, not that a `CHECKPOINT_CREATED` event's own content is internally consistent — a signer
> could sign a `merkleRoot` that doesn't actually match its shipped `leafIds`, and the CID +
> signature checks alone would not catch it (both are computed over whatever content is handed to
> them, correct or not). Added a targeted check in `ingestRemoteEvent`: for
> `InteractionKind.CHECKPOINT_CREATED`, recompute `computeMerkleRoot(content.leafIds)` and reject
> if it doesn't match `content.merkleRoot`. Proven by hand-constructing a validly-signed,
> correct-CID event with a deliberately wrong `merkleRoot` (`appendEvent` itself doesn't validate
> this invariant — in the real flow via `maybeCreateCheckpoint` it's always correct by
> construction) and confirming `verifyEvent` alone passes it while `ingestRemoteEvent` rejects it.
>
> **A residual limitation, not fixed here, worth flagging to Bernard alongside Item 5's own open
> policy questions:** a checkpoint's *content* (its `merkleRoot`/`leafIds`) is only recoverable
> from its own raw event node — the CID is a one-way hash, so once a checkpoint's own node ages
> past the retention window and is pruned (an ordinary chain event, subject to the same rule per
> Item 2's finding), only "checkpoint existed" survives (via a *later* checkpoint's `leafIds`
> containing its id), not "checkpoint said this." With N=100/M=500, this first becomes possible
> once a 6th checkpoint's own prune pass reaches back far enough to delete checkpoint #1 (see
> Item 2's "Done" note) — so sufficiently old history's checkpoint content is not preserved
> indefinitely under these numbers. Tests here deliberately stop at one unpruned checkpoint to
> isolate Item 3's own logic from this compounding effect; Item 7's end-to-end tests should decide
> whether this residual gap needs a policy answer (e.g., a longer-lived "checkpoint of
> checkpoints") or is acceptable as designed.
>
> Tests: `src/test/unit/web-ledger-service.test.ts`, new describe block "delta-sync via
> checkpoint proof (TODO §S Item 3)" — (1) a pruned range is substituted with its covering
> checkpoint while a retained tail is still sent as individual raw events, and the receiving
> side's `ingestRemoteEvent`/`getState()` correctly advances past the pruned range; (2) a
> checkpoint with an internally-inconsistent `merkleRoot` passes `verifyEvent` but is rejected by
> `ingestRemoteEvent`. Full suite: 90 suites, 1083 passed (was 1081), 1 skipped, 0 regressions.
> Targeted E2E sanity (`00-ui-navigation-settings.spec.ts` full file,
> `00i-p0-direct-talk-delivery.spec.ts`): 9/9 passed.

---

## Item 4 — Messages: analogous checkpoint + pruning for `pairConversations/*/messages/*`

**Where**

- `src/web/services/gun-message-store.ts` — `putMessageRecord()` (line 261, the write path used by
  both `pairConversations/<pairId>/<convId>/messages/<id>` for direct-p2p and
  `conversations/<id>/messages/<id>` for other transports) and `listLocalWires()` (line 312, the
  read path Phase 5 reconciliation already bounds to `DEFAULT_RECONCILE_WINDOW`).

**What changes**

Reuse Item 0's merkle module. Per conversation, every `MESSAGE_CHECKPOINT_INTERVAL` (default K=50)
messages, compute a checkpoint whose leaves are `msgId + SHA-256(ciphertext)` pairs (SRS §9.4 —
committing to both ordering and content integrity without disclosing plaintext), write it to
`pairConversations/<pairId>/<convId>/checkpoints/<seq>` (mirroring the direct-p2p-vs-star-gun path
split `putMessageRecord` already does for the messages themselves — a `conversations/<id>/
checkpoints/<seq>` path for the non-direct-p2p case), then prune messages older than
`MESSAGE_RETENTION_WINDOW` (default K_retain=200) the same "delete via `.put(null)` after confirmed
checkpoint" way as Item 2.

Track the "messages since last checkpoint" count per conversation the same way as Item 1's ledger
rolling window (in-memory, rebuilt from a bounded Gun read on session start rather than persisted)
— `listLocalWires` already exists and already returns the ordered wire list, so counting off its
result rather than inventing a second read path is the natural fit.

**Risks / gotchas**

- **The same "leaf array must survive pruning" gap from Item 3 applies here, worse** — message
  content is SEA-encrypted end-to-end, so there is no server-side or Gun-side fallback that could
  ever recover a pruned ciphertext's exact hash if the leaf array itself is lost. Store
  `leafHashes: string[]` on the message checkpoint node from the start (this is explicitly
  budgeted into SRS §9.5's own "~512 bytes" message-checkpoint size estimate, unlike the ledger
  case above where it wasn't budgeted at all — reconcile that discrepancy when this note is
  reviewed).
- **Interaction with `getPairMessageSecret`/decryption**: pruning only removes the Gun node, not any
  cached-in-memory decrypted `Message[]` the UI is currently holding for an open conversation —
  those stay visible until the tab reloads, same as any other Gun deletion in this codebase. No
  special handling needed, just don't assume pruning is instantly reflected in an already-rendered
  conversation view.
- **Do not prune a conversation's messages while its live subscription is mid-backfill/reconcile.**
  `subscribeToMessages`'s Phase 5 reconcile (`getLocalMessageDigest`/`getMessagesForBackfill`) reads
  via `listLocalWires` at connection time — if a prune runs concurrently and deletes a message
  between the digest being built and the backfill request landing, the peer could get an
  inconsistent partial answer. Simplest safe rule: run the prune pass only when no reconcile is
  currently in flight for that conversation (a per-conversation lock/flag), not on every message
  send.

> **Done 2026-07-31.** Implemented in `src/web/services/gun-message-store.ts`. Since messages
> have no `seq` field (unlike the ledger's `InteractionEvent`), "position" is the index within
> the full chronological read `listLocalWires(conversationId, senderId, otherUserId, 0)` already
> returns (sorted by timestamp, id tiebreak — the same order `collectAndDecryptMessages` uses) —
> checkpoint/pruning both operate on that index rather than an explicit counter field.
>
> `putMessageRecord` fires a new private `maybeCreateMessageCheckpoint` at the end of every write
> (fire-and-forget, matching the method's own existing style — no caller awaits `putMessageRecord`
> today either). Per conversation, in-memory state (`lastCheckpointedCount`, `prunedThroughCount`)
> is lazily rebuilt once from a new `checkpointState` Gun node (mirrors the ledger's `head` node),
> then kept current in memory for the rest of the session. Every `MESSAGE_CHECKPOINT_INTERVAL`
> (50) new messages, a checkpoint is written to `checkpoints/count_<N>` under the same
> pair-vs-legacy root `putMessageRecord` itself already splits on; leaves are
> `msgId:SHA-256(wire.text)` (`wire.text` is already ciphertext for encrypted channels, so no
> plaintext is ever committed). Pruning then deletes anything more than
> `MESSAGE_RETENTION_WINDOW` (200) messages behind the most recent checkpoint, via the same
> `.get(id).put(null)` idiom Item 2 used for the ledger.
>
> **Reused Item 0/6, not reinvented**: `computeMerkleRoot` and `sha256Hex` (newly exported from
> `merkle-checkpoint.ts` for this reuse) are the same functions the ledger checkpoint uses — one
> hash implementation for both checkpoint kinds, exactly as this item's own "What changes" text
> intended.
>
> **Design refinement — extracted the decision logic as pure functions, not tested against Gun
> directly:** `planMessageCheckpoint`/`planMessagePruning` (also in `gun-message-store.ts`) carry
> all the window-slicing/merkle-root/retention-boundary math with zero Gun dependency — the same
> "no DOM, no Gun, no WebRTC" split this file's sibling `conversation-reconcile.ts` already uses
> ("this module is the pure, single source of truth for 'what to send / what to keep'... so the
> convergence logic is fully unit-tested"). `maybeCreateMessageCheckpoint`/`pruneMessages` call
> these and handle only the Gun reads/writes/deletes around them. This wasn't the original plan —
> it came from a concrete testing failure: a real in-memory `Gun()` instance (`radisk: false`, no
> peers, no AXE/multicast — the standard e2e-isolated config) turned out not to reliably resolve a
> `.map()` read over freshly-written *nested* children under Jest's node test environment, even
> after independently pre-warming every intermediate node in the chain; a flat single-level
> `.get(key).put()`/`.once()` round-trip worked fine, but multi-level chains
> (`pairConversations/<pairId>/<convId>/messages/<id>`, four levels deep) did not resolve within
> any wait tried. This is a limitation of that bare test configuration, not of the production
> code, which runs against a real browser Gun instance with actual storage and peer connections —
> confirmed by the messaging E2E specs below passing unmodified. Extracting the pure logic sidesteps
> needing real Gun for the bulk of the coverage; the remaining Gun-wiring tests (does
> `putMessageRecord` write the checkpoint to the right path in the right shape, does pruning
> delete the right message nodes) run against a small hand-written synchronous fake Gun-chain
> double (real nested `.get()`/`.put()`/`.once()`/`.map()` semantics, no timing quirks) rather than
> a real or partially-mocked Gun instance.
>
> **Reconcile-guard wiring**: `GunMessageStore.setReconcileInFlight(conversationId, boolean)` is
> new public API; `DirectP2PConversationTransport`'s `getLocalMessageDigest`/
> `getMessagesForBackfill` hooks (passed into the P2P session config) now bracket each call with
> it in a try/finally. This closes the concrete race within each individual read (a prune
> interleaving with `listLocalWires`'s own multi-hundred-ms collection window) but does not
> lock the narrower gap *between* the two independently-triggered calls (digest sent, then
> backfill requested later) — flagged here as a known, minor residual gap (worst case: the peer's
> digest-time view included an item that's since been pruned by the time backfill runs, so that
> one item silently isn't backfilled, recoverable the same way any pruned-but-still-needed item
> would be — not a crash or corruption).
>
> Tests: `src/test/unit/gun-message-store.test.ts` — 8 pure-logic tests against
> `planMessageCheckpoint`/`planMessagePruning` (interval boundary, window slicing across multiple
> checkpoints, merkle-root self-consistency, retention-boundary math including "never prunes past
> what's actually checkpointed") + 3 Gun-wiring tests against the fake chain (checkpoint written
> at the interval, reconcile-in-flight suppresses the pass, pruning deletes the correct message
> range and leaves the retained tail intact). Full suite: 91 suites, 1094 passed (was 1083 before
> this item), 0 regressions. Targeted E2E sanity: `00i-p0-direct-talk-delivery.spec.ts` (1/1),
> `09-messaging.spec.ts` + `00j-messaging-edge-cases.spec.ts` (3/3) — all passed unmodified.

---

## Item 5 — Numeric retention windows (policy decision, not code)

**Where:** N/A — this is a product decision for Bernard, per TODO.md's own framing ("the one piece
of the design that's a policy choice, not an implementation detail").

**What's needed:** confirm or replace SRS §28.9's example values (`LEDGER_CHECKPOINT_INTERVAL=100`,
`LEDGER_RETENTION_WINDOW=500`, `MESSAGE_CHECKPOINT_INTERVAL=50`, `MESSAGE_RETENTION_WINDOW=200`)
against real usage numbers once Items 1–4 are implemented and can be measured against actual
storage growth (the same "run it against a real deployment and paste the numbers" gate L2 is
already blocked on). Until then, ship with the spec's example values as named constants so this is
a one-line change later, not a re-implementation.

---

## Item 6 — Test: unit, merkle proof correctness + forgery rejection

> **Done 2026-07-31.** `src/test/unit/merkle-checkpoint.test.ts`, 12 tests, all green (plus
> single-leaf and two-leaf edge cases beyond the list below). Confirmed the O(log N) claim
> directly: every proof against the 100-leaf set is ≤7 steps, matching SRS §9.3's own
> number.

**Where:** new `src/test/unit/merkle-checkpoint.test.ts`, pure (no Gun/browser), testing Item 0's
module directly.

**What it must cover:**
- A proof for a real leaf in a real tree verifies against the correct root.
- A proof for a leaf **not** in the tree fails verification.
- Tampering with any single proof step (or the claimed leaf, or the root) fails verification —
  the actual "reject a forged proof" case TODO.md's Work list calls out explicitly.
- Deterministic root: the same leaf set in a different insertion order produces the identical root
  (proves the lexicographic sort is doing its job).
- Odd-length leaf arrays (the padding-by-duplication edge case) still produce valid, verifiable
  proofs for every real leaf, including the duplicated one.

---

## Item 7 — Test: `stage2`/`stage3`, pruning + delta-sync end to end

**Where:** new spec(s) under `tests/e2e/staged/stage2-two-user/` (ledger) and/or
`stage3-three-user/` (message reconciliation with a third peer catching up).

**What it must cover** (per TODO.md's own Work item, now made concrete against the real service):
1. Drive enough `appendEvent` calls (or enough real talk/message activity) to cross
   `LEDGER_CHECKPOINT_INTERVAL` + `LEDGER_RETENTION_WINDOW` (or the message equivalents) so a real
   prune actually fires.
2. Assert the older full-detail Gun nodes are gone (`gunService.get('ledger/<id>/events/<seq>')`
   resolves empty for a pruned seq) **and** the checkpoint node exists with a valid `sig`.
3. A peer who was offline during the pruning window, then reconnects and runs delta-sync, still
   ends up caught up — receiving proofs for the pruned range and raw events for the retained range
   — without the sync silently dropping the pruned portion (this is the regression Item 3 exists to
   prevent; before Item 3, `syncWithPeer`'s `if (!event) continue;` would silently skip it).
4. Message history in the UI still renders correctly up to the retention window after a prune (SRS
   §9.4's "not reconstructible beyond the window" is the *expected* limit — assert the boundary,
   not that everything is still there).

> **Done 2026-08-01.** `tests/e2e/staged/stage2-two-user/30-ledger-message-pruning-e2e.spec.ts`
> (+ companion `.md`). Two real browsers (Tom/Jerry), matched via the normal talk flow, then:
> Tom's ledger is driven through `appendLedgerEventsForE2e` (a new `IinPublicApp` E2E hook
> calling `WebLedgerService.appendEvent` directly — 650+ real UI actions would be
> impractical) past a real checkpoint + prune cycle; `isLedgerRawEventPresentForE2e` and
> `getLedgerCheckpointVerifiedForE2e` confirm the pruned seq is gone and the checkpoint
> re-verifies via the service's own `verifyEvent`; Jerry (who never received the flood)
> is pushed a delta-sync via `pushLedgerSyncToPeerForE2e` and polls `getLedgerStateForE2e`
> until caught up, proving Item 3's checkpoint-substitution actually works over the wire.
> Messages are driven the same way (`sendConversationMessagesForE2e`) and checked via
> `/api/test/export-snapshot` plus a live UI render check.
>
> **`LEDGER_CHECKPOINT_INTERVAL`/`LEDGER_RETENTION_WINDOW`/`MESSAGE_CHECKPOINT_INTERVAL`/
> `MESSAGE_RETENTION_WINDOW` are now env-overridable** (`IINPUBLIC_E2E_LEDGER_*`/
> `IINPUBLIC_E2E_MESSAGE_*`, unset = real production defaults) — real sequential Gun round
> trips at production scale (100/500, 50/200) take several seconds *each*; driving 600+ of
> them in one browser session is impractical for a suite that must stay CI-fast. This spec
> runs at a small scale (5/25 ledger, 5/10 messages) that still genuinely crosses both
> thresholds. Also required adding these vars to webpack.config.js's `BUNDLED_ENV_KEYS`
> filesystem-cache key list — omitting them was itself a real bug found while calibrating
> the scale (a stale cached bundle silently ignored a changed env var between runs).
>
> **Four real, previously-invisible bugs were found and fixed via this spec** — none
> caught by the FakeGunStore/FakeGunNode unit tests for Items 1-4, since those doubles are
> plain in-memory Maps/trees that don't enforce Gun's own real semantics:
> 1. **The ledger has been completely inert in every E2E run since Phase E.** `initLedger`/
>    `startLedgerDeltaSync`/`ledgerEmit` were gated behind `if (process.env.DISABLE_HMR ===
>    'true') return;` — bundled into an unrelated background-service-quieting sweep, not a
>    deliberate "ledger is broken in E2E" decision (see `app.ts`'s `isLedgerDisabledForRun`
>    for the full story) — and every standard `test:e2e` script sets `DISABLE_HMR=true`.
>    Fixed with a narrow, additive `IINPUBLIC_E2E_ENABLE_LEDGER=1` override that changes
>    nothing for the hundreds of other E2E specs that never set it.
> 2. **Ledger event deletion (Item 2's `pruneLedgerEvents`) never actually deleted
>    anything, two ways in a row.** `gunService.put(path, null)` at a flat string-keyed
>    path is rejected by Gun ("Data at root of graph must be a node") since that isn't a
>    delete-one-edge operation. The fix — null every field individually instead of the
>    whole node — then silently did nothing either, because `WebGunService.serializeDates`
>    strips every `null`-valued property before handing data to Gun, so an
>    all-fields-null object serializes to `{}`, a no-op merge. Fixed by writing through the
>    raw Gun instance directly for this one case (`putRawGunFieldsNulled`), bypassing
>    `serializeDates`.
> 3. **`getEventBySeq` silently broke CID/signature verification for every event it ever
>    read back.** `WebGunService.get()`'s `deserializeDates` auto-converts any ISO-date-*
>    looking* string field (every event's `timestamp` always matches) back into a JS
>    `Date` object; `canonicalSerialize` treats a `Date` as a plain object and calls
>    `Object.keys()` on it (empty — a `Date`'s state isn't an enumerable own property),
>    serializing it as `{}` and silently changing the recomputed payload. This broke
>    checkpoint verification, delta-sync ingest verification — everything that reads an
>    event back through this method. Fixed by normalizing `timestamp` back to a string.
> 4. **The ledger's delta-sync inbox has never actually delivered anything to anyone,
>    ever.** Inbox entries were written via `gunService.put('ledger/<peerId>/inbox/
>    <eventId>', ...)` — a *flat* string key, making each entry an independent, unlinked
>    top-level Gun soul with no real parent-child edge to the `inbox` node at all.
>    `subscribeToInbox`'s `.map()` (itself upgraded from a plain, equally-broken `.on()`
>    that only sees unresolved child references, not resolved content) can only iterate
>    *real* nested children — a flat key sharing a string prefix isn't one. So every event
>    ever pushed via `syncWithPeer` was permanently undiscoverable by the receiving peer.
>    Fixed by writing and reading inbox entries through a real nested `.get('ledger').get(
>    peerId).get('inbox').get(eventId)` chain (`putLedgerInboxEntry`) — every *other*
>    flat-keyed ledger path (events, checkpoints, head) is looked up by an already-known
>    key, not discovered by iteration, so flat keys remain correct there.
>
> A fifth, separate test-authoring bug (not a production bug) was also found and fixed:
> `WebLedgerService.getState()`/`peerState` keys a feed by `userId` for events a device
> authors itself but by `event.pubkey` for events ingested from a remote peer (the only
> identifier available for a feed that isn't "us") — the spec's own delta-sync assertion
> initially checked the wrong key (`tomUserId` instead of `tomPub`), exactly the same
> distinction the Item 3 unit test itself already got right.
>
> **Ledger requirements 1-3 are now solidly proven end to end** across many repeated runs.
> **Message-side pruning (part of requirement 1/2) remains an open, documented gap**: unlike
> the ledger, message checkpoint/prune reliability in a real browser was found to be
> inconsistent — `checkpointState.prunedThroughCount` sometimes advances and the
> corresponding deletes land, sometimes it advances but the deletes don't, and sometimes no
> checkpoint/prune completes at all for the tail of a fill. This was reproduced even after
> eliminating the most likely cause (concurrent fire-and-forget `maybeCreateMessageCheckpoint`
> passes racing on inconsistent `listLocalWires` snapshots — pacing sends up to 2.5s apart,
> nearly 5x `listLocalWires`' own 500ms settle window, did not make it reliable). The spec
> deliberately does **not** assert a specific message is pruned; it asserts what's actually
> proven (checkpoint creation itself, and that the UI keeps rendering correctly after heavy
> send/checkpoint activity). Root-causing message-side prune reliability is unfinished work —
> a natural next investigation, distinct from Items 1-3's now-confirmed-solid ledger
> mechanism.
>
> Full unit suite throughout this item's debugging: 91 suites, 1094 passed, 0 regressions
> (unchanged from Item 4, since every fix here is either E2E-hook-only or normalized by
> existing test doubles once updated to match — e.g. `FakeGunStore`/`FakeGunNode` gained a
> real multi-level `getGun()` node tree to model the flat-key-vs-nested-chain distinction).

---

## Contract / doc amendments

- `docs/specs/iinpublic-technical-specifications.md` §28.9 needs two corrections once this lands
  (flag when this note is reviewed, don't silently patch the spec pre-implementation):
  1. §9.2's ~256-byte ledger checkpoint size and §9.5's savings table both assume no leaf-array
     storage; Item 3's finding is that the leaf array must be retained somewhere for proofs to
     remain buildable after pruning, which changes those numbers materially for the ledger case
     (message checkpoints already budget for a comparable list, per §9.4's own field description).
  2. §9.6's "the `ledger/<userId>/state` broadcast is unchanged" line stays true, but add that
     `peerState` (the in-memory `LedgerState`) also advances past proof-only ranges once Item 3
     lands, not just past fully-ingested-event ranges.
- No change needed to `CLAUDE.md`'s architecture summary — the ledger/message storage paths and the
  P2P transport description are unaffected; only their internal retention behavior changes.
