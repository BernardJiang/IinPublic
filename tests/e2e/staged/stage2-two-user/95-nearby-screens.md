# 95-nearby-screens

covers: SPEC-3.7

Tom and Jerry are in Nearby (design §3.7 "Map, list and headcounts").

1. Nearby has no room row. Tom sees **1 near you · 2 online** beside the people heading, and Jerry
   is directly visible as a person row. The room-list header shows the same online count. No
   match-collection buttons appear in this list, and the AppBar does not repeat the static
   `📍 Nearby` label.
2. The group bar above the root people list reads **Group 1 · the people nearest you** with
   **Meet new people**. Pressing it opens a confirmation; cancelling it changes nothing
   (stage4/08 covers an actual switch). The person rows preserve the v3 roster order.
3. Tom broadcasts a Talk and Jerry receives it. Broadcast progress remains operational but is not
   rendered as a stray status/control card in the browser list.
4. Jerry's own row reads **1 near you** (Tom).
