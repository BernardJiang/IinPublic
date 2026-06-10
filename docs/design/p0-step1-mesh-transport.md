# P0 Step 1 — Mesh Transport Foundation (design note)

> Status: design only. Implementation handed to Sonnet.
> Authoritative design of record: spec §23 (Mesh Talk Delivery), §19.13 (identity/versioning),
> §19.14 (visibility zones), REQ-P2P-09–29. TODO P0 step 1.
> Test (TODO P0 §1): *three browser peers can gossip `mesh-ping` across a sparse room overlay
> without `talks/*` or `peerTalkOffers/*` Gun writes.*

## Pre-existing substrate (read before implementing)

A partial foundation already ships behind `e2e_mesh_talks` (`usesMeshTalkDelivery`, always-on per
`p2p-runtime.ts`): `PeerMeshService` (`src/web/services/peer-mesh-service.ts`) already implements
`sendPing()` → `mesh-ping` gossip, seen-set dedup, TTL-hop forwarding, and signed frames via
`p2p-mesh-protocol.ts` + `p2p-runtime.ts`. The WebRTC session (`p2p-webrtc-session.ts`) already
carries a `{type:'mesh', frame}` wire payload over the DataChannel. **This step does not build the
mesh from scratch — it hardens the `mesh-ping` overlay, adds the missing degree bound and the
`P2P_MESH_TALKS` flag gate, and ships the E2E that proves the zero-Gun-write invariant.** Refinements
to the shipped code are called out explicitly below.

## 1. Goal & non-goals

**Goal.** Prove a reusable, server-independent gossip transport: three browser peers in one room
form a *sparse* DataChannel overlay (each connects to ≤ K neighbors, not full mesh — spec §23.1 ¶5,
§23.7) and an originator's `mesh-ping` reaches every other peer via store-and-forward gossip
(§23.5), with **zero** `talks/*` and `peerTalkOffers/*` Gun writes. This is the substrate that
steps 2–4 generalize into `talk-announce` / `talk-body` / `talk-response`, so the envelope, dedup,
and forwarding rule must be designed once here and reused unchanged (§23.5 protocol table).

**Non-goals.** No talk delivery, intake filtering, matching, or conversation creation (steps 2–6).
No offline mailbox (step 6) — `mesh-ping` is online-only; offline targets are simply unreached this
step. No removal of the star path (step 7) — that path stays compiled but the mesh ping must not
touch it. No global stats. Crucially, **this step does not yet remove the Gun-relayed
`p2pMeshTalkBodies/*` rendezvous** that the shipped `broadcastTalk` room path uses (§"Refinement R1");
that body path is out of scope because `mesh-ping` carries its payload inline and needs no body pull.

## 2. Overlay construction

**Peer-discovery source (NOT a talk Gun path).** The overlay is seeded from room presence:
`WebChatroomService.getActiveMembers(roomId)` (Socket.IO room roster, server rendezvous only — spec
§23.3 "Room roster", REQ-P2P-22 zone-A membership). This is the same source `warmMeshConnectionToPeer`
already uses (`app.ts` ~L687). No read or write of `talks/*`, `peerTalkOffers/*`,
`incomingTalksByUser/*`, or `chatrooms/*/announcements` participates in overlay formation.

