# Test: Nearby and Places list/map views

covers: SPEC-3.3, OPEN-40 Nearby UI and location privacy

**File:** `54-chatroom-tree-and-map.spec.ts`

One location-enabled user verifies that:

1. The list contains the current flat Nearby audience, not Global, L1-L4 tiles, or `_part_N` rooms.
2. Map view shows no retired Nearby audience-area shading or grid-room navigation. The public
   GPS blur box is a separate presentation overlay, not an audience boundary.
3. The real app's outgoing broadcast-progress and incoming-Talk handlers produce different map
   effects, which expire without replaying on match-data updates.
4. Tapping open map no longer offers retired grid-room travel. Meaningful travel uses Place pins.
5. Return to Nearby is disabled while already home.
6. Recording an exchange updates the map badge through the core-backed exchange view, reaches
   the device core, and removes the badge when the outcome changes to mismatch. Public points
   are deterministic fixtures; this test requires no second device or real peer delivery.
