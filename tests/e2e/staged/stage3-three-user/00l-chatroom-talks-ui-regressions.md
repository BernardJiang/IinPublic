# Test: Chatrooms and Talks UI Regressions

covers: SPEC-3.3, SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**File:** 00l-chatroom-talks-ui-regressions.spec.ts  
**Features tested:** Five regression tests protecting chatroom headcount updates as members come and go, first-screen hydration of existing headcounts, talks row states (new/copied/broadcast toggle), copy-by-choice (📋) behavior, and ignored-talk non-copying.

---

## What this test does (in plain English):

A multi-test file guarding against UI regressions across chatroom presence and talks list rendering. Three browsers available but each test uses only what it needs.

### Test 1 — Headcount Updates As Members Come And Go
Tom and Jerry share the automatic Nearby room; Tom's current-room row shows 2 (Nearby headcounts exclude TechSupport). Tom opens the room → "2 members total". Jerry's browser calls `manualCleanup` → Tom's open detail view drops to "1 member total" without a reload, and back on the list the row shows 1. (The old Global → area-room hop is retired with the tile tree.)

### Test 2 — First Screen Hydrates Existing Headcounts
Bob logs in as the third user and lands directly on the Chatrooms list. His current Nearby row should show headcount "3" *before* he clicks it (TechSupport is not counted). After opening the room, the status bar confirms "3 members total". Proves presence data is loaded on first render without requiring a manual refresh.

### Test 3 — Talks Rows Show States Without Redundant Controls
Jerry receives Tom's broadcast → incoming row has `talk-incoming-new` class. Jerry taps the row's 📋 toggle, then answers with match path → copied OUT row appears with `talk-broadcast-enabled` class and toggle shows "Broadcast On". No redundant edit badge in the row. Long-press on toggle flips to "Broadcast Off" (disabled class), back again to "On". Clicking the row opens editor modal (cancelable).

### Test 4 — Flow Talks Are Copied Only By Choice
Auto-save stays on (it only applies to tags). Jerry answers "match" for Flow talk A → role = "answered", no copy in OUT. On talk B's incoming row Jerry taps 📋 → copied (✓); taps again → the copy is dropped; taps again and answers → talk B is `data-role="copied"` in OUT, talk A still absent. Both talks appear in answer history.

### Test 5 — Ignored Talks Don't Copy
Jerry ignores a talk using an ignore answer → NOT copied to OUT list. In Me/Answers tab, the title appears but WITHOUT the edit-talk button (only creators can edit).

> **Why this matters:** These are regression tests for specific bugs that were fixed and should not recur: stale headcounts after members leave, auto-copy leaking into past answers, redundant UI controls in copied talk rows. Each subtest targets a concrete historical failure mode.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterNav`, `afterSync`, `confirmBroadcastTagPreambleIfVisible`, `broadcastFromGlobalChatroom`, `waitForBroadcastBulkAck`, `bootstrapUser`, `openIncomingTalkModal`, `resetTalksMatchingSession`, `finalCleanupPages`, `syncIncomingFromServer`, `waitForResponseModalClosed`, `waitForTabActive`, `createSimpleFlowTalk`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
