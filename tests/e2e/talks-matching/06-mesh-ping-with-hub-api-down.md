# Mesh-ping reachability with hub API down mid-session

**Features tested:** L3 hub-loss re-form increment. Three peers form mesh neighbors first, then browser-level routing aborts hub API endpoints (`/api/presence/*`, `/api/chatrooms/*/members`) to simulate hub loss. Each peer tears down its overlay and rejoins either with explicit peer IDs (default mode) or self-only roster (when `P2P_NODE_ENABLED=1`), and mesh ping/pong still works.

**Run:** `npx playwright test tests/e2e/talks-matching/06-mesh-ping-with-hub-api-down.spec.ts`

## Flow

1. Bootstrap Tom/Jerry/Bob in the same room with mesh delivery enabled.
2. Wait until each page has at least one connected mesh neighbor.
3. Abort hub API calls in each browser context.
4. Call `peerMeshService.leaveRoom()` then `joinRoom(...)` once per peer while APIs are unavailable:
	- default mode: `[{self}, ...knownPeers]`
	- p2p-node mode: `[{self}]` (discovery fallback path)
5. Assert each peer re-forms at least one connected neighbor.
6. Reset ping diagnostics and send `mesh-ping` from Tom.
7. Assert Jerry and Bob receive Tom in `pingedOrigins`.
8. Assert Tom receives both pongs in `pongedOrigins`.

## Invariant

Mesh reachability and overlay re-formation remain functional without successful hub API interactions.
