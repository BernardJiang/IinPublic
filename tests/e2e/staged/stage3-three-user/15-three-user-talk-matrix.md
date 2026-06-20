# Test: Three-User Complete Talk Matrix — 36 Talks Per User, All Matched

**File:** 15-three-user-talk-matrix.spec.ts  
**Features tested:** The heaviest stress test in the suite — each of three users publishes a 3×4 talk set (3 tag + 3 flow + 3 survey + 3 route = 12 talks per user). Every received talk (24 from others) is answered as MATCH. Verifies the complete talk ledger counts (IN, OUT, ALL, filtered by type) and flattened Me answer history across all question types.

---

## What this test does (in plain English):

The "kitchen sink" scenario: Tom, Jerry, and Bob each create 12 distinct talks covering all four types (tag = 1 question, flow = 2 questions, survey = 2 questions, route = 4 questions). Then every user answers all 24 incoming talks from the other two users as MATCH. The resulting state is then exhaustively verified.

### Talk composition per user:
| Type | Count | Questions/Talk | Total Q per User |
|------|-------|----------------|------------------|
| Tag | 3 | 1 | 3 |
| Flow | 3 | 2 | 6 |
| Survey | 3 | 2 | 6 |
| Route | 3 | 4 | 12 |
| **Total** | **12** | — | **27** (self-answered) + 54 incoming = **81 answered questions per user** |

### Verification:
1. **Setup:** Clear Gun DB, `launchThreeBrowsers()`, each user bootstraps with unlimited talk ledger quota (`setTalkLedgerQuotaUnlimitedForE2e(true)`) and auto-copy disabled. All join Global chatroom.
2. **Each user creates 12 talks** via company page JSON API with unique runId-based titles (e.g., `matrix-<ts> Tom flow 1`). Waits for Gun peer awareness (≥2 peers).
3. **Broadcast:** Each user broadcasts until ack'd with `minGunPeers: 2, minSent: 12` — confirms all 12 talks delivered to both other users.
4. **Answer all incoming:** Each recipient answers the other two users' 24 talks as MATCH via `completeTalksInAppByAnswerIds`.
5. **Talk ledger verification per user:**
   - ALL: 36 talks (12 own + 24 from others)
   - IN: 24 talks (received from other two users)
   - OUT: 12 talks (own created talks — auto-copy is OFF so matched-incoming stays in IN not moved to OUT)
   - Type filter "route": 9 route talks (3 own + 6 from others)
6. **Me/Answers tab verification per user:** 54 total question-item rows (from answering 24 incoming talks). Toggle each type filter → tag shows 6 visible items, flow shows 12, survey shows 12, route shows 24.

> **Why this matters:** This is the ultimate integration test for the talk ledger + answer history system. It exercises ALL four talk types, multi-user exchange, broadcast delivery with high volume, matching aggregation, IN/OUT categorization with auto-copy disabled, type-based filtering at both levels (talks list + Me answers), and verifies exact counts. At ~720s timeout it's the longest-running spec — designed to catch state leak bugs that only appear under high load. The 54-question answer count provides a precise mathematical invariant: `(3 tag users × 1q) + (3 flow × 2 users × 2q) + (3 survey × 2 × 2q) + (3 route × 2 × 4q) = 6+12+12+24 = 54`.

---

**Helpers used:** `maybeClearGunDatabases`, `clickBroadcastUntilBulkAck`, `completeTalksInAppByAnswerIds`, `createTalksFromCompanyPage`, `waitForDistinctGunPeersExcludingSelf`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession', 'waitForTabActive', 'launchThreeBrowsers', 'shutdownThreeBrowsers`
