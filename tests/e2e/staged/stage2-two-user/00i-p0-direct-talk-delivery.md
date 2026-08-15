# Pair-direct talk delivery (two browsers, server as connector)

covers: SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**Features tested:** default pair-direct mesh path — server helps users discover/connect, then the receiver persists the talk in its SEA-owner envelope at `users/<ownerSeaPub>/incomingTalkClusters`. Retired `ownerIncomingTalkIndex`/`incomingTalksByUser` paths and the server inbox remain empty and non-authoritative.

**Run:** `npm run test:e2e` or `npm run test:e2e:p0-talks` (direct delivery + ephemeral server persistence).

## Flow

1. Tom and Jerry bootstrap in Global.
2. Tom creates a flow talk and broadcasts to the room.
3. Jerry's IN list is populated from **local Gun** (poll `getLocalIncomingClustersForE2e`), not the server inbox API.
4. Server `GET incoming-talks` for Jerry returns `[]` with `X-P0-Direct-Talk-Delivery: 1`.
