# Test: Nearby and Places list/map views

covers: SPEC-3.3, OPEN-40 Nearby UI and location privacy

**File:** `54-chatroom-tree-and-map.spec.ts`

One location-enabled user verifies that:

1. The list contains the current flat Nearby audience, not Global, L1-L4 tiles, or `_part_N` rooms.
2. Map view shades and focuses the locally derived Nearby cell and reports its approximate size.
3. Cell bounds stay UI-local; the browser exposes only a render-state flag for the test.
4. Tapping open map no longer offers retired grid-room travel. Meaningful travel uses Place pins.
5. Return to Nearby is disabled while already home.