**Server interactions that remain (rendezvous + signaling only, §23.3/§23.4):**
1. `GET` active room members (Socket.IO presence roster).
2. WebRTC signaling relay (`P2PSignalingClient` → `system-routes` offer/answer/ICE, TTL'd ciphertext).
3. STUN/TURN config.
4. Public-key resolution: `getPublicUser(userId).pub` (zone-A public profile, read-only) to address
   the signed handshake. *No* talk-path interaction.

**Sparse selection + degree bound.** On `joinRoom(roomId, members)`:
- Candidate set = active members minus self minus TechSupport root (already filtered, `peer-mesh-service.ts` L155–159).
- **Degree bound K = `maxNeighbors` (default 12; E2E uses 3).** *Refinement R2:* the shipped code
  selects candidates by `localeCompare` sort then `slice(0, K)` (L162–165) — deterministic but not
  sparse-aware. Keep deterministic selection for v1 (reproducible E2E), but document that step ≥2 must
  swap in `scoreP2PNeighbor` (recency, room overlap, latency, contact — spec §23.7) without changing
  the gossip layer. For a 3-peer room K=3 yields a complete graph; sparsity is proven by the
  forwarding rule (hops > 1), so the test also runs a "degree-bounded" assertion: with K=1, a ping
  from A still reaches C via B (one forward hop).
- Each kept candidate gets one `MeshSession` (`getOrCreateP2PSession`), initiator chosen by
  `localeCompare` to avoid glare (L335). Existing behavior — reused.

**Join/leave churn.** `joinRoom` is idempotent and diff-based: neighbors not in the new wanted set
are dropped, new ones are added (L167–199). On membership change the app re-invokes
`syncPeerMeshRoom` (app.ts L788). *Refinement R3:* `leaveRoom()` already clears neighbors + seen-set
(L202); on a neighbor's DataChannel close the overlay must re-pick a replacement up to K — add a
`onNeighborClosed` hook that re-runs candidate selection. Seen-set persists across a single room
session so re-delivery after reconnect is still deduped.

## 3. Gossip protocol for `mesh-ping`

**Envelope (already in `p2p-mesh-protocol.ts` — reuse verbatim, generalizes to steps 2–4):**
```ts
type P2PMeshFrame = {
  version: 1;
  kind: P2PMeshMessageKind;        // 'mesh-ping' | 'mesh-pong' | 'talk-announce' | 'talk-body-request'
                                    //  | 'talk-body' | 'talk-response' | 'ack'
  msgId: string;                   // dedup key (unique per origin emission)
  roomId: string;                  // scope guard: frames from another room are dropped
  originUserId: string;            // signer; preserved across forwards
  originPub: string;
  recipientUserId?: string;        // unicast target (omitted ⇒ gossip flood)
  createdAt: string;               // ISO; replay/age basis for steps 4/9
  ttlHops: number;                 // decremented each forward; 0 ⇒ stop
  payload: P2PMeshFramePayload;    // mesh-ping: { text }
  proof?: SignedP2PEnvelopeProof;  // SEA signature over p2pMeshFrameSigningPayload(frame)
};
```
This is the **single envelope for the whole epic.** `mesh-ping` sets `payload={text}` and no
`recipientUserId` (flood). Steps 2–4 reuse it unchanged: `talk-announce` = flood with metadata
payload; `talk-body-request`/`talk-body`/`talk-response` set `recipientUserId` for unicast routing.
*Note (spec alignment):* spec §23.5 names fields `{v, kind, msgId, roomId, ttlHops, senderPub,
proof, payload}`; the shipped frame additionally carries `originUserId`/`recipientUserId`/`createdAt`,
which steps 4/9/10 require for last-writer ordering. Treat the shipped frame as the refined design of
record and update §23.5's field list to match (documentation follow-up, not a code change).

**Dedup key + cache.** `msgId`. `PeerMeshService.seen: Set<string>` (L101). A frame is processed +
forwarded at most once: `handleRemoteFrame` drops if `seen.has(msgId)`, else adds and proceeds
(L476–478). *Refinement R4:* `seen` is currently unbounded; bound it (LRU / FIFO ~10k entries, spec
§23.8 "seen-set sizing") to prevent leak in long sessions. Cleared on `leaveRoom`.

**Forwarding rule (`forwardFrame`, L413–425; reuse):**
1. If `ttlHops ≤ 0`, stop.
2. Decrement TTL into a copy.
3. If `recipientUserId` set and that neighbor is known → unicast to it. Else fan out to all
   neighbors **except** the inbound sender (split-horizon) and except the frame's origin.
4. `mesh-ping` is a flood (no recipient): every newly-seen ping is re-emitted to all other neighbors.
5. Origin emits via `rememberAndFanout` (adds to `seen`, then `forwardFrame`) so it never re-accepts
   its own ping.

**Verification + scope.** Every inbound frame: `version===1`, `roomId===currentRoomId`,
not-already-seen, and `verifyOrigin` (signature over `originPub`) before processing (L473–477).
Unsigned/cross-room/replayed frames are dropped (REQ-P2P-10, P2P-19). `mesh-ping` addressed-to-me
(no recipient ⇒ all) fires `onPing` and emits a unicast `mesh-pong` back to `originUserId` (L490–499)
— the pong is the durable proof signal the test asserts on (see §6).

**TTL default.** `sendPing` uses `ttlHops:8` (L249) — ample for ≤ log(N) hops in rooms up to ~256.
Keep 8 for the foundation.

## 4. Invariant enforcement (zero `talks/*` / `peerTalkOffers/*` writes)

The `mesh-ping` path is pure DataChannel: `sendPing` → `buildFrame` → `rememberAndFanout` →
`session.sendMeshFrame`. It performs **no Gun writes at all** — confirmed by code path inspection
(no `gun.put`, no `getGunOrNull` use in the ping path). The Gun-touching mesh code
(`publishRoomTalkBodyRendezvous`, `subscribeToRoomTalkBodyRendezvous`) is reached only from
`broadcastTalk`'s room path, which `mesh-ping` never calls.

**Test proves the invariant by relay-side Gun read assertion** (the pattern already used in
`tests/e2e/staged/stage2-two-user/00i-p0-direct-talk-delivery.spec.ts` L104–129): after the ping
fans out and pongs return, each browser reads the Gun graph and asserts the forbidden subtrees are
empty:
```ts
const collect = (root) => /* root.map().once(...) accumulate over 500ms */;
expect((await collect(gun.get('peerTalkOffers').get(receiverId))).length).toBe(0);
expect((await collect(gun.get('talks'))).length).toBe(0);          // no talk bodies
expect((await collect(gun.get('peerTalkOffers'))).length).toBe(0); // no offers anywhere
```
This mirrors the shipped spec's `offerCount/announcementCount` assertions, so reviewers recognize the
pattern. The check runs on all three browsers' local Gun (each peer's own graph), since a leak could
originate on any node. *Belt-and-suspenders (optional):* a relay-side hook in `system-routes` test
mode that counts `put`s to `talks/`/`peerTalkOffers/` prefixes and exposes a `GET /api/test/relay-write-counts`;
recommended only if the per-browser read proves flaky.

