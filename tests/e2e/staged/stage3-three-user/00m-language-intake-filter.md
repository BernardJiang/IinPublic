# Test: Language Intake Filtering

covers: SPEC-3.2, SPEC-5.4  <!-- auto-seeded; refine by hand -->

**File:** 00m-language-intake-filter.spec.ts  
**Features tested:** Language-based talk delivery filtering — Jerry can toggle which languages he accepts (en, zh, es). Verifies that filter state persists across settings navigation and syncs to the Gun graph as `allowedLanguages`.

---

## What this test does (in plain English):

Two users (Tom sends, Jerry receives). Jerry controls which languages are accepted via Settings checkboxes. The test verifies:
1. Default: only English selected.
2. Jerry adds Chinese → count shows "2 active", both en and zh checked; Spanish still unchecked.
3. Jerry then adds Spanish → count becomes "3 active". Gun graph at `user-talk-filters/{userId}` confirms all three languages in `allowedLanguages` array.

Uses `launchThreeBrowsers()` helper but only Tom + Jerry are exercised (Bob slot unused).

> **Why this matters:** Language filtering is a core privacy/preference feature. Users in non-English locales shouldn't be flooded with talks they can't read. The test verifies the filter UI → localStorage → Gun persistence chain works without gaps.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `submitTalkEditorAndWaitForOut`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `syncIncomingFromServer`, `waitForIncomingTalkClusterOnServer`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
