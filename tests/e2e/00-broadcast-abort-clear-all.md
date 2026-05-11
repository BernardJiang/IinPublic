# Test: Broadcast Cancellation — Creator Clears All Talks Mid-Flight

**Spec file:** `00-broadcast-abort-clear-all.spec.ts`

**Features tested:** Broadcast cancellation, clear-all-talks functionality, API routing interception

---

## What this test does (in plain English):

1. **Actor(s):** Tom (first browser) and Jerry (second browser) — both bootstrapped with the `bootstrapUser` helper
2. **Action:** Tom creates 10 flow talks with titles "Broadcast Abort Talk 1" through "Broadcast Abort Talk 10"
3. **Action:** The test intercepts the `/api/talks/*/register-receivers-for-broadcast` API calls using `pageTom.route()`. When the 5th registration call fires, a "ready to clear" signal is sent
4. **Action:** Tom clicks Broadcast and confirms the tag preamble (uses `confirmBroadcastTagPreambleIfVisible` helper which picks a random tag chip and sends)
5. **Action:** Once the 5th registration is reached, Tom navigates to Me → View My Talks → Clicks Clear All Talks button, accepts the dialog confirmation
6. **Action:** Tom returns to the Chatrooms tab
7. **Action:** The test waits for broadcast bulk acknowledgment with `minSent: 0` — meaning 0 talks actually got delivered
8. **Verification:** Jerry should NOT receive "Broadcast Abort Talk 6" or "Broadcast Abort Talk 10" (the ones that were being registered when Tom cleared all) — verified by polling the incoming-talks API with `incomingClustersIncludeTitleSubstring` helper

> **Why this matters:** Verifies that when a creator clears all talks during an ongoing broadcast operation, the remaining registration batches are cancelled and receivers don't see talks that should have been deleted
