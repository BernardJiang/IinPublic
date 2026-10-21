# 53 — Nearby and Place navigation

covers: SPEC-3.3, SPEC-13.1

OPEN-40 replacement for the retired Global/tile hierarchy and owner-controlled custom rooms:

1. The chatroom list contains the active Nearby audience plus flat Community-created Places, with
   no Global, tile hierarchy, expand controls, or visible capacity shards.
2. Room detail uses the AppBar back icon; it disappears on the list and never leaks to Contacts.
3. The map shades the current Nearby area. Tapping open map does not invent or enter a coordinate
   grid room.
4. A created Place has an immutable content-addressed identity, appears as a map pin, and exposes no
   owner rename control. The server rejects mutation for every participant.
5. A Place visit enables Return to Nearby; returning recomputes the automatic Nearby room and clears
   the visit state.
