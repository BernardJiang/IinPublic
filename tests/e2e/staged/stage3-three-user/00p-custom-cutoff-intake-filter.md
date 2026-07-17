# Test: Custom Phrase and Cutoff Intake Filtering

covers: SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00p-custom-cutoff-intake-filter.spec.ts  
**Features tested:** Two intake filter mechanisms with granular controls (1) custom blocked phrases gate delivery until cleared and (2) "sent-after" temporal cutoff blocks talks created before a threshold date. Verifies broadcast rejection via `talksSent: 0` ack count.

---

## What this test does (in plain English):

Two users (Tom sends, Jerry receives). Jerry configures custom blocked terms + sent-after cutoff via Settings. Tom broadcasts talks with titles that either match the blocked phrase or pre-date the cutoff — both should be rejected at delivery time (0 received). After clearing each filter, subsequent broadcasts succeed.

### Custom phrase blocking:
1. **Jerry sets blocked phrase** to `"eclipse invitation"` in `settings-custom-blocked` input → persists `customBlockedTerms: ["eclipse invitation"]` to localStorage + Gun graph.
2. **Tom creates & broadcasts** "Eclipse Invitation Blocked" → broadcast ack shows `talksSent: 0` (rejected by all receivers). Jerry's incoming list confirmed empty via `expectIncomingExcludes`.
3. **Jerry clears blocked phrase:** Empty string → `customBlockedTerms: []` in localStorage + Gun graph.

### Sent-after cutoff:
4. **Tom broadcasts** "Eclipse Invitation Allowed" (phrase cleared) → successfully received by Jerry (`waitForIncomingTalkClusterOnServer`).
5. **Jerry sets cutoff date** to `2099-01-01T00:00` → localStorage confirms, pushed to Gun graph.
6. **Tom broadcasts** "Cutoff Delivery Blocked" → rejected with `talksSent: 0`. Jerry's incoming empty. Settings page re-visits confirm cutoff value survived navigation.
7. **Jerry clears cutoff** → `sentAfter: undefined`, push update to Gun.

> **Why this matters:** Custom phrase blocking lets users filter spam or unwanted topics by keyword. The sent-after cutoff is a powerful privacy control — users can block old talks they missed while only receiving fresh broadcasts. Both rely on the server-side intake filter evaluation path. The `talksSent: 0` ack proves rejection happened at delivery, not just UI hiding.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `submitTalkEditorAndWaitForOut`, `waitForBroadcastBulkAck`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForIncomingTalkClusterOnServer`, `waitForTabActive`, `incomingClustersIncludeTitleForUser`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
