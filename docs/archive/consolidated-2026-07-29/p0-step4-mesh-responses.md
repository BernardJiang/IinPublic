# P0 Step 4 — Responses, matches, and conversations over mesh (design note)

> Status: design only. Implementation handed to Sonnet.
> Authoritative design of record: spec §23.6 (response path), §19.13 (identity/versioning,
> REQ-LEDGER-04/05), §19.4 (transport-vs-Gun model). TODO P0 step 4.
> Test (TODO P0 §4): *responses produce matches/conversations without server response endpoints
> or pair Gun subscriptions.*

## Pre-existing substrate (read before implementing)

Most of step 4 already ships behind `usesMeshTalkDelivery` (always-on per `p2p-runtime.ts`):

- `PeerMeshService.sendTalkResponse(payload)` (`peer-mesh-service.ts` L503) builds a `talk-response`
  frame with `recipientUserId: payload.authorId`, `ttlHops:8`, and unicast-forwards it (relay across the
  sparse overlay reaches the author when not a direct neighbor — step-1 forwarding rule).
- App-side `onTalkResponse` → `handleMeshTalkResponse` (`app.ts` L953): author-side. Drops if
  `payload.authorId !== currentUser.id`; dedups on `mesh-response::<talkId>::<responseId>`; resolves the
  talk via `resolveMeshTalkData`; decrypts the SEA-ECDH pair ciphertext; runs **`checkIfMatch` locally**
  (`src/shared/talk-engine.ts`, the single source of truth — never duplicated); records the local
  exchange; and on match calls `WebConversationService.createConversation` + `addNewConversation` +
  `setMemberMatched`.
- Responder-side `submitTalkResponsePairDirect` (`app.ts` L2075): runs `checkIfMatch` locally, encrypts
  the pair payload, calls `sendTalkResponse`, emits ledger `TALK_ANSWERED`, and on match
  **optimistically creates the conversation locally on the responder side** + emits `MATCH_CREATED`.
- Dispatch (`app.ts` L1927): when `talkData.authorId && authorId !== currentUser.id` and mesh is on,
  the pair-direct path runs and `return`s — the legacy server `else` branch
  (`talkService.submitTalkResponse` → `POST /api/talks/:id/response`) is never reached.

**Step 4 therefore hardens and proves an already-working path, not greenfield.** Remaining work:
the offline-author interim queue, response record/version fields for steps 8–11, removal of two
residual server/Gun writes that still ride the pair-direct path, and the E2E that proves the
zero-server / zero-pair-Gun-subscription invariant. Refinements are called out as R-* below.

## 1. Goal & non-goals

**Goal.** A responder's answer reaches the talk author over the mesh `talk-response` unicast; the
author runs `checkIfMatch` locally; on mutual match a conversation is created **locally on both sides**
with no server fan-in (`fanoutResponseToSenders`), no `POST /api/talks/:id/response`, and **no per-pair
Gun subscription** on a response/conversation path (spec §23.6 "replaces O(receivers) per-pair Gun
subscriptions"; §3170/§2999 anti-pattern: `talks/<talkId>/responses/<responseId>` replicates to every
peer syncing the talk node). Match truth stays in `src/shared/talk-engine.ts`.

**Non-goals.** No offline mailbox (step 6) — offline authors are handled by the interim local re-send
queue specified in §2. No sender-side outcome inbox / re-ask suppression (step 8), no response
versioning propagation / change-of-mind (step 9), no retraction (step 10), no exchange suppression
(step 11) — step 4 only *carries the fields* those steps need (`version`, `respondedAt`, CIDv1
`responseId`) so it does not preclude them. No deletion of the star path or its server maps (step 7);
the star branch stays compiled but unreached in mesh mode. Global server stats are out of scope —
the residual stats POST is called out as step-7 leftover (§4), not replaced here.

## 2. Response & match flow (sequence, incl. offline-author interim)

