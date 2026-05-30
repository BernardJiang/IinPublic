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

---

## Phase 0 — Decisions & prerequisites

- [x] **Transport library:** Native `RTCPeerConnection` + manual ICE (`src/web/services/p2p-webrtc-session.ts`).
- [x] **E2E WebRTC in CI:** Playwright/Chromium on one machine — empty ICE servers when `DISABLE_HMR=true`, plus `--disable-features=WebRtcHideLocalIpsWithMdns`.
- [ ] **Fallback policy:** When direct ICE fails, fall back to `server-relay` (encrypted relay envelopes) before `star-gun` — match `createConversationTransportDiagnostics()` fallback.
- [x] **Feature flags:**
  - E2E default: `P2P_DIRECT_CHAT_ENABLED=1` in `playwright.config.ts`
  - Star regression: `npm run test:e2e:star` with `P2P_DIRECT_CHAT_ENABLED=0`

---

## Phase 1 — `DirectP2PConversationTransport` (core) ✅ (except LEDGER_STATE)


**Files:** new `src/web/services/direct-p2p-conversation-transport.ts`, `src/web/services/p2p-signaling-client.ts` (or under `src/web/p2p/`).

- [x] Implement `ConversationTransport` with `mode: 'direct-p2p'`.
- [ ] **Signaling client:** POST/GET `/api/p2p/signaling/:conversationId` using existing server routes (`system-routes.ts`); poll or subscribe until remote offer/answer/ICE arrive.
- [ ] **WebRTC session:** Per `(conversationId, localUserId, remoteUserId)`:
  - Create RTCPeerConnection (or simple-peer) with encrypted channel.
  - Exchange offer/answer/ICE via signaling envelopes (`createP2PSignalingEnvelope` — ciphertext-only).
  - Expose connection state: `connecting` | `connected` | `failed`.
- [ ] **sendMessage:** Serialize outbound messages as `DirectP2PMessageEnvelope` / app `Message` JSON over DataChannel; **do not** `gun.put` message bodies to `conversations/.../messages` in direct mode.
- [ ] **subscribeToMessages:** Deliver inbound DataChannel payloads to UI callback; maintain `prevSeen` / REQ-LEDGER-08 two-writer DAG same as star transport.
- [ ] **Encryption:** Reuse SEA shared secret (`SEA.secret(epub, pair)`) for channel payload encryption if not using built-in DTLS-only.
- [ ] **LEDGER_STATE handshake (spec REQ-LEDGER-06):** On channel `open`, exchange `LEDGER_STATE` then O(Δ) ledger events before showing historical messages (coordinate with `WebLedgerService` if already present).
- [ ] **Connection lifecycle:** Reconnect on tab focus / peer back online; idempotent signaling (dedupe by nonce/responseId).

**Wire-up:**

- [ ] `WebConversationService` constructor: if `resolveP2PRuntimeFlags().p2pDirectChatEnabled`, use `DirectP2PConversationTransport`, else `StarGunConversationTransport`.
- [ ] `app.ts`: pass transport from boot config (read flags from `/api/debug/storage` on init or inject via webpack `DefinePlugin` / env baked at build for E2E).
- [ ] `createConversation` / `addNewConversation`: set `transportMode: 'direct-p2p'` on conversation metadata (localStorage + any Gun conversation shell record).

---

## Phase 2 — Server relay fallback & diagnostics

- [ ] Implement `ServerRelayConversationTransport` (optional middle layer) OR internal fallback inside direct transport posting to relay-only paths (no Gun message bodies).
- [ ] `POST /api/p2p/transport-diagnostics` — emit events when mode switches (`direct-p2p` → `server-relay` → `star-gun`).
- [ ] UI: `user-detail-view.ts` / `ui-manager.ts` show live mode + fallback reason (already has copy keys).
- [ ] Settings storage inspector: when direct enabled, `activeMode: 'direct-p2p'`, `messageBodyStorage: 'local-only'`.

---

## Phase 3 — Privacy & verification (must pass before E2E cutover)

- [ ] **Gun leak test:** After DM exchange in direct mode, assert `GET /api/debug/storage` relay scan + manual Gun read shows **no plaintext** under `conversations/{id}/messages/*`.
- [ ] **Unit tests:** `src/test/unit/p2p-runtime.test.ts` — extend for transport selection factory.
- [ ] **Integration tests:** `src/test/integration/system-routes.test.ts` — signaling round-trip; reject plaintext signaling bodies (already partially covered).
- [ ] **New integration test:** two simulated peers complete signaling + one encrypted message envelope (mock WebRTC if needed).

---

## Phase 4 — E2E infrastructure ✅ (core)


**Playwright / env**

- [ ] `playwright.config.ts`: add to each Gun server spawn:
  ```text
  P2P_DIRECT_CHAT_ENABLED=1 P2P_NODE_ENABLED=0
  ```
- [ ] `.env.test`: document the same flags (optional mirror).
- [ ] New helper: `tests/e2e/helpers/p2p-transport-e2e.ts`
  - `expectActiveTransportMode(page, 'direct-p2p')` — poll `app.conversationService.getTransportMode()` or Settings inspector.
  - `waitForDirectP2PChannel(page, conversationId)` — poll connection state via `page.evaluate` (default **10s** — longer waits usually indicate ICE/signaling bugs).
  - `assertNoGunStoredMessageBodies(page, conversationId)` — server debug or Gun get from test API.
