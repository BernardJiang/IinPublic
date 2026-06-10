# 03 — Mesh response, match, and conversation (P0 step 4)

## What this test proves

Three browser peers (Tom / Jerry / Bob) all in the same chatroom. Tom is the talk **author**;
Jerry is a **matching responder**; Bob is an **ignoring responder**.

1. Tom creates and broadcasts a **tag** talk (`"Do you play tennis?"`).
2. Jerry answers **MATCH** (`"Yes"`).
3. Bob answers **IGNORE** (`"No"`).

### Durable assertions

- **Both Tom AND Jerry** see a `conversation-list-item` in `myConversations` (localStorage-backed)
  for the Tom↔Jerry pair. The **conversation id is identical** on both sides — proving the
  deterministic `conv_<sortedUserIds>_<talkId>` id is derived independently and converges without
  a server round-trip.
- **Bob** has **no** match conversation (ignore → `checkIfMatch:false` → no conversation created).
- Tom's `localTalkExchanges` entry for Jerry has `outcome: 'match'` (R-2 forward-compat record).

### Server-endpoint invariant

**Zero** calls to `POST /api/talks/:id/response` across the entire scenario, confirmed via
Playwright `page.route` intercepts. The mesh `talk-response` unicast path completely displaces
the server fan-in route (`fanoutResponseToSenders`). Stats calls (`/api/stats/*`) are **allowed**
per design §4 (step-7 leftover).

### Pair-Gun invariant (ASI-safe collect-helper)

On each of the three pages' local Gun:

- `talks/<talkId>/responses` length `0` — proves the L1997 data-preservation fallback never fired
  (that path only runs in the legacy star branch, which the pair-direct dispatch `return`s before).
- `peerTalkOffers/*` length `0` — no star-era per-pair Gun writes.
- `p2pMeshTalkBodies/*` length `0` — under a fully-connected K overlay no coverage-gap fallback
  fires (no explicit `recipientUserIds`, `roomBroadcast:true`, all peers directly connected).

### Duplicate-delivery idempotence

Tom must have **exactly one** conversation with Jerry in `myConversations` (not two), and the
conversation id is stable across the assertion. This confirms the `processedTalkResponseKeys` dedup
gate (`mesh-response::<talkId>::<responseId>`) prevents a second conversation creation if the same
`talk-response` frame is replayed.

## Setup

- `e2eWorkerSlot` fixture (parallel-isolated ports).
- Three independent Chromium browsers with `WEBRTC_CHROMIUM_ARGS` for loopback DataChannel support.
- `bootstrapUser` bootstraps each peer (settings stage-name, chatroom join, tech-support greeting).
- `webAppURLStableChatroom()` appends `e2e_mesh_talks=1` so `usesMeshTalkDelivery()` returns `true`.
- `warmMesh` pre-connects all pairs before broadcasting.
- `afterLoad` / `afterSync` / `afterAction` timing helpers — no raw `wait()`.
- Durable assertions via `expect.poll` against `localStorage.myConversations` — not ephemeral toasts.

## Scoped out (follow-on steps)

- Offline-author sub-case (step 6 mailbox): not tested here; the interim localStorage queue
  (`pendingMeshTalkResponses`, STEP-6-REPLACE) is unit-tested in `mesh-response-step4.test.ts`.
- Change-of-mind / response versioning (step 9).
- Survey/route talk type smoke (no match expected, no conversation).
