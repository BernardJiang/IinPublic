# Test: Concurrent Room Visit Counter

covers: docs/TODO.md L1 (CRDT G-Counter visit metrics)

**File:** 35-concurrent-visit-counter.spec.ts
**Features tested:** Room visit / unique-visitor accounting under simultaneous joins.

---

## What this test does (in plain English):

The two lifetime badges on every chatroom row — 🚪 visits and ◎ unique visitors — used to be
shared Gun scalars that both the server and the browser incremented read-modify-write. When two
people joined a room at the same moment, both read the same total and both wrote total + 1, so
Gun's last-write-wins quietly threw one visit away. There was no event log to rebuild from, so the
loss was permanent.

Both numbers now come from a CRDT G-Counter: each user owns one slot at
`chatrooms/<roomId>/visitCounter/<userId>` and nobody writes anyone else's. Total visits is the sum
of the slots; unique visitors is the number of slots with at least one visit.

This spec is the regression gate for that change.

1. **Setup:** Clear to the stage2 baseline (TechSupport present), launch two browsers.
2. **Simultaneous join:** Bootstrap Alice and Bob with `Promise.all`, so their joins interleave
   the way that used to lose an increment.
3. **Assert both counted:** Poll the server graph until unique visitors has risen by 2, then
   check total visits rose by at least 2.
4. **Repeat visit:** Reload Alice's page and confirm total visits rises while unique visitors
   stays flat — a returning user is not a new visitor.

## Verifications:

- Two concurrent joins both appear; neither is lost to a last-write-wins race.
- Unique visitors rises by exactly 2 for two distinct users, no matter how many joins each made.
- A repeat visit increments visits but not unique visitors.

## Notes:

- Assertions read `chatrooms/<roomId>/visitCounter/*` from `/api/test/export-snapshot` and total it
  with the shared `visitTotals` helper — **not** the on-screen badge. The badge renders from a
  published aggregate (`public/room-visit-counts/<id>`) that lags behind the graph, so asserting on
  it would test cache latency rather than counter correctness.
- Comparisons are relative (`before` vs `after`) rather than absolute, because the stage2 baseline
  already contains TechSupport and any visits it recorded.
