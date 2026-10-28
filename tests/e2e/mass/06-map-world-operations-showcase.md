1. Start 6 users with deterministic world-spread coordinates and `e2e_capacity=3`.
2. Arrange the first 6 headed Chromium windows in a non-overlapping 3x2 grid so they can be watched side-by-side.
3. Open the Chatrooms map for all users and verify each visible user sees the other 5 users in total: `3` green dots (in reach) and `2` yellow dots (farther away).
4. Every user creates one tag Talk titled `MapOps user-XX #tag-XX` and broadcasts it to all other 5 users.
5. Every receiver answers the first incoming map Talk manually and answers the remaining 4 in auto mode, validating the responder exchange ledger records `1 manual + 4 auto`.
6. Keep the visible windows on map view for a short final pause so the operator can observe the end state.
