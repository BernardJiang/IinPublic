# Test: Talk Type Intake Filtering

covers: SPEC-3.6, SPEC-3.4, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00t-talk-type-intake-filter.spec.ts  
**Features tested:** Talk type-based intake gating — Jerry configures allowed talk types to `["flow"]` only (survey, tag, route all unchecked). Tom broadcasts a tag talk → it is rejected at delivery time with `talksSent: 0` and never appears in Jerry's incoming list.

---

## What this test does (in plain English):

Two users (Tom sends, Jerry receives) in Global chatroom. Jerry goes to Settings and unchecks survey, tag, route — leaving only flow enabled. Then Tom creates and broadcasts a tag talk → delivery is blocked before reaching Jerry.

1. **Setup:** Both users bootstrapped and joined Global.
2. **Jerry configures filter:** Unchecks `.settings-talk-filter-type` for survey, tag, route. Flow remains checked. Calls `updateTalkFilters(userId, talkFilters)` to push to Gun graph. Confirms localStorage `allowedTalkTypes === ["flow"]`. Verifies via two separate filter-persist calls (once from currentUser.talkFilters, once rebuilt from localStorage).
3. **Tom creates tag talk** ("Type Intake Tag Rejected") via `createTagTalk()` which uses the tag-type editor path (different from flow).
4. **Broadcast rejected:** Tom clicks broadcast → ack shows `talksSent: 0` (rejected by Jerry who has only flow enabled).
5. **Jerry's incoming verified empty:** Syncs from server, polls `incomingClustersIncludeTitleForUser` → returns false. Talks list confirmed no matching title text.

> **Why this matters:** Type filtering is the coarsest-grained intake control — users can exclude entire categories of talks (e.g., only want flow discussions, not surveys or tags). The test proves rejection happens at the broadcast-layer ack, meaning Jerry never receives junk data just to filter it client-side. Complements `00ac-talk-lifecycle-intake-filtered-responder` which uses the same mechanism with three users and an actual match path.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `submitTalkEditorAndWaitForOut`, `selectTalkEditorType`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `syncIncomingFromServer`, `waitForTabActive`, `incomingClustersIncludeTitleForUser`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
