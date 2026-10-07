# Test: Capacity Regional Spread — Global-first routing with coarse-cell overflow

covers: SPEC-3.3, SPEC-3.7, FR-CR-1, FR-CR-2

**File:** 00k-capacity-regional-spread.spec.ts
**Features tested:** Chatroom capacity enforcement (capacity=3, FIFO), Global-first entry, automatic
eviction to the evictee's coarse coordinate cell, same-family overflow of a full cell room, and the
absence of continent/country/state routing.

---

## What this test does (in plain English)

1. Gun databases are cleared; the app runs with `e2e_capacity=3&e2e_fifo=true`.
2. Nine users join one after another, all entering **Global** (FR-CR-1): the first six are located
   in San Francisco, the last three in Toronto.
3. Global holds three ordinary members, so FIFO moves each longest-staying member out as newer
   ones arrive. Each evictee goes straight to their **coarse coordinate cell**
   (`getAutomaticLocationChatroomId(San Francisco)`), never to North America / USA / California.
4. That cell room is also capped at three, so it overflows **within its own family** into
   `<cell>_part_2`.

## Verifications (server members API)

- Global has exactly 3 ordinary members (the newest — the Toronto users).
- The San Francisco cell room has 1–3 members, and `<cell>_part_2` has at least one.
- `north-america`, `usa`, `california`, and `canada` have no members (hierarchy routing retired).
