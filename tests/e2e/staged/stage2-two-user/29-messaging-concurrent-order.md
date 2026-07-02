# Test: Messaging — Concurrent Interleaved Sends Converge to the Same Order

**File:** 29-messaging-concurrent-order.spec.ts
**Features tested:** Message ordering determinism under concurrent (non-sequential) sends from both participants, Gun-as-source-of-truth convergence, direct-p2p message store sort tie-breaking

---

## What this test does (in plain English):

1. **Setup:** Two users (A and B) are fast-matched into a direct-p2p conversation via `setupFastMatchedDm` (bypasses the talk editor/broadcast/response-modal UI — creates the same match/conversation outcome through the lower-level pair-direct mesh response path used by `talks-matching/03-mesh-response-match.spec.ts`).

2. **Concurrent interleaved sends:** A fires 3 messages ("A-msg-1/2/3") and B fires 3 messages ("B-msg-1/2/3") all via `Promise.all` — none of the 6 sends is awaited before the next one starts, on either side. This means messages can (and often do) land within the same millisecond, and the two participants' local Gun graphs can receive/process them in different orders.

3. **Convergence assertion:** All 6 messages must become visible on both A's and B's conversation view. Both sides' final rendered message order must be **identical** — not just "contains the same set," but the same sequence.

> **Why this matters:** Gun is the authoritative store for direct-p2p conversations (WebRTC is notify-only). Two peers racing to send at nearly the same instant is a realistic scenario (not just a test artifact), and message rendering must be deterministic — every participant must see the same conversation history in the same order, or "which message came first" becomes ambiguous and confusing in the UI.

---

## Product bug found and fixed

`GunMessageStore.collectAndDecryptMessages` (src/web/services/gun-message-store.ts) sorted messages by timestamp only: `messagesArray.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())`. When two messages share the same millisecond timestamp, `Array.prototype.sort`'s stability preserves the *pre-sort* array order — which comes from `Array.from(processedMessages)`, a `Set` populated in the order each peer's local Gun `.on()`/`.once()` callbacks fired. That firing order is peer-local and not guaranteed to match between participants, so A and B could genuinely converge on different final orderings for same-millisecond messages.

Fix: added a deterministic tie-breaker — when timestamps are equal, sort by message `id` (a durable string identical on both sides, embedding `Date.now()` plus a random suffix), making the final order reproducible regardless of local arrival order.

---

**Helpers used:** `setupFastMatchedDm`, `sendConversationMessage`, `waitForMessageVisible`, `teardownFastDmPair` (all from `tests/e2e/helpers/fast-dm-setup.ts`)
