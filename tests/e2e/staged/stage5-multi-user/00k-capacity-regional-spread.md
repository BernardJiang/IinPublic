# Test: Capacity Regional Spread — Global-first routing, one tile layer at a time

covers: SPEC-3.3, SPEC-3.7, FR-CR-1, FR-CR-2, FR-CR-4a

**File:** 00k-capacity-regional-spread.spec.ts
**Features tested:** Chatroom capacity enforcement (capacity=3, FIFO), Global-first entry, eviction
**one layer down** the tile tree (docs/design/room-tree-routing.md §3), and the absence of
continent/country/state routing.

---

## What this test does (in plain English)

1. Gun databases are cleared; the app runs with `e2e_capacity=3&e2e_fifo=true`.
2. Nine users join one after another, all entering **Global**: the first six are in San Francisco,
   the last three in Toronto.
3. Global holds three, so each newcomer pushes Global's longest-staying member **one layer down**
   to the L1 region tile at their position ("North America · West & Central").
4. That tile also holds three, so its longest-staying member moves one layer further down (L2).

## Verifications (server members API)

- Global has exactly 3 ordinary members (the newest — the Toronto users).
- San Francisco's L1 tile has 3, and its L2 tile has the 3 oldest.
- Nobody jumps straight to the 1 km cell; `north-america`, `usa`, `california`, `canada` are empty.
