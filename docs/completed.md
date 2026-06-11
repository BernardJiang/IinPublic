# IinPublic Completed Work

Last updated: 2026-06-08

## 2026-06-08 - Docs consolidation into four canonical files + archive

Reorganized the `docs/` tree so all content lives in four canonical buckets, moving the redundant
source documents to `docs/archive/`.

**Feature/design detail → spec (`docs/specs/iinpublic-technical-specifications.md`, renamed from singular):**
- Folded in `similar-people-scalable-srs.md` (new §22), `p2p-mesh-talk-delivery-plan.md` design (new §23), and `phase-d-dht-bootstrap.md` design (new §24).
- `specs.md` (v1.0 SRS + P2P + blockchain survey) confirmed fully subsumed by the canonical spec's §19/§20/§21 — archived without re-merge.

**Test detail → `docs/testing/testplan.md`:** added Appendix C (flake investigations & historical benchmarks, from `testing-benchmarks.md`, `P2P_nodes.md`, and root `test-12-flake-root-cause.md`), Appendix D (mesh test impact), Appendix E (statistics verification requirements).

**Future tasks → `docs/TODO.md`:** added Appendix A (detailed backlog inventory, from `TODO-backlog-inventory.md`), Appendix B (statistics expansion backlog, from `roadmap/statistics-expansion.md`), Appendix C (residual P2P transport + spec-gap follow-ups, from `TODO-direct-p2p.md`, `roadmap/spec-gap-matrix.md`, `reports/PROJECT_STATUS.md`).

**Retired status/audit facts captured here (sources archived):**
- Gun authority audit complete (`roadmap/talk-loop-authority.md`): stats, match counts, and conversation creation all go through the server; `getTalkWithRetry()` prefers the server (Gun cache-first check only, then authoritative server, then alternating retry — replacing the old 20× Gun-retry that cost up to 5s); client-side Gun conversation-creation fallback removed.
- Spec-gap matrix (`roadmap/spec-gap-matrix.md`) marked Implemented: profile foundation + viewer-filtered Q&A visibility; intake filters & moderation; reputation & abuse prevention; chatroom model expansion; tags & bulk-targeting; survey & statistics endpoints; rate limiting & cooldowns; exact chatbot memory.
- Project status (`reports/PROJECT_STATUS.md`): server `index.ts` and `ui-manager.ts` de-monolithed; talk loop HTTP-integration tested; statistics baseline live; P0 UI correction pass live.
- Direct-P2P transport stack (`TODO-direct-p2p.md`) shipped: `DirectP2PConversationTransport`, signaling client, WebRTC session, `ResilientConversationTransport` fallback chain (direct-p2p → server-relay → star-gun), LEDGER_STATE handshake, transport diagnostics, and Batch A–C E2E migration — only the full parallel-suite release gate remains (now in TODO Appendix C).

Removed/archived source files: `specs.md`, `TODO-backlog-inventory.md`, `TODO-direct-p2p.md`, `p2p-mesh-talk-delivery-plan.md`, `P2P_nodes.md`, `testing-benchmarks.md`, `roadmap/p2p-node-network.md`, `roadmap/phase-d-dht-bootstrap.md`, `roadmap/spec-gap-matrix.md`, `roadmap/statistics-expansion.md`, `roadmap/talk-loop-authority.md`, `reports/PROJECT_STATUS.md`, and root `test-12-flake-root-cause.md`.

## 2026-06-07 - P2P mesh talk delivery foundation behind `P2P_MESH_TALKS`

Converted `docs/p2p-mesh-talk-delivery-plan.md` into the active `docs/TODO.md` mesh checklist and landed the first implementation slice behind `P2P_MESH_TALKS=1`.

**Mesh transport + protocol:**
- Added `src/shared/p2p-mesh-protocol.ts` with signed origin-frame payloads for `mesh-ping`, `mesh-pong`, `talk-announce`, `talk-body-request`, `talk-body`, `talk-response`, and `ack`.
- Added `p2pMeshTalks` / `usesMeshTalkDelivery` runtime flag plumbing and webpack exposure for `P2P_MESH_TALKS`.
- Extended `P2PConversationSession` DataChannel frames with a `mesh` frame type and `sendMeshFrame`.
- Added `src/web/services/peer-mesh-service.ts`: room join/leave, bounded neighbor selection, signed origin verification, seen-set dedupe, TTL forwarding, diagnostics, ping, talk body cache, body pull, and mesh response routing.

**App integration:**
- Room member updates now refresh mesh neighbor sessions when the flag is enabled.
- Broadcast and directed talk sends use mesh `talk-announce` instead of `peerTalkOffers/*` when `P2P_MESH_TALKS=1`.
- Receivers request `talk-body`, run the existing receiver-side intake path, and populate the local incoming index from mesh bodies.
- Pair-private responses use mesh `talk-response` with `sea-ecdh-v1` ciphertext when the flag is enabled; author-side processing creates local matches/conversations from the single mesh response callback.
- Mesh mode skips `broadcast-receiver-preview`, `peerTalkOffers` subscription, pair Gun response writes, and server talk stats writes for the mesh response path.

**Verification:**
- `npm run test:type -- --pretty false`
- `npx jest src/test/unit/peer-mesh-service.test.ts src/test/unit/p2p-runtime.test.ts --runInBand`
- `npm run test:unit -- --runInBand` — 40 suites, 480 passed
- `npm run test:integration -- --runInBand` — 7 suites, 127 passed, 1 skipped
- `npm run lint`
- `npm run build:server`
- `npm run build:web` — clean with existing bundle-size warnings
- `npm run test:e2e:p0-talks` — 1 passed (legacy direct-Gun regression)
- In-app browser smoke loaded `http://localhost:3001` with `P2P_MESH_TALKS=1` into the main UI

## 2026-06-07 - TODO cleanup: moved shipped hub migration phases out of active queue

Moved the completed rows from the `docs/TODO.md` hub migration track into completed work so the active TODO only carries unfinished implementation.

| Phase | Completed status |
|-------|------------------|
| B Client-authoritative talks | Shipped |
| C Relay-only hub (no app `radata/`) | Shipped |
| E Pair-private ownership graph | Shipped |

Phase A remains partial and Phase D remains implementation-pending, so they were not recorded as completed items.

## 2026-06-06 - SRS v4.5 implementation: community ownership, challenge plugins, ICE audit, Phase D design

### FR-CR-11/12 — Community Ownership Model (Tasks #1 + #2)

**Shared domain (`src/shared/`):**
- `types.ts`: added `CommunityRole` (`owner | moderator | member | guest`) and `CommunityRoleRecord` interface.
- `chatroom-hierarchy.ts`: added `deriveCommunityId(ownerPub, label)` (content-addressed room IDs via `computeCIDv1Sync`), `getRoleCapabilities(role)`, `canAssignRole(actor, target)`, `chatroomRolePath(chatroomId, userId)`, `RoleCapabilities` interface.

**Server (`src/server/`):**
- `services/chatroom-manager.ts`: `createChatroom` now derives a content-addressed ID via `deriveCommunityId` and auto-assigns owner role; added `getRole`, `setRole`, `canUserBroadcast` methods.
- `routes/chatroom-routes.ts`: added `GET /api/chatrooms/:id/roles/:userId` and `PUT /api/chatrooms/:id/roles/:userId`; optional `resolveChallengeGate` hook wired into join route.
- `routes/talk-delivery-routes.ts`: added optional `chatroomManager` dep; broadcast route accepts `sourceChatroomId` and enforces guest-broadcast gate (FR-CR-12).
- `index.ts`: passes `chatroomManager` to `registerTalkDeliveryRoutes`.

**Tests:** `src/test/unit/community-ownership.test.ts` — 15 tests covering all new helpers.

### FR-CPF-01–05 — Challenge Plugin Framework (Task #3)

**New file:** `src/shared/challenge-plugins.ts`
- `ChallengePlugin` interface: `evaluate(action, context) → ChallengeResult`
- `runChallengeGate(action, context, config)`: AND/OR composable gate executor
- Built-in plugins: `RequireVerifiedIdentity`, `RequireTrustScore(threshold)`, `RequireInvitation`, `RequirePreviousInteraction`
- Plugin registry: `registerChallengePlugin`, `getChallengePlugin`, `listChallengePluginIds`

**Server wiring:** `chatroom-routes.ts` `join-community` gate via optional `resolveChallengeGate` dep; broadcast gate already in `talk-delivery-routes.ts` via `chatroomManager`.

**Tests:** `src/test/unit/challenge-plugins.test.ts` — 29 tests covering all plugins, AND/OR semantics, async plugins, registry, and FR-CPF-05 denial reason surface.

### §4.4 ICE candidate priority audit (Task #4)

- `p2p-webrtc-session.ts`: `defaultIceServers()` made `export`; added §4.4 reference comment documenting priority order (host > srflx > relay) and TURN opt-in via `E2E_WEBRTC_ICE_SERVERS`.
- **Tests:** `src/test/unit/p2p-ice-priority.test.ts` — 8 tests verifying STUN-only default, TURN opt-in, fallback on invalid JSON, and RTCIceServer shape.

### Phase D DHT Bootstrap design doc (Task #5)

- **New:** `docs/roadmap/phase-d-dht-bootstrap.md` — full design document: bootstrap service API (`GET /bootstrap/peers`, `POST /bootstrap/announce`, `GET /bootstrap/lookup/:userId`), TypeScript interface sketch, libp2p vs. Kademlia evaluation table with recommendation, `UserAddressLookup` interface, migration steps D-1–D-7, security considerations, and file list for Phase D implementation.

**Total new tests this session:** 52 (15 community-ownership + 29 challenge-plugins + 8 ICE-priority). All 478 unit tests pass.

---

## 2026-06-06 - SRS v4.5 + TODO cleanup: merged decentralized architecture additions

All items previously listed in `TODO.md` under "Shipped" are recorded below. New open items (FR-CR-11/12, FR-CPF, Phase D, connection priority) are tracked in `TODO.md`.

**SRS changes (v4.5):** Long-term decentralization vision (§2.1), explicit non-goals (§2.5), content-addressed community IDs FR-CR-11, community ownership FR-CR-12, context-aware answers clarification (§3.6.1), Challenge Plugin Framework §3.13, connection establishment priority (§4.4), future architecture diagram (§6.6), profile/identity separation (§19.13.2), Phase D peer discovery detail (§19.12), local node diagram (§19.5), protocol/UI separation (§17), future tech candidates (§16).

---

## 2026-06-04 - P2P-Y/Z: Handshake E2E coverage + relay-only hub hardening

### P2P-Y — E2E coverage for P2P-Q handshake frame (REQ-P2P-14/15)

**New E2E spec:** `tests/e2e/staged/stage2-two-user/00k-p2p-handshake.spec.ts`
- Two-peer test: after `prepareDirectP2PConversation`, both pages call `waitForHandshakeOk`; asserts `handshakeState: 'ok'`, `selectedProtocol: 'iinpublic-p2p-v1'`, and `failureReason: null`.
- In-browser negotiation test: `page.evaluate` runs `negotiateProtocol` with an incompatible remote protocol list; asserts `handshakeState: 'failed'` and `failureReason` matching `/no common protocol/`.

**New helper:** `getHandshakeDiagnosticsFromPage` and `waitForHandshakeOk` added to `tests/e2e/helpers/p2p-transport-e2e.ts`.

**Service plumbing:** `getHandshakeDiagnostics(conversationId, localUserId)` threaded through `DirectP2PConversationTransport` → `ResilientConversationTransport` → `WebConversationService` so E2E tests can read diagnostics from `app.conversationService`.

