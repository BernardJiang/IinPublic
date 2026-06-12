# Mesh-ping reachability with hub API down mid-session

**Features tested:** L3 hub-independent reachability increment. Three peers form mesh neighbors first, then browser-level routing aborts hub API endpoints (`/api/presence/*`, `/api/chatrooms/*/members`) to simulate hub loss, and mesh ping/pong still works.

**Run:** `npx playwright test tests/e2e/talks-matching/06-mesh-ping-with-hub-api-down.spec.ts`

## Flow

1. Bootstrap Tom/Jerry/Bob in the same room with mesh delivery enabled.
2. Wait until each page has at least one connected mesh neighbor.
3. Abort hub API calls in each browser context.
4. Force `peerMeshService.joinRoom(...)` once per peer to trigger reconcile while APIs are unavailable.
5. Reset ping diagnostics and send `mesh-ping` from Tom.
6. Assert Jerry and Bob receive Tom in `pingedOrigins`.
7. Assert Tom receives both pongs in `pongedOrigins`.

## Invariant

Mesh reachability remains functional without successful hub API interactions once peers are already connected.
