# Test: Chatrooms and Talks UI Regressions

**File:** 00l-chatroom-talks-ui-regressions.spec.ts  
**Features tested:** Five regression tests protecting chatroom headcount updates on room switches/Return Home, first-screen hydration of existing headcounts, talks row states (new/copied/broadcast toggle), auto-copy toggle behavior, and ignored-talk non-copying.

---

## What this test does (in plain English):

A multi-test file guarding against UI regressions across chatroom presence and talks list rendering. Three browsers available but each test uses only what it needs.

### Test 1 — Headcount Updates Across Room Switches
Tom starts in Global with headcount showing 3, then navigates to North America and back → headcount should drop to 2 (Tom left), then clicks Return Home button → lands on San Diego room showing "1 member total". After Jerry's browser calls `manualCleanup`, Tom still sees "1 member total" (not affected by other browser cleanup).

### Test 2 — First Screen Hydrates Existing Headcounts
Bob logs in as fourth user, lands directly on the Chatrooms list. Global should show headcount "4" *before* Bob even clicks the room. After clicking Global, status bar confirms "4 members total". Proves presence data is loaded on first render without requiring a manual refresh.

### Test 3 — Talks Rows Show States Without Redundant Controls
Jerry receives Tom's broadcast → incoming row has `talk-incoming-new` class. Jerry answers with match path → copied OUT row appears with `talk-broadcast-enabled` class and toggle shows "Broadcast On". No redundant edit badge in the row. Long-press on toggle flips to "Broadcast Off" (disabled class), back again to "On". Clicking the row opens editor modal (cancelable).

### Test 4 — Auto-Copy Toggle Controls Durably
Jerry has auto-copy disabled, answers "match" for talk A → role = "answered", no copy to OUT. Jerry enables auto-copy in Settings, answers "match" for talk B → talk B appears as `data-role="copied"` in OUT list, talk A still absent from copied list (past behavior unchanged). Both talks appear in answer history.

### Test 5 — Ignored Talks Don't Copy
Jerry ignores a talk using an ignore answer → NOT copied to OUT list. In Me/Answers tab, the title appears but WITHOUT the edit-talk button (only creators can edit).

> **Why this matters:** These are regression tests for specific bugs that were fixed and should not recur: stale headcounts after room switches, auto-copy leaking into past answers, redundant UI controls in copied talk rows. Each subtest targets a concrete historical failure mode.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterNav`, `afterSync`, `confirmBroadcastTagPreambleIfVisible`, `broadcastFromGlobalChatroom`, `waitForBroadcastBulkAck`, `bootstrapUser`, `openIncomingTalkModal`, `resetTalksMatchingSession`, `finalCleanupPages`, `syncIncomingFromServer`, `waitForResponseModalClosed`, `waitForTabActive`, `createSimpleFlowTalk`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