## 5. File plan

**New (`src/shared/`):**
- *(none)* — envelope/protocol already in `p2p-mesh-protocol.ts`; do not duplicate.

**New (`src/web/`):**
- *(none new)* — extend the existing `PeerMeshService`.

**Changed (`src/web/services/peer-mesh-service.ts`):**
- `private readonly seen` → bounded LRU (R4). New helper `private rememberSeen(msgId): void`.
- `joinRoom` candidate selection: extract `selectNeighbors(members, K): RoomMember[]` (keep
  deterministic body now; documented seam for `scoreP2PNeighbor`, R2).
- Add `onNeighborClosed` re-pick on session close (R3).
- Public surface (already present; no signature change needed for the test):
  ```ts
  joinRoom(roomId: string, members: RoomMember[]): Promise<void>;
  sendPing(text?: string): Promise<string>;        // returns msgId
  waitForConnectedNeighbor(userId, timeoutMs?): Promise<boolean>;
  getDiagnostics(): { roomId; neighborCount; connectedNeighborCount; seenCount; cachedTalkBodies };
  // options gains:
  onPing?(fromUserId: string, frame: P2PMeshFrame): void | Promise<void>;
  onPong?(fromUserId: string, frame: P2PMeshFrame): void | Promise<void>;  // ADD for durable test signal
  ```
- *Refinement R5:* add `onPong` to `PeerMeshServiceOptions` and fire it in `handleLocalFrame` for
  `kind==='mesh-pong'` (currently pong is emitted but inbound pong is not surfaced). The app records
  received pong origins so the E2E can assert reachability without a toast.

**Changed (`src/web/app/app.ts`):**
- In `ensurePeerMeshService` wire `onPing`/`onPong` to update a small `meshPingDiagnostics`
  record on the app (origins pinged, origins ponged) exposed via the existing `getApp()` handle for
  the E2E.

**Feature-flag wiring (`P2P_MESH_TALKS`).** The runtime flag already resolves through
`usesMeshTalkDelivery(flags)` (gates `ensurePeerMeshService`, app.ts L774) and the E2E URL param
`e2e_mesh_talks=1` (`ports.ts`). *Action:* surface the public name `P2P_MESH_TALKS` as the
canonical env/flag alias in `p2p-runtime.ts` (it is currently effectively always-on); keep
`usesMeshTalkDelivery` as the read accessor so step 7 can flip the default and delete the star branch
in one place. No new flag plumbing in the UI for this step.

## 6. E2E test plan

**Spec file:** `tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts` (+ companion `01-mesh-ping-overlay.md`).

**Setup (reuse helpers, parallel-isolated):**
- `e2eWorkerSlot` fixture (`helpers/fixtures.ts`) sets `parallelSlotOverride` before `beforeAll`, so
  each worker gets its own Gun (`8080+N`) and webpack (`3001+N`) server (`helpers/ports.ts`).
