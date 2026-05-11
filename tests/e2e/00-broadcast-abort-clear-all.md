# Test: Broadcast Cancellation — Creator Clears All Talks Mid-Flight

**File:** 00-broadcast-abort-clear-all.spec.ts  
**Features tested:** Broadcast cancellation, clear-all-talks, register batch delay, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Tom (stage name "Tom Abort") and Jerry (stage name "Jerry Abort") both log into separate browsers. Databases are cleared before starting.

2. **Tom creates 10 talks** titled "Broadcast Abort Talk 1" through "Broadcast Abort Talk 10" using the `createSimpleFlowTalk` helper and navigates to the Chatrooms tab.

3. **Tom clicks Broadcast** to send all 10 talks to the network. A network route intercepts the `register-receivers-for-broadcast` API calls — on the 5th registration request, a signal is sent and the request is delayed by 10 seconds.

4. **Mid-flight, Tom clears ALL talks:** Once the signal fires, Tom navigates to "Me" → "View My Talks", clicks "Clear All Talks", confirms the dialog, and navigates back to Chatrooms.

5. **Broadcast batch acknowledgment** is waited for via `waitForBroadcastBulkAckMinSent` (1 receiver, minSent may be 0 since talks were cleared).

6. **Verification — Jerry should NOT receive the remaining talks (6-10):** The test polls Jerry's `/api/users/jerry/incoming-talks` endpoint and confirms that talks #6 and #10 were NOT delivered to Jerry. Since Tom cleared all talks mid-broadcast, the remaining batches were skipped.

> **Why this matters:** Ensures that when a creator cancels all talks while a broadcast is still propagating, remaining sends are skipped and recipients don't receive incomplete or cancelled talks.

---

**Helpers used:** `bootstrapUser`, `createSimpleFlowTalk`, `goToChatrooms`, `confirmBroadcastTagPreambleIfVisible`, `clearGunDatabases`, `afterSync`, `afterNav`, `afterAction`, `waitForBroadcastBulkAckMinSent`, `incomingClustersIncludeTitleSubstring`
