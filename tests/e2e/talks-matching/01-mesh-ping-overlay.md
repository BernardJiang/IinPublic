# Mesh-ping overlay (three browsers in one Place)

covers: SPEC-19.4, SPEC-3.12  <!-- auto-seeded; refine by hand -->

**Features tested:** P0 step 1 — three browser peers in one Place (a personal list, §3.7 "Places
in v3") link to each other, and an originator's `mesh-ping` reaches every other peer **with zero
`talks/*` or `peerTalkOffers/*` Gun writes**.

**Run:** `npx playwright test tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts`

## Flow

1. Tom, Jerry, and Bob bootstrap with `e2e_mesh_talks=1` and enter one new Place together, then
   opt in to third-party mesh forwarding (off by default).
2. Each peer warms links to the other two; each has at least 1 connected neighbor, and Tom's
   links to both are manifest-ready (a ping goes only to ready neighbors and is not queued).
3. Tom calls `peerMeshService.sendPing('p0-step1')`.
4. **Durable assertions (not toasts):** poll `getApp().meshPingDiagnostics` (populated by
   `onPing`/`onPong` callbacks) — no transient UI notifications.
   - Jerry and Bob: `lastPingFrom` contains Tom's userId.
   - Tom: `pongedOrigins` contains every peer Tom is directly linked to. Pongs are addressed to
     Tom, and authoritative direct delivery never relays an addressed frame through a third peer.
5. **Invariant assertion:** each browser reads local Gun and asserts `peerTalkOffers` and `talks`
   subtrees are empty — proves the ping path never touches forbidden Gun paths.
6. Cleanup: `finalCleanupPages` + `shutdownThreeBrowsers`.

## Key design invariants verified

- Links come from the Place's members (my list), with no `talks/*` or `peerTalkOffers/*` reads.
- `mesh-ping` is pure DataChannel: `sendPing` → `buildFrame` → `rememberAndFanout` → `sendMeshFrame`.
- Seen-set dedup prevents re-delivery of the same `msgId`.
- The K=1 sparse-path sub-case was removed on 2026-10-19: no scope runs the K-bounded room overlay
  any more.