**Online (both author and responder in the room overlay):**

```
Responder R answers talk T (author A)
  R: isMatch = checkIfMatch(talkData, answers)            // shared engine
  R: responseId = CIDv1({ talkId, responderId, responseContentJson })   // R-1 (replaces resp_<ts>_<rand>)
  R: ciphertext = encryptPair(A, { responderName, answers, version, respondedAt, isChatbotResponse })
  R: PeerMeshService.sendTalkResponse({ responseId, talkId, authorId:A, responderId:R,
                                        submittedAt, version:1, encryption, payloadCiphertext })
  R: ledgerEmit(TALK_ANSWERED, { talkId, responseId, outcome, version })
  R: if isMatch → createConversation(R,A,talkId) locally   // optimistic, race-safe (see below)
        ↓ unicast talk-response (relay-forwarded across sparse overlay)
  A: handleMeshTalkResponse: authorId===A, dedup on responseId
  A: talkData = resolveMeshTalkData(talkId)                // author owns its own definition
  A: decrypt; isMatch = checkIfMatch(talkData, answers)    // same shared engine ⇒ same verdict
  A: recordLocalTalkExchange(R, …, outcome)
  A: if isMatch → createConversation(A,R,talkId) locally
```

**Race-safe creation — no ack frame needed.** Both sides independently derive the same `checkIfMatch`
verdict from the same talk definition + answers, so each side creates its own conversation node under a
**deterministic conversation id** (`meshConversationId`/`conv_<sortedUserIds>_<talkId>` — already used by
`createConversation`, which writes idempotent Gun nodes at `conversations/<id>` and
`users/<id1|id2>/conversations/<id>`). Identical ids on both sides mean re-creation is a no-op merge,
not a duplicate. **Default: no `ack`/confirm frame.** The envelope's `ack` kind stays reserved for
step 6 (mailbox receipt) and step 9 (delta-sync). *Rationale:* an ack would add a round-trip and a
failure mode (lost ack ⇒ asymmetric state) for zero benefit, since the verdict is deterministic and the
id is content/peer-derived. The only asymmetry window is "R created, A's unicast not yet delivered" —
self-healing on delivery; conversation is fully usable from R's side meanwhile (DM transport is
`DirectP2PConversationTransport`, peer-to-peer, not server-mediated).

**Offline author (interim, step-6 mailbox NOT built):** if `A` is not reachable at response time
(`sendTalkResponse` relay finds no path — `connectedNeighborCount` excludes A and no relay covers it),
the response is **queued locally on the responder** and re-sent on author presence. **Default
(per TODO "Keep offline author fallback routed through encrypted mailbox only"):** do NOT invent a new
Gun path and do NOT write `talks/<id>/responses/*`. Instead:

- Queue the *already-encrypted* `P2PMeshTalkResponsePayload` in `localStorage`
  (`pendingMeshTalkResponses`, keyed `<talkId>::<authorId>::<responseId>`).
- Presence source = **room roster** (`WebChatroomService.getActiveMembers` / presence-gossip), the same
  source the overlay is built from (step 1 §2). On a roster change that adds `A`, or on the next
  `joinRoom`/`syncPeerMeshRoom`, drain the queue: re-`sendTalkResponse` each pending payload, delete on
  send. R already created its conversation optimistically, so the match is not lost while A is offline —
  only A's local copy is deferred.
- This is explicitly **interim**: step 6 replaces the localStorage queue with the encrypted TTL mailbox
  (`talk-response` routed through mailbox fallback). Mark the queue with a `// STEP-6-REPLACE` comment so
  step 6 deletes it in one place. No server endpoint is added now.

## 3. Frame & record shapes (TypeScript)

The mesh frame and `P2PMeshTalkResponsePayload` already exist (`src/shared/p2p-mesh-protocol.ts`).
**R-1: add forward-compatible fields now (cheap, unblocks steps 8–11):**

