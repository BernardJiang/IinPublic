# Test: Content Intake Filtering — Grammar and Dirty-Words Moderation

covers: SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00o-content-intake-filter.spec.ts  
**Features tested:** Grammar check and profanity (dirty words) filter toggles in Settings → verifies default state is enabled, disabling persists to localStorage AND syncs to Gun graph at `user-talk-filters/{userId}`.

---

## What this test does (in plain English):

Two users (Tom sends, Jerry receives) in Global chatroom. Jerry navigates to Settings and toggles grammar + dirty-words moderation filters. The test verifies the full pipeline: UI checkbox → localStorage → current user object → Gun persistence.

1. **Setup:** Tom + Jerry bootstrapped and joined Global chatroom.
2. **Check defaults:** Both `settings-grammar-filter` and `settings-dirty-words-filter` checkboxes are checked by default. Confirmation text explains what each filter does (sentence length for grammar, English+Chinese profanity lists for dirty words).
3. **Disable both filters:** Jerry unchecks both → localStorage `requireGoodGrammar: false`, `blockDirtyWords: false`. Navigating to Talks then back to Settings confirms disabled state persists across tab switches.
4. **Push to Gun graph:** Jerry's filters object is rebuilt from localStorage and pushed via `updateTalkFilters(userId, filters)`. Polls Gun with exponential backoff (`[200, 500, 1000]`) to confirm `user-talk-filters/{userId}` reflects `[false, false]`.

> **Why this matters:** Content moderation filters protect users from low-quality or offensive talks. The test ensures disabling them is a deliberate two-step process (local + remote persistence). Since the broadcast path isn't exercised here (only filter config), the actual delivery-blocking behavior is covered by specs that combine filter config with talk creation.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `submitTalkEditorAndWaitForOut`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `syncIncomingFromServer`, `waitForIncomingTalkClusterOnServer`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
