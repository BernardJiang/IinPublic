# Mesh broadcast announcements (three browsers, zero Gun writes)

**Features tested:** P0 step 2 — a find-similar broadcast reaches eligible receivers over the
mesh DataChannel overlay with **zero delivery-path Gun writes** (`peerTalkOffers/*`,
`p2pMeshTalkBodies/*`, and `talks/*` all strictly empty).  Ineligible peers (different chatroom,
or the author itself) do NOT receive the announcement.

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
7. **Gun invariant assertion:** each browser reads local Gun and asserts `peerTalkOffers/*`,
   `p2pMeshTalkBodies/*`, and `talks/*` are all **strictly empty** (zero) — `createTalk` now
   writes only to `myAuthoredTalks` localStorage (P0 step 7); no Gun creation write ever fires.
8. Cleanup: `finalCleanupPages` + `shutdownThreeBrowsers`.

## Displaced Gun writes

The following Gun writes were displaced:

| Path | Written by | Replaced with |
|---|---|---|
| `p2pMeshTalkBodies/<roomId>/<talkId>::<authorId>` | `publishRoomTalkBodyRendezvous` (room broadcast path) | per-recipient mailbox posts via `WebMailboxClient` (P0 step 7, R-a RESOLVED) |
| `talks/<id>` | `WebTalkService.createTalk` (star-era CRUD) | `myAuthoredTalks` localStorage (P0 step 7, R-f RESOLVED) |

`publishRoomTalkBodyRendezvous`, `subscribeToRoomTalkBodyRendezvous`, and `syncRoomTalkBodyRendezvous`
have been deleted from `PeerMeshService`.  The coverage-gap and below-degree fallback branches now
call `onMailboxFallback` (injected by app.ts) instead of writing to Gun.

## Fallback: mailbox posts (R-a RESOLVED, step 7)

`broadcastTalk`'s room path calls `onMailboxFallback(payload, recipientUserIds)` on EITHER of two
conditions — both meaning the DataChannel overlay cannot guarantee full room coverage:

1. **Below wanted degree** (`connectedNeighborCount === 0 || connectedNeighborCount <
   neighbors.size`): the overlay has not fully formed.
2. **Coverage gap** (`explicitRecipientCount > maxNeighbors && connectedNeighborCount <
   explicitRecipientCount`): the caller named more recipients than the degree bound K can hold.

`app.ts` wires `onMailboxFallback` to `postTalkBodyToMailboxForRecipients`, which posts an
encrypted envelope per recipient via `POST /api/mailbox/:recipientId`. Receivers drain it on
next `drainMailbox` call. The `p2pMeshTalkBodies` Gun path is completely absent.

## Author-qualified identity (content-address collision)

Talk ids are content-addressed (`computeTalkCIDv1`, no `authorId`), so two authors who create
identical content share the SAME `talkId` with different `authorId`s — legal by design. Both
body-delivery paths (mesh flood + Gun rendezvous) keep author identity:

- Gun rendezvous key is `…/<talkId>::<authorId>` (author-qualified).
- `PeerMeshService.talkBodies` cache is keyed `talkId::authorId`; a remote author's
  identical-content body never clobbers the local author's own cached copy.
  `getCachedTalkBody(talkId)` prefers the local user's own copy; `handleTalkBodyRequest` serves
  only the local author's copy.
- `handleMeshTalkBody` no longer mirrors to `talks/<talkId>` Gun (P0 step 7, R-f RESOLVED).
  The author's definition lives in `myAuthoredTalks` localStorage; receiver-side mirrors via
  `mirrorTalkDefinitionToLocalGun` are preserved so `getTalkWithRetry` can find the body after
  the mesh body-pull completes.
- Delivery/UI/chatbot dedup and response routing are all `talkId::authorId`-qualified, so a
  response reaches every author of identical content independently.

## Key design invariants verified

- `talk-announce` frames carry `{ talkId, authorId, title, type, questionCount }` — no body.
- The body is co-broadcast as a `talk-body` flood alongside the announce (no Gun rendezvous).
- `roomId` guard in `handleRemoteFrame` ensures frames from a different room are dropped —
  an ineligible peer in room-B never receives room-A's announce.
- `authorId === localUserId` guard in `handleLocalFrame` (talk-announce branch) ensures the
  author does not receive their own announce.
- Seen-set dedup prevents re-delivery of the same `msgId` even via multiple hops.
- K=1 path-graph case proves gossip forwarding works across a sparse topology.
