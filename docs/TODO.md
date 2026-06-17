# IinPublic TODO

Last updated: 2026-06-15

This file is the short, execution-oriented plan. The detailed acceptance inventory and the
statistics / spec-gap follow-ups are consolidated into the appendices at the bottom of this file.
- Completed work: `docs/completed.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)
- Detailed acceptance inventory: see "Appendix A — Detailed backlog inventory" below.

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. Do steps 9–11 in one Opus session (shared versioning/ordering machinery). `- [ ] Test:` items belong to whichever model implemented the step.

## Open items — SHIPPING GATES & FOLLOW-UPS

### P0 — P2P messaging: Gun-as-graph-DB, no star fallback (spec §19.4 Phase C) `[Opus]`

**Goal:** ordinary-peer DMs travel over WebRTC (delivery) with **Gun-on-device as the source of
truth** for `conversations/<id>/messages`; the server is signaling/presence rendezvous only and the
central hub retains **no** message bodies. This is spec §19.4's own end state (WebRTC = ephemeral
delivery lane, Gun local = durable truth, star hub = migration-only / disabled in Phase C).

**Where we are (audit 2026-06-13):** the §19.4 core already works — `DirectP2PConversationTransport`
writes each message to local Gun then notifies over WebRTC; the receiver applies the peer update to
its own local Gun; the UI reads from a Gun subscription. A relay-only (no-archive) hub already exists
behind `RELAY_ONLY_HUB=1` (`npm run dev:relay-only`) with a `/api/debug/storage` diagnostic. What
remains is fallback/config scaffolding plus one real missing capability (offline mailbox for DMs).

**Current state (2026-06-15):** Phases 1–4 shipped: `DirectP2PConversationTransport` is the only ordinary-peer transport; `ResilientConversationTransport` and `ServerRelayConversationTransport` deleted; hub skips all message bodies (`shouldSkipServerGunPersist`); offline DM mailbox wired. `GunMessageStore` is the local Gun write path (not a transport). The only remaining gap is Phase 5 peer reconciliation (browser CI pending). **TechSupport stays server-backed (spec §19.7) — out of scope.**

Phases 1–4 **completed** 2026-06-13 and moved to `docs/completed.md` (direct-p2p default transport;
Gun store split from star transport; no hub message archive; offline DM mailbox).

All P1 (libp2p/IPFS), P2 (Find Similar), and P2.5 (sort pipeline) **completed** and moved to `docs/completed.md` (2026-06-12). REQ-SIM-01–08 fully implemented including distance sort (§22.7) with blurred-GPS Haversine — see `docs/completed.md`.

Phase 5 peer↔peer Gun reconciliation **promoted to `docs/completed.md` 2026-06-16** (core DONE; browser CI verification still pending).

### P0 — Test determinism `[Opus]` — CI VERIFICATION PENDING

**Context (2026-06-15).** `playwright.config.ts` global `retries` dropped to `0`; 9 specs pinned with `test.describe.configure({ retries: 0 })`; `ResilientConversationTransport` and its fallback spec deleted — fallback chain gone by design. Remaining open: live `--retries=0` full-suite run in browser-capable CI, and two specs still at `retries:1` allowlist (`00-p2p-neighbor-memory`, `00-p2p-cross-platform-protocol`) pending the connectedNeighborCount gate (G-fix class).

T1 retry-dependence inventory **promoted to `docs/completed.md` 2026-06-16** (static analysis DONE; G-fix gate + live retries=0 CI run still pending).
- [ ] **Test/verify:** `[Haiku]` `PW_WORKERS=4 npm run test:e2e` green with `retries: 0`; `npm run health` clean.

**Next phase:** Appendix C (P2P spec-gap audits `[Haiku]`). Appendix B (Statistics expansion) completed 2026-06-13 — see `docs/completed.md`.

---

## Infrastructure & Architecture Follow-ups

### S1 — Signaling server memory: add background pruning `[Haiku]` — **COMPLETED 2026-06-16** (moved to `docs/completed.md`)

### S2 — Replace HTTP signaling poll with Gun pub/sub `[Sonnet]`

`P2PSignalingClient` (`src/web/services/p2p-signaling-client.ts`) currently polls `GET /api/p2p/signaling/:conversationId` every ~400 ms. The Gun WebSocket is already open for every user in a chatroom. Writing signaling envelopes to a Gun path (`gun.get('p2p-signal').get(sharedKey)`) and subscribing via `.on(callback)` would deliver offers/answers the moment they're written — no polling, no server HTTP route needed.

Plan:
- [x] Derive `sharedKey` deterministically from two `pub` values: `sha256(sorted([pubA, pubB]).join(':'))` — `deriveSignalingSharedKey()` in `src/web/services/gun-pubsub-signaler.ts`.
- [x] Write SDP offer/answer/ICE frames to `gun.get('p2p-signal').get(sharedKey).get(nonce)` (one node per nonce so frames never overwrite) — `GunPubSubSignaler.post()`.
- [x] Subscribe via Gun `.map().on()` instead of the `setInterval` poll — `GunPubSubSignaler.startPolling()`. Both signalers now implement a shared `SignalingTransport` interface; `P2PConversationSession` picks `GunPubSubSignaler` when `config.gun` is supplied, else the HTTP `P2PSignalingClient` (default).
- [x] Add `shouldSkipServerGunPersist()` rule for `p2p-signal/` so the hub never archives these — `src/shared/p2p-runtime.ts:656`.
- [x] Unit coverage: `src/test/unit/gun-pubsub-signaler.test.ts` (sharedKey determinism/symmetry; post path; signed-frame delivery; self-frame skip + nonce dedup).
- [x] **Wire `config.gun` so Gun-signaling is the default — scoped to conversation DMs.** Only `direct-p2p-conversation-transport.ts` passes `gun: this.gunService.getGun()`. The mesh talk-delivery path (`peer-mesh-service.ts`, `app.ts` fallback) was reverted to HTTP signaling: enabling Gun signaling there slowed peer connect enough that the broadcast retry loop exhausted the daily talk-send rate limit (10/day) and gated all recipients (`00-broadcast-boundary-match`, `00-broadcast-deletion-mid-broadcast` red-lined in stage2 E2E). HTTP `P2PSignalingClient` remains the no-gun fallback everywhere. **Follow-up:** extend Gun signaling to the mesh once it has dedicated E2E coverage that tolerates connect latency without burning the rate-limit budget.
- [x] **Root-caused the first default-flip failure (2026-06-16).** The original `GunPubSubSignaler` stored each frame as a **primitive JSON string** at `p2p-signal/<sharedKey>/<nonce>`; Gun's `.map()` iterates child *nodes*, and primitive-string leaves do not replicate to a peer's map subscription, so offer/answer frames never reached the peer and the WebRTC handshake never completed (red-lined `00j-messaging-edge-cases`, `00k-p2p-handshake`, `09-messaging`, `10-message-unread-badge`). **Fix:** store each frame as a flat **object node** keyed by nonce (`.get(nonce).put(record)`) + consolidate via `.get(nonceKey).once()` on each `.map().on()` emission — mirrors the proven `GunMessageStore` record-per-id pattern (`conversations/<id>/messages/<msgId>`). Unit tests updated; logic green. NOTE: a real-Gun *node* integration test is not possible — node in-memory Gun never fires `.map().on()` for nested (`depth ≥ 2`) keyed children, only top-level `.set()`; the browser relay handles nested paths fine (the message store relies on it). So the cross-peer proof is the E2E item below.
- [x] **2nd-round root cause (2026-06-16): browser↔browser Gun *push* doesn't propagate in this hub.** With object-node frames the messaging/handshake specs still failed at the WebRTC connect step (channel stuck `connecting`). This app uses Gun as a local-graph relay with effectively server-authoritative reads — presence, talks, messages, member counts all travel over HTTP/WebRTC, never browser→browser Gun `.on()` push. So a peer's `.map().on()` never saw the other peer's offer. **Fix:** `GunPubSubSignaler` now also PULLS the channel every 250ms via `.map().once()` (a Gun GET that retrieves what the writer replicated to the hub) in addition to the live `.on()` — the Gun analog of the old HTTP poll; handleFrame dedups by nonce. Mesh stays on HTTP (above).
- [ ] **VERIFY (browser CI):** run `npx playwright test tests/e2e/staged/stage2-two-user/` and confirm the 4 messaging/handshake specs pass with the pull-poll signaler (and the 2 broadcast specs stay green).
- [ ] For native nodes (those with a `Libp2pBindingRecord` in Gun at `p2p-peer-bindings/<userId>`): skip signaling entirely — read their multiaddrs and dial via `node.dialProtocol(peerId, '/iinpublic/mesh/1.0.0')`.
- [ ] E2E: once the above is green, remove `POST`/`GET /api/p2p/signaling/:conversationId` server routes.



---

## GUI Polish — Talks presentation & information density `[Sonnet]`

The current talk UI surfaces minimal metadata. Each item below adds a concrete, self-contained layer of information or interaction quality.

### G1 — Richer talk cards in the incoming list

Each incoming talk card currently shows title + type badge only. Add:
- [ ] **Question count + progress ring** for flow/route talks (e.g. "Q3 of 5") so the user knows the depth before accepting.
- [ ] **Language badge** (flag icon + ISO code) when the talk language differs from the viewer's preferred language — gives instant filter signal.
- [ ] **Creator name + avatar thumbnail** (from `user-public-profile/<creatorId>`) — currently absent; adds social context.
- [ ] **Time-to-expiry chip** ("Expires in 2 h") derived from `talk.expiresAt`; color-coded (green/amber/red).
- [ ] **Distance chip** if the creator's blurred location is available in presence ("~3 km away") — reuse `blurredDistanceMiles` from the find-similar pipeline.
- [ ] **Answer count** for survey and tag talks ("47 responses") pulled from local ledger aggregates.

### G2 — Talk response flow UX

Inside the response modal for flow/route talks:
- [ ] **Step indicator bar** at the top: "Question 2 of 4" with filled dots for completed steps and an empty dot for the current one.
- [ ] **Back button** for flow talks — allow the user to revise the previous answer before submitting (requires buffering answers locally and only submitting on the final step).
- [ ] **Branch preview** for route talks: after selecting an answer show a subtle "this leads to: [next question title]" preview before the user commits.
- [ ] **Auto-save draft** — if the modal is closed mid-flow, re-open at the same question (store draft in `localStorage` keyed by `talkId`).
- [ ] **Estimated completion time** shown at the start of a flow/route talk (e.g. "~2 min, 4 questions").

### G3 — Conversation list improvements

`conversations-view.ts` currently shows: other user's name + talkId. Add:
- [ ] **Last message preview** (first 60 chars, ellipsised) and **relative timestamp** ("3 min ago") — read from `GunMessageStore.listLocalWires` for the conversation.
- [ ] **Unread badge** (count of messages since last `readAt` cursor) — store cursor in `localStorage`.
- [ ] **Transport mode chip** ("P2P" / "Relay") derived from `transportMode` field already on the conversation record.
- [ ] **Online indicator** — green dot if the peer has a live `PresenceRecord` (not expired).

### G4 — Peer detail view enhancements

`user-detail-view.ts` shows basic profile fields. Add:
- [ ] **Compatibility score** (the `matchScore` from `find-similar.ts`) rendered as a percentage bar next to the peer's name — already computed in the contacts index, just needs to be passed through to the detail view.
- [ ] **Talk exchange timeline** — chronological list of talks the two users exchanged (from `localTalkExchanges`), each showing outcome (match / ignore / pending) and date.
- [ ] **Shared tags** panel — the intersection of their matched tag sets, ordered by mutual importance weight.
- [ ] **Reputation summary** — render the peer's `Reputation` struct as compact icon-row (response rate, match rate, flagged count) rather than raw numbers.

### G5 — Survey results visualization

`displayStatisticsDashboard` renders tables. Replace/augment with:
- [ ] **Horizontal bar chart** for tag-frequency and per-answer distribution — use the existing Canvas/SVG budget (no new library; D3 or plain SVG).
- [ ] **Day-over-day sparkline** for response volume (last 14 days) on the dashboard header.
- [ ] **Question completion funnel** for flow/route talks: each step's drop-off shown as a narrowing funnel chart, highlighting where users abandon.
- [ ] **Cross-question heatmap** for survey talks: a 2-D matrix showing co-occurrence frequency for the top N question pairs.

---

## Public Gun Bootstrap — Shared knowledge graph `[Sonnet]`

Certain data is logically global and should be replicated to every peer's local Gun graph on first connection, rather than fetched on demand. This makes the app functional with a degraded or offline hub.

### P1 — Chatroom hierarchy as Gun-published constant

`CHATROOM_HIERARCHY` in `src/shared/chatroom-hierarchy.ts` is a hardcoded static tree (Global → Region → City). It should also live in Gun at a well-known path so any peer can read/subscribe to additions without a code deploy.

- [ ] On server startup, write `CHATROOM_HIERARCHY` to `gun.get('public/chatroom-hierarchy').put(JSON.stringify(hierarchy))` (idempotent).
- [ ] Add `shouldSkipServerGunPersist` exemption so this path IS persisted (it's shared public knowledge, not user-private).
- [ ] Browser: on boot, subscribe to `gun.get('public/chatroom-hierarchy')` and merge with the local static constant — remote wins for additions; local constant is the safe fallback.
- [ ] Unit test: server write → browser read produces the same tree as the static import.

### P2 — TechSupport root identity bootstrap

The TechSupport root user ID and public key (`TECHSUPPORT_ROOT_USER_ID`, `TECHSUPPORT_PUB`) are currently constants in `src/shared/techsupport.ts`. They should also be announced in Gun so a new peer can verify them without trusting the bundle.

- [ ] Write `{ userId, pub, epub, role: 'techsupport' }` to `gun.get('public/techsupport-identity')` signed with the TechSupport SEA key on server startup.
- [ ] Browser: on boot, read `public/techsupport-identity`, verify signature, and cross-check against the compiled constant — mismatch triggers a visible security warning.
- [ ] E2E: assert that a fresh browser without the compiled constant can discover TechSupport identity solely from the Gun path.

### P3 — Location-based chatroom auto-join hints

When a user grants location access, the app should suggest or auto-join the most specific matching chatroom from the hierarchy.

- [ ] `getCurrentLocation()` (`src/shared/location.ts`) → `LocationPrivacy.blurLocation()` → walk `CHATROOM_HIERARCHY` to find the best-match city/region room.
- [ ] Write the user's blurred chatroom affinity to `gun.get('user-public-profile/<userId>').get('chatroomAffinity')` so peers in the same room can discover them.
- [ ] UI: on first location grant, show "Suggested room: [City]" banner with one-click join.
- [ ] Gun path `public/room-member-counts/<roomId>` maintained by server presence heartbeat — browser reads it to show live member counts in the room list without a separate HTTP call.

### P4 — System announcements channel

TechSupport needs a broadcast channel for maintenance notices, rule changes, and safety alerts that every peer sees without a DM conversation.

- [ ] Gun path `public/announcements` — append-only list of `{ id, authorPub, text, createdAt, expiresAt, signature }`.
- [ ] Server-side: `POST /api/admin/announcements` (TechSupport-auth only) writes + signs a new entry.
- [ ] Browser: on boot subscribe to `gun.get('public/announcements').map().on(...)`, render unexpired entries as a dismissible banner above the chatroom list.
- [ ] `shouldSkipServerGunPersist` exemption so announcements ARE hub-persisted (public, not user-private).
- [ ] Unit test: announcement with expired `expiresAt` not rendered; invalid signature rejected.

---

## Massive Talks Exchange E2E `[Sonnet]`

High-volume multi-user E2E scripts stress-test the mesh delivery, match engine, and stats pipeline beyond the current 2–3 user specs.

### M1 — Flow talks: branching-path mass exchange

`tests/e2e/mass/01-flow-mass-exchange.spec.ts`

Scenario: 10 users in the same chatroom; creator broadcasts a 4-question flow talk with 3 branching paths (match / ignore / neutral). Each non-creator user follows a different answer path. Assert:
- [ ] All 9 responses received by creator (Gun ledger + HTTP `/api/incoming-talks` agrees).
- [ ] Correct subset of users matched (those whose final answer has `isMatch: true`).
- [ ] Correct subset ignored.
- [ ] `buildConversationDigest` / reconcile sync completes for each matched pair within `P2P_E2E_TIMEOUT_MS`.
- [ ] No duplicate conversations created (idempotent `conv_<sorted>_<talkId>` key).
- [ ] Stats: `matchRate` in local ledger equals `matches / totalResponses`.

Seed helper: extend `talks-matching-flow.ts` with `broadcastFlowTalkToN(page, n, branchMap)` where `branchMap` maps user index → answer sequence.

### M2 — Survey talks: aggregate correctness under load

`tests/e2e/mass/02-survey-mass-exchange.spec.ts`

Scenario: 15 users; one survey talk with 5 questions, each with 4 answer options. Each user submits a randomly seeded answer vector (deterministic via `userId` hash so the test is reproducible). Assert:
- [ ] All 14 responses recorded in `localTalkExchanges`.
- [ ] `summarize(responses)` `byQuestion[i].skipCount` + `byQuestion[i].answerCounts` totals equal 14.
- [ ] `completionRate` for each question equals `(14 - skipCount) / 14`.
- [ ] `aggregateCrossQuestion` co-occurrence table is symmetric: `coOccurrence[a][b] === coOccurrence[b][a]`.
- [ ] Time-range filter (7d) returns all 14 (all submitted within the test run).
- [ ] CSV export row count equals response count.

### M3 — Route talks: DAG traversal correctness

`tests/e2e/mass/03-route-mass-exchange.spec.ts`

Scenario: 8 users; one route talk modelled as a binary DAG (depth 3, 7 terminal nodes). Each user follows a unique root-to-leaf path. Assert:
- [ ] Each user reaches a distinct terminal node.
- [ ] Terminal nodes marked `isMatch`/`isIgnore` correctly route each user into the matched or ignored set.
- [ ] No user is stuck in a cycle or hits an undefined `next` pointer (timeout guard: 10s per user).
- [ ] `computeTalkIdFromTalkData` (`src/shared/talk-content-id.ts`) produces the same id on creator and all responders — content-hash dedup verified across 8 instances.

### M4 — Mixed-type saturation test

`tests/e2e/mass/04-mixed-saturation.spec.ts`

Scenario: 20 users; creator broadcasts one of each type (flow, tag, survey, route) in sequence. Assert:
- [ ] All 4 talks delivered to all 19 non-creators (76 total delivery events) within 30s.
- [ ] No cross-talk contamination: responses to talk A do not appear in talk B's ledger.
- [ ] Mesh flood stats: `PeerMeshService` `ping/pong` round-trips complete for all 20 users (full mesh within `maxNeighbors=12` cap; assert ≥12 neighbors per node for a 20-node graph).
- [ ] Memory: Gun graph size (measured via `gun.get('talks').once()` key count) does not grow unboundedly after test — `shouldSkipServerGunPersist` verified by checking hub radata is empty for talk bodies.

## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Relay-only hub (RELAY_ONLY_HUB=1)
npm run test:e2e:parallel     # Full E2E suite in direct mode
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.

---

## Appendix A — Detailed backlog inventory `[Haiku]` — AUDITED (2026-06-12)

> Consolidated 2026-06-08 from `docs/TODO-backlog-inventory.md` (archived). Full acceptance closure audit completed 2026-06-12; all major items verified shipped and working correctly. See `docs/completed.md` for detailed audit findings.

**Audit summary (see completed.md for full details):**

| Area | Status | Finding |
|------|--------|---------|
| **Contacts** | ✓ VERIFIED | Stranger/undefined state on first contact; relationship labels filter/sort/save/reload work correctly (8 tests passing); profile parity complete |
| **Talks** | ✓ VERIFIED | D4 matrix complete: tag/flow/survey/route validation (1108 test lines); language edit, creator/recipient transitions, diagnostics all shipped |
| **Me Tab** | ✓ VERIFIED | Profile editing parity, preferences modes, per-answer ownership, durable reply review all working |
| **Settings** | ✓ VERIFIED | Localization/filter behavior, storage/transport diagnostics (TechSupport/room-visits/language/SEA/P2P flags) complete |
| **Conversation/Peer Detail** | ✓ VERIFIED | Transport status, privacy verification, history/search controls shipped |
| **TechSupport Root** | ✓ VERIFIED | Singleton identity, anti-impersonation, global anchor, support-channel, privacy constraints all implemented |
| **E2E Stage Pipeline** | ✓ VERIFIED | TechSupport baseline seeding, parallel isolation, single-user→Stage 0 consolidation complete |

**Deferred forward work:**
- Responder ranking enhancement (matched-talk/match-rate/relationship/recency/weighted) — covered by P2.5 sort-pipeline work; further strategy enhancements in future
- Custom chatroom detail metadata expansion (description/capacity/headline/owner/created/members/visits) — future feature gate
- Intake control richer dirty-word diagnostics and distance preamble polish — optional UX refinement
- Contextual statistics (cross-question correlation, completion rates, segment filters) — in Appendix B forward work

**Verification:** All 763 unit tests passing; type checking clean; no acceptance gaps or regressions detected.

## Appendix B — Statistics expansion backlog `[Sonnet]` — **COMPLETED 2026-06-13**

> All items shipped. See `docs/completed.md` for full details. Verification: `npx tsc --noEmit` clean; all 763 unit tests pass.

## Appendix C — Residual P2P transport & spec-gap follow-ups `[Haiku]` — AUDITED (2026-06-12)

> Consolidated 2026-06-08 from `docs/TODO-direct-p2p.md`, `docs/roadmap/spec-gap-matrix.md`, and `docs/reports/PROJECT_STATUS.md` (all archived). The direct-P2P transport stack shipped (see `docs/completed.md`); full audit completed 2026-06-12.

**Audit findings (see completed.md for details):**

- [x] Reputation/credit section visibility allowlists (FR-UM-7) — **Deferred** to next phase (requires design review).
- [x] Broader moderation UX and centralized reporting/appeal model (FR-BF / FR-SP) — **Deferred** (safety-critical, out of scope).
- [x] Production-durability review of in-memory stats indices, quota counters, rate-limit counters — **VERIFIED**: All intentionally ephemeral per spec; Gun-backed persistence deferred if requirements tighten. All 763 unit tests passing.
- [x] Statistics/visualization product polish (shipped dashboard/endpoints) — **Complete**; baseline live, forward aggregates in Appendix B.
- [x] Android: maintenance-only until web/server loop stable — **Acknowledged** (superseded by S3 below).

### S3 — Cross-platform native clients `[Opus]`

Add native builds that run a real libp2p node (TCP/QUIC), eliminating WebRTC signaling overhead for native↔native and exposing a Circuit Relay so browser peers can connect.

**Target platforms:** Windows, Linux, macOS desktop (Electron or Tauri); Android (WebView + Kotlin native module); iOS (WKWebView + Swift native module).

**Browser ↔ native-node connection design (chosen: hybrid):**
- Native↔native: libp2p direct TCP/QUIC via published multiaddrs in `Libp2pBindingRecord` (Gun path `p2p-peer-bindings/<userId>`, already spec'd).
- Browser↔native: native node runs `circuitRelayServer()` and includes the relay multiaddr in its `Libp2pBindingRecord`. Browser reads the record from Gun and dials via `@libp2p/webrtc` through that relay — no HTTP signaling needed.
- Browser↔browser: unchanged — Gun WebSocket + WebRTC with HTTP or Gun-pubsub signaling (see S2).

**Pieces to build:**
- [ ] Electron/Tauri shell (Windows/Linux/macOS): bundled libp2p node with `@libp2p/tcp`, `@libp2p/quic`, Circuit Relay v2 server, Kademlia DHT. Shares the same Gun hub WebSocket as the browser build.
- [ ] `Libp2pBindingRecord` extended with Circuit Relay multiaddr; published to Gun on startup; refreshed on address change.
- [ ] Browser-side dial upgrade: in `P2PRoomDiscoveryService.findRoomProviderPeerIds()`, if a peer has a `Libp2pBindingRecord` with a Circuit Relay addr, attempt `node.dialProtocol(peerId, '/iinpublic/mesh/1.0.0')` via the relay before falling back to Gun-WebRTC signaling.
- [ ] Android: WebView shell + Kotlin `Libp2pBridgeService` exposing a local WebSocket; same libp2p node logic as desktop.
- [ ] iOS: WKWebView shell + Swift `Libp2pBridgeService` over WKScriptMessageHandler; same circuit-relay logic.
- [ ] E2E spec: one browser peer + one native node in the same chatroom; exchange a talk and open a conversation; assert DataChannel opens through the Circuit Relay multiaddr from `Libp2pBindingRecord`.

**Known runtime risks (verified):**
- ✓ Gun replication timing on auto-reply path: Mitigated by server POST path.
- ✓ `talkCompleted` handler fallback: Verified, preserves data safely.
