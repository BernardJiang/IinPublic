# 09 — Exchange Suppression (Step 11: Mutual Exchange Suppression)

covers: SPEC-8.2  <!-- auto-seeded; refine by hand -->

## Plain-English Description

**Three browsers: Tom, Jerry, Bob.**

### Part A: Tom exchanges tennis with Jerry

1. Tom broadcasts a tag talk containing two tags: **tennis** and **chess**.
2. Jerry answers Tom's talk.
3. Tom's device graph records tennis and chess as exchanged with Jerry (`ix/exchanged/<jerry>`: Tom sent both). Jerry's records tennis only (the tag he answered).

### Part B: Jerry rebroadcasts his own talk with tennis + chess

4. Jerry broadcasts **his own** tag talk, also containing tennis + chess, to Tom and Bob.
5. Jerry's graph has tennis exchanged with Tom from step 2 — tennis is **left out** (`omit`) for Tom.
   Chess is **not** suppressed, so Tom receives a **filtered** version of Jerry's talk containing **chess only**.
6. Bob has never exchanged tennis with Jerry — Bob receives **both** tennis and chess unchanged.

**Assertion:** Tom's body cache for Jerry's second talk must NOT contain "Tennis". Bob's body cache must contain both "Tennis" and "Chess".

### Part C: Jerry edits tennis (new identity key)

7. Jerry creates a new version of his tag talk where the tennis tag text is changed to "Tennis v2" (a new tag word).
8. Tom has no exchange of "Tennis v2" with Jerry (a new tag word).
9. Jerry rebroadcasts — Tom receives "Tennis v2" **exactly once** (new key, no prior exchange). Chess is still left out for Tom (Jerry already sent it to him).

**Assertion:** Tom receives the edited talk; body cache contains "Tennis v2". Tom does not receive the old "Tennis" again.

## Invariants Re-Asserted

- Zero `POST /api/talks/*/response` calls (mesh-only delivery).
- Suppression is per-identity, not per-talk: Tom can receive chess from Jerry's multi-tag talk even after tennis is suppressed.
- A new content hash (identity key change) re-opens delivery exactly once.

## Key Design Reference

Design note: `docs/design/p0-steps8-11-ledger.md` §5 (Step 11), §11.3 (broadcast-time per-identity exclusion), REQ-LEDGER-16.
