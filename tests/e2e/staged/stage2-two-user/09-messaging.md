# Test: Direct Messaging — Tom and Jerry Match on Talk, Then Exchange Messages

covers: SPEC-7.6, SPEC-19.4  <!-- auto-seeded; refine by hand -->

**File:** 09-messaging.spec.ts  
**Features tested:** Talk matching triggering conversation creation, direct messaging between matched users, bidirectional message delivery, conversation overlay, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Two browsers — Tom and Jerry — both log in and join "Global" chatroom. Test timeout is 420 seconds (7 minutes) due to long Gun sync waits.

2. **Tom creates and broadcasts a talk** titled "Tennis Partner": "Want a tennis partner?" with match answer "Yes, lets play." and ignore answer "No thanks." Tom uses `clickBroadcastUntilBulkAck` helper to broadcast, then polls server to confirm Jerry received the incoming talk.

3. **Jerry opens the incoming talk and matches** by selecting "Yes, lets play." After the match, conversation entries are created for both users (poll-localStorage for the other user's ID to appear as a conversation).

4. **Tom opens conversation with Jerry** via `openConversation` helper, types "Hey Jerry, want to play tennis tomorrow?", and sends. Tom sees his own message appear.

5. **Jerry opens conversation with Tom** and sees Tom's message arrive (polls until visible).

6. **Jerry replies** with "Sounds great! Meet at the courts at 9am?" — Jerry sees the reply, and Tom (still on his conversation overlay) also sees Jerry's reply arrive.

> **Why this matters:** Verifies the complete messaging flow: match → conversation created → bidirectional real-time messaging works with correct message delivery in both directions.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `openIncomingTalkModal`, `waitForResponseModalClosed`, `clickBroadcastUntilBulkAck`, `waitForBroadcastableTalkIds`, `waitForDistinctGunPeersExcludingSelf`
