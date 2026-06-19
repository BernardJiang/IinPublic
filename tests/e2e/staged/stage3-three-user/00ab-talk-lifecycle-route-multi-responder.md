# Test: Talk Lifecycle — Route Multi-Responder Matrix (D4)

**File:** 00ab-talk-lifecycle-route-multi-responder.spec.ts
**Features tested:** Route talk with two responders taking different DAG branches, one match + one mismatch, Me/Answers outcome labels

---

## What this test does (in plain English):

Three users: Tom, Jerry, and Bob, all in the "Global" chatroom.

1. **Tom creates a route talk** using `makeRouteTalk(RUN_ID)` with title `E2E FourTypes Route 900402` via the company page.
2. **Tom broadcasts** the route talk to everyone in the room, confirming 2 distinct Gun peers and waiting for bulk ACK.
3. **Jerry takes the match path:** answers "looking for job? → yes" (`a_r_job_yes`) then "engineer? → yes" (`a_r_role_yes`) which triggers `isMatch=true` — outcome is `match`.
4. **Bob takes the mismatch path:** answers "looking for job? → no" (`a_r_job_no`) which triggers `isIgnore=true` (terminal node) — outcome is `mismatch`.
5. **Tom's local ledger** is checked to confirm both peer-signed responses are stored (≥ 2 entries for this talkId).
6. **Jerry's Me/Answers tab** shows the route talk title as answered with a "Match" outcome label visible.
7. **Bob's Me/Answers tab** shows the same talk title as answered with a "Mismatch" outcome label visible.

## Verifications:

- ✅ Both responders' answers are recorded in the creator's local ledger.
- ✅ Jerry's DAG path (job yes → engineer yes) produces a Match outcome in his Me/Answers tab.
- ✅ Bob's DAG path (job no → ignore) produces a Mismatch outcome in his Me/Answers tab.
- ✅ Creator receives exactly 1 match from the two responders.

> **Why this matters:** Confirms that route talks correctly route different responders along different DAG branches, produce distinct outcomes (match vs mismatch), and display those outcomes per-user in Me/Answers.

---

**Helpers used:** `maybeClearGunDatabases`, `launchThreeBrowsers`, `shutdownThreeBrowsers`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForTabActive`, `createTalksFromCompanyPage`, `clickBroadcastUntilBulkAck`, `completeTalkInAppByAnswerIds`, `waitForDistinctGunPeersExcludingSelf`, `afterSync`, `afterAction`
