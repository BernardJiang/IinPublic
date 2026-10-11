# Test: Travel Between Nearby Regions, Then Re-Split (Capacity 3)

**File:** 09-nearby-travel-resplit-map.spec.ts
**Features tested:** map travel ("Join as traveler"), Return home, adaptive Nearby split on
C + 1 (`docs/design/nearby-and-place-chatrooms.md` §3), map view's shaded Nearby area

---

## What this test does (in plain English):

1. **Setup:** Same as spec 08. Four users a few km apart around downtown San Diego, `?e2e_capacity=3`.
   The worldwide Nearby group splits until it settles as two side-by-side regions about 12 km
   across: **A** with 3 users and **B** with 1.

2. **One user travels A → B:** A user of A (not the one watching A) taps a point inside B on the
   map and presses **Join as traveler**. Now A = 2 and B = 2. The test waits two control
   heartbeats and checks nothing split, because neither region is over capacity.

3. **Two users move back into A:** B's own user taps a point in A and joins as a traveler. The
   earlier traveler presses **Return home** (home is in A). A now has 4 users, more than the
   capacity of 3.

4. **A splits again:** The partition index replaces A with four smaller regions (about 6 km), and
   each user follows the one covering their point. A typical result is A1 = 3, A2 = 1. If A had
   already been at the deepest partition level, the index would instead reject the 4th presence
   ("Nearby group is full and cannot be subdivided safely"). The test detects and reports which
   outcome happened, and always checks that no room holds more than 3.

## Test-only overlay

The real map shows only **your own** shaded area. It never shows other users or other regions.
To make the demo readable, every screenshot adds a test-only overlay:
- a pin at each user's encounter point, with ✈ for travelers;
- a dashed outline and headcount for every occupied region.

The overlay positions come from the test's known coordinates, not from anything the app publishes.

**Outputs:** `NN-<user>-map.png` per step, `video-U1..U4/*.webm`.