### P2P-Z — Hub Phase C: relay-only hub hardening (REQ-P2P-Hub-C)

**Modified:** `src/server/bootstrap/http-bootstrap.ts`
- Added `warnIfStaleRadataExists(cwd)`: logs a warning at startup if a `radata/` directory exists when `relayOnlyHub=true`; harmless no-op when the directory is absent.
- `attachGun` calls `warnIfStaleRadataExists()` automatically when `RELAY_ONLY_HUB=1`.
- Gun boot already sets `radisk: false` in relay-only mode; this change adds the operational guard.

**Modified:** `src/server/routes/system-routes.ts`
- Added `GET /api/debug/relay-only-status`: reports `relayOnlyHub`, `radiskEnabled`, `inMemorySignaling/relay/presence` flags.

**New integration test:** `src/test/integration/p2p-relay-only-hub.test.ts`
- Flag resolution, `shouldSkipServerGunPersist` for all app paths, `/api/debug/relay-only-status` responses, presence routes still work in relay-only mode, `warnIfStaleRadataExists` with/without radata/.

**Evidence:**
- `npx tsc --noEmit` — clean
- `npx jest --no-coverage` — 43 suites, 553 passed, 0 failures

## 2026-06-04 - P2P-V/W/X: Wire abuse defense, trust levels, and schema migrator into runtime paths

### P2P-V — Abuse defense wired into relay routes + client receive paths (REQ-P2P-20)

**Modified:** `src/server/routes/system-routes.ts`
- Replaced bare `Set<string>` nonce caches (`signalingNonces`, `relayNonces`, `discoveryNonces`, `peerAckNonces`) with `BoundedNonceCache` instances (LRU-evicting, 10k cap).
- Added a single `P2PAbuseDefenseContext` for the relay route scope.
- `POST /api/p2p/signaling`, `POST /api/p2p/conversation-relay`, `POST /api/p2p/discovery`, and `POST /api/presence/ack` all call `abuseCtx.checkInbound(peerId, pub)` before verification; demoted or rate-limited peers receive `429`.
- Added `GET /api/debug/p2p-abuse` endpoint (non-production) that returns `abuseCtx.getDiagnostics()`.

**Modified:** `src/web/services/p2p-webrtc-session.ts`
- Replaced unbounded `Set<string>` `dataChannelNonces` with `BoundedNonceCache`.

**New tests:** `src/test/integration/p2p-abuse-relay.test.ts` — rate-limit rejection (429) and nonce-replay rejection (400) on signaling and relay POST routes.

### P2P-W — Trust levels wired into neighbor cache + delivery filter (REQ-P2P-11/12/18)

**Modified:** `src/web/services/client-peer-talk-delivery.ts`
- `subscribePeerTalkOffers` and `reconcilePeerTalkOffersFromGun` now call the optional `checkTrust` hook (injected via `TrustGate`) before accepting an offer; callers that supply a gate that returns `false` for blocked senders silently drop the offer.

**Modified:** `src/web/services/web-user-service.ts`
- Added `getPeerTrustStore(): Promise<Map<string, PeerTrustRecord>>` and `putPeerTrustStore(store): Promise<void>` that read/write the SEA-encrypted `peerTrustStore` key under the user's private Gun path.

**New helper:** `src/shared/p2p-trust-neighbor-bridge.ts`
- `trustLevelFromNeighborRecord` — derives a `TrustLevel` from a `P2PNeighborRecord`.
- `neighborRecordWithTrust` — applies a `PeerTrustRecord.trustLevel` to a neighbor record via `toLegacyTrustStatus`.

**New tests:** `src/test/unit/p2p-trust-neighbor-bridge.test.ts` — blocked/friend/verified mapping, capability gate enforcement.

### P2P-X — Schema migrator wired into boot paths (REQ-P2P-13/16)

**Modified:** `src/server/index.ts`
- `initializeServices()` calls `runStartupMigrations` on Gun-loaded neighbor cache, presence, and conversation records; logs pending-migration counts via `logger.info`.

**Modified:** `src/web/services/web-gun-service.ts`
- Added `migrateOnRead<T>(kind, record)` helper that calls `migrateRecord` before returning a Gun-loaded record to callers.

**New tests:** `src/test/unit/p2p-schema-boot.test.ts` — verifies v0 records are transparently upgraded when read through `migrateOnRead`; startup migrator logs correct pending counts.

**Evidence:**
- `npx tsc --noEmit` — clean
- `npx jest --no-coverage` — 42 suites, 541 passed, 0 failures

## 2026-06-04 - P2P-Q/R/S/T/U: Handshake, Trust, Schema Migrations, Upgrade Verification, Abuse Defense

Implemented the five SRS §19.13 / REQ-P2P-14–20 items identified in the SRS audit.

### P2P-Q — Signed Handshake + Protocol/Feature Negotiation (REQ-P2P-14/15)
**New file:** `src/shared/p2p-handshake.ts`
- `buildHandshakePayload` — constructs `{ appName, appVersion, supportedProtocols, features, peerId, publicKey, timestamp }`.
- `negotiateProtocol` — selects the highest common protocol; fails cleanly when lists are empty or have no overlap; ignores unknown remote features without crashing.
- `validateHandshakePayload` — validates required fields and timestamp skew; returns typed result.
- `buildHandshakeDiagnostics` — snapshot of selected protocol, unsupported features, and handshake state.

**Modified:** `src/web/services/p2p-webrtc-session.ts`
- On DataChannel `open`, sends a signed `handshake` frame before `ledger-state`.
- Incoming `handshake` frame triggers `negotiateProtocol`; result stored as `HandshakeDiagnostics` accessible via `getHandshakeDiagnostics()`.
- `HandshakeWirePayload` added to `ChannelFramePayload` union.

**Tests:** `src/test/unit/p2p-handshake.test.ts` — compatible, downgraded, unsupported, malformed, and diagnostics cases.

### P2P-R — Local Trust Levels + Capability Gating (REQ-P2P-11/12/18)
**New file:** `src/shared/p2p-trust.ts`
- `TrustLevel: 'unknown' | 'friend' | 'verified' | 'blocked'` — four-level model.
- `CAPABILITY_TRUST_REQUIREMENTS` — per-capability minimum trust level table.
- `isTrustCapable` / `capabilitiesForTrustLevel` — gate capabilities; blocked peers are always denied.
- `applyTrustLevelChange` — promotes/demotes with source (`'user'` | `'reputation'`); reputation cannot override user-set blocks or demote below a user-set friend/verified level.
- `toLegacyTrustStatus` — backwards-compatible bridge to `P2PNeighborTrustStatus`.
- Import/export helpers (`upsertPeerTrustRecord`, `exportTrustStore`, `importTrustStore`) with idempotency guarantee.

**Tests:** `src/test/unit/p2p-trust.test.ts` — unknown defaults, promotion/demotion, verified behavior, block precedence, reputation constraints, round-trip export.

### P2P-S — Schema Versions + Deterministic Migration Registry (REQ-P2P-13/16)
**New file:** `src/shared/p2p-schema-migrations.ts`
- `SCHEMA_VERSIONS` — version constants for presence, peerOffer, catalogRecord, pairResponse, pairConversation, knownPerson, neighborCache, ledgerEvent, localInIndex, localOutIndex, peerTrustRecord, handshakeRecord.
- `MIGRATION_REGISTRY` — v0→v1 migration steps for every kind.
- `migrateRecord` / `migrateRecords` — deterministic, idempotent per-record migration.
- `inspectSchemaVersions` — diagnostics showing stored versions and pending migration count.
- `runStartupMigrations` — applies all pending migrations across a full store and returns a diagnostic summary.

**Tests:** `src/test/unit/p2p-schema-migrations.test.ts` — v1→current migration, no-op re-run, preserves fields, all kinds covered, startup diagnostics.

### P2P-T — Signed Upgrade Verification (REQ-P2P-17)
**New file:** `src/shared/p2p-release-verification.ts`
- `ReleaseManifest` — `{ manifestVersion, version, packageHash, signature, signerKeyId, minSupportedProtocol, minSchemaVersion, builtAt }`.
- `TrustStoreEntry` — signer key record with validity window.
- `createReleaseManifest` — validated factory.
- `manifestSigningPayload` — deterministic canonical payload (excludes `signature`).
- `verifyReleaseManifest` — checks required fields, resolves signer from trust store, validates key validity window, verifies SEA signature, checks package hash, rejects downgrades.
- `isDowngrade` — numeric semver comparison.

**Tests:** `src/test/unit/p2p-release-verification.test.ts` — valid manifest, unknown signer, bad signature, hash mismatch, downgrade, expired key, not-yet-valid key, same-version (not downgrade).

### P2P-U — Fake-Client Defense + Replay/Rate Controls (REQ-P2P-20)
**New file:** `src/shared/p2p-abuse-defense.ts`
- `BoundedNonceCache` — LRU-evicting cache (default 10 000 entries) implementing `P2PReplayNonceCache`; usable on server relay routes and client receive paths.
- `P2PRateLimiter` — sliding-window rate limiter keyed by peer id, pub, or IP.
- `SuspiciousPeerTracker` — per-peer counters for duplicate nonce, malformed payload, stale timestamp, wrong peer id, rate-limit exceeded, blocked-peer attempt; auto-demotes at configurable threshold; exposes non-secret diagnostics.
- `classifyRejectionReason` — maps `verifySignedP2PEnvelopeProof` failure strings to `SuspiciousPeerReason`.
- `P2PAbuseDefenseContext` — bundles nonce cache + rate limiter + tracker; `checkInbound` is the single call-site for relay routes and peer receive paths.

**Tests:** `src/test/unit/p2p-abuse-defense.test.ts` — duplicate nonce, eviction, rate-limit flood, stale timestamp, blocked-peer attempts, priority downgrade, diagnostics exposure.

**Evidence:**
- `npx jest p2p-handshake p2p-trust p2p-schema-migrations p2p-release-verification p2p-abuse-defense` — 5 suites, 109 passed

## 2026-06-04 - P2P-P: Canonical PeerID + Signed P2P Envelopes

Implemented canonical signed envelope proofing for current direct P2P metadata and relay surfaces.

**Changes:**
- Added shared deterministic payload serialization, `peerId = SHA-256(pub)`, payload hashing, SEA signing, SEA verification, and replay nonce-cache helpers.
- Signaling, conversation relay, discovery, and presence ack server routes now reject missing, tampered, stale, wrong-peer, invalid-signature, and duplicate-nonce envelopes.
- Browser signaling and conversation-relay polling verifies fetched envelopes before decode/delivery.
- WebRTC DataChannel `ledger-state` and DM notify frames are wrapped in signed frames and verified before handling.
- WebRTC signaling POSTs and server-relay conversation messages now sign with the local SEA pair.
- Direct peer talk offers now carry signed sender metadata (`senderPub`, `senderPeerId`, timestamp, payload hash, signature, nonce), and incoming offer subscribe/reconcile paths verify before accepting.
- Updated E2E discovery/signaling fixtures to use real SEA signatures instead of placeholder `sig_*` strings.

**Evidence:**
- `npm run test:type` clean
- `npm run lint` clean
- `npm run test:unit` — 29 suites, 296 passed
- `npm run test:integration` — 5 suites, 110 passed, 1 skipped
- `npx jest src/test/unit/peer-talk-delivery.test.ts src/test/unit/p2p-runtime.test.ts src/test/unit/p2p-presence.test.ts src/test/unit/p2p-signaling-client.test.ts src/test/integration/system-routes.test.ts --runInBand` — 47 passed
- `npm run build:server` clean
- `npm run build:web` clean (existing bundle-size warnings)
- `P0_DIRECT_TALK_DELIVERY=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/00i-p0-direct-talk-delivery.spec.ts tests/e2e/staged/stage1-single-user/00-p2p-conversation-transport.spec.ts tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts` — 3 passed

