# Mesh-ping overlay (three browsers, sparse DataChannel graph)

**Features tested:** P0 step 1 — three browser peers form a sparse DataChannel overlay via
`PeerMeshService.joinRoom` (seeded from Socket.IO room presence), and an originator's `mesh-ping`
reaches every other peer via store-and-forward gossip **with zero `talks/*` or `peerTalkOffers/*`
Gun writes**.

**Run:** `npx playwright test tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts`

## Flow

1. Tom, Jerry, and Bob bootstrap in the Global chatroom with `e2e_mesh_talks=1`.
2. Presence settles; the app calls `syncPeerMeshRoom`, each peer connects to ≤ K neighbors.
3. **Full-mesh sub-case (default K=3):** each peer has at least 1 connected neighbor.
4. **Sparse path sub-case (K=1):** Tom re-joins with `maxNeighbors:1`; graph becomes a path
   A–B–C. Tom's ping still reaches Bob via one forward hop through Jerry (or vice-versa).
5. Tom calls `peerMeshService.sendPing('p0-step1')`.
6. **Durable assertions (not toasts):** poll `getApp().meshPingDiagnostics` (populated by
   `onPing`/`onPong` callbacks) — no transient UI notifications.
   - Jerry and Bob: `lastPingFrom` contains Tom's userId.
   - Tom: `pongedOrigins` contains both Jerry's and Bob's userIds.
7. **Invariant assertion:** each browser reads local Gun and asserts `peerTalkOffers` and `talks`
   subtrees are empty — proves the ping path never touches forbidden Gun paths.
8. Cleanup: `finalCleanupPages` + `shutdownThreeBrowsers`.

## Key design invariants verified

- Overlay seeded from Socket.IO room presence only — no `talks/*` or `peerTalkOffers/*` reads.
- `mesh-ping` is pure DataChannel: `sendPing` → `buildFrame` → `rememberAndFanout` → `sendMeshFrame`.
- Seen-set dedup prevents re-delivery of the same `msgId`.
- K=1 path-graph case proves gossip forwarding works across a sparse topology.
