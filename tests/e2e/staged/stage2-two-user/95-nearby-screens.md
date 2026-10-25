# 95-nearby-screens

covers: SPEC-3.7

Tom and Jerry are in Nearby (design §3.7 "Map, list and headcounts").

1. Nearby has no room row or redundant **People near you** heading. Tom sees
   **1 nearby · 2 online** in the AppBar header (the list does not repeat it), and Jerry is directly visible as a person row.
   No match-collection buttons appear, and the AppBar does not repeat the static `📍 Nearby` label.
2. **Meet new people** is a compact AppBar icon, not a large group card, and it appears only when
   there is a next page: with two people everyone fits on one page, so it is absent (stage4/08 and
   stage5/15 cover paging). The person rows preserve the v3 roster order.
3. Tom broadcasts a Talk and Jerry receives it. Broadcast progress remains operational but is not
   rendered as a stray status/control card in the browser list.
4. Jerry's header reads **1 nearby** (Tom).