```ts
// src/shared/p2p-mesh-protocol.ts — extend existing type
export type P2PMeshTalkResponsePayload = {
  responseId: string;          // R-1: CIDv1({ talkId, responderId, responseContentJson }) — REQ-LEDGER-04/12
  talkId: string;
  authorId: string;            // unicast routing target (recipientUserId)
  responderId: string;
  submittedAt: string;         // ISO
  respondedAt: string;         // R-1: ISO; == submittedAt at v1; step 9 sets changedAt on supersession
  version: number;             // R-1: monotonic per (talkId,responderId); 1 at first answer (REQ-LEDGER-04)
  encryption: 'sea-ecdh-v1';
  payloadCiphertext: string;   // pair ciphertext: { responderName, answers, isChatbotResponse, ... }
  transportMode: 'mesh-p2p';
};
```

`responseId` is the dedup key (`isP2PMeshTalkResponsePayload` already checks `responseId` presence; spec
REQ-LEDGER-05). `version`/`respondedAt` are inert in step 4 (always `1` / `== submittedAt`) but let
step 9's last-writer-by-version ingest reject stale updates without a payload migration. The plaintext
`answers` carry `identityKey` per answer via the existing intake keying (`buildTalkIdentityKey`,
`talkId::authorId` qualification from step 2) — author-qualified end-to-end so steps 8/11 can index by
peer + identity.

**Local author response inbox (spec §23.6 "single local response inbox keyed by talk").** Step 4 keeps
the *existing* `recordLocalTalkExchange` (`localStorage.localTalkExchanges`, keyed `<peerId>::<talkId>`)
as the inbox surface; **R-2: add `responseId`, `version`, `respondedAt` to the stored record** so step 8
can promote it to the authoritative per-responder outcome inbox without a schema change:

```ts
exchanges[`${peerId}::${talkId}`] = {
  peerId, peerName, talkId, title,
  outcome: 'match' | 'mismatch' | 'ignore',
  direction: 'sent',
  responseId, version, respondedAt,   // R-2 (new)
  date: new Date().toISOString(),
};
```

## 4. What is displaced (endpoints + Gun paths)

**Displaced by the mesh pair-direct path (step 4 proves these unused in mesh mode):**

- `POST /api/talks/:id/response` (`web-talk-service.ts` L303, `talkService.submitTalkResponse`) — the
  server fan-in / `fanoutResponseToSenders` / server conversation creation. Reached only by the legacy
  `else` branch (`app.ts` L1948), which the pair-direct dispatch (L1927) `return`s before.
- **Pair Gun subscriptions** on response/conversation pair paths — none are created by the mesh path;
  matches arrive by unicast `talk-response`, not by subscribing to a `talks/<id>/responses` or
  `pair/<id>/responses` node. (Spec §3170/§2999 anti-pattern.) The conversation *write* nodes
  (`conversations/<id>`, `users/<id>/conversations/<id>`) are local idempotent puts, not server fan-in,
  and remain (DM transport is direct P2P; persisting these is step-7 "conversation messages" cleanup,
  not a step-4 violation).

**Step-7 leftovers (still present on the pair-direct path; called out, NOT fixed here):**

1. **Stats POST** — `enqueueDirectTalkStats` → `POST /api/stats/talks/:id/record` (`app.ts` L2049,
   L2122). This is *talk stats*, not a response endpoint, and spec §23.6 explicitly defers stats
   ("drop global stats [recommended v1]"). Step 4 must **not add new server calls** and the E2E asserts
   no `/api/talks/:id/response` call — but it does **not** assert zero `/api/stats/*` (surveys/analytics
   specs still need it). **Step-7 work item:** remove the stats POST when global server stats are
   dropped. Note the existing `skipDirectTalkStatsForE2e` flag already lets a spec opt out.
