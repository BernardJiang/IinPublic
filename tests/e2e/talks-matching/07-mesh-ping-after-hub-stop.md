# Mesh-ping after process-level hub stop

**Features tested:** L3 strict acceptance path. Three peers establish mesh neighbors, the hub process is terminated via test-only endpoint, peers re-sync room membership from explicit IDs without hub APIs, and mesh ping/pong remains reachable with hub offline.

**Run:** `npm run test:e2e:l3:hub-stop`

## Flow

1. Bootstrap Tom/Jerry/Bob in one room and wait for connected mesh neighbors.
2. Call `POST /api/test/shutdown-hub` to stop the hub process.
3. Confirm `/health` becomes unreachable.
4. Call `joinRoom(roomId, [{self}, ...knownPeers])` on each peer after hub stop.
5. Assert each peer still has connected neighbors.
6. Send ping from Tom and assert Jerry/Bob receive it plus Tom receives both pongs.

## Invariant

Mesh overlay remains usable for ping traffic even after hub process termination.