- `launchThreeBrowsers()` / `shutdownThreeBrowsers()` (`helpers/talks-matching-browsers.ts`) — Tom,
  Jerry, Bob, each with `WEBRTC_CHROMIUM_ARGS` (`helpers/webrtc-chromium.ts`) for split-browser WebRTC.
- `bootstrapUser` (`helpers/talks-matching-flow.ts`) for each; all three join the same room via
  `webAppURLStableChatroom()` (which already appends `e2e_mesh_talks=1`).
- `afterLoad()` after navigation; `afterSync()` (600ms) after presence settles so
  `getActiveMembers` returns all three.

**Body:**
1. Each page calls `getApp().peerMeshService.joinRoom(roomId, members)` (or relies on
   `syncPeerMeshRoom` once presence lands); poll `getDiagnostics().connectedNeighborCount > 0` on each
   page (`expect.poll`, P2P_E2E_TIMEOUT_MS = 10s).
2. **Sparse-overlay sub-case:** re-join with `maxNeighbors:1` so the graph is a path A–B–C; assert
   A has exactly 1 neighbor (`getDiagnostics().neighborCount===1`).
3. Tom calls `peerMeshService.sendPing('p0-step1')`, capturing the returned `msgId`.
4. **Durable assertion (per CLAUDE.md — prefer persistent signals over toasts):** poll the app-level
   `meshPingDiagnostics.pingedOrigins`/`pongedOrigins` record (populated by `onPing`/`onPong`,
   exposed via `getApp()`), not a transient notification:
   - On Jerry **and** Bob: `expect.poll(() => pingDiag.lastPingFrom).toContain(tomId)` — proves the
     ping reached both, including via a one-hop forward in the K=1 path case.
   - On Tom: `expect.poll(() => pingDiag.pongedOrigins)` contains both Jerry and Bob — proves
     round-trip reachability over the overlay. Mirror to `#status-bar-text` if a visible durable
     signal is wanted.
5. **Invariant assertion** (§4): on each of the three pages, read local Gun and assert
   `peerTalkOffers` and `talks` subtrees empty (the `collect(root.map().once)` pattern). Fail loudly
   if any forbidden write appears.
6. Cleanup: `finalCleanupPages` + `shutdownThreeBrowsers`.

**Timing helpers:** `afterLoad` (boot), `afterSync` (presence/overlay settle), `afterAction`
(post-ping); never raw `wait()`. Reachability waits use `expect.poll` against durable app state, not
fixed sleeps.

## 7. Risks & open questions (each with a default so Sonnet is unblocked)

