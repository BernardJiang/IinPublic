# Test: Broadcast — Talk Matching Across Chatroom Boundaries After Switching Rooms

**File:** 00-broadcast-boundary-match.spec.ts  
**Features tested:** Talk matching across chatroom boundaries, chatroom switching, incoming talk delivery

---

## What this test does (in plain English):

1. **Setup:** Tom (stage name "Tom Boundary") and Jerry (stage name "Jerry Boundary") both log into separate browsers via `bootstrapUser`. Databases are cleared before starting.

2. **Tom creates a talk** titled "Boundary Match Talk" with two answer choices: "Yes, lets play." (matching) and "No thanks." (non-matching).

3. **Tom broadcasts the talk.** Using `confirmBroadcastTagPreambleIfVisible` if the tag modal appears, and waits for the broadcast to be acknowledged with at least 1 receiver and 1 sent.

4. **Jerry switches to a different chatroom:** Before answering Jerry navigates to Chatrooms and clicks into the "North America" room.

5. **Jerry opens and answers the incoming talk:** Even though Jerry switched rooms, Jerry uses `openIncomingTalkModal` to find and open the incoming talk, then selects the matching answer ("Yes, lets play.").

6. **Verification — Match is confirmed:** The status bar shows at least 1 match via `waitForStatusBarMatchCountAtLeast`. After the response modal closes, Jerry navigates to the "Me" tab and verifies Tom's conversation appears in the conversation list.

> **Why this matters:** Verifies that talk matching works correctly even if the responder switches chatrooms before answering — broadcasts cross chatroom boundaries properly.

---

**Helpers used:** `bootstrapUser`, `createSimpleFlowTalk`, `confirmBroadcastTagPreambleIfVisible`, `openIncomingTalkModal`, `waitForIncomingTalkClusterOnServer`, `waitForResponseModalClosed`, `waitForStatusBarMatchCountAtLeast`, `waitForBroadcastBulkAckMinSent`, `goToChatrooms`
