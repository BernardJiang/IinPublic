# Mesh broadcast announcements (three browsers, zero Gun writes)

**Features tested:** P0 step 2 — a find-similar broadcast reaches eligible receivers over the
mesh DataChannel overlay with **zero delivery-path Gun writes** (`peerTalkOffers/*` and
`p2pMeshTalkBodies/*` strictly empty; `talks/*` gains nothing beyond the author's one creation
write — see "Known step-7 debt" below).  Ineligible peers (different chatroom, or the author
itself) do NOT receive the announcement.

**Run:** `npx playwright test tests/e2e/talks-matching/02-mesh-broadcast-announce.spec.ts`

## Flow

1. Tom, Jerry, and Bob bootstrap in the Global chatroom with `e2e_mesh_talks=1`.
2. Presence settles; the app calls `syncPeerMeshRoom`, each peer connects to ≤ K neighbors.
3. **K=1 sparse path sub-case:** Tom re-joins with `maxNeighbors:1`; his graph is a single
   edge to one neighbor (Jerry or Bob, determined by `localeCompare` sort).  Tom's broadcast
   must still reach the non-direct peer via one forward hop.
4. Tom calls `peerMeshService.broadcastTalk(...)` directly — this sends a `talk-announce`
   flood + a `talk-body` flood over the DataChannel overlay.  The `publishRoomTalkBodyRendezvous`
   Gun write is intentionally suppressed (step 2 displacement).
5. **Durable assertions (not toasts):** poll `getApp().meshAnnounceDiagnostics.received`
   (populated by the `onTalkAnnounce` callback before the body pull completes):
   - Jerry: `received` contains `{ talkId, authorId: tomId }`.
   - Bob: same — even if Bob is the non-direct peer that received the frame via a relay hop.
6. **Ineligible peer assertion:** Tom's own announce must NOT appear in Tom's
   `meshAnnounceDiagnostics.received` — the `not-self` guard in `handleLocalFrame` drops
   frames whose `authorId === localUserId`.