- **R-a: Existing `broadcastTalk` room path writes Gun `p2pMeshTalkBodies/*`.** Not `talks/*` or
  `peerTalkOffers/*`, so it does **not** fail this step's literal invariant — but it is a Gun-relayed
  body path step 7 must remove. **Default:** out of scope here; `mesh-ping` carries payload inline and
  never calls that path. File a step-2/4 follow-up to replace rendezvous with `talk-body-request`/
  `talk-body` unicast pull (§23.5). *(Partially resolved in step 2: room broadcast now floods
  `talk-body` over DataChannel as the primary path. However, a **conditional fallback** was
  required. The fallback fires (writes `publishRoomTalkBodyRendezvous` →
  `p2pMeshTalkBodies/<roomId>/<talkId>::<authorId>`, **author-qualified key**) on EITHER of two
  conditions — both meaning the DataChannel overlay cannot *guarantee* full room coverage:*
  1. *Below wanted degree: `connectedNeighborCount === 0 || connectedNeighborCount < neighbors.size`
     — the WebRTC overlay has not fully formed (staged specs that call `joinRoom` + `broadcastTalk`
     without waiting for neighbors).*
  2. *Coverage gap (find-similar-people 8/9 fix): the caller named more recipients than the degree
     bound can directly hold AND the connected overlay does not cover them
     (`explicitRecipientCount > maxNeighbors && connectedNeighborCount < explicitRecipientCount`).
     With a bounded degree K (e2e K=3) over many recipients, delivery to the non-neighbor
     recipients depends on **relay forwarding** across a sparse, possibly **partitioned** overlay,
     which can silently miss a peer behind a non-bridged link — even when the sender's OWN K
     neighbors are all connected (so condition 1 alone did NOT fire). Root cause of the
     deterministic "exactly 8 of 9 contacts" regression: one recipient sat in a relay-unreachable
     component. Writing the Gun rendezvous makes it the authoritative full-room delivery channel.*

  *Spec 02's `p2pMeshTalkBodies/* == 0` assertion is preserved because Tom broadcasts over a fully
  connected K=1 overlay with **no explicit `recipientUserIds`** (`explicitRecipientCount === 0`, so
  condition 2 is skipped) and `connectedCount === neighbors.size === 1` (condition 1 false). Full
  removal of the fallback requires either (a) all broadcast callers gating on a fully connected
  overlay, or (b) the offline mesh mailbox (step 6). Track as step-6/7 work item: remove both
  fallback branches from `broadcastTalk`, delete `publishRoomTalkBodyRendezvous`, and add
  `p2pMeshTalkBodies/* == 0` to the staged spec assertions.)*

  ***Author-qualified identity (content-address collision, find-similar fix).*** *Talk ids are
  content-addressed (`computeTalkCIDv1`, no `authorId`), so two authors who create identical content
  share the SAME `talkId` with different `authorId`s — legal by design (needed for step 8–11
  per-author outcome records). Step-2's mesh flood added a second body-delivery path alongside the
  Gun rendezvous; both must keep author identity. Keying that is now author-qualified end-to-end:*
  - *Gun rendezvous key: `p2pMeshTalkBodies/<roomId>/<talkId>::<authorId>` (already; unchanged).*
  - *Mesh body cache (`PeerMeshService.talkBodies`): now keyed `talkId::authorId`, so a remote
    author's identical-content body no longer **clobbers the local author's own cached body**.
    `getCachedTalkBody(talkId)` prefers the local user's own copy (`talkId::localUserId`);
    `handleTalkBodyRequest` serves only the local author's copy.*
  - *App-side `talks/<talkId>` Gun mirror is keyed by `talkId` alone (shared node). `handleMeshTalkBody`
    now skips the mirror when the local user authored content with that id
    (`localUserAuthoredTalkContent`), so the author's own definition survives for the response/match
    path (`resolveMeshTalkData`).*
  - *Delivery dedup (`deliveredTalkBodyIds`), chatbot-reply dedup (`chatbotAutoReplySentForPair`),
    UI dedup (`processedTalkResponseKeys`), and response routing (`sendTalkResponse` →
    `recipientUserId: authorId`) are all `talkId::authorId`-qualified, so a response reaches every
    author of identical content independently.*
- **R-f (found in step 2): `WebTalkService.createTalk` persists the talk definition to Gun
  `talks/<id>`** (relay-synced) at creation time — author-side star-era CRUD, independent of the
  delivery path. Mesh E2Es therefore assert `talks/*` *does not grow beyond the single creation
  write* rather than strict emptiness. **Step-7 work item:** move author talk persistence to local
  stores ("Stop Gun relay use for `talks/*`"), then tighten the E2E assertions back to zero.
  *(Note: the `talks/<id>` node is keyed by content-addressed id alone, so two authors of identical
  content share the node; `handleMeshTalkBody` must not mirror a remote author's body over a
  locally-authored `talks/<id>` — see the author-qualified-identity note under R-a.)*
- **R-b: Unbounded `seen` set.** **Default:** bound to FIFO ~10k entries (R4); cleared on `leaveRoom`.
- **R-c: Neighbor churn mid-ping (DataChannel still connecting).** **Default:** `sendPing` fans out to
  currently-connected neighbors; `sendFrameToNeighbor` already retries after `ensureConnected`
  (L427–457). The E2E gates on `connectedNeighborCount>0` before pinging, so foundation correctness
  does not depend on reconnect timing.
- **R-d: NAT/STUN on CI for split-browser WebRTC.** **Default:** rely on `WEBRTC_CHROMIUM_ARGS`
  (mDNS-off) which the shipped P2P E2Es already use successfully on one machine; no TURN needed for
  loopback. If a pair fails to connect, the K-bounded forward path still delivers via a third peer —
  do not add a mailbox fallback this step (step 6).
- **R-e: Deterministic vs. score-based neighbor selection.** **Default:** ship deterministic
  `localeCompare` selection now (reproducible E2E); leave a documented `selectNeighbors` seam for
  `scoreP2PNeighbor` (§23.7) so steps 2+ swap it in without touching gossip/dedup/forwarding.