## 2026-06-04 - TODO cleanup: P1 moved out of active queue

Moved the completed P1 ownership-graph focus, exit criteria, and audit evidence out of `docs/TODO.md`. The active TODO now starts from the next SRS gap: §19.13 / REQ-P2P-09–20 identity, trust, versioning, upgrades, and fake-client defense.

**P1 completion evidence preserved here:**
- Direct-mode E2E exercises client pair writes instead of `POST /api/talks/:id/response`.
- Server response endpoint rejects direct-mode answer submission.
- `test:e2e:parallel` defaults to direct mode.
- Direct-mode peer offers are catalog-ref metadata without duplicated full `talkData`.
- Direct-mode local IN writes use `ownerIncomingTalkIndex` instead of public `incomingTalksByUser`.
- Pair response payloads under `pairTalkResponses/<pairId>/...` are pair-scoped SEA ciphertext with routing metadata only.
- Non-TechSupport conversation bodies write to pair-scoped encrypted paths in direct mode.
- Direct-mode Creator Replies, relationship stats, and talk-history server APIs no longer expose hub-derived pair history.
- Chatroom delivery writes metadata announcements to `chatrooms/<room>/announcements/*`; legacy `talks` read fallback remains for migration.
- Third-party isolation E2E proves Bob/Alice/Tom response and DM ciphertext isolation plus one canonical talk body.

**Verification:**
- `npm run test:e2e:parallel` — 96 passed, 2 skipped

## 2026-06-04 - Pair-direct response encryption stabilization

Fixed a direct-mode race where responders could receive a talk offer before `users/<authorId>` had replicated, causing pair response encryption to fail while looking up the author's public encryption key.

