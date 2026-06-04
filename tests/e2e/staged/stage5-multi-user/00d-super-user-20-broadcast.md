# Test: Super User — TechSupport Creates 20 Talks (10 Tags + 10 Talks), Tom Completes All

**File:** 00d-super-user-20-broadcast.spec.ts
**Features tested:** Bulk talk creation via super user/companyp page, large-scale pair-direct broadcast (20 talks), bulk completion by responder, status bar verification, local incoming index verification, localStorage ledger verification

---

## What this test does (in plain English):

1. **Setup:** Two browsers — TechSupport and Tom — both log in via `bootstrapSuperUser` and join "Global" chatroom.

2. **TechSupport creates 20 talks** using the company page demo (API-based creation):
   - 10 tag-type talks (from `TAG_NAMES` list)
   - 10 flow-type talks (from `TALK_TITLES` list)
   All are created with 1 question each, matching/ignoring answers, and self-answers set to match.

3. **Tom joins Global.** Waits for pair-direct broadcast delivery and confirms Tom's local incoming index has received talks.

4. **Tom completes all 20 talks** using `completeTalksInAppByAnswerIds` — each talk is opened and answered with the matching answer. Timeout extended to 120 seconds.

5. **TechSupport end-of-flow verification:**
   - Opens Talks tab — confirms at least one "Matched with:" line
   - Status bar shows "20 matches"
   - Poll confirms 20 matches in status bar text

6. **Tom end-of-flow verification:**
   - Answers tab: polls localStorage to confirm all 20 expected titles are present with "answered" role and "match" outcome
   - Answers tab UI: shows at least 20 answer-talk-item entries with "Match" text
   - Local incoming index: confirms at least 20 talk slots remain

> **Why this matters:** Verifies the system handles 20 simultaneous broadcasts — creation, delivery, completion, and end-state verification all work correctly at this scale. Performance and data integrity under load.

---

**Helpers used:** `clearGunDatabases`, `bootstrapSuperUser`, `createTalksFromCompanyPage`, `completeTalksInAppByAnswerIds`, `waitForTabActive`, `countIncomingTalkSlots`
