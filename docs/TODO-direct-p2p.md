# Direct P2P — Implementation & E2E Migration TODO

Last updated: 2026-05-29

**Goal:** After a match, conversation messages travel **browser ↔ browser** over WebRTC DataChannel with **server-only signaling** (SDP/ICE via `/api/p2p/signaling/*`). Message bodies must not persist on the public Gun hub in direct mode.

**Scope boundary (important):**

| Flow | This TODO | Notes |
|------|-----------|--------|
| Post-match **conversation DMs** | **In scope** | Replace default `StarGunConversationTransport` when `P2P_DIRECT_CHAT_ENABLED=1` |
| Talk **delivery / matching / intake** | **Out of scope** | Stays on HTTP + server `incomingTalksMap` until a separate mesh epic (spec §19) |
| Gun **profile / talks / stats** | **Out of scope** | Star hub remains for public/relay paths per `p2p-node-network.md` |

**References:** `docs/roadmap/p2p-node-network.md`, `src/shared/p2p-runtime.ts`, `src/web/services/web-conversation-service.ts`, spec §19 + REQ-LEDGER-06 (ledger handshake over WebRTC).

**E2E parallel:** `npm run test:e2e:parallel` → `PW_WORKERS=20`, **10 min/test** timeout (`playwright.config.ts` when `PW_WORKERS≥4`).

---

## Phase 0 — Decisions & prerequisites

- [x] **Transport library:** Native `RTCPeerConnection` + manual ICE (`src/web/services/p2p-webrtc-session.ts`).
- [x] **E2E WebRTC in CI:** Playwright/Chromium on one machine — empty ICE servers when `DISABLE_HMR=true`, plus `--disable-features=WebRtcHideLocalIpsWithMdns`.
- [ ] **Fallback policy:** When direct ICE fails, fall back to `server-relay` (encrypted relay envelopes) before `star-gun` — match `createConversationTransportDiagnostics()` fallback.
- [x] **Feature flags:**
  - E2E default: `P2P_DIRECT_CHAT_ENABLED=1` in `playwright.config.ts`
  - Star regression: `npm run test:e2e:star` with `P2P_DIRECT_CHAT_ENABLED=0`

---

## Phase 1 — `DirectP2PConversationTransport` (core)

**Files:** `src/web/services/direct-p2p-conversation-transport.ts`, `src/web/services/p2p-signaling-client.ts`, `src/web/services/p2p-webrtc-session.ts`.

- [x] Implement `ConversationTransport` with `mode: 'direct-p2p'`.
- [x] **Signaling client:** POST/GET `/api/p2p/signaling/:conversationId` (`p2p-signaling-client.ts`).
- [x] **WebRTC session:** Per-conversation peer connection + ICE via signaling (`p2p-webrtc-session.ts`, 10s connect timeout).
- [x] **sendMessage / subscribeToMessages:** DataChannel path; no Gun message bodies in direct mode.
- [ ] **LEDGER_STATE handshake (spec REQ-LEDGER-06):** On channel `open`, exchange ledger state before historical messages.
- [x] **Wire-up:** `WebConversationService` selects `DirectP2PConversationTransport` when `p2pDirectChatEnabled`; `app.ts` syncs flags from `/api/debug/storage`; conversations get `transportMode: 'direct-p2p'` (server `createOrGetConversation`, client Gun puts, `addNewConversation` merge).
- [x] **FR-BM-7 alignment:** `resolveBroadcastReceivers` uses Gun room members only (no stale UI fallback for cross-room delivery).

---

## Phase 2 — Server relay fallback & diagnostics

- [ ] Implement `ServerRelayConversationTransport` (optional middle layer) OR internal fallback inside direct transport.
- [ ] `POST /api/p2p/transport-diagnostics` — emit events when mode switches.
- [ ] UI: live mode + fallback reason in peer detail / settings inspector.
- [x] Settings storage inspector: `activeMode` / `messageBodyStorage` when direct enabled.

---

## Phase 3 — Privacy & verification

- [x] **Gun leak test:** `assertNoGunStoredMessageBodies` in `09-messaging` + helper.
- [x] **Unit tests:** `p2p-runtime.test.ts`, `p2p-signaling-client.test.ts`.
- [ ] **Integration test:** signaling round-trip with two logical peers (mock WebRTC optional).

---

## Phase 4 — E2E infrastructure

- [x] `playwright.config.ts`: `P2P_DIRECT_CHAT_ENABLED=1` on Gun/webpack spawns; WebRTC launch args.
- [x] `tests/e2e/helpers/p2p-transport-e2e.ts` — `expectActiveTransportMode`, `waitForDirectP2PChannel` (10s), `assertNoGunStoredMessageBodies`, `prepareDirectP2PConversation`, `expectConversationTransportModeForPeer`.
- [x] `npm run test:e2e:p2p` / default `test:e2e` with P2P on; `npm run test:e2e:star` with flag off.
- [x] `npm run test:e2e:parallel` — `PW_WORKERS=20`, 10 min per-test timeout.

---

## Phase 5 — E2E spec migration

**Global:** After match + before DM → `prepareDirectP2PConversation` or `waitForDirectP2PChannel` on both pages.

### Batch A — Dedicated P2P / storage specs

| Spec | Status |
|------|--------|
| `stage1/00-p2p-conversation-transport.spec.ts` | [x] |
| `stage1/00-p2p-star-baseline-storage.spec.ts` | [x] star project only |
| `stage1/00-ui-navigation-settings.spec.ts` | [x] support-channel overlay still seeds `star-gun` for localized copy assertions |

### Batch B — Primary messaging suites

| Spec | Status |
|------|--------|
| `stage2/09-messaging.spec.ts` | [x] |
| `stage2/00j-messaging-edge-cases.spec.ts` | [x] |
| `stage2/10-message-unread-badge.spec.ts` | [x] |
| `stage2/00-broadcast-boundary-match.spec.ts` | [ ] no DM path |

### Batch C — Match → conversation lifecycle

| Spec | Status |
|------|--------|
| `stage3/12-two-responders-partial-match.spec.ts` | [x] transport mode assertions |
| `stage3/00w-talk-lifecycle-flow-multi-responder.spec.ts` | [x] transport mode assertions |
| `stage3/01-tennis-jerry-match.spec.ts` | [ ] match only, no DM |
| `stage3/00u-talk-lifecycle-stranger-match.spec.ts` | [ ] contacts only |
| `stage3/03-chatbot-bot-badge.spec.ts` | [ ] declare support/hybrid in header |
| `stage3/09-four-types-chatbot.spec.ts` | [ ] bot attribution only |

### Batch E — Full suite gate

- [ ] `npm run health`
- [ ] `npm run test:e2e:parallel` (PW_WORKERS=20)
- [ ] Update `docs/completed.md` when green

---

## Exit criteria

- [x] With `P2P_DIRECT_CHAT_ENABLED=1`, matched users exchange DMs over WebRTC (`09-messaging`, `00j`, `10-message-unread-badge`).
- [x] Message bodies not on server Gun paths for those messages.
- [x] Signaling encrypted envelopes only.
- [ ] **All** E2E specs in Batch A–C pass under default `npm run test:e2e` / `test:e2e:parallel`.
- [x] Star-gun regression via `npm run test:e2e:star`.

---

## Out of scope (future epic)

- Talk broadcast/delivery off server
- Full Gun mesh / super-peers
- Removing `incomingTalksMap` server authority