2. **`gun.get('talks/<id>').get('responses').get(responseId).put(...)`** (`app.ts` L1997) — fires only
   in the `!submittedViaServer` data-preservation fallback of the **legacy** branch, which the
   pair-direct path never enters. It is dormant in mesh mode but is the §3170 anti-pattern; **step-7
   work item:** delete with the star branch. The step-4 E2E asserts `talks/<id>/responses` stays empty
   in mesh mode (proves the fallback never fires).

## 5. File plan

**Changed (`src/shared/p2p-mesh-protocol.ts`):** add `version`, `respondedAt` to
`P2PMeshTalkResponsePayload` (R-1). `isP2PMeshTalkResponsePayload` unchanged (already keys on
`responseId`).

**Changed (`src/shared/cid.ts` or where `computeTalkIdFromTalkData` lives):** add/confirm a
`computeResponseId({ talkId, responderId, responseContentJson })` CIDv1 helper (REQ-LEDGER-04/12). If a
CIDv1 util is not yet present, default to the existing content-hash util used for `talkId` and leave a
`// REQ-LEDGER-12 CIDv1` seam for step 9.

**Changed (`src/web/app/app.ts`):**
- `submitTalkResponsePairDirect`: replace `responseId = resp_<ts>_<rand>` with `computeResponseId(...)`;
  set `version:1`, `respondedAt: submittedAt` on the payload (R-1). Keep the existing local optimistic
  `createConversation` (race-safe per §2).
- `handleMeshTalkResponse`: pass `responseId`/`version`/`respondedAt` into `recordLocalTalkExchange`
  (R-2). No new server call. No subscription.
- Add the **offline-author interim queue** (§2): `enqueuePendingMeshResponse` on send failure / no path;
  `drainPendingMeshResponses(roomMembers)` invoked from `syncPeerMeshRoom` / roster-change handler.
  Mark `// STEP-6-REPLACE`.

**Changed (`src/web/app/app.ts` dispatch ~L1927):** no change needed — pair-direct already short-circuits
the server branch in mesh mode; confirm the guard covers all four talk types (survey/route produce
`isMatch:false` from `checkIfMatch`, which is correct — no conversation, response still delivered).

**No change** to `talk-engine.ts` (match truth), `WebConversationService` (idempotent local writes),
or `DirectP2PConversationTransport` (already the post-match DM transport).

## 6. E2E test plan

**Spec file:** `tests/e2e/talks-matching/03-mesh-response-match.spec.ts` (+ companion
`03-mesh-response-match.md`). Mirror 01/02 structure.

**Setup (reuse helpers, parallel-isolated):** `e2eWorkerSlot` fixture; `launchThreeBrowsers()` (Tom,
Jerry, Bob) with `WEBRTC_CHROMIUM_ARGS`; `bootstrapUser` each; all join the same room via
`webAppURLStableChatroom()` (appends `e2e_mesh_talks=1`). `afterLoad()` after nav; `afterSync()` (600ms)
after presence settles; poll `getDiagnostics().connectedNeighborCount > 0` (P2P_E2E_TIMEOUT_MS=10s)
before broadcasting.

**Body:**
1. Tom creates + broadcasts a **tag** talk (`tennis`, match/ignore). Jerry + Bob receive it over mesh
   (step-2/3 path; `displayIncomingTalk`).
2. **Jerry answers MATCH; Bob answers IGNORE** (open the incoming-talk modal via
   `openIncomingTalkModal`, submit, `waitForResponseModalClosed`). `afterAction()`.
3. **Durable match assertions** (per CLAUDE.md — persistent signals, not toasts):
   - Tom AND Jerry: `expect.poll` for a `.conversation-list-item` for the Tom↔Jerry pair (localStorage-
     backed, survives tab switches). Conversation id must match on both (`conv_<sortedIds>_<talkId>`).
   - Tom: `#status-bar-text` / member roster shows Jerry matched (`setMemberMatched`); Bob does NOT
     appear as a match (ignore ⇒ no conversation). Assert **no** Tom↔Bob `.conversation-list-item`.
   - `waitForTabActive` as the reliable navigation-complete signal.
