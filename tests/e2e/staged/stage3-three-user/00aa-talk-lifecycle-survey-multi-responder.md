# Test: Talk Lifecycle — Survey Multi-Responder Matrix (D4)

covers: SPEC-3.9, SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**File:** 00aa-talk-lifecycle-survey-multi-responder.spec.ts
**Features tested:** Survey talk with two responders, aggregate stats for creator, no match notifications, Me/Answers entries per responder

---

## What this test does (in plain English):

Three users: Tom, Jerry, and Bob, all in the "Global" chatroom.

1. **Tom creates a survey talk** using `makeSurveyTalk(RUN_ID)` with title `E2E FourTypes Survey 900401` via the company page.
2. **Tom broadcasts** the survey talk to everyone in the room, waiting for bulk ACK after confirming 2 distinct Gun peers online.
3. **Jerry answers with rating '1'** (answer ID `a_sv_1`) — outcome recorded as `mismatch` (surveys have no match concept).
4. **Bob answers with rating '2'** (answer ID `a_sv_2`) — also recorded as `mismatch`.
5. **Tom's local ledger** is checked to confirm both peer-signed responses are stored (≥ 2 entries for this talkId).
6. **Tom does NOT get a match notification** — status bar text is verified to not contain "1 match" since surveys never produce matches.
7. **Jerry's Me/Answers tab** shows the survey title as an answered entry.
8. **Bob's Me/Answers tab** also shows the same survey title as an answered entry.

## Verifications:

- ✅ Both responders' answers are recorded in the creator's local ledger.
- ✅ Creator receives no match notification for survey-type talks.
- ✅ Each responder sees the survey as "answered" in their own Me/Answers tab.
- ✅ Survey outcomes use `mismatch` label (no match concept).

> **Why this matters:** Confirms that survey talks behave differently from matching talks — they aggregate responses without producing matches, and each responder's answer is reflected in their personal history.

---

**Helpers used:** `maybeClearGunDatabases`, `launchThreeBrowsers`, `shutdownThreeBrowsers`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForTabActive`, `createTalksFromCompanyPage`, `clickBroadcastUntilBulkAck`, `completeTalkInAppByAnswerIds`, `waitForDistinctGunPeersExcludingSelf`, `afterSync`, `afterAction`
