# Test: Concurrent Room Visit Counter

covers: docs/TODO.md L1 (CRDT G-Counter visit metrics)

**File:** 35-concurrent-visit-counter.spec.ts
**Features tested:** Place visit / unique-visitor accounting under simultaneous joins. Nearby is
each phone's own list (design §3.7) and has no visit counter, so the counter is tested on a Place.

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

1. **Setup:** Clear to the stage2 baseline (TechSupport present), launch two browsers and boot
   Alice and Bob into Nearby.
2. **A Place:** Alice creates a Place (one visit, one unique visitor) and returns to Nearby.
3. **Simultaneous join:** Alice and Bob enter the Place at the same moment, so their joins
   interleave the way that used to lose an increment.
4. **Assert both counted:** Poll the server graph until total visits has risen by at least 2, then
   check unique visitors is exactly 2.
5. **Repeat visit:** Alice goes back to Nearby and enters the Place again; total visits rises while
   unique visitors stays flat — a returning user is not a new visitor.

## Verifications:

- Two concurrent joins both appear; neither is lost to a last-write-wins race.
- Unique visitors rises by exactly 2 for two distinct users, no matter how many joins each made.
- A repeat visit increments visits but not unique visitors.

## Notes:

- Assertions read `chatrooms/<roomId>/visitCounter/*` from `/api/test/export-snapshot` and total it
  with the shared `visitTotals` helper — **not** the on-screen badge. The badge renders from a
  published aggregate (`public/room-visit-counts/<id>`) that lags behind the graph, so asserting on
  it would test cache latency rather than counter correctness.
- Visit totals are compared before and after each step; the Place is new, so unique visitors is
  checked as an exact number.
