# P0 direct talk delivery (two browsers, relay-style hub)

**Features tested:** `P0_DIRECT_TALK_DELIVERY=1` mesh path — `peerTalkOffers` + `peerTalkCatalog`, local `incomingTalksByUser`, no server `register-receivers` / empty `GET incoming-talks`.

**Run:** `npm run test:e2e:p0-talks` (sets P0 + ephemeral server persistence on webpack and Gun).

## Flow

1. Tom and Jerry bootstrap in Global.
2. Tom creates a flow talk and broadcasts to the room.
3. Jerry's IN list is populated from **local Gun** (poll `getLocalIncomingClustersForE2e`), not server inbox API.
4. Server `GET incoming-talks` for Jerry returns `[]` with `X-P0-Direct-Talk-Delivery: 1`.
