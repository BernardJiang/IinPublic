# Mesh-ping reachability with hub API down mid-session

covers: SPEC-19.4, SPEC-3.12  <!-- auto-seeded; refine by hand -->

**Features tested:** L3 hub-loss re-form increment. Three peers form mesh neighbors first, then browser-level routing aborts hub API endpoints (`/api/presence/*`, `/api/chatrooms/*/members`) to simulate hub loss. Each peer tears down its overlay and rejoins with explicit peer IDs (the mesh's explicit-members mode; Nearby itself links only on demand, §3.7), and mesh ping/pong still works. The spec opts in to third-party forwarding (off by default), waits until each peer has a manifest-ready neighbor before pinging, and expects pongs from Tom's directly linked peers (addressed frames are never relayed).

**Run:** `npx playwright test tests/e2e/talks-matching/06-mesh-ping-with-hub-api-down.spec.ts`

## Flow

1. Bootstrap Tom/Jerry/Bob in the same room with mesh delivery enabled.
2. Wait until each page has at least one connected mesh neighbor.
3. Abort hub API calls in each browser context.
4. Call `peerMeshService.leaveRoom()` then `joinRoom(room, [{self}, ...knownPeers], { personal: false })`
   once per peer while APIs are unavailable. (The libp2p discovery fallback that let a self-only
   roster find peers was removed with the room-wide overlay, OPEN-70.)
5. Assert each peer re-forms at least one connected neighbor.
6. Reset ping diagnostics and send `mesh-ping` from Tom.
7. Assert Jerry and Bob receive Tom in `pingedOrigins`.
8. Assert Tom receives both pongs in `pongedOrigins`.

## Invariant

Mesh reachability and overlay re-formation remain functional without successful hub API interactions.
