# Test: P2P-Q Signed Handshake (Two Users)

**File:** 00k-p2p-handshake.spec.ts  
**Features tested:** WebRTC DataChannel handshake between two peers after talk match — protocol negotiation, state machine, and diagnostics. Exercises both success and failure paths.

---

## What this test does (in plain English):

Two users with WebRTC support establish a direct P2P conversation channel via the handshake protocol. Verifies that selectedProtocol defaults to `iinpublic-p2p-v1` and that incompatible peer lists produce a proper "failed" state.

1. **Setup:** Two headless Chromium browsers (Tom & Jerry) launched with WebRTC-args (`WEBRTC_CHROMIUM_ARGS`).
2. **Join Global chatroom → create/broadcast flow talk** — Tom creates `"Handshake test <timestamp>"` talk via company page, waits for Gun peers to see each other, then broadcasts until ack'd.
3. **Jerry answers match** via UI modal for the incoming talk. Modal closes after sync.
4. **Prepare P2P conversation:** Opens direct P2P conversation between Tom and Jerry using `prepareDirectP2PConversation`.
5. **Handshake succeeds (primary test):** Both Tom and Jerry poll until handshakeState reaches `'ok'`. Extract diagnostics: `selectedProtocol === 'iinpublic-p2p-v1'`, `failureReason === null`, `remoteAppVersion` truthy on both sides. Verifies the protocol was selected via common-list intersection (`intersect = ['v1','v2'] ∩ ['v2','v1','v0'] = ['v1','v2']`).
6. **Negotiate fallback version:** Calls `window.__iinpublic_app.getApp().p2pConversationManager?.negotiateHandshakeVersion` inline via evaluate — passes explicit protocol lists where only 'v0' is common. Result: handshakeState remains `'ok'`, but selectedProtocol rolls back to `'iinpublic-p2p-v0'`.
7. **Incompatible list produces failure (secondary test):** Third browser navigates to app, runs inline negotiate logic where either side has empty `supportedProtocols` → expected result: `{ ok: false, reason: 'no protocol match' }`, `handshakeState === 'failed'`, `failureReason === 'empty protocol list'` or `'no protocol match'`.

## Verifications:

- ✅ handshakeState === 'ok' after two peers connect
- ✅ selectedProtocol === 'iinpublic-p2p-v1' (v1 preferred) on both Tom and Jerry
- ✅ remoteAppVersion truthy — app version exchange worked
- ✅ Fallback protocol negotiates correctly ('v0') with restricted lists
- ✅ Incompatible peer negotiation → 'failed' state with clear failure reason

> **Why this matters:** Validates the core P2P handshake protocol. Without a working handshake, there is no direct-peer communication. The fallback and reject tests prove robustness when version negotiation goes wrong.

---

**Helpers used:** `clearGunForStage2Spec`, `bootstrapUser`, `openIncomingTalkModal`, `waitForResponseModalClosed`, `createSimpleFlowTalk`, `clickBroadcastUntilBulkAck`, `waitForDistinctGunPeersExcludingSelf`, `prepareDirectP2PConversation`, `getHandshakeDiagnosticsFromPage`, `waitForHandshakeOk`, `WEBRTC_CHROMIUM_ARGS`
