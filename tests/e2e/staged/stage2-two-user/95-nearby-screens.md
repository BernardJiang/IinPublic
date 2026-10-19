# 95-nearby-screens

covers: SPEC-3.7

Tom and Jerry are in Nearby (design §3.7 "Map, list and headcounts").

1. Tom's Nearby row is named **People near you** and reads **1 near you · 2 online**: his list
   (Jerry, never himself) and the hub's count of everyone online. The room-list header shows the
   same online count.
2. Opening it lists Jerry, the status reads the same counts, and **Show more people here** is under
   the list. Pressing it with nobody else around changes nothing.
3. Tom broadcasts a Talk. Once Jerry's phone stores it and acknowledges it, Tom's list shows
   **Sent to 1 of 1** under the Nearby row.
4. Jerry's own row reads **1 near you** (Tom).
