# Test: Broadcast Cancellation — Talk Deletion by Creator Mid-Flight

covers: SPEC-3.6, SPEC-3.4, SPEC-8.2  <!-- auto-seeded; refine by hand -->

**File:** 00-broadcast-deletion-mid-broadcast.spec.ts  
**Features tested:** Talk deletion around broadcast, pair-direct delivery stability, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Tom (stage name "Tom DelCancel") and Jerry (stage name "Jerry DelCancel") both log into separate browsers. Databases are cleared before starting.

2. **Tom creates 6 talks** titled "Deletion Cancel Talk 1" through "Deletion Cancel Talk 6" using `createSimpleFlowTalk` and navigates to the Chatrooms tab.

3. **Tom broadcasts all 6 talks.** In direct mode this publishes peer offers from the current local OUT snapshot.

4. **Tom deletes the LAST talk (Talk #6):** After the direct send snapshot starts, Tom deletes only talk #6. Then navigates back to Chatrooms.

5. **Broadcast acknowledgment waited for** via `waitForBroadcastBulkAckMinSent` (1 receiver, minSent 1 — meaning at least 1 of the surviving 5 talks should be delivered).

6. **Verification:** In direct mode, Jerry's local incoming index receives the already-published offer; legacy star mode still verifies cancellation through the server inbox.

> **Why this matters:** Verifies that individual talk deletion mid-broadcast cancels only that specific talk's delivery — other talks in the same broadcast batch still propagate correctly.

---

**Helpers used:** `bootstrapUser`, `createSimpleFlowTalk`, `confirmBroadcastTagPreambleIfVisible`, `goToChatrooms`, `clearGunDatabases`, `afterSync`, `afterNav`, `afterAction`, `waitForBroadcastBulkAckMinSent`, `waitForIncomingTalkCluster`
