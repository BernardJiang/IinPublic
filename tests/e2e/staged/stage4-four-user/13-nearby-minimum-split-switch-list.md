# Test: Split to the Smallest Region, Then Switch Rooms by Tapping (List View, Capacity 3)

**File:** 13-nearby-minimum-split-switch-list.spec.ts (steps in
`tests/e2e/helpers/nearby-demo-scenarios.ts` → `runMinimumSplitSwitchDemo`)
**Features tested:** adaptive Nearby split down to the privacy floor, the flat room list (§3.6),
full rooms shut, entering a room by tapping its row, the partition index counting each person once

---

## What this test does (in plain English):

1. **Setup:** Four users on the list view, with `?e2e_capacity=3` and the Neighborhood setting.
   U1–U3 stand inside one smallest square, about 1 km wide, around downtown San Diego. U4 stands
   about 1.4 km west, in the neighbouring square. All four share every larger region.

2. **Split to the minimum:** Four is more than three, so the worldwide group splits. All four stay
   together through every level until the last one, so it takes 12 splits to reach the smallest
   region (about 1.5 km across), where U4 finally separates:
   - **A** = U1, U2, U3 (3 / 3, full)
   - **B** = U4

   The test checks that U1's region is under 2 km across.

3. **A full room cannot be entered:** U4's list shows A as "3 / 3 · Full", greyed out. U4 taps it
   and stays in B.

4. **Switch by tapping:** U3 taps B in "Rooms near you". U3 becomes a Traveler there and sees B's
   member list. Now A = 2 and B = 2.

5. **The room has space again:** A shows "2 / 3" and is no longer greyed. U4 taps it and enters
   A's member list. Final: A = U1, U2, U4 and B = U3. No room holds more than 3.

Every step saves one 2×2 frame of all four users' screens (U1 U2 / U3 U4).

## Two bugs this test found (both fixed)

- **A tap aimed at the members' average position.** The average of a group's members' public
  1 km points can fall just across a partition edge, inside an empty sibling group, so the tap
  could land in the wrong group. Taps now travel to the centre of the group's own partition square
  (`nearbyPartitionTargetPoint`). The square comes from the room's path in the room list.
- **The partition index counted a person twice.** It kept a member's presence in the group they
  had just left for its whole 45 s lifetime. A quick switch therefore pushed the old group to
  C + 1 and caused a false split. Now each person has one live presence: joining a group removes
  them from the others (`NearbyPartitionStore`, with a unit test).

**Outputs:** `NN-list.png` (2×2 frames) and `video-U1..U4/*.webm`. Set `ROOM_TAP_DEBUG=1` to log
the room list and travel point for each tap.
