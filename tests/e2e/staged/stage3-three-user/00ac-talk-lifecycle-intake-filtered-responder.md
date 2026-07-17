# Test: Intake-Filtered Responder — Flow Talk Blocked for Bob

covers: SPEC-3.6, SPEC-3.4, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00ac-talk-lifecycle-intake-filtered-responder.spec.ts  
**Features tested:** Phase D4 multi-responder matrix — when Bob has flow talk type filtered out in intake settings, Tom's broadcast reaches Jerry (who matches) but Bob never receives the talk. Creator sees exactly 1 match from Jerry.

---

## What this test does (in plain English):

Tests the "filtered responder" scenario in a three-user setup: Tom broadcasts a flow talk, Jerry answers and matches, but Bob has intake-filtered flow talks so the broadcast is rejected server-side before Bob even receives it.

1. **Setup:** Three browsers — Tom (sender), Jerry (active responder), Bob (filtered responder).
2. **Bob configures intake filter:** Goes to Settings → unchecks "flow" in talk type filters → persists via `updateTalkFilters`. Verifies localStorage confirms flow is not in `allowedTalkTypes`.
3. **Tom creates & broadcasts flow talk** ("Lifecycle Matrix Flow Intake Filtered") via company page. Waits for Gun peer awareness (2 peers). Broadcasts until bulk ack.
4. **Jerry completes the talk** with match answer IDs → MATCH outcome recorded.
5. **Creator sees exactly 1 match:** Tom's status bar shows ≥1 match (only from Jerry, not Bob).
6. **Bob's IN list stays empty:** Syncs incoming talks from server → flow talk title is NOT present in Bob's talk list.
7. **Bob's Me/Answers tab clean:** No answered entry for this talk — proving Bob never received it at all (not just that he ignored it).

> **Why this matters:** Validates that intake type filtering works as a delivery gate — the server rejects talks matching filtered types before they ever reach the user. This is different from a user simply answering "ignore"; it proves end-to-end blocking at the ingestion layer. Part of the Phase D4 talk lifecycle matrix.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `createTalksFromCompanyPage`, `completeTalkInAppByAnswerIds`, `waitForDistinctGunPeersExcludingSelf`, `waitForStatusBarMatchCountAtLeast`, `buildFlowTalkPayload`, `flowMatchAnswerIds`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `syncIncomingFromServer`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
