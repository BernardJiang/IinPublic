# Test: Chatroom hierarchy in tree and map views

covers: SPEC-3.3, FR-CR-2, FR-CR-4a, FR-CR-10

**File:** 54-chatroom-tree-and-map.spec.ts

## What this test does (in plain English)

One user located in San Diego.

1. **Tree:** Global ▼ → the land region tiles, grouped by continent (level 1);
   "North America · West & Central" ▼ → "📍 Near San Diego" (level 2, Current), directly under it.
   No ocean/Antarctica tiles and no `north-america`/`europe`… continent rooms. No `usa` / `california` / `san-diego` /
   `uk` / `london` / `japan` / `germany` rows exist.
2. **Collapse/expand:** collapsing North America hides the grid room; expanding shows it again.
3. **Map:** the current grid room has a highlighted pin; tapping it opens "Near San Diego".
   Zoomed out to the world, the region tiles appear as pins on their own land; the current room
   always keeps its own pin (never clustered).
4. **Travel to London's grid room:** the tree shows "Europe · North Atlantic" ▼ → "📍 Near London" (Current);
   the map shows the London pin as current.

Screenshots of every step are attached to the Playwright report (`1-tree-…` to `6-map-…`).
