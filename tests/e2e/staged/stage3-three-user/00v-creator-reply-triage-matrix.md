# Test: Creator Reply Triage at Scale — 100-Reply Matrix

**File:** 00v-creator-reply-triage-matrix.spec.ts  
**Features tested:** D5 creator reply triage under high volume — a seeded dataset of 10 talks × 10 responders = 100 replies exercises pagination (page size 25), text search, outcome filter, relationship filter, and all four sorting modes. Validates the champion responder ranks #1 in match-rate and weighted-score sorts.

---

## What this test does (in plain English):

Single browser with a massive pre-seeded reply dataset. This is the "data-heavy" companion to `00ad-reply-triage-group-date.spec.ts` which tests the same UI layer at small scale. Here, pagination, filtering under volume, and sorting correctness are stress-tested.

1. **Setup:** Clear Gun DB, launch Chromium, login as "Tom Matrix Creator".
2. **Seed 100 replies** via `importChampionReplyMatrixSnapshot`: 10 talks × 10 responders where responder index 9 is the champion (all matches). Total = 100 reply records across `myQuestionAnswers` and creator-replies panel.
3. **Verify full dataset loads:** Summary shows "(100 total), Showing 25 of 100". Click "Load More" 3 times → all 100 rows visible.
4. **Text search by responder name:** Query `"Matrix User 9"` (champion) → exactly 10 rows match, active filter chip shows query text.
5. **Text search by talk title:** Query `"Matrix Talk 3"` → exactly 10 rows (one per responder for that talk).
6. **Outcome filter — mismatch:** Select "mismatch" → summary updates to show filtered count excluding the champion row (who matched everything) and partial-match responders. Clears afterward.
7. **Relationship filter — stranger:** All 100 replies from strangers → full set still matches.
8. **Clear filters:** Restores "(100 total)" baseline.
9. **Sort by match-rate:** Champion User 9 appears first (matched every talk). 
10. **Sort by talk-matches:** First row is "Matrix Talk 0" (every responder's first reply for that talk).
11. **Sort by weighted score:** Champion User 9 appears with highest composite score = `MATCH_SIZE * 100 + MATCH_SIZE` (derived from match rate weighting formula). Verified NOT containing any "TechSupport" seeded data.
12. **Persistence check:** Navigate to Settings, return to Talks → weighted sort still active, dataset intact.

> **Why this matters:** Creator reply triage is a critical feature for power users who receive dozens of replies daily. At 100+ replies the UI must paginate correctly, filter accurately, and sort deterministically. The champion-user invariant (always ranks #1 by match-rate) provides a stable assertion regardless of random data generation.

---

**Helpers used:** `maybeClearGunDatabases`, `injectIdbClear`, `gotoWebApp`, `webAppURLStableChatroom`, `ensureWindowFitsViewport`, `attachE2eBrowserTabLabel`, `attachFilteredConsoleLog`, `afterAction`, `afterLoad`, `afterSync`, `waitForTabActive`, `buildMatrixTalks`, `importChampionReplyMatrixSnapshot`
