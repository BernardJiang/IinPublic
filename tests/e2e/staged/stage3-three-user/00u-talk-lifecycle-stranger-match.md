# Test: Talk Lifecycle — Stranger Auto-Added to Contacts After Match

**File:** 00u-talk-lifecycle-stranger-match.spec.ts  
**Features tested:** When two users who have never interacted match on a flow talk, the responder is automatically added to the creator's Contacts tab with "Stranger" relationship label and no saved relationship metadata.

---

## What this test does (in plain English):

Two users (Tom creates + broadcasts, Jerry answers). Neither has contacted the other before. After Jerry matches Tom's talk, Tom's Contacts list should show Jerry as a new entry labeled "Stranger". This verifies the contact-creation side effect of a successful talk match between unknown peers.

1. **Setup:** Two browsers — Tom and Jerry joined Global chatroom.
2. **Tom creates flow talk** ("Lifecycle Stranger Match") with match/ignore answers via company page JSON API.
3. **Broadcast delivered:** Waits for Gun peer awareness (≥1 distinct peer). Clicks broadcast until bulk ack.
4. **Jerry matches:** Completes the incoming talk with match answer IDs → recorded as MATCH outcome.
5. **Creator sees match count:** Tom's status bar shows ≥ 1 match.
6. **Tom opens Contacts tab:** Jerry appears in the contacts list (`#contacts-list .contact-item` with text "Jerry Lifecycle"). The row also contains "Stranger" text confirming default relationship label for first-match peers without prior contact.

> **Why this matters:** Validates that matches between strangers automatically seed the contacts database. Without this, new connections would be invisible until a second interaction. The "Stranger" label distinguishes these auto-created entries from explicitly saved relationships (Partner, Friend, etc.). This feeds into the broader talk lifecycle matrix where contacts are verified after each match type.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `completeTalkInAppByAnswerIds`, `createTalksFromCompanyPage`, `waitForDistinctGunPeersExcludingSelf`, `waitForStatusBarMatchCountAtLeast`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`, `buildFlowTalkPayload`, `flowMatchAnswerIds`
