# 75-p2p-rate-limit-429

covers: SPEC-3.8, SPEC-9.1

Spec §3.8 spam prevention / §9.1 drop policy: the shared P2P POST routes enforce a
per-peer rate budget (P2PAbuseDefenseContext), returning 429 past
P2P_RATE_LIMIT_MAX_EVENTS per P2P_RATE_LIMIT_WINDOW_MS.

The regular E2E servers raise the cap to 5000, so this spec boots its own
`dist/server` on a dedicated port (18300+worker) with a 5-event / 2s budget and
asserts: under-budget requests pass, the budget-exceeding request is 429 with an
error body, a different peer keeps its own budget, and the throttled peer recovers
after the window expires.

Closes the previously untested §3.8 anchor (coverage-matrix gap list, Part 3 P0 #4 —
the limiter itself was never exercised anywhere).
