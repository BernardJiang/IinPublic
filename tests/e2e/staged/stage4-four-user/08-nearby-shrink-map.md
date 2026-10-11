# Test: Nearby Shrinks From Worldwide to Local on the Map (Capacity 3)

**File:** 08-nearby-shrink-map.spec.ts
**Features tested:** adaptive Nearby partition (`docs/design/nearby-and-place-chatrooms.md` §3), signed
C+1 split, map view's shaded Nearby area, `?e2e_capacity=` reaching the room protocol checkpoint

---

## What this test does (in plain English):

1. **Setup:** Database cleared. Four browsers, each with a fixed location a few km apart around
   downtown San Diego. Every page opens with `?e2e_capacity=3`, which (outside production) sets
   the capacity in the room protocol checkpoint, so the Nearby split happens at 4 users.

2. **U1 alone:** U1 joins the one worldwide Nearby group and opens the **Map** view. The shaded
   green area covers the whole world (~47,700 km). Screenshot.

3. **U2 and U3 join:** Three users equals capacity. The group must NOT split. Screenshot.

4. **U4 joins:** Four users is capacity + 1. The partition index replaces the group with four
   compact geographic groups. All four users are in the same quarter, so that group also has 4
   and splits again. This repeats level by level. U1's map follows each new room: the shaded box
   shrinks and the map zooms to it. One screenshot per split. The whole run is recorded as video.

5. **Settled:** When U1's room has not changed for 60 s (four control heartbeats), the test
   checks that at least one split happened, that the final area is smaller than the worldwide
   one, and that no room holds more than 3 of the four users.

Typical run: 9 splits, 47,684 km → 11,921 → 5,960 → 2,980 → 745 → 373 → 186 → 47 → 23 → 12 km.
The last split separates one user, leaving 3 + 1.

> **Why this matters:** This shows the "global to local" behavior visually. No Global room or
> tile tree is shown anywhere. The user only ever sees one Nearby room, whose area on the map
> gets smaller as the crowd grows.

---

**Outputs:** `NN-map.png` per step (also attached to the report), `video/*.webm` for U1.
Locally the windows are visible (headless only under `CI`); U1's large window is on the left:
`npx playwright test tests/e2e/staged/stage4-four-user/08-nearby-shrink-map.spec.ts`
