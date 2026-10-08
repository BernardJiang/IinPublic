# Test: Two-way room routing (down on overflow, up on underflow, cooldown loop guard)

covers: SPEC-3.3, FR-CR-1, FR-CR-3, FR-CR-7

**File:** 07-two-way-room-routing.spec.ts
**Design:** docs/design/room-tree-routing.md §3–§5. Capacity 3; promotion dwell 2 s and eviction
cooldown 25 s via `?e2e_promote_ms=` / `?e2e_cooldown_ms=` (production: 3 min + jitter, 15 min).

## What this test does (in plain English)

1. **GPS users.** Four users in San Diego join Global. Global holds 3, so the oldest (U1) moves
   **one layer down**, into the L1 region tile "North America · West & Central" (not a 1 km cell).
   U4 then leaves, so Global has room again — but U1 was just pushed out of Global, so U1 **stays**
   during the cooldown (otherwise U1 would re-enter, push someone else out, and loop). After the
   cooldown, U1 is alone in its room and Global has headroom, so U1 is **promoted back to Global**.
2. **GPS-less desktop with a home tile.** A desktop with no GPS picks a London L2 tile as home, then
   three more users fill Global. The desktop is the oldest, so it is moved one layer down **toward
   its home tile** — "Europe · North Atlantic" — not into the non-geographic Global overflow.
