# Test: Distance Intake Filtering

covers: SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00n-distance-intake-filter.spec.ts  
**Features tested:** Geographic distance filtering for talk delivery — Jerry configures min/max distance bounds (1-3 miles), then resets to [0, 0] (any distance). Verifies both the localStorage persistence and the Gun graph sync of `minDistanceMiles` / `maxDistanceMiles`.

---

## What this test does (in plain English):

Two users (Tom sends, Jerry receives). Jerry sets distance constraints via Settings inputs. The test exercises the full filter lifecycle: configure bounds → persist to localStorage → push to Gun graph → navigate away and back → verify values survived. Then reset to "any distance" mode.

1. **Setup:** Tom + Jerry in Global chatroom.
2. **Jerry sets min=1, max=3 miles** in Settings → Tab out of each input triggers validation. Confirms localStorage has `[1, 3]`, Gun `filtersJson` path also stored with same values via `updateTalkFilters`.
3. **Navigate to Talks then back to Settings** → inputs still show 1 and 3 (persistence across tabs).
4. **Jerry resets both to 0** → localStorage confirms `[0, 0]`, pushes update to Gun graph. Polls Gun with exponential backoff to confirm `user-talk-filters/{userId}` reflects the reset.

> **Why this matters:** Distance filtering is a key geo-social feature. Jerry sets bounds → Tom's broadcast respects them (in practice, filtered server-side). This test focuses on the filter *configuration and persistence* pipeline rather than the delivery blocking itself (which is tested in other specs). The [0, 0] reset proves "no constraint" mode works correctly.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `submitTalkEditorAndWaitForOut`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `syncIncomingFromServer`, `waitForIncomingTalkClusterOnServer`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
