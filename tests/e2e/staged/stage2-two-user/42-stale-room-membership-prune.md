# 42-stale-room-membership-prune

covers: SPEC-3.3, SPEC-8.2

Alice and Bob are both in Nearby, so each is on the other's list and Alice's headcount is 2. Bob's
browser context closes without any goodbye. Nearby has no hub membership to expire (design §3.7):
Alice's next swap with Bob gets no answer, and that drops him from her list at once. The test runs
that swap immediately and checks that Alice's headcount falls to 1.
