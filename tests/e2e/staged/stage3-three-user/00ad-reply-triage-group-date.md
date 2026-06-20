# Test: Reply Triage — Group-By Options and Date Range Filter

**File:** 00ad-reply-triage-group-date.spec.ts  
**Features tested:** D6 creator reply triage UI — group-by (responder, talk, day), date range filtering (from/to), sort persistence across navigation, and clear-filters reset. Seeds a small 4×4 = 16-reply matrix for fast verification.

---

## What this test does (in plain English):

Complements the high-volume `00v-creator-reply-triage-matrix.spec.ts` by focusing on group-by controls and date range filters with a smaller dataset (MATRIX_SIZE=4, so 16 total replies). Runs faster while exercising the same UI components.

1. **Setup:** Single browser, fresh Gun database. Creates "GD Creator" identity, seeds 4 talks × 4 responders = 16 reply records via `importChampionReplyMatrixSnapshot`.
2. **Verify baseline:** Confirmation summary shows "(16 total)" and all 16 rows visible.
3. **Group by responder:** Selects "responder" → 4 groups appear, each header contains a "GD User N" stage name.
4. **Group by talk:** Selects "talk" → 4 groups appear, first header contains "Matrix Talk".
5. **Group by day:** Selects "day" → exactly 1 group (all replies seeded today).
6. **Reset grouping:** Selects "none" → zero group headers; all rows flat again.
7. **Date range — future "from":** Sets from-date to 2099 → summary shows "0 of 0 filtered", reply count = 0, active filter chip for "From" appears.
8. **Date range — past "to":** Clears from, sets to-date to last week → again "0 of 0 filtered".
9. **Clear all filters:** Clicks clear button → full set restored: "(16 total)", 16 rows, no active filter chips.
10. **Sort by talk-replies:** Selects sort option → all 16 rows still visible (sanity check).
11. **Sort persistence:** Navigates away to Settings then back to Talks → sort dropdown still shows "talk-replies" and data is intact.

> **Why this matters:** Validates grouping + date filtering work correctly at the UI layer. The small matrix makes this fast (~3 min) while covering the same D6 acceptance criteria. Sort persistence proves state survives tab switches.

---

**Helpers used:** `maybeClearGunDatabases`, `injectIdbClear`, `gotoWebApp`, `webAppURLStableChatroom`, `ensureWindowFitsViewport`, `attachE2eBrowserTabLabel`, `attachFilteredConsoleLog`, `afterAction`, `afterLoad`, `afterSync`, `waitForTabActive`, `buildMatrixTalks`, `importChampionReplyMatrixSnapshot`