- [ ] `npm run test:e2e:p2p` — full suite with direct P2P flags (alias or default `test:e2e` after cutover).
- [ ] `npm run test:e2e:star` — **retain** star-gun regression with `P2P_DIRECT_CHAT_ENABLED=0` (subset: storage baseline + transport API specs).

**Chromium launch (if ICE fails in headless):**

- [ ] Try `--use-fake-device-for-media-stream` only if needed; prefer loopback ICE first.
- [ ] Document worker isolation: two browsers in one spec = two WebRTC peers; parallel workers remain port-isolated.

---

## Phase 5 — E2E spec migration (switch all conversation tests to direct-p2p)

**Global changes (every messaging-related spec):**

- [ ] After match + before send: `await waitForDirectP2PChannel(pageTom, convId)` (both pages).
- [ ] Assert sent message appears in overlay **without** relying on Gun replication latency (use UI + optional DataChannel callback).
- [ ] Where tests today inject conversations via server (`openConversationViaServer`, `waitForServerConversations`), keep server **conversation record** creation but assert **transport** is direct-p2p for message sync.

### Batch A — Dedicated P2P / storage specs (flip expectations)

| Spec | Action |
|------|--------|
| `stage1/00-p2p-conversation-transport.spec.ts` | Expect `activeMode: 'direct-p2p'`, `messageBodyStorage: 'local-only'` when flag on |
| `stage1/00-p2p-star-baseline-storage.spec.ts` | Move to **`test:e2e:star`** project only; keep expecting `p2pDirectChatEnabled: false` |
| `stage1/00-p2p-star-baseline-storage.md` | Note star regression script |
| `stage1/00-ui-navigation-settings.spec.ts` | Update seeded conversation `transportMode` to `direct-p2p` where asserted |

### Batch B — Primary messaging suites

| Spec | Action |
|------|--------|
| `stage2/09-messaging.spec.ts` | Add transport wait + direct-p2p assertions on send/receive |
| `stage2/00j-messaging-edge-cases.spec.ts` | Same; reopen-after-reload must re-establish WebRTC |
| `stage2/10-message-unread-badge.spec.ts` | Unread badge still driven by local transport events |
| `stage2/00-broadcast-boundary-match.spec.ts` | If opens conversation, verify direct transport |

### Batch C — Match → conversation lifecycle

| Spec | Action |
|------|--------|
| `stage3/12-two-responders-partial-match.spec.ts` | Conversation only for Jerry; optional transport check |
| `stage3/01-tennis-jerry-match.spec.ts` | Transport after match |
| `stage3/00w-talk-lifecycle-flow-multi-responder.spec.ts` | Jerry conversation path |
| `stage3/00u-talk-lifecycle-stranger-match.spec.ts` | Post-match DM if any |
| `stage3/03-chatbot-bot-badge.spec.ts` | Bot badge + messaging |
| `stage3/09-four-types-chatbot.spec.ts` | Chatbot conversations |
| `stage3/00-broadcast-boundary-match` (stage2) | Already in B |

### Batch D — TechSupport / edge (exclude or explicit mode)

| Spec | Action |
|------|--------|
| `stage2/00k-techsupport-contact-mute.spec.ts` | Support channel may stay star-gun or hybrid — **declare** in test header |
| Specs that only use HTTP talks (no DM) | No change |

### Batch E — Full suite gate

- [ ] `npm run health`
- [ ] `npm run test:e2e:p2p` (or `PW_WORKERS=4` then `20`)
- [ ] Fix flakes: ICE timing, replace Gun-sync waits with `waitForDirectP2PChannel` + UI assertions
- [ ] Update `docs/completed.md` + trim items from this file when done

---

## Phase 6 — Documentation & defaults

- [ ] `docs/roadmap/p2p-node-network.md` — mark “WebRTC DataChannel activation” done; note talk delivery still star.
- [ ] `CLAUDE.md` — document default transport, E2E env vars, `test:e2e:star` vs `test:e2e`.
- [ ] `docs/TODO.md` — link here while in progress; remove when Phase 5 complete.

---

## Suggested implementation order

1. Phase 0 → Phase 1 (minimal send/receive over DataChannel in manual two-tab test)
2. Phase 3 leak tests
3. Phase 4 helpers + enable flag in Playwright
4. Phase 5 Batch A → B → C → E
5. Phase 2 fallback + Phase 6 docs

---

## Exit criteria

- [x] With `P2P_DIRECT_CHAT_ENABLED=1`, matched users exchange DMs with connected WebRTC channel (`09-messaging`, `00j`, `10-message-unread-badge`).
- [x] Message bodies are **not** stored on server Gun paths for those messages (`assertNoGunStoredMessageBodies` in `09-messaging`).
- [x] Signaling uses encrypted envelopes only (existing server validation + `p2p-signaling-client`).
- [ ] **All** E2E specs in Batch A–C pass under default `npm run test:e2e` with direct P2P enabled (Batch B/C not fully migrated).
- [x] Star-gun regression via `npm run test:e2e:star` (explicit flag off).

---

## Out of scope (future epic — do not block DM cutover)

- Talk broadcast/delivery off server (`POST /api/talks/:id/received` removal per spec §19)
- Full Gun mesh neighborhood / super-peers
- Removing `incomingTalksMap` server authority
