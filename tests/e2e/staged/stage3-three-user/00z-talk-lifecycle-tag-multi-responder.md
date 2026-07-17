# Test: Talk Lifecycle — Tag Multi-Responder Matrix

covers: SPEC-3.5, SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**File:** 00z-talk-lifecycle-tag-multi-responder.spec.ts  
**Features tested:** Phase D4 tag talk lifecycle with multiple responders — Tom broadcasts a tag talk, Jerry checks the box (match), Bob leaves it unchecked (mismatch). Creator sees exactly 1 match in status bar. Me/Answers tab for each responder shows the correct outcome.

---

## What this test does (in plain English):

Three users in Global chatroom exercising tag-talk semantics with asymmetric outcomes. Tag talks use checkbox UI (checked = match, unchecked = mismatch) rather than radio-button flow answers — so this test validates the tag-specific matching path.

1. **Setup:** Three browsers — Tom (creator), Jerry (match responder), Bob (mismatch responder). All bootstrapped in Global.
2. **Tom creates & broadcasts** tag talk ("Lifecycle Matrix Tag") via `buildTagTalkPayload()` JSON API. Waits for 2 Gun peers, broadcasts until bulk ack.
3. **Jerry matches:** Completes incoming talk with `tagMatchAnswerIds()` → MATCH outcome (checkbox checked).
4. **Bob mismatches:** Completes same talk with `tagIgnoreAnswerIds()` → MISMATCH outcome (checkbox unchecked).
5. **Creator match count:** Tom's status bar shows ≥ 1 (only Jerry counted as match — Bob ignored).
6. **Jerry verifies Me/Answers tab:** Talk title visible + "Match" badge present at top of answer list.
7. **Bob verifies Me/Answers tab:** Same talk title visible but outcome reads "Mismatch".

> **Why this matters:** Tag talks have distinct matching semantics from flow (checkbox vs radio buttons) and don't trigger P2P conversation creation. The test proves tag-type broadcasting, checkbox-based response recording, and creator-side match aggregation all work correctly with multiple asymmetric responders. Complements `00w-talk-lifecycle-flow-multi-responder` which covers the same D4 matrix pattern for flow type.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `createTalksFromCompanyPage`, `completeTalkInAppByAnswerIds`, `waitForDistinctGunPeersExcludingSelf`, `waitForStatusBarMatchCountAtLeast`, `buildTagTalkPayload`, `tagMatchAnswerIds`, `tagIgnoreAnswerIds`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
