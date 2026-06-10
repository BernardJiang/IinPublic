# 06 — Sender-side suppression (P0 step 8)

Three browsers: **Tom** (talk author), **Jerry** (ignores), **Bob** (matches).

1. Tom creates a tag talk with two tags: "Tennis" and "Chess".
2. Tom broadcasts to Jerry and Bob.
3. Jerry receives the talk and answers **IGNORE**; Bob answers **MATCH**.
4. Tom's `talkLedger.outcomes` must record:
   - `Jerry → ignored` with `version=1` and a `respondedAt` timestamp.
   - `Bob → matched` with `version=1` and a `respondedAt` timestamp.
5. **Tom rebroadcasts the same talk.**
6. Assert that **Jerry is never re-prompted** — no new incoming cluster or modal
   appears on Jerry's page for the same talk identity.
7. Assert that Jerry's incoming cluster count for that identity key is unchanged
   after the rebroadcast (still the original one cluster, not a second one).
8. Assert that Tom's mesh-announce diagnostic count for Jerry did **not** increase
   after the rebroadcast (suppression happened at recipient selection, before
   any frame was sent).
9. Bob (matched) is also suppressed on the rebroadcast (per-identity, already
   in the exchanged set).
10. Zero calls to `POST /api/talks/*/response` throughout (mesh-only delivery).