4. **Server-endpoint invariant:** install a Playwright route/request interceptor on each page
   (`page.on('request')` or `route('**/api/talks/*/response', …)`) and assert **zero** calls to
   `POST /api/talks/:id/response` across the whole scenario. (Stats `POST /api/stats/*` is allowed —
   step-7 leftover, §4.)
5. **Pair-Gun invariant** (collect-helper pattern from 02-mesh-broadcast-announce.spec.ts L277–339,
   ASI-safe `new Function('return (' + collectFnSrc + ')')` wrapper, `root.map().once` accumulate over
   ~500ms): on each of the three pages' local Gun, assert empty:
   - `talks/<talkId>/responses` length `0` (proves the L1997 fallback never fired and no per-pair
     response replication — §3170 anti-pattern).
   - `peerTalkOffers/*` length `0`.
   - **Debt-aware on `talks/*`** (R-f from step-1 design): `talks/*` may hold ≤ 1 node per created talk
     (`createTalk` creation-write), so assert `talks/<talkId>/responses` empty rather than `talks/*`
     emptiness. **`p2pMeshTalkBodies/*`** stays `0` under the same conditions as spec 02 (no explicit
     `recipientUserIds`, fully-connected K overlay — neither fallback branch fires); assert `0` and, if
     flaky, gate on `connectedNeighborCount === neighbors.size` first.
6. **Change-of-mind / offline are NOT tested here** (steps 9 / 6). Optional smoke: a survey/route talk
   produces a response delivery (author `recordLocalTalkExchange`) but **no** conversation — proves
   `checkIfMatch:false` is honored.
7. Cleanup: `finalCleanupPages` + `shutdownThreeBrowsers`.

**Timing helpers:** `afterLoad` (boot), `afterSync` (presence/overlay settle), `afterAction`
(post-answer); reachability/match waits use `expect.poll` against durable state, never raw `wait()`.

## 7. Risks & open questions (each with a default so Sonnet is unblocked)

- **R-a: Optimistic responder-side conversation could orphan if A never comes online.** *Default:* accept
  it — R's conversation is locally usable; A's copy arrives when the interim queue drains on A's presence,
  and fully on step-6 mailbox. The deterministic id makes A's later creation a no-op merge. Do **not** add
  an ack now.
- **R-b: `responseId` was `resp_<ts>_<rand>` (non-deterministic), spec wants CIDv1.** *Default:* switch to
  `computeResponseId` content hash now (cheap, unblocks step-9 dedup/supersession); if the CIDv1 util is
  absent, reuse the existing `talkId` content-hash util behind a `// REQ-LEDGER-12` seam.
- **R-c: Residual `/api/stats/*` POST on the pair-direct path is a server call.** *Default:* allowed in
  step 4 (it is talk *stats*, not a response endpoint; §23.6 defers stats to step 7). E2E asserts no
  `/response` call but tolerates `/api/stats/*`. Step-7 removes it; `skipDirectTalkStatsForE2e` already
  exists to opt out per-spec.
- **R-d: Offline-author interim uses localStorage, not the (unbuilt) mailbox.** *Default:* per TODO,
  queue the encrypted payload locally and re-send on roster presence; **no new Gun path, no server
  endpoint**. Mark `// STEP-6-REPLACE` so step 6 swaps in the TTL mailbox in one place.
- **R-e: Multiple authors of identical content share `talkId` (content-addressed).** *Default:* already
  handled by step-2 author-qualified keying (`talkId::authorId`); `sendTalkResponse` routes to
  `payload.authorId`, `handleMeshTalkResponse` drops non-self authors, and the response inbox/exchange
  keys are `<peerId>::<talkId>` (peer-qualified). No change needed; step 4 must preserve this when adding
  `responseId`.
