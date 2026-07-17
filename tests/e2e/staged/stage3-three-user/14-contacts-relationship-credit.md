# Test: Contacts Relationship Dialog — Nickname, Label, Rating, Notes Persistence

covers: SPEC-3.8, SPEC-7.9  <!-- auto-seeded; refine by hand -->

**File:** 14-contacts-relationship-credit.spec.ts
**Features tested:** Contact relationship editing, nickname persistence, label/relationship type, rating, notes, contact list display update

---

## What this test does (in plain English):

1. **Setup:** Three browsers (Tom, Jerry, Bob). Tom and Jerry join Global chatroom.

2. **Tom creates and broadcasts "Relationship Match Talk"** ("Want coffee?" with Yes/No answers). Jerry opens it and matches with "Yes".

3. **Tom opens contacts, clicks Jerry** — sees Jerry's contact detail.

4. **Tom edits relationship:** Clicks "Edit Relationship":
   - Label: "friend"
   - Nickname: "J"
   - Rating: 4
   - Notes: "coffee buddy"
   Clicks save — modal closes.

5. **Verification — Contact list updates:** The contacts list now shows Jerry as "J (Jerry)" with "Friend" label.

6. **Verification — Settings persist on re-open:** Clicking the updated contact, then re-editing the relationship — all fields (nickname "J", rating "4", notes "coffee buddy") are pre-filled with saved values.

> **Why this matters:** Verifies that the contact relationship dialog correctly saves and restores nickname, label, rating, and notes, and that the contacts list reflects nickname changes.

---

**Helpers used:** `clearGunDatabases`, `bootstrapUser`, `launchThreeBrowsers`, `resetTalksMatchingSession`, `finalCleanupPages`, `openIncomingTalkModal`, `confirmBroadcastTagPreambleIfVisible`, `waitForResponseModalClosed`, `waitForTabActive`