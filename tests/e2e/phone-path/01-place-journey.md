# Phone path 01 — Place journey across two phones

Alice (phone A) creates a Place. The hub must list it and have Alice as a member, and list it
among rooms with people. Bob (phone B, a different embedded node) finds it in his room list and
enters; the hub has both, and each sees the other in the member list. Both go home; the empty
Place is still in Bob's list, and in the list of Carol, a plain web user on the hub. Bob enters
the empty Place again.

Found on its first runs (2026-10-14): Place reserve/commit aborted by a 4 s browser timeout on
phones; `/api/active-rooms` returned 503 on phones once a Place had people; the durable presence
store rejected `Date` values. Room moves take 5–31 s on this route (OPEN-58); the `[timing]` lines
record them.
