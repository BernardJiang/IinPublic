# Test: Eight Users, Each Newcomer Closer — Progressive Split, List and Map (Capacity 3)

**File:** 14-nearby-progressive-split.spec.ts (steps in `tests/e2e/helpers/nearby-demo-scenarios.ts`
→ `runProgressiveSplitDemo`)
**Features tested:** adaptive Nearby split at C + 1, the privacy floor and identity lanes, the room
list (§3.6), the map's areas, dots and room pins

---

## What this test does (in plain English):

1. **Setup:** U1–U3 stand inside one smallest Neighborhood square in downtown San Diego. With
   capacity 3 they fit in the single worldwide room, so there is no split.
2. **Five newcomers, one at a time, each closer than the last.** Each arrival makes 4 in the
   trio's room, which splits until the newcomer separates. The test checks that the trio stays
   together and the newcomer ends up apart.

   | Newcomer | From | Trio's room afterwards |
   |---|---|---|
   | U4 | New York (~3,900 km) | ~11,900 km across |
   | U5 | Los Angeles (~180 km) | ~745 km |
   | U6 | La Jolla (~17 km) | ~23 km |
   | U7 | the next smallest square (~1.4 km) | ~1.5 km (the smallest region) |
   | U8 | inside the trio's own smallest square | location cannot divide them |

3. **After every arrival:** all users switch to the list view (one frame with every screen), then
   the map view (another frame). The list shows "N online · M rooms", "Your room · near <city>",
   and the other rooms by distance. The map shows each user's shaded area, the dots, and room pins
   with headcounts.
4. **Four people in one smallest region:** location cannot split them, so the partition switches
   to **balanced** identity lanes: the split's threshold is the median lane hash of its 4 witnesses,
   so they divide 2 / 2 (for example **U1 + U2 / U3 + U8**), two groups on the same 1.5 km
   square, listed as "Here", "Here · 2".
   The test checks that no room exceeds 3, that the four share the smallest square, and that they
   were divided either by lanes or by a rejection from the index.

## What this shows about the design

- Before balanced lanes, the same step gave 1 / 1 / 2 (a 1-in-4 hash digit), which left people
  alone. The balanced split gives 2 / 2, which is less likely to split again.
- On the map every other room is a dashed square in its own colour, with a matching pin.
- Same-square lane groups all read "Here" in the list, and a tap travels by location, so it lands
  in your own lane rather than the one you tapped (known limit, §3.6).

**Outputs:** `NN-list.png` and `NN-map.png` (4 × 2 frames, U1–U4 on top, U5–U8 below) and
`video-U1..U8/*.webm`. Runtime is about 10 minutes.