**Changes:**
- Peer talk offers now carry the sender SEA `epub` as metadata.
- Chatroom announcements carry `authorEpub` when available.
- Hydrated incoming talk records preserve `authorEpub` for direct response completion.
- Pair response encryption first uses the delivery key hint, then falls back to bounded public-user retries for legacy records.

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit -- peer-talk-delivery` — 29 suites, 294 passed
- Focused P2P E2E batch — 11 passed
- `npm run test:e2e:parallel` — 96 passed, 2 skipped

## 2026-06-04 - P1-6b/P1-7: Encrypted pair-private direct graph

Direct-mode talk answers and non-TechSupport conversation bodies now use pair-scoped SEA ciphertext with raw Gun nodes limited to routing metadata.

| Item | Deliverable |
|------|-------------|
| P1-6b | `pairTalkResponses/<pairId>/<talkId>/<responseId>` stores encrypted answer payloads; sender subscriptions decrypt before match/contact processing. |
| P1-7 | Direct conversations write encrypted bodies to `pairConversations/<pairId>/<conversationId>/messages/*`; legacy public conversation message paths are avoided in direct mode. |
| E2E | P0 direct delivery asserts encrypted pair responses; messaging E2E asserts pair conversation ciphertext and no legacy `conversations/<id>/messages` storage. |

**Evidence:**
- `npm run test:type` clean
- `npm run test:e2e:p0-talks` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/09-messaging.spec.ts` — 1 passed

## 2026-06-04 - P1 Ownership Graph Closure

Completed the remaining P1 ownership-graph action items from `docs/TODO.md`.

| Item | Deliverable |
|------|-------------|
| P1-9 | Added Bob/Alice/Tom third-party isolation E2E. Bob broadcasts one canonical talk to Alice and Tom; Alice answers and DMs Bob; Tom cannot decrypt Alice/Bob pair payloads; raw response/DM nodes contain ciphertext only. |
| P1-3b | Direct-mode room delivery now writes metadata to `chatrooms/<room>/announcements/*`; subscribers keep a legacy `talks` fallback for migration. |
| P1-8 | Direct-mode Creator Replies, peer relationship, and talk-history APIs no longer expose hub-derived `talkResponsesMap` pair history; direct-mode snapshots omit/import no `talkResponses` application history. |
| P1-2b | Added `createOwnershipEnvelope` with `visibility: 'room' | 'user' | 'pair'`, required `roomId` / `ownerPub` / `pairId`, encrypted-payload enforcement, and deprecated-path rejection. |

**Evidence:**
- `npm run test:type` clean
- `npx jest src/test/unit/p2p-runtime.test.ts --runInBand` — 21 passed
- `npx jest src/test/integration/peer-routes.test.ts --runInBand` — 27 passed
- `npm run test:e2e:p0-talks` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage3-three-user/00j-pair-private-isolation.spec.ts` — 1 passed
- `npm run test:unit` — 29 suites, 294 passed
- `npm run test:integration` — 5 suites, 110 passed, 1 skipped
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/15a-blocking-unblock-resumes-talk-delivery.spec.ts` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts` — 1 passed
- `npm run test:e2e:parallel` — 96 passed, 2 skipped
- `npm run health` clean

## 2026-05-30 - P0: Direct browser talk exchange (spec §19.2 / §19.12 Phase B)

Two browsers deliver talks over Gun mesh; server skips authoritative inbox and talk-body persistence when `P0_DIRECT_TALK_DELIVERY=1` or `RELAY_ONLY_HUB=1`.

| Item | Deliverable |
|------|-------------|
| P0-1 | `shouldSkipServerGunPersist` for `talks/*`, `incomingTalksByUser/*`, `peerTalkOffers/*`, `peerTalkCatalog/*`, `chatrooms/*/talks/*` |
| P0-2 | `peerTalkOffers/<receiverId>/<sender::talkId>` fanout; `publishPeerTalkOffer` / `subscribePeerTalkOffers` |
| P0-3 | Local-first IN: `collectLocalIncomingTalkClusters`, `upsertLocalIncomingTalkCluster` |
| P0-4 | Server gates: empty `GET incoming-talks`, skip `register-receivers` / `POST received` inbox writes |
| P0-5 | `peerTalkCatalog/<authorId>/<talkId>` + `resolveTalkFromPeerMesh` for chatroom announce → pull |
| P0-6 | E2E `00i-p0-direct-talk-delivery.spec.ts`; `npm run test:e2e:p0-talks`, `npm run dev:p0-talks` |

**E2E reliability:** browser flag via `/?e2e_p0_talks=1` (`resolveP2PRuntimeFlags` + `webAppURLStableChatroom`) so P0 mode does not depend on webpack compile-time env alone.

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit` — peer-talk-delivery, p2p-runtime (incl. URL param)
- `npm run test:integration` — register-receivers skip when P0 env set
- `npm run test:e2e:p0-talks` — 1 passed

## 2026-05-28 - P2P stack phases I–O (production relay model)

Implemented remaining stack phases from spec §19.9 (no UI changes).

| Phase | Deliverable |
|-------|-------------|
| P2P-I | `POST/GET /api/presence/*`, signed peer ack, `P2PPresenceClient` heartbeat in `app.ts` |
| P2P-J | Worker Gun bridge IndexedDB persistence (existing `public/worker.js` idb adapter) |
| P2P-K | `shouldSkipServerGunPersist` + `GunService.putPath` skip for peer DM paths when ephemeral/`RELAY_ONLY_HUB` |
| P2P-L | `mirrorIncomingTalkClustersToLocalGun` + `mirrorTalkDefinitionToLocalGun` |
| P2P-M | `RELAY_ONLY_HUB` flag, `npm run dev:relay-only`, production presence/signaling routes |
| P2P-N | `TechSupportMessageStore`, `/api/support/messages/*`, `TechSupportConversationTransport` |
| P2P-O | `P2PLocalNodeBridgeClient` probes `/api/p2p/local-node` when `P2P_NODE_ENABLED=1` |

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit` — 280 tests pass (incl. `p2p-presence.test.ts`)
- `npm run test:integration` — presence + TechSupport routes in production mode

## 2026-05-28 - P2P-H: Gun write-through on direct P2P transport

Direct conversation transport now persists DM bodies to local Gun before/alongside WebRTC notify (spec §19.4, REQ-P2P-01).

**Key changes:**
- `StarGunConversationTransport`: `buildAndPersistMessage`, `putMessageRecord`
- `DirectP2PConversationTransport`: Gun store authoritative; subscribe via Gun; WebRTC `onRemoteDm` write-through
- `p2p-webrtc-session`: `onRemoteDm` hook; `sendDm` accepts pre-persisted wire
- Diagnostics: `messageBodyStorage: 'gun-local'` when `P2P_DIRECT_CHAT_ENABLED=1`
- E2E: `assertGunStoredMessageBodies` replaces hub-leak assertion in `09-messaging`

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit` — `direct-p2p-conversation-transport.test.ts`, `p2p-runtime.test.ts`

This is the durable ledger for shipped feature work. Keep `TODO.md` focused on forward work:
when an item is finished, move it here with a short description and concrete evidence.

## Maintenance Rule

- Move completed TODO items from `docs/TODO.md` into this file.
- Include the date, feature/phase name, user-visible result, and verification evidence.
- Keep detailed design and future work in the relevant spec or roadmap doc.
- If a completed item later needs more work, add a new TODO entry instead of editing history.

## 2026-05-28 - Spec §19 production P2P model + TODO realignment

Documented authoritative architecture for `www.iinpublic.com` relay-only hub, Gun-local persistence, transport/persistence split, TechSupport server exception, and stack phases P2P-H–O (no UI changes).

**Evidence:**
- `docs/specs/iinpublic-technical-specifications.md` v4.1 — §19 rewritten
- `docs/TODO.md` — forward work is P2P-H–O per spec
- `docs/TODO-direct-p2p.md` — marked superseded for persistence policy

## 2026-05-30 - Direct P2P transport slice (persistence superseded by spec §19.4)

Shipped WebRTC conversation transport infrastructure. **Persistence policy superseded:** production target is Gun write-through on device (P2P-H), not RAM-only DataChannel storage.

**Shipped:**
- `DirectP2PConversationTransport`, `p2p-signaling-client`, `p2p-webrtc-session`
- `ResilientConversationTransport` fallback chain (direct → server-relay → star-gun)
- LEDGER_STATE handshake on DataChannel open (REQ-LEDGER-06)
- `/api/p2p/signaling/*`, `/api/p2p/conversation-relay/*`, `/api/p2p/transport-diagnostics`
- E2E helpers and migration for messaging/match specs (`docs/TODO-direct-p2p.md` Phases 0–5)

**Evidence:**
- `npm run test:type` clean
- E2E: `00-p2p-conversation-transport`, `09-messaging`, `12-two-responders-partial-match`
- Full checklist: `docs/TODO-direct-p2p.md` (optional `test:e2e:parallel` gate still open)

## 2026-05-30 - Direct P2P: fallback chain, LEDGER_STATE, relay API

Completed remaining `docs/TODO-direct-p2p.md` items except the full `test:e2e:parallel` gate.

**Transport fallback:** `ResilientConversationTransport` wraps direct WebRTC → encrypted `ServerRelayConversationTransport` (`/api/p2p/conversation-relay/*`) → `StarGunConversationTransport`. Fallback events POST to `/api/p2p/transport-diagnostics`; UI updates via `updateConversationTransportMode`.

**LEDGER_STATE (REQ-LEDGER-06):** `p2p-webrtc-session.ts` exchanges `{ type: 'ledger-state', feeds }` on DataChannel open before DMs; wired to `WebLedgerService.syncWithPeer` from `app.ts`.

**Evidence:**
- `npm run test:type` clean
- Unit + integration tests pass (including new signaling two-peer + conversation-relay tests in `system-routes.test.ts`)
- E2E: `00-p2p-conversation-transport`, `09-messaging`, `12-two-responders-partial-match` pass

## 2026-05-29 - Fix 7 Failing E2E Tests (Post-Phase-G Regressions)

After Phase G shipped CIDv1 talk IDs, 7 E2E tests regressed. Root causes and fixes:

**`src/shared/incoming-talk-ids.ts`** — `isValidTalkId` and `isTalkIdMapKey` only accepted UUID and `qa_` formats. Added `TALK_CIDv1_ID = /^b[a-z2-7]{50,}$/` and wired it into both functions. This fixed `pickLatestTalkIdFromIncomingCluster` silently returning `''` for CIDv1 IDs, which caused `loadFullTalkViaIncomingIdentity` to return `null` and the response modal to never open. Fixed: `00i` (survey analytics dashboard), `00aa` (survey multi-responder lifecycle), `00ab` (route multi-responder lifecycle).

**`src/web/app/app.ts`** — Removed `audiencePreviews.length > 0 &&` guard from broadcast preamble check. Single-user broadcasts (0 eligible receivers) were skipping `confirmBroadcastAudience`, so the preamble modal never appeared. Fixed: `00z` (Chinese edge notifications / broadcast preamble).

**`src/web/ui/contacts-view.ts`** — Changed `formatRelationshipLabel(known, deps)` (returned "No relationship set" when `known` is undefined) to `known?.label ? formatRelationshipLabel(known, deps) : deps.text('stranger')`. Fixed: `00ae` (contacts stranger relationship default label).

**`src/web/ui/ui-manager.ts`** — Added group-field pre-sort at the top of the comparator in `renderCreatorReplies`. Without it, rows sorted by date interleaved responders across date buckets, producing N×M duplicate group headers (16 instead of 4 in the failing test). Fixed: `00ad` (reply triage group-by date).

**`tests/e2e/staged/stage3-three-user/03-chatbot-bot-badge.spec.ts`** — Widened `talkId` assertion regex from `/^qa_[0-9a-f]{8}$/i` to `/^(qa_[0-9a-f]{8}|b[a-z2-7]{58,})$/i` to accept CIDv1 IDs. Fixed: `03` (chatbot bot badge).

Evidence:
- `npx tsc --noEmit` → no errors
- Commit `a6c8b77f84aabd8f931c13808ff749972eb2e798`

## 2026-05-28 - Phase G: Conversation sub-DAG with prevSeen field (REQ-LEDGER-08)

Added two-writer DAG link to the conversation message layer.

Key changes:
- `src/shared/types.ts`: `Message.prevSeen?: string` — the `id` of the last message from the *other* participant the sender had observed when composing this message. Creates a causal DAG edge per message enabling offline merge and ordering without a central sequencer.
- `src/web/services/web-conversation-service.ts`:
  - `StarGunConversationTransport.lastSeenFromOther` Map keyed by `${conversationId}:${myUserId}` tracks the latest incoming message id from the other party.
  - `sendMessage()` reads `lastSeenFromOther` and includes `prevSeen` in the Gun message payload.
  - `subscribeToMessages(conversationId, callback, myUserId?)` and `collectAndDecryptMessages(..., myUserId?)` accept optional `myUserId`; after each message batch, update `lastSeenFromOther` for every message whose `senderId !== myUserId`.
  - `prevSeen` field carried through `collectAndDecryptMessages` and returned in the `Message` array.
  - `ConversationTransport` interface updated to document the optional `myUserId` parameter.
- `src/web/app/app.ts`: `subscribeToMessages(data.conversationId, callback, this.currentUser?.id)` — seeds the tracker from the first batch.

Evidence:
- `npx tsc --noEmit` → no errors
- Commit `fd61f6d671b603272c15ce13fe4eab3b4c5492d7`

## 2026-05-28 - Phase G: Remove Legacy Gun Dual-Writes

Removed the last legacy `talkAnswerTemplateByUser/<userId>/<identityKey>` Gun write that was still firing on every talk answer.

Key changes:
- `src/server/index.ts` `saveUserAnswerTemplateByContent`: removed `gunService.putPath(['talkAnswerTemplateByUser', responderId, identityKey], ...)`. Instead, now sets `cluster.isAnswered = true` and `cluster.isAutoAnswered = isAuto` directly on the in-memory `incomingTalksMap` cluster for the responderId.
- `src/server/routes/talk-delivery-routes.ts` `/api/incoming-talks`: removed Gun `getPath` read per cluster entry. `isAnswered` and `isAutoAnswered` are now read from `cluster.isAnswered` / `cluster.isAutoAnswered` (populated above), eliminating one Gun read per incoming talk in the list response.
- `incomingTalksByUser` writes: already absent (server-side Map is sole authority; confirmed via comment at server/index.ts:599-601).
- Per-question cache (`byQuestion/<cidKey>`) continues to be written by talk-delivery-routes.ts after `fanoutResponseToSenders` (Phase E, unchanged).
- Exact chatbot memory path (primary auto-reply) unaffected.

Evidence:
- `npx tsc --noEmit` → no errors
- Commit `0f8d7f6ca72d30d651c83adc5c262389906c1ac3`

## 2026-05-28 - Phase G: CIDv1 for All Entity IDs — Consolidate talk-content-id.ts into cid.ts

All exports from `src/shared/talk-content-id.ts` moved into `src/shared/cid.ts`. New `computeTalkCIDv1` async function added using real SHA-256 CIDv1.

Key changes:
- `src/shared/cid.ts` now exports all talk-content-id.ts functions: `TalkContentIdOptions`, `normalizeIdentityText`, `hashIdentityPayload`, `buildIdentityPayloadFromTalk`, `computeTalkIdFromTalkData`, `buildTalkIdentityKey`, `canonicalIdentityKeyFromStoredCluster`
- `computeTalkCIDv1(talkData)` — new async function using `computeCIDv1`; produces real CIDv1 IDs for talk creation
- `web-talk-service.ts createTalk`: switched to `await computeTalkCIDv1` 
- `server/talk-service.ts createTalk`: switched to `await computeTalkCIDv1`
- All other call sites (ui-manager, app.ts, talk-engine, flattened-answer-keys, server/index) updated to import from `cid.ts`
- `talk-content-id.ts` replaced with a `@deprecated` re-export shim (filesystem mounted read-only, actual deletion deferred)
- Tests updated to import from `cid.ts`

Evidence:
- `src/shared/cid.ts` — full consolidation + computeTalkCIDv1
- `src/shared/talk-content-id.ts` — deprecated re-export shim
- All import sites updated
- Commit: 284d0b2

## 2026-05-28 - Phase F: Chatbot Differential Answering Review Screen (REQ-CHATBOT-02–04)

Review screen added to `talk-response-dialog.ts` to prevent silent auto-submit when all questions can be auto-answered.

Key changes:
- `tryCollectAllAutoAnswers()`: pre-scans the talk question chain using `resolveAnswerPreferenceForTalkQuestion`. Returns the full auto-answer set if every question resolves with `mode === 'auto'`, or null if any question is unanswered or the talk is a route (branching).
- Review screen triggered when all questions are auto-fillable OR when `isTalkSuperseded` flag is set.
- Pre-filled answers displayed grayed out with `(pre-filled)` label; user can override any choice via radio selection.
- `Confirm & Submit` validates all questions are answered before calling `completeTalk`.
- `Edit answers manually` closes review and reopens with `skipAutoAnswer: true` for the standard interactive flow.
- TALK_SUPERSEDED banner: "[Sender] updated this talk. Your previous answers are pre-filled — please review and answer any new questions."
- `isTalkSuperseded` and `senderName` added to `TalkResponseDialogOptions` and threaded through `ui-manager.showTalkResponseDialog`.

Evidence:
- `src/web/ui/talk-response-dialog.ts` — tryCollectAllAutoAnswers, review screen, TALK_SUPERSEDED banner
- `src/web/ui/ui-manager.ts` — isTalkSuperseded + senderName opts in showTalkResponseDialog
- Commit: c28114c

## 2026-05-28 - Phase F: TALK_SUPERSEDED + TALK_WITHDRAWN Events and Grace Window

TALK_SUPERSEDED and TALK_WITHDRAWN ledger events now fire from existing talk edit and delete/disable flows.

Key changes:
- `app.ts updateTalk` handler: emits `TALK_SUPERSEDED { oldTalkId, newTalkId }` after a successful edit. Since the current implementation updates in-place, both IDs are the same — the ledger captures the revision event for chatbot differential answering (REQ-CHATBOT-03).
- `ui-manager.ts deleteMyTalk`: emits `'withdrawTalk'` event to app.ts when a talk is removed from the local list.
- `ui-manager.ts setTalkDisabled(talkId, true)`: emits `'withdrawTalk'` — disabling broadcast is treated as withdrawal from active delivery.
- `app.ts withdrawTalk` handler: listens for the UI event and fires `TALK_WITHDRAWN { talkId, gracePeriodMs }` into the ledger. Grace period defaults to 24h; configurable via `TALK_WITHDRAWN_GRACE_MS` env var.
- `WebLedgerService.writeIndexes` (Phase E) already writes the `ledger/<userId>/index/withdrawn/<talkId>` path, so the withdrawal is immediately queryable via `isTalkWithdrawn()`.

Evidence:
- `src/web/app/app.ts` — TALK_SUPERSEDED hook in updateTalk; withdrawTalk handler
- `src/web/ui/ui-manager.ts` — withdrawTalk emit in deleteMyTalk + setTalkDisabled
- Commit: ad87ebb

## 2026-05-28 - Phase F: LEDGER_STATE Handshake + O(Δ) Delta Sync (REQ-LEDGER-06)

Gun-path-based delta sync layer added to `WebLedgerService` and wired into `app.ts`.

Key additions to `WebLedgerService`:
- `broadcastState()` — writes our LedgerState JSON to `ledger/<userId>/state` on Gun
- `getEventBySeq(feedUserId, seq)` — reads a single event from Gun by position
- `syncWithPeer(peerId, theirState)` — pushes missing events to `ledger/<peerId>/inbox/<eventId>`
- `syncWithPeerById(peerId)` — reads peer state from Gun then calls syncWithPeer
- `subscribeToInbox()` — watches `ledger/<userId>/inbox`, verifies + ingests each delta event
- `startDeltaSync(getPeerIds)` — orchestrates broadcast + inbox subscription + proactive peer sync

`app.ts` changes:
- `startLedgerDeltaSync()` called after own feed head loaded (post-keypair init)
- Gun `hi` event triggers `broadcastState()` so newly connected peers receive our state
- `getPeerIds()` lazily returns `currentUser.knownPeople` userIds

All delta sync operations are fire-and-forget; errors are non-fatal. Peers without ledger support silently fall back to Gun star sync.

Evidence:
- `src/web/services/web-ledger-service.ts` — broadcastState, syncWithPeer*, subscribeToInbox, startDeltaSync
- `src/web/app/app.ts` — startLedgerDeltaSync + Gun hi wiring
- Commit: ddfcaf2

## 2026-05-28 - Phase E: Ledger Event Hooks Wired Into All Interaction Flows

All interaction flows in `src/web/app/app.ts` now emit ledger events (fire-and-forget, non-blocking):

- `TALK_CREATED` — emitted after `createTalk()` succeeds
- `TALK_BROADCAST` — emitted after the Gun announce loop completes (per chatroom)
- `TALK_ANSWERED` — emitted after `submitTalkResponse()` with outcome: match/ignore/mismatch
- `MATCH_CREATED` — emitted once per match entry after a successful match
- `CONVERSATION_MSG` — emitted after `conversationService.sendMessage()` succeeds

Key design decisions:
- `initLedger()` is called lazily after the SEA keypair is ready, not at construction time
- `ledgerEmit()` wraps all calls in try/catch and only logs warnings — ledger failures never block the main flow
- `(serverResult as any).isIgnore` and `responseId` fallback used since the server response type doesn't expose these fields

Evidence:
- `src/web/app/app.ts` — initLedger, ledgerEmit, TALK_CREATED/BROADCAST/ANSWERED/MATCH_CREATED/CONVERSATION_MSG hooks
- Commit: f5efae3

## 2026-05-28 - Phase D5/D6 Acceptance Closure

Reply triage group-by + date range filter coverage and contacts stranger/relationship coverage added.

Key changes:
- `00ad-reply-triage-group-date.spec.ts` — verifies group-by responder/talk/day/none, date range filter (future-from → 0 results, past-to → 0 results), clear-filters restores all rows, sort-by-talk-replies, and sort order persists after tab switch.
- `00ae-contacts-stranger-relationship.spec.ts` — verifies new match appears as "Stranger" in contact list, edit-relationship modal saves "Friend" label correctly, contact meta line updates, sort by relationship and weighted both show contact, and label persists after navigating away and returning.
- `package.json` — phase-d5 and phase-d6 scripts updated to include new specs.

Evidence:
- `tests/e2e/staged/stage3-three-user/00ad-reply-triage-group-date.spec.ts`
- `tests/e2e/staged/stage2-two-user/00ae-contacts-stranger-relationship.spec.ts`
- Commit: b18ff61

## 2026-05-28 - Phase D3 Filter Diagnostics Hardening

CJK grammar detection, broadcast preamble localization, and location-pending warning shipped.

Key changes:
- `ContentFilter.isCjkContent()` — detects when ≥20% of non-whitespace chars are CJK ideographs; used by `assessGrammar()` to return 1.0 (pass) for Chinese/Japanese/Korean content without applying Latin sentence/punctuation heuristics that would incorrectly reject CJK messages.
- `assessGrammar()` CJK bypass — prevents false `intake_grammar` filter rejections for valid CJK talks, allowing the dirty-word check to run independently.
- Broadcast preamble chip — was hardcoded `'1 talk'`/`'N talks'`; now uses `talksCountOne`/`talksCount` translation keys so the chip reads correctly in Chinese.
- `filterLocationPending` — new EN + ZH translation key; shown as a warning in Settings filter diagnostics and the Talks IN tab empty state when `currentLocation` is null but incoming talks have a `locationRadiusMiles` constraint.
- Unit tests — `ContentFilter.isCjkContent` + `applyFilters` CJK grammar bypass + dirty-word detection added to `reputation.test.ts`.

Evidence:
- `src/shared/reputation.ts` — `isCjkContent()` static method + CJK bypass in `assessGrammar()`
- `src/web/ui/ui-translations.ts` — `filterLocationPending` EN + ZH keys
- `src/web/ui/ui-manager.ts` — preamble chip localization + location pending note
- `src/test/unit/reputation.test.ts` — `ContentFilter` describe block with 8 unit tests
- Commit: 6193e39

## 2026-05-28 - Phase D2 Localization Edge Surface Hardening

Status bar user/match count were rendering with hardcoded English strings (`'user'`, `'users'`, `'match'`, `'matches'`). Fixed by adding `statusBarUser/Users/Match/Matches` translation keys to both EN and ZH catalogs, updating `updateStatusBar()` to call `tf()`, and storing the base text in `data-status-bar-base` so `syncStatusBarMatchCount()` does not depend on an English-only regex.

Evidence:
- `src/web/ui/ui-translations.ts` — 4 new keys in EN + ZH
- `src/web/ui/ui-manager.ts` — `updateStatusBar` + `syncStatusBarMatchCount` now use `tf()`
- `tests/e2e/staged/stage1-single-user/00z-chinese-edge-notifications.spec.ts` — verifies status bar, broadcast preamble modal, and chatroom create modal in Chinese
- Commit: 3ffd31d

## 2026-05-28 - Phase D4 Talk Lifecycle Multi-Responder Matrix (E2E, complete)

Survey, route, and intake-filtered responder cases added to the D4 matrix:
- Survey talk: two responders, aggregate stats ≥2, no match badge, Me tab entry per responder.
- Route talk: engineer branch yields isMatch, no-job branch yields isIgnore; creator sees 1 match.
- Intake-filtered: Bob blocks flow type server-side; only Jerry's match reaches creator; Bob's IN list stays empty.

Evidence:
- `tests/e2e/staged/stage3-three-user/00aa-talk-lifecycle-survey-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00ab-talk-lifecycle-route-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00ac-talk-lifecycle-intake-filtered-responder.spec.ts`
- Commit: 287fe4e

## 2026-05-27 - Phase D4 Talk Lifecycle Multi-Responder Matrix (E2E, partial)

Flow and tag talks with two responders (match + mismatch) now assert isolated conversations,
Contacts stranger labeling, Me answer ownership per responder, and creator reply triage rows per
outcome. Builds on `talk-lifecycle-fixtures.ts` and `talk-lifecycle-e2e.ts`.

Evidence:

- `tests/e2e/staged/stage3-three-user/00w-talk-lifecycle-flow-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00z-talk-lifecycle-tag-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00u-talk-lifecycle-stranger-match.spec.ts`
- Script: `npm run test:e2e:phase-d4`

## 2026-05-27 - Phase D5 High-Volume Reply Triage Matrix (E2E)

Expanded creator reply triage browser proof to a deterministic 10×10 matrix (100 replies) with
query filters, outcome/relationship filters, match- and talk-based sorting, weighted score ordering,
clear-filter restoration, and sort persistence after tab navigation.

Evidence:

- `tests/e2e/staged/stage3-three-user/00v-creator-reply-triage-matrix.spec.ts`
- `tests/e2e/helpers/creator-reply-matrix.ts`
- Script: `npm run test:e2e:phase-d5`

## 2026-05-27 - Phase D6 Tab Sweep Bundle Script

Added a dedicated D6 script that runs the tab-sweep smoke, navigation/settings durability checks, and
Chinese traversal proof together as one sweep entrypoint.

Evidence:

- `tests/e2e/staged/stage1-single-user/00x-tab-sweep-smoke.spec.ts`
- `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`
- `tests/e2e/staged/stage1-single-user/00y-chinese-ui-traversal.spec.ts`
- Script: `npm run test:e2e:phase-d6`

## 2026-05-27 - Phase D2 Chinese UI Localization Proof (E2E)

App UI language (`zh`/`en`) re-renders navigation and main-tab chrome immediately, persists across
reload via `iinpublic_ui_language`, keeps profile/incoming language codes stable, and restores
English on switch. Dedicated traversal spec covers Chatrooms, Contacts, Talks (editor), Me, and
Settings; `00-ui-navigation-settings.spec.ts` adds deep modal/notification/storage checks.

Evidence:

- `tests/e2e/staged/stage1-single-user/00y-chinese-ui-traversal.spec.ts`
- `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`
- `src/web/ui/ui-translations.ts`
- Script: `npm run test:e2e:phase-d2`

## 2026-05-27 - Feature Backlog Audit (Tab and E2E Infrastructure)

Moved shipped tab features and E2E stage infrastructure from `docs/TODO.md` into this ledger:
localization controls, room visitor counters and metadata, TechSupport global anchor and support
contact, contact language/ranking/relationship filters, talk language and creator diagnostics,
answer-memory UI, storage inspector, contextual statistics, runtime diagnostics, Stage 0 TechSupport
bootstrap/snapshot integrity, and ordinary-user greeting bootstrap.

Evidence: see prior 2026-05-26 entries in this file plus `tests/e2e/staged/stage0-bootstrap/`,
`tests/e2e/helpers/e2e-stage-pipeline.ts`, and tab-specific E2E specs under `tests/e2e/staged/`.

## 2026-05-27 - Fix Flaky Staged Broadcast and Contacts E2E Specs

Stabilized hierarchy parent-room broadcast expectations (USA under North America), clear-all
mid-flight broadcast cancellation, and contacts summary assertions after mismatch flows.

Evidence:

- `tests/e2e/staged/stage2-two-user/00h-chatroom-hierarchy-broadcast.spec.ts`
- `tests/e2e/staged/stage2-two-user/00-broadcast-abort-clear-all.spec.ts`
- `tests/e2e/staged/stage3-three-user/00f-ux-contacts-talks-answers.spec.ts`

## 2026-05-27 - D3 Incoming Talk Filter Multi-User E2E Suite

Staged browser proofs now cover language, distance band, grammar/dirty-word moderation, custom
sent-after cutoff, talk-type gating, and related Settings persistence paths alongside broadcast
preview reasons.

Evidence:

- `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00n-distance-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00p-custom-cutoff-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00t-talk-type-intake-filter.spec.ts`
- Settings/intake: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-27 - Phase D3–D6 E2E Coverage (Intake, Lifecycle, Reply Triage, Tab Sweep)

Added staged Playwright specs and helpers for talk-type intake filtering, stranger-before-match
lifecycle, creator reply triage at scale (snapshot-seeded 6×6 UI matrix plus existing 10×10 API
integration test), and a single-user tab sweep smoke. New script: `npm run test:e2e:phase-d`.

Evidence:

- Helpers: `tests/e2e/helpers/talk-lifecycle-fixtures.ts`, `tests/e2e/helpers/creator-reply-matrix.ts`
- E2E: `00t-talk-type-intake-filter.spec.ts`, `00u-talk-lifecycle-stranger-match.spec.ts`,
  `00v-creator-reply-triage-matrix.spec.ts`, `00x-tab-sweep-smoke.spec.ts`
- Integration (100 replies): `src/test/integration/peer-routes.test.ts`

## 2026-05-26 - Live Broadcast Intake Rejection Preview (D3)

Broadcast pre-send preview now reliably calls `POST /api/talks/broadcast-receiver-preview` with a
longer timeout, UI-member fallback when Gun member sync lags, and faster server filter/location
reads via `getOptional`. Senders see localized reasons for `intake_language`, `intake_grammar`, and
`intake_dirty_words` before confirming a broadcast. Integration coverage adds distance rejection
counts for `intake_min_distance` / `intake_max_distance`.

Evidence:

- Client/server: `src/web/app/app.ts`, `src/server/services/user-service.ts`
- Tests: `src/test/integration/talk-loop.test.ts`, `src/test/integration/services.test.ts`,
  `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`,
  `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`

## 2026-05-26 - Prevent Expired Direct Talk Delivery

Expired talks can no longer enter a receiver inbox through direct peer send, direct delivery API
calls, or bulk-registration calls. Peer `Send My Talks` omits expired outgoing entries, and the
audience-preview endpoint returns a localized `talk_expired` reason for expired payloads. Omitted
expired/disabled entries are now listed explicitly as unavailable options in the peer-send picker
and broadcast pre-send preview.

Evidence:

- Delivery/UI: `src/server/routes/talk-delivery-routes.ts`, `src/web/ui/user-detail-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Tests: `src/test/integration/talk-loop.test.ts`, `src/test/unit/ui-extracted-modules.test.ts`,
  `tests/e2e/staged/stage2-two-user/00e-chatroom-peer-detail.spec.ts`

## 2026-05-26 - Clarify Shared Languages in Contact Detail

Contact public-profile detail now displays localized readable language names, marks languages
shared with the viewer, and shows a localized translation hint when the profiles have no declared
language in common.

Evidence:

- Contacts UI and translation copy: `src/web/ui/contacts-view.ts`, `src/web/ui/ui-translations.ts`,
  `src/web/ui/ui-manager.ts`
- Tests: `src/test/unit/contacts-view.test.ts`,
  `tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts`

## 2026-05-26 - Surface Contact Credit And Block Context

Ordinary Contact detail now shows saved relationship notes, public-credit privacy state, and
whether delivery is blocked in either direction without requiring the user to open the edit modal.
Recorded transport fallback/no-fallback state and confirmed-contact display are covered by the
subsequent conversation-transport work; live P2P health negotiation remains future work.

Evidence:

- Contact detail UI: `src/web/ui/contacts-view.ts`
- Tests: `src/test/unit/contacts-view.test.ts`,
  `tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts`

## 2026-05-26 - Surface Active Conversation Transport

Peer detail and conversation overlays now identify the active conversation transport mode with
localized labels, including the current star-compatible default. They also display any recorded
fallback reason, explicitly state that no fallback is active for the current star path, and report
the last delivered-message time as confirmed contact evidence.

Evidence:

- Peer and conversation UI: `src/web/ui/user-detail-view.ts`, `src/web/ui/ui-manager.ts`
- Tests: `src/test/unit/ui-extracted-modules.test.ts`, `src/test/unit/ui-translations.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Expose Runtime Feature Diagnostics

Settings Storage Inspector now explicitly displays the runtime state of star persistence, P2P-node
and direct-chat enablement, transport fallback availability, and built-in TechSupport bootstrap.

Evidence:

- Settings UI and translations: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Tests: `src/test/unit/ui-translations.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-p2p-star-baseline-storage.spec.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Reconcile Contextual Statistics Surface

The product decision already present in the application is now recorded in the active backlog:
statistics remain contextual inside work views and per-survey analytics instead of adding a sixth
bottom-navigation tab.

Evidence:

- Contextual summaries and survey analytics UI: `src/web/ui/ui-manager.ts`
- No-tab and aggregate summary proof:
  `tests/e2e/staged/stage1-single-user/00-statistics-dashboard.spec.ts`

## 2026-05-26 - Guard Staged Snapshot Integrity

Sequential E2E snapshot save/load boundaries now validate the canonical TechSupport root identity,
network marker, active Global membership, duplicate support-greeting absence, and the expected
canonical user population for stages 0 through 3.

Evidence:

- Pipeline assertion boundary: `tests/e2e/helpers/e2e-stage-pipeline.ts`
- Canonical seed and staged pipeline: `tests/e2e/helpers/clear-database.ts`,
  `tests/e2e/staged/README.md`

## 2026-05-26 - Reconcile Shipped Talk And Ranking Diagnostics

The active backlog now reflects existing shipped behavior for localized OUT/IN talk badges,
incoming hidden-reason diagnostics, OUT-talk response ranking, Contacts peer ranking, and Settings
filter preview. These capabilities were already implemented and verified but were still listed as
future work in the tab backlog.

Evidence:

- UI implementation: `src/web/ui/ui-manager.ts`, `src/web/ui/contacts-view.ts`
- Intake and broadcast reason tests: `src/test/unit/talk-intake-filters.test.ts`,
  `src/test/integration/talk-loop.test.ts`
- Localized UI proof: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Complete Contact Relationship Labels

Contacts now displays saved custom relationship text instead of reducing it to a generic `Custom`
label. Custom relationship text participates in search and alphabetical relationship sorting, while
the existing `partner` and `custom` filter categories remain available.

Evidence:

- Contacts list behavior and unit proof: `src/web/ui/contacts-view.ts`,
  `src/test/unit/contacts-view.test.ts`
- Relationship sort control and E2E persistence proof: `src/web/ui/ui-manager.ts`,
  `tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts`

## 2026-05-25 - Transparent Room Broadcast Audience

The broadcast confirmation view now identifies eligible recipients and skipped members before any
send occurs, with per-member intake, moderation, age, block, capacity, and rate-limit reasons. It
also states when the built-in TechSupport support channel was intentionally excluded from an
ordinary room broadcast.

Evidence:

- Preview API and reason-bearing response: `src/server/routes/talk-delivery-routes.ts`,
  `src/test/integration/talk-loop.test.ts`
- Localized audience view and E2E proof: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`, `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Stable Concurrent Capacity Overflow

FIFO room overflow now lets only the newest active join resolve a capacity breach, preventing
delayed checks from evicting multiple occupants during concurrent room entry. The regional spread
proof now starts users in their declared parent rooms and verifies the intentional USA-to-region
overflow without an artificial all-Global relocation race.

Evidence:

- Capacity enforcement: `src/web/services/web-chatroom-service.ts`
- Browser proof: `tests/e2e/staged/stage5-multi-user/00k-capacity-regional-spread.spec.ts`

## 2026-05-25 - Complete Custom Room Detail Metadata

Custom and business room detail views now expose the metadata collected at creation: room type,
description, business headline, capacity, owner, creation date, active member count, lifetime
visits, and unique visitor count, using localized labels.

Evidence:

- Detail rendering and localized catalog: `src/web/ui/chatrooms-view.ts`,
  `src/web/ui/ui-translations.ts`, `src/web/ui/ui-manager.ts`
- Metadata propagation and UI proof: `src/web/app/app.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Idempotent Room Visits And Membership Audits

Duplicate joins from an already-active member no longer increment lifetime visit totals or reset
the member's FIFO entry time. Re-entering after leaving remains a new lifetime visit while leaving
unique-visitor totals stable, and soft-deleted rooms preserve their recorded visitor history.

Evidence:

- Server/web join accounting: `src/server/services/chatroom-manager.ts`,
  `src/web/services/web-chatroom-service.ts`
- Unit/E2E: `src/test/unit/chatroom-manager.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`,
  `tests/e2e/staged/stage4-four-user/03-capacity-eviction.spec.ts`

## 2026-05-25 - Complete Storage Inspector App State

Storage Inspector now reports application state alongside the existing storage and P2P
diagnostics: TechSupport root/support-channel status, visible room visit counters, incoming
language filtering, and the default language for newly created talks. Existing panels continue
to expose transport, SEA custody/relay scan, localStorage keys, and IndexedDB names.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Complete Localized Language Labels

Language names now stay localized across creator reply filtering and reply rows as well as the
existing Settings, editor, talk badge, peer/profile, and answer-history surfaces. Filter state
continues to store stable language codes while displaying human-readable English or Chinese
labels.

Evidence:

- UI: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Validated Profile Language Selector

The Me profile editor now uses selectable supported-language options rather than a
comma-separated free-text field. Users can retain multiple profile languages, and saved values
are limited to the same language catalog exposed in Settings.

Evidence:

- UI: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Independent Default Talk Language Setting

Settings now exposes a visible default language for newly created talks. Without an explicit
selection it follows App language; after selection it persists independently of App language,
profile language, and incoming-talk filter languages.

Evidence:

- UI and storage: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-settings-storage.ts`,
  `src/web/ui/ui-translations.ts`
- Unit and E2E: `src/test/unit/ui-extracted-modules.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Human-Readable Conditional Answer Context

The Me answer-history view now explains route branches with the earlier question and selected
answer text rather than exposing internal question/answer ids. This is applied to both current
flattened history records and the legacy answered-talk rendering path.

Evidence:

- UI and history serialization: `src/web/ui/answers-view.ts`, `src/web/ui/ui-manager.ts`
- Unit and E2E: `src/test/unit/answers-view.test.ts`,
  `tests/e2e/staged/stage0-bootstrap/caa-techsupport-four-talk-types.spec.ts`

## 2026-05-25 - Support Message Exclusion From Answer History

The Me answer-history list now rejects marked TechSupport welcome and support-channel message rows
from local or migrated data while continuing to render TechSupport-authored talks that the user
intentionally answered.

Evidence:

- UI and history record contract: `src/web/ui/answers-view.ts`,
  `src/web/ui/answer-history-storage.ts`
- Unit and E2E: `src/test/unit/answers-view.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Exact-Question Answer Memory Mode Controls

Preferences now exposes Manual, Temporary auto-answer, Permanent auto-answer, and Skip-this-question
choices for each saved answer. Mode changes, answer edits, and deletion update exact-question memory
instead of leaving hidden auto-answer behavior active.

Evidence:

- UI and storage bridge: `src/web/ui/preferences-dialog.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/answer-preferences-storage.ts`, `src/web/ui/ui-translations.ts`
- Unit and E2E: `src/test/unit/ui-extracted-modules.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Language-Aware Answer History Display

The Me answer-history list now shows a localized language badge on each answered talk and keeps
otherwise identical histories in different languages as separate rows, matching the isolated
auto-use metrics introduced for chatbot memory.

Evidence:

- UI: `src/web/ui/answers-view.ts`, `src/web/ui/ui-manager.ts`
- Unit and E2E: `src/test/unit/answers-view.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Language-Aware Chatbot Memory Isolation

Exact chatbot memory, content-template identity, and flattened answer-preference keys now include
talk language, preventing identical visible text in different languages from triggering automatic
answer reuse. Historical unscoped exact-memory records remain usable only for English talks.

Evidence:

- Identity and memory: `src/shared/exact-chatbot-memory.ts`, `src/shared/talk-content-id.ts`,
  `src/shared/flattened-answer-keys.ts`
- Server and UI wiring: `src/server/routes/talk-delivery-routes.ts`, `src/server/index.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/answers-view.ts`
- Tests: `src/test/unit/exact-chatbot-memory.test.ts`, `src/test/unit/talk-content-id.test.ts`,
  `src/test/unit/flattened-answer-keys.test.ts`, `src/test/unit/answers-view.test.ts`,
  `src/test/integration/talk-loop.test.ts`

## 2026-05-25 - Talks Language Editing Completion

Authored talks now keep their stored language when opened for editing, persist a changed language,
and refresh the visible OUT language badge immediately after save instead of leaving stale local
metadata until reload.

Evidence:

- UI persistence: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/05-talks-edit.spec.ts`

## 2026-05-25 - TechSupport Pinned Contact And Local Mute

Ordinary users with a durable TechSupport support channel now see a pinned built-in Contacts row
that remains outside ordinary contact counts and ranking. Its support control dialog, plus the
reachable TechSupport peer overlay, provides per-user local mute/unmute instead of normal block
actions; support-ready and welcome notifications respect that mute state without deleting the
support conversation.

Evidence:

- UI/app/catalog: `src/web/ui/contacts-view.ts`, `src/web/ui/user-detail-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`, `src/web/app/app.ts`
- Unit: `src/test/unit/contacts-view.test.ts`, `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts`,
  `tests/e2e/staged/stage3-three-user/06-contacts-tab.spec.ts`

## 2026-05-25 - D2 Independent App Language And Talk Default

Added an explicit persisted App language selector for completed English and Chinese catalogs,
separate from profile language and incoming-talk intake languages. Switching App language now
re-renders translated navigation and Settings without changing profile metadata, survives reload,
and supplies the default language of a newly created talk while retaining its per-talk selector.

Evidence:

- UI preference and renderer: `src/web/ui/ui-settings-storage.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Settings Feedback Localization Slice

Localized Settings feedback for invalid distance ranges, inline nickname validation failures,
and profile-photo file rejection while retaining the existing localized preview and camera
permission flow. The Chinese traversal now triggers each non-mutating validation path.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Contact Relationship Feedback Localization Slice

Localized age-verification vouch, block/unblock, and pre-match conversation guidance notices
issued by app relationship handlers. The Chinese traversal renders each notice through its
catalog formatter without writing relationship state.

Evidence:

- UI/app/catalog: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Chatrooms And Contacts Localization Slice

Moved the visible Chatrooms runtime/member states and Contacts list, detail, relationship,
block, and public-credit surfaces into the English/Chinese catalog. Chinese navigation coverage
now enters an active chatroom, and focused Contacts tests cover Chinese detail/modal rendering
while retaining English singular count grammar.

Evidence:

- Views and catalog: `src/web/ui/chatrooms-view.ts`, `src/web/ui/contacts-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/contacts-view.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Chatroom Actions And Travel Localization Slice

Localized custom-room create and rename dialogs, room-management results and delete confirmation,
broadcast controls/results, and travel/location state notices. The Chinese traversal now opens
the custom-room dialogs while retaining stable room payload values and avoiding server mutations.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`, `src/web/app/app.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Talks List And Linear Dialog Localization Slice

Localized the Talks main list and its incoming/outgoing row metadata, including counts, action
labels, language badges, relative dates, expiry/location text, and response status. Extended the
catalog into tag/flow editor controls and response outcomes while preserving localized persistent
match notifications.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`,
  `src/web/ui/talk-editor-dialog.ts`, `src/web/ui/talk-editor-form-helpers.ts`,
  `src/web/ui/talk-response-dialog.ts`
- Unit: `src/test/unit/ui-translations.test.ts`, `src/test/unit/ui-extracted-modules.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Talks Action Feedback Localization Slice

Localized Talks create/send/update/load/copy/remove/completion feedback and editor validation
banners. Also kept live chatroom visit and matched-member updates in the active language instead
of allowing asynchronous refreshes to restore English runtime labels.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`, `src/web/app/app.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Me History And Auxiliary Dialog Localization Slice

Localized Me answer-history metadata, filtering controls, stored-talk type badges, Preferences,
and My Talks dialogs while retaining stable stored talk type codes for filtering and persistence.
The Chinese traversal now exercises populated history and both dialogs.

Evidence:
- UI/catalog: `src/web/ui/answers-view.ts`, `src/web/ui/preferences-dialog.ts`,
  `src/web/ui/my-talks-dialog.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-extracted-modules.test.ts`, `src/test/unit/answers-view.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Route Editor Tree Localization Slice

Localized the rendered route branch tree, including outcome pills, prompts, child/remove actions,
new branch default answers, and route validation messaging. The Chinese traversal now opens the
route editor and adds a localized child branch.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Peer Detail Localization Slice

Localized peer-detail loading, public profile, relationship statistics, conversations, history,
direct-message controls, and the Send My Talks picker. Language and talk-type labels now respect
the active UI language, and the Chinese traversal opens a populated peer detail overlay.

Evidence:
- UI/catalog: `src/web/ui/user-detail-view.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-extracted-modules.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`,
  `tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts`

## 2026-05-25 - D2 Storage Inspector Localization Slice

Localized Settings Storage Inspector headings, standard status values, local-node permission
labels, policy explanations, and server persisted-path descriptions. Technical storage, transport,
and protocol identifiers remain unchanged for debugging and stable assertions; the Chinese
traversal now verifies the rendered diagnostics panel.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Conversations And Support Welcome Localization Slice

Localized conversation list and overlay copy, displayed message timestamps, incoming-talk and
response-submission notices, and new conversation notifications. TechSupport welcome messages
remain stored in their stable English synchronization form but are rendered and toasted through
the selected UI language; the Chinese traversal now opens the support channel and checks its
translated greeting and ready notice.

Evidence:
- UI/catalog: `src/web/app/app.ts`, `src/web/ui/conversations-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-extracted-modules.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Messaging Feedback Localization Slice

Localized app-owned room-message, conversation-load/send, direct-message error, and
answer-processing feedback while preserving existing conversation rendering behavior. The Chinese
traversal renders each notice without sending messages or forcing network failures.

Evidence:

- UI/app/catalog: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Me Profile And Credit Localization Slice

Localized the always-visible Me profile summary, language labels, privacy annotations,
broadcast-tag trend states/table labels, and reputation/credit cards. The canonical TechSupport
profile role is translated only at render time, preserving stored seeded values.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Me Profile Editor Localization Slice

Localized the Me nickname and profile editor dialogs, including privacy/category option labels,
input guidance, validation alerts, and successful save notifications. Stored privacy and interest
category values remain stable internal codes, and stage names are escaped when displayed in the
legacy nickname dialog.

Evidence:
- UI/catalog: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D1 Single Settings Owner For Intake Preferences

Confirmed that Settings is the sole editing surface for Talk Behavior and incoming-intake
controls. Me remains an answer-history view with its Preferences shortcut and cannot overwrite
newer Settings values. Added browser coverage that edits Settings-owned values, visits Me, and
verifies the values remain unchanged when Settings is reopened.

Evidence:

- UI ownership and settings storage: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-settings-storage.ts`
- Persistence wiring: `src/web/app/app.ts`, `src/web/services/web-user-service.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-24 - D1 Confirmed Photo Capture And Reload

Added a confirmation preview before uploaded or captured photos become public, a centered
in-browser camera capture flow, and durable permission-denied/unsupported-device guidance.
Restored the visible Me profile card and reconciled reloads with the authoritative public
profile foundation so saved and removed photos do not reappear from stale private state.
Regression verification also aligned online block mutations with the server-owned reputation
counter and preserves ordered block/unblock results across delayed Gun visibility.

Evidence:

- UI and translations: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Public reload and online block reconciliation: `src/web/services/web-user-service.ts`, `src/server/services/user-service.ts`
- Unit: `src/test/unit/web-user-service.test.ts`
- Integration: `src/test/integration/services.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts`, `tests/e2e/staged/stage2-two-user/21a-reputation-block-count.spec.ts`

## 2026-05-24 - D1 Identity Guardrails And Profile Presentation

Implemented protected stage-name validation across ordinary creation and Settings rename flows,
with clear user feedback and preservation of the previous identity. The protected acceptance
matrix includes `TechSupport`, normalized TechSupport variants, `ROOT`, `admin`, `administrator`,
`system`, `support`, `api`, and `www`; only the canonical root flow may retain `TechSupport`.

Removed empty-interest filler from Settings and public peer/contact profile rendering, and added
image headshots with bounded rendering, choose/capture file actions, replacement/removal, file
validation, public-profile display, and initials/preset fallback.

Evidence:

- Shared validator and UI: `src/shared/techsupport.ts`, `src/web/ui/ui-manager.ts`
- Avatar/profile rendering: `src/web/ui/profile-avatar.ts`, `src/web/ui/contacts-view.ts`,
  `src/web/ui/user-detail-view.ts`
- Unit/integration: `src/test/unit/techsupport.test.ts`, `src/test/unit/profile-avatar.test.ts`,
  `src/test/unit/web-user-service.test.ts`, `src/test/integration/services.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts`,
  `tests/e2e/staged/stage0-bootstrap/aaa-stage0-techsupport.spec.ts`

## 2026-05-20 - P2P Node Network Roadmap P1-P7

Source roadmap: [P2P Node Network Roadmap](archive/consolidated-2026-06-08/roadmap-p2p-node-network.md) (archived 2026-06-08; design now in spec §19)

### P1 - Star Compatibility Baseline

Implemented runtime flags and explicit star-mode storage classification while keeping the
existing Gun star topology as the default compatibility baseline.

Evidence:

- Commit: `0a90432` - `Implement P2P star baseline`
- Runtime/debug surface: `GET /api/debug/storage`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-star-baseline-storage.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P2 - Permissioned Local Node Supervisor

Added the local-node supervisor model and APIs for explicit permission disclosures, lifecycle
state, signed session pairing, identity binding, health checks, local-only persistence controls,
and wipe/delete behavior.

Evidence:

- Commit: `ff3943c` - `Implement P2P local node supervisor`
- APIs: `/api/p2p/local-node`, `/start`, `/bind-identity`, `/health-check`, `/wipe`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-local-node-supervisor.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P3 - SEA Key Custody And Relay Privacy

Replaced plaintext browser SEA keypair storage with encrypted WebCrypto custody, formalized the
public-only SEA identity policy, added encrypted linked-device/recovery primitives, and added
relay/browser leak scanning for private SEA keys and plaintext direct-message bodies.

Evidence:

- Commit: `134ddf5` - `Implement P2P SEA key custody`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-sea-key-custody.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P4 - Conversation Transport Boundary

Introduced the conversation transport abstraction while preserving `star-gun` as the active
default, exposed `server-relay` and `direct-p2p` modes, added encrypted short-lived signaling
envelopes, and surfaced transport diagnostics in Settings/debug storage.

Evidence:

- Commit: `dd17f70` - `Implement P2P conversation transport`
- APIs: `/api/p2p/signaling/:conversationId`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-conversation-transport.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P5 - Cross-Platform P2P Protocol

Added the platform-neutral P2P protocol model using the selected
`gun-mesh-websocket-webrtc` substrate, with Web/Windows/Ubuntu/Android/iOS descriptors,
capability negotiation, signed discovery messages, encrypted signaling expectations, and
plaintext/private-key rejection rules.

Evidence:

- Commit: `17c71a8` - `Implement P2P cross-platform protocol`
- APIs: `/api/p2p/discovery`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P6 - Active Neighbor Memory

Added local-only active neighbor memory with scoring, expiry pruning, blocked/failed peer
exclusion, encrypted export, disable/clear controls, and bootstrap candidates before public
star fallback.

Evidence:

- Commit: `0265e3f` - `Implement P2P active neighbor memory`
- APIs: `/api/p2p/neighbors`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P7 - Data Ownership And Migration Boundaries

Added data ownership policy surfaces for device-local deletion, metadata-only server-held data
requests/deletes, migration planning for private and legacy data, relay-only TTL policy, and
telemetry-free user-visible transport diagnostics.

Evidence:

- Commit: `344558a` - `Implement P2P data ownership boundaries`
- APIs: `/api/p2p/data-ownership`, `/api/p2p/transport-diagnostics`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-data-ownership.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

Verification after P1-P7:

- `npm run health`
- `PW_WORKERS=20 npm run test:e2e`

## 2026-05-20 - P2P Test Stabilization

Stabilized date-sensitive P2P expiry tests so discovery and neighbor-memory checks use
future-relative timestamps instead of fixed dates.

Evidence:

- Commit: `84f330d` - `Stabilize P2P expiry tests`
- Files:
  - `src/test/integration/system-routes.test.ts`
  - `tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts`
  - `tests/e2e/staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts`

## 2026-05-20 - Health Check Warning Cleanup

Removed Jest open-handle warnings from Gun read helpers and silenced the expected Webpack
production bundle-size warning with an explicit project budget.

Evidence:

- Commit: `8edb241` - `Silence health check warnings`
- Files:
  - `src/server/services/gun-service.ts`
  - `webpack.config.js`
- Verification: `npm run health`

## 2026-05-20 - Exact Chatbot Memory E2E Stabilization

Stabilized the exact chatbot memory E2E by adding a normalized server-side test endpoint and
waiting on the same memory read path used by server auto-reply instead of grepping raw Gun
snapshots.

Evidence:

- Commit: `2d5db9a` - `Stabilize exact chatbot memory E2E`
- API: `/api/test/exact-chatbot-memory/:userId`
- E2E: `tests/e2e/staged/stage3-three-user/14-exact-chatbot-memory.spec.ts`
- Verification: `npm run health && PW_WORKERS=20 npm run test:e2e`

## Current Implemented Feature Baseline

These feature areas are already part of the current implementation and should not be re-added
to `TODO.md` as greenfield work:

- Profile editor and viewer-filtered public profile rendering.
- Intake filters, server-side moderation, blocking/unblock, age gating, reputation scoring,
  and bulk-capacity enforcement.
- Custom/business chatrooms, hierarchy navigation, single-room travel mode, and same-room
  broadcast delivery.
- Tag catalog, mandatory broadcast preamble, interest targeting, distance caps, tag popularity,
  and tag trend stats.
- Talk creation, matching, answer history, contacts, messaging, cancellation/deletion paths,
  and exact chatbot Q/A memory.
- Generic per-talk stats endpoints, cross-question/time-series/chatroom/peer/dashboard stats,
  dedicated Statistics tab, survey analytics dashboard, low-count masking, CSV exports,
  follow-up survey creation, and peer relationship stats.
## 2026-05-25 - D2 Survey Analytics Localization Slice

Localized the creator-facing survey analytics dashboard, including its metric labels, privacy and
CSV-export controls, load states, export notice, and follow-up survey launch. The dedicated
three-user dashboard scenario now reopens populated survey results in Chinese and verifies the
localized follow-up editor path.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage3-three-user/00i-survey-analytics-dashboard.spec.ts`

## 2026-05-26 - Independent App Language Reconciliation

Reconciled stale forward backlog entries with the shipped language controls. Settings already
separates persistent App language from profile language, default-talk language, and multi-language
incoming filters, and its E2E path proves an immediate Chinese re-render and reload persistence.
Full reachable-workflow Chinese traversal remains active work under Phase D2.

Evidence:

- UI: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Three-Language Intake Delivery Proof

Added a real multi-user browser scenario for incoming language filters: the receiver accepts
English and Chinese while Spanish delivery stays out of IN, then opts into Spanish and receives a
new Spanish talk. The remaining user-visible rejection-reason portion stays tracked in TODO because
live audience preview can fall back to final-send checking under synchronized browser load.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`

## 2026-05-26 - Distance-Band Intake Delivery Proof

Added a deterministic two-user browser scenario for distance intake filters: the receiver persists
a one-to-three mile acceptance band, then receives only the authored talk inside that band while
nearer and farther talks remain out of IN. Existing Settings coverage already rejects an invalid
minimum-greater-than-maximum range; user-visible live rejection details remain tracked in TODO.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00n-distance-intake-filter.spec.ts`
- Existing validation E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Content Intake Toggle Delivery Proof

Added a real two-user browser scenario for the documented grammar heuristic and content-moderation
toggle: clean content reaches IN, unreadable and moderated content stays out while filters are on,
and newly sent equivalent content reaches IN after each setting is disabled and persisted.
User-visible live rejection reasons and expanded multilingual policy remain tracked in TODO.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`

## 2026-06-04 - P1 Direct Talk Connector Guardrails

Moved the direct-talk test/runtime model further away from server-authoritative delivery. Direct
mode now rejects `POST /api/talks/:id/response`, does not retain server inbox entries during
direct broadcast registration, skips deprecated public server Gun writes unless
`IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY=1` is set, publishes metadata-only peer offers with
catalog refs, and mirrors direct IN clusters to `ownerIncomingTalkIndex`.

Evidence:

- Unit: `src/test/unit/p2p-runtime.test.ts`
- Unit: `src/test/unit/peer-talk-delivery.test.ts`
- Integration: `src/test/integration/talk-loop.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/00i-p0-direct-talk-delivery.spec.ts`
- Unit: `src/test/unit/intake-filter-reasons.test.ts`

## 2026-05-26 - Custom Phrase and Sent-After Delivery Proof

Added a real two-user browser scenario for custom blocked phrases and the sent-after cutoff:
matching or future-cutoff content stays out of IN while each persisted control is active, and newly
sent content reaches IN after the receiver clears that control. Fixed the `datetime-local`
round-trip so a stored ISO cutoff redisplays in the receiver's local wall-clock time after
navigation. Existing delivery tests already cover allowed talk types, adult gating, and
public-credit visibility behavior.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00p-custom-cutoff-intake-filter.spec.ts`
- Existing E2E: `tests/e2e/staged/stage3-three-user/13-me-filters-credit.spec.ts`
- Existing E2E: `tests/e2e/staged/stage3-three-user/00g-age-gating.spec.ts`

## 2026-05-26 - Expiration and Block Delivery Reconciliation

Added a deterministic two-user expiration scenario: a one-day talk reaches the receiver while
active, then a second one-day talk displays as expired and cannot be broadcast after advancing the
sender clock. Reconciled existing browser evidence that blocking prevents delivery and unblocking
allows newly sent talks again.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00q-expiration-broadcast.spec.ts`
- Existing E2E: `tests/e2e/staged/stage2-two-user/15a-blocking-unblock-resumes-talk-delivery.spec.ts`
- Existing E2E: `tests/e2e/staged/stage2-two-user/15b-blocking-stops-delivery-and-peer-visibility.spec.ts`

## 2026-05-26 - Delivered Auto-Copy Toggle Proof

Extended the real sender/receiver browser path with two delivered matching talks. With auto-copy
disabled, the receiver retains answer history without an OUT copy; after enabling the persisted
setting, the second delivered talk is saved as a copied OUT talk while both history records remain.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00l-chatroom-talks-ui-regressions.spec.ts`

## 2026-05-26 - Distance Boundary Equality Proof

Extended the real distance-band delivery scenario with a persisted equal minimum/maximum of zero
miles. A colocated sender's newly authored talk reaches the receiver, proving endpoint equality is
inclusive through the browser path.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00n-distance-intake-filter.spec.ts`

## 2026-05-26 - Dirty Answer Choice Delivery Proof

Extended content-intake delivery with clean-title talks whose answer choice alone contains
moderated content. The talk stays out of IN while dirty-word filtering is enabled and reaches the
receiver after that persisted toggle is disabled.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`

## 2026-06-09 - P0 Step 1: Mesh Transport Foundation (mesh-ping gossip)

Three browser peers gossip `mesh-ping` across a sparse room overlay with zero Gun writes to
`talks/*` or `peerTalkOffers/*`. Hardened `PeerMeshService`: bounded seen-set dedup, neighbor
re-pick on churn, `meshPingDiagnostics` for durable E2E assertions. Fixed origin attribution —
`onPing`/`onPong` now report `frame.originUserId` (the envelope's verified origin), not the
relay neighbor; msgId is stable across forward hops (dedup-safe, reused by P0 steps 2–4).
Design note: `docs/design/p0-step1-mesh-transport.md`.

Evidence:

- E2E: `tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts` (includes K=1 path-graph sparse forwarding + relay-side Gun emptiness assertion)
- Unit: `src/test/unit/peer-mesh-service.test.ts` (origin/msgId stability across relay hop)

## 2026-06-09 - P0 Step 2: Mesh Broadcast Announcements

Find-similar room broadcasts now travel as `talk-announce` + `talk-body` floods over the mesh
DataChannel overlay (primary path, zero delivery Gun writes). `publishRoomTalkBodyRendezvous`
(`p2pMeshTalkBodies/*`) remains only as a conditional fallback when the overlay cannot guarantee
coverage: below wanted degree, or named recipients exceed the degree bound K (sparse overlay may
be partitioned). Author-qualified identity (`talkId::authorId`) is preserved end-to-end —
content-addressed talkId collisions across authors no longer clobber cached bodies, the author's
own `talks/<id>` definition, or response routing. Contacts view no longer leaks self.
Interim fallback + author-side `talks/*` creation write tracked as step-6/7 debt
(`docs/design/p0-step1-mesh-transport.md` R-a/R-f).

Evidence:

- E2E: `tests/e2e/talks-matching/02-mesh-broadcast-announce.spec.ts` (3 browsers, K=1 relay hop, strict `peerTalkOffers/*` + `p2pMeshTalkBodies/*` emptiness)
- E2E: full suite green — 101 passed, 0 failed, 0 flaky (incl. stage2/08-super-user-copy-talk, stage5/find-similar-people 9/9 contacts)
- Unit: `src/test/unit/peer-mesh-service.test.ts` (announce guards, relay-hop flood, fallback decision, author-collision cache, coverage-gap condition)

## 2026-06-10 - P0 Step 3: Receiver-Side Intake Filtering

Intake decisions (language, distance, content/dirty-word, adult age-gate, expiry cutoff) are now
applied on the RECEIVER at the single mesh choke point, via the shared
`intakeFilterRejectReasons` (`src/shared/talk-intake-filters.ts`) extended with `expiresAt` and
a synchronous `ReceiverIntakeContext` (`ageVerified` resolved async by the caller, only for
adult-flagged talks). Rejected bodies are not cached/delivered and remain eligible for
re-delivery after the user relaxes filters (`onTalkBody` returns false). The server's star-path
`filterReasonsForTalk` is unchanged (deleted wholesale in step 7).

Evidence:

- E2E: full suite green in mesh mode incl. distance (stage3/00n), content (stage3/00o), and adult/language/cutoff intake specs with receiver-side filtering
- Unit: `src/test/unit/intake-filter-reasons.test.ts` (expiry, age-gate, per-dimension accept/reject), `src/test/unit/peer-mesh-service.test.ts` (mesh choke point honors rejection)

## 2026-06-10 - P0 Steps 4-6: Mesh Responses/Matches, Local-Only Contacts, Encrypted Mailbox

Step 4: talk responses unicast over mesh; both sides run shared `checkIfMatch` and create the
conversation locally with deterministic ids (idempotent, no ack frame, no server response
endpoints, no pair Gun subscriptions). `responseId = CIDv1`, `version`, `respondedAt` shipped
for steps 8-11. Step 5: contacts/peer-detail/match-%/replies/history derive from local stores
only (`local-peer-derivation.ts`); zero client calls to `/peers`, `/relationship`,
`/talk-history`, `/replies`. Step 6: hub-side encrypted TTL mailbox (ciphertext-only envelopes,
SEA ECDH, drain-then-delete on boot/roster change) replaces the step-4 interim localStorage
queue for offline recipients.

Evidence:

- E2E: `03-mesh-response-match.spec.ts`, `04-local-contacts.spec.ts`, `05-mailbox-offline-response.spec.ts`; full suite green locally
- Integration: `src/test/integration/mailbox-routes.test.ts` (25)
- Unit: `mesh-response-step4.test.ts` (18), `local-peer-derivation.test.ts` (40)

## 2026-06-10 - P0 Step 8: Sender-Side Ledger State

Unified local `talkLedger` (outcomes / exchanged / edges / retracted) with pure ordering module
`src/shared/talk-ledger.ts` (version-then-timestamp, retraction-wins, per-identity
`shouldSuppress`, `applyEdgeGate` mirroring the server day/week quotas). Author records each
responder's outcome with version + respondedAt; broadcast recipient selection skips
already-answered identities and enforces the local-outbound edge quota. Steps 9-11 fields
scaffolded (no migration needed). Design: `docs/design/p0-steps8-11-ledger.md`.

Evidence:

- E2E: `06-sender-suppression.spec.ts`; full suite green locally
- Unit: `src/test/unit/talk-ledger.test.ts` (49)
