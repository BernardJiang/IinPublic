# Test: Broadcast Cancellation — Talk Deletion by Creator Mid-Flight

**File:** 00-broadcast-deletion-mid-broadcast.spec.ts  
**Features tested:** Talk deletion during broadcast, register batch delay, partial broadcast cancellation, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Tom (stage name "Tom DelCancel") and Jerry (stage name "Jerry DelCancel") both log into separate browsers. Databases are cleared before starting.

2. **Tom creates 6 talks** titled "Deletion Cancel Talk 1" through "Deletion Cancel Talk 6" using `createSimpleFlowTalk` and navigates to the Chatrooms tab.

3. **Tom broadcasts all 6 talks.** A network route intercepts the `register-receivers-for-broadcast` API calls — on the 5th registration request, a signal is triggered and the request is delayed by 10 seconds.

4. **Mid-flight, Tom deletes the LAST talk (Talk #6):** Once the signal fires, Tom navigates to "Me" → "View My Talks", and deletes only talk #6. Then navigates back to Chatrooms.

5. **Broadcast acknowledgment waited for** via `waitForBroadcastBulkAckMinSent` (1 receiver, minSent 1 — meaning at least 1 of the surviving 5 talks should be delivered).

6. **Verification — Jerry receives talks 1-5 but NOT talk #6:** Jerry's `/api/users/jerry/incoming-talks` confirms that "Deletion Cancel Talk 5" appeared, but "Deletion Cancel Talk 6" was never delivered because Tom deleted it mid-broadcast.

> **Why this matters:** Verifies that individual talk deletion mid-broadcast cancels only that specific talk's delivery — other talks in the same broadcast batch still propagate correctly.

---

**Helpers used:** `bootstrapUser`, `createSimpleFlowTalk`, `confirmBroadcastTagPreambleIfVisible`, `goToChatrooms`, `clearGunDatabases`, `afterSync`, `afterNav`, `afterAction`, `waitForBroadcastBulkAckMinSent`, `waitForIncomingTalkClusterOnServer`, `incomingClustersIncludeTitleSubstring`