7. **Gun invariant assertion:** each browser reads local Gun and asserts `peerTalkOffers/*`
   and `p2pMeshTalkBodies/*` are empty, and `talks/*` holds **at most one** record (the
   author's creation write, possibly relay-synced into the collect subscription) — proves
   the announce/delivery path itself never writes to any displaced Gun path.
8. Cleanup: `finalCleanupPages` + `shutdownThreeBrowsers`.

## Displaced Gun writes

The following Gun write was displaced by this step:

| Path | Written by | Replaced with |
|---|---|---|
| `p2pMeshTalkBodies/<roomId>/<talkId>::<authorId>` | `publishRoomTalkBodyRendezvous` (room broadcast path) | mesh `talk-body` flood (DataChannel) |

The `subscribeToRoomTalkBodyRendezvous` subscription still exists in `PeerMeshService` as a
fallback for any legacy callers, and `publishRoomTalkBodyRendezvous` is still called as a
**conditional fallback** when the overlay is below its wanted degree at broadcast time (see below).
In this spec the three peers are fully mesh-connected before broadcasting, so the fallback is
never reached and the `p2pMeshTalkBodies/*` assertion remains zero.

## Interim step-6/7 debt: conditional Gun fallback (R-a extended)

`broadcastTalk`'s room path includes a conditional fallback that fires on EITHER of two
conditions — both meaning the DataChannel overlay cannot *guarantee* full room coverage, so
`publishRoomTalkBodyRendezvous` is called in addition to the mesh flood:

1. **Below wanted degree** (`connectedNeighborCount === 0 || connectedNeighborCount <
   neighbors.size`): the overlay has not fully formed. Covers callers that broadcast immediately
   after `joinRoom` without waiting for the WebRTC handshake.
2. **Coverage gap** (`explicitRecipientCount > maxNeighbors && connectedNeighborCount <
   explicitRecipientCount`): the caller named more recipients than the degree bound K can directly
   hold, so non-neighbor recipients depend on **relay forwarding** across a sparse, possibly
   **partitioned** overlay. This can silently miss a peer behind a non-bridged link **even when
   the sender's own K neighbors are all connected** (condition 1 false). This was the root cause
   of the deterministic find-similar-people "exactly 8 of 9 contacts" regression: with K=3 over 10
   users, one recipient sat in a relay-unreachable component. Writing the author-qualified Gun
   rendezvous (`p2pMeshTalkBodies/<roomId>/<talkId>::<authorId>`) makes it the authoritative
   full-room delivery channel.

Callers this preserves correctness for:

- **stage2/08-super-user-copy-talk**: `deliverTalkToReceiversOverMesh` calls `joinRoom` then
  immediately `broadcastTalk`; the DataChannel may not be established yet
  (connectedNeighborCount == 0 → condition 1), so the Gun rendezvous fires.
- **stage5/find-similar-people**: 10 users, K=3, 9 recipients per broadcast — condition 2 fires
  (recipients > K), guaranteeing every peer's body reaches every receiver via Gun even when the
  sparse overlay is partitioned.

This spec's `p2pMeshTalkBodies/* == 0` assertion is unaffected: Tom broadcasts over a FULLY
connected K=1 overlay (condition 1 false: `connectedCount === neighbors.size === 1`) AND passes
**no explicit `recipientUserIds`** (`explicitRecipientCount === 0`, so condition 2 is skipped),
putting him on the primary all-mesh path.

**Removal plan (step 6/7):** Once all broadcast callers either (a) gate on a fully connected
overlay or (b) the offline mesh mailbox lands (step 6), remove BOTH fallback branches from
`broadcastTalk` and delete `publishRoomTalkBodyRendezvous`.  At that point tighten the staged
specs' assertion to confirm `p2pMeshTalkBodies/*` is also empty.

## Author-qualified identity (content-address collision)

Talk ids are content-addressed (`computeTalkCIDv1`, no `authorId`), so two authors who create
identical content share the SAME `talkId` with different `authorId`s — legal by design. Both
body-delivery paths (mesh flood + Gun rendezvous) keep author identity:

- Gun rendezvous key is `…/<talkId>::<authorId>` (author-qualified).
- `PeerMeshService.talkBodies` cache is keyed `talkId::authorId`; a remote author's
  identical-content body never clobbers the local author's own cached copy.
  `getCachedTalkBody(talkId)` prefers the local user's own copy; `handleTalkBodyRequest` serves
  only the local author's copy.
- `handleMeshTalkBody` skips the `talks/<talkId>` Gun mirror when the local user authored content
  with that id, so the author's own definition survives for the response/match path.
- Delivery/UI/chatbot dedup and response routing are all `talkId::authorId`-qualified, so a
  response reaches every author of identical content independently.

## Known step-7 debt: the author's `talks/*` creation write

`WebTalkService.createTalk` (src/web/services/web-talk-service.ts, `gunService.put('talks/<id>')`)
still persists the talk **definition** to the relay-synced Gun graph at creation time. This is
star-era CRUD state, scheduled for deletion in TODO P0 step 7 ("Stop Gun relay use for
`talks/*`" — requires moving author-side talk persistence to local stores). It is **not** part
of the step-2 delivery path, so this spec asserts `talks/*` does not grow beyond that single
creation write rather than asserting strict emptiness. When step 7 lands, tighten the
assertion back to `toBe(0)`.

## Key design invariants verified

- `talk-announce` frames carry `{ talkId, authorId, title, type, questionCount }` — no body.
- The body is co-broadcast as a `talk-body` flood alongside the announce (no Gun rendezvous).
- `roomId` guard in `handleRemoteFrame` ensures frames from a different room are dropped —
  an ineligible peer in room-B never receives room-A's announce.
- `authorId === localUserId` guard in `handleLocalFrame` (talk-announce branch) ensures the
  author does not receive their own announce.
- Seen-set dedup prevents re-delivery of the same `msgId` even via multiple hops.
- K=1 path-graph case proves gossip forwarding works across a sparse topology.
