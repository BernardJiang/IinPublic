# 29-messaging-semantics

covers: SPEC-7.6, SPEC-19.4  <!-- auto-seeded; refine by hand -->

Merged spec (speed re-organization): one shared boot instead of 3. Sections below are the original per-spec narratives.

---

## from 29-messaging-concurrent-order.md

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

---

## from 30-messaging-read-state.md

# Test: Messaging — Unread Badge Lifecycle Persists Across Reload

**File:** 30-messaging-read-state.spec.ts
**Features tested:** Unread conversation badge on Me nav, badge clear on open, durable read-cursor persistence in `localStorage` surviving a full page reload

---

## What this test does (in plain English):

1. **Setup:** Two users (A and B) are fast-matched into a direct-p2p conversation via `setupFastMatchedDm`. Both conversation overlays start open (part of setup warm-up); the test closes B's overlay so subsequently-arriving messages register as unread.

2. **A sends 2 messages** while B's conversation overlay is closed. B is on the Me tab: the Me nav button shows a notification badge once B's conversation-preview subscription (wired automatically when the conversation record is ingested) picks up both messages.

3. **B opens the conversation:** the badge clears, and the read cursor for this conversation is recorded in `localStorage['iinpublic:conversation-read-cursors']` (see `ui-manager.ts` `syncConversationMessageSummary`, ~line 7393-7422).

4. **B reloads the page.** The conversation-preview subscription is torn down and re-established from scratch on boot, but the read cursor is durable `localStorage` state — so even though the subscription re-delivers both historical messages, they are older than the recorded cursor and must NOT re-trigger the unread badge.

> **Why this matters:** Without a durable, per-conversation read cursor, a page reload would make every already-read conversation look unread again (the preview subscription necessarily replays history on re-subscribe). The cursor is what lets `syncConversationMessageSummary` tell "read before reload" apart from "arrived after."

---

**Helpers used:** `setupFastMatchedDm`, `sendConversationMessage`, `reloadAppReady`, `teardownFastDmPair` (`tests/e2e/helpers/fast-dm-setup.ts`, `tests/e2e/helpers/timing.ts`)

---

## from 31-messaging-history-order.md

# Test: Messaging — Long Alternating History Renders in Full, Identical Order on Both Sides

**File:** 31-messaging-history-order.spec.ts
**Features tested:** Gun-backed ordered delivery for a direct-p2p conversation, support-channel vs pair-thread classification, reload recovery of the canonical pair history, >50-row conversation rendering, scroll reachability, and explicit unsupported-state coverage for message edit/delete controls.

---

## What this test does (in plain English):

1. **Setup:** Two users (A and B) are fast-matched into a direct-p2p conversation via `setupFastMatchedDm`.

2. **Classification check:** Both users have exactly one bootstrap TechSupport support channel, and the canonical matched pair conversation is present as a non-support thread with the other user's id.

3. **Warm-up:** Both sides send one throwaway message concurrently. This pays each side's one-off ~8s WebRTC connect-timeout cost up front (in parallel, not serially) so the timed, alternating loop below doesn't re-pay it once per sender.

4. **12 alternating messages**, strictly sequential (A, then B, then A, ...) — since sends are awaited one at a time there is exactly one unambiguous expected order.

5. **Real-delivery assertions:**
   - All 12 messages (the 2 warmups excluded) are visible on both A's and B's conversation view.
   - Both sides' rendered order exactly matches the expected alternating sequence.
   - The newest message is visible at the default (bottom) scroll position.
   - Scrolling `#conversation-messages` to `scrollTop = 0` reveals the oldest message.

6. **Large-history renderer:** The UI is then given a 54-message snapshot (2 warmups + 12 real-history rows + 40 bulk rows) on both pages. The test asserts all 54 message rows render and that both top and bottom scroll positions remain reachable.

7. **Unsupported edit/delete state:** The conversation overlay currently exposes only navigation, share-media and send buttons (back, shared-media, back-from-media, the three media-gallery tabs, attach and send), and message rows expose no action buttons. This pins edit/delete as explicitly unsupported instead of half-present.

8. **Reload recovery:** B reloads, reopens the same canonical `conv_pair_...` conversation, and the 12-message ordered Gun-backed core history reappears in the same order.

> **Why this matters:** A conversation with real history (not just one or two messages) must render completely and in the correct order for both participants. The UI also has to keep bootstrap support separate from ordinary pairwise/manual messaging, remain usable once a thread grows past a compact smoke-test size, and keep unsupported destructive actions visibly absent until real product behavior exists.

---

## Verification

`npm run test:type && E2E_PORT_OFFSET=433 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/31-messaging-history-order.spec.ts` — 1 passed.

---

**Helpers used:** `setupFastMatchedDm`, `sendConversationMessage`, `teardownFastDmPair` (`tests/e2e/helpers/fast-dm-setup.ts`), `reloadAppReady`, `openConversationViaServer`.
