# 95-nearby-screens

covers: SPEC-3.7

Tom and Jerry are in Nearby (design §3.7 "Map, list and headcounts").

1. Nearby has no room row or redundant **People near you** heading. Tom sees
   **1 nearby · 2 online** in the top list row, and Jerry is directly visible as a person row.
   No match-collection buttons appear, and the AppBar does not repeat the static `📍 Nearby` label.
2. **Meet new people** is a compact AppBar icon, not a large group card. Pressing it opens a
   confirmation; cancelling it changes nothing (stage4/08 covers an actual switch). The person
   rows preserve the v3 roster order.
3. Tom broadcasts a Talk and Jerry receives it. Broadcast progress remains operational but is not
   rendered as a stray status/control card in the browser list.
4. Jerry's own row reads **1 near you** (Tom).
