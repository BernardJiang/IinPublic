# Test: Messaging — Long Alternating History Renders in Full, Identical Order on Both Sides

**File:** 31-messaging-history-order.spec.ts
**Features tested:** Gun-backed ordered delivery for a direct-p2p conversation, reload recovery of the canonical pair history, >50-row conversation rendering, scroll reachability, and explicit unsupported-state coverage for message edit/delete controls.

---

## What this test does (in plain English):

1. **Setup:** Two users (A and B) are fast-matched into a direct-p2p conversation via `setupFastMatchedDm`.

2. **Warm-up:** Both sides send one throwaway message concurrently. This pays each side's one-off ~8s WebRTC connect-timeout cost up front (in parallel, not serially) so the timed, alternating loop below doesn't re-pay it once per sender.

3. **12 alternating messages**, strictly sequential (A, then B, then A, ...) — since sends are awaited one at a time there is exactly one unambiguous expected order.

4. **Real-delivery assertions:**
   - All 12 messages (the 2 warmups excluded) are visible on both A's and B's conversation view.
   - Both sides' rendered order exactly matches the expected alternating sequence.
   - The newest message is visible at the default (bottom) scroll position.
   - Scrolling `#conversation-messages` to `scrollTop = 0` reveals the oldest message.

5. **Large-history renderer:** The UI is then given a 54-message snapshot (2 warmups + 12 real-history rows + 40 bulk rows) on both pages. The test asserts all 54 message rows render and that both top and bottom scroll positions remain reachable.

6. **Unsupported edit/delete state:** The conversation overlay currently exposes only the back and send buttons, and message rows expose no action buttons. This pins edit/delete as explicitly unsupported instead of half-present.

7. **Reload recovery:** B reloads, reopens the same canonical `conv_pair_...` conversation, and the 12-message ordered Gun-backed core history reappears in the same order.

> **Why this matters:** A conversation with real history (not just one or two messages) must render completely and in the correct order for both participants. The UI also has to remain usable once a thread grows past a compact smoke-test size, and unsupported destructive actions should stay visibly absent until real product behavior exists.

---

## Verification

`npm run test:type && E2E_PORT_OFFSET=433 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/31-messaging-history-order.spec.ts` — 1 passed.

---

**Helpers used:** `setupFastMatchedDm`, `sendConversationMessage`, `teardownFastDmPair` (`tests/e2e/helpers/fast-dm-setup.ts`), `reloadAppReady`, `openConversationViaServer`.
