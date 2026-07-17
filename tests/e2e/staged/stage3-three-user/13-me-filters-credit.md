# Test: Me Tab Filters and Credit Visibility Toggle

covers: SPEC-3.8, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 13-me-filters-credit.spec.ts
**Features tested:** Talk type filters (survey/flow), credit visibility toggle, filtered broadcast delivery, peer relationship modal

---

## What this test does (in plain English):

1. **Setup:** Three browsers (Tom, Jerry, Bob) launched. Tom and Jerry join Global chatroom.

2. **Jerry adjusts Me tab settings:** Unchecks the "survey" talk type filter (so Jerry won't receive surveys) and unchecks "credit visibility" (hiding public credit). Navigates back and forth — settings persist.

3. **Tom creates and broadcasts two talks:**
   - "Filtered Flow Talk" (flow type: "Want to play tennis?")
   - "Filtered Survey Talk" (survey type: "How was the meetup?")

4. **Verification — Server-side filtering:** Polls `/api/users/jerry/incoming-talks` — only "Filtered Flow Talk" arrives. The survey talk was filtered out server-side because Jerry disabled survey reception.

5. **Verification — Jerry's Talks tab:** Shows only "Filtered Flow Talk". "Filtered Survey Talk" is absent. Jerry has exactly 1 incoming talk.

6. **Jerry answers the flow talk with "Yes"** (match).

7. **Verification — Credit visibility preserved in contact detail:** Tom opens his contacts, clicks Jerry, clicks "Edit Relationship" — the relationship modal shows "Public credit" text (the credit visibility setting is preserved and visible in the relationship dialog).

> **Why this matters:** Verifies that Me tab talk type filters work at the server level (not just UI filtering), credit visibility settings persist across navigation, and the relationship modal correctly reflects privacy settings.

---

**Helpers used:** `clearGunDatabases`, `bootstrapUser`, `launchThreeBrowsers`, `resetTalksMatchingSession`, `finalCleanupPages`, `syncIncomingFromServer`, `openIncomingTalkModal`, `confirmBroadcastTagPreambleIfVisible`, `waitForBroadcastBulkAck`, `waitForResponseModalClosed`, `waitForTabActive`