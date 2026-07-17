# Test: Broadcast Cancellation — Creator Clears All Talks Mid-Flight

covers: SPEC-3.6, SPEC-3.4, SPEC-8.2  <!-- auto-seeded; refine by hand -->

**File:** 00-broadcast-abort-clear-all.spec.ts  
**Features tested:** Broadcast cancellation, clear-all-talks, pair-direct delivery stability, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Tom (stage name "Tom Abort") and Jerry (stage name "Jerry Abort") both log into separate browsers. Databases are cleared before starting.

2. **Tom creates 10 talks** titled "Broadcast Abort Talk 1" through "Broadcast Abort Talk 10" using the `createSimpleFlowTalk` helper and navigates to the Chatrooms tab.

3. **Tom clicks Broadcast** to send talks to the network. In direct mode this publishes peer offers and records the durable broadcast ack.

4. **Mid-flight, Tom clears ALL talks:** Once the signal fires, Tom navigates to "Me" → "View My Talks", clicks "Clear All Talks", confirms the dialog, and navigates back to Chatrooms.

5. **Broadcast batch acknowledgment** is waited for via `waitForBroadcastBulkAckMinSent` (1 receiver, minSent may be 0 since talks were cleared).

6. **Verification:** The test confirms the creator-side broadcast loop remains stable and the local OUT list is cleared without relying on the server inbox.

> **Why this matters:** Ensures that when a creator cancels all talks while a broadcast is still propagating, remaining sends are skipped and recipients don't receive incomplete or cancelled talks.

---

**Helpers used:** `bootstrapUser`, `createSimpleFlowTalk`, `goToChatrooms`, `confirmBroadcastTagPreambleIfVisible`, `clearGunDatabases`, `afterSync`, `afterNav`, `afterAction`, `waitForBroadcastBulkAckMinSent`
