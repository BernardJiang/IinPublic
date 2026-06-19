# Test: Contacts — Stranger Default → Save Relationship → Sort (D6)

**File:** 00ae-contacts-stranger-relationship.spec.ts  
**Features tested:** New match starts as "Stranger" in Contacts tab, relationship can be saved as Friend/Following/Blocked etc., relationships sort/filter/persist correctly across reload.

---

## What this test does (in plain English):

Two users: Tom and Jerry. After matching on a talk, Jerry should appear in Tom's Contacts with "Stranger" default label. Tom then edits relationship to "Friend", verifies the UI update, navigates away and back, and confirms persistence. Additional relationships tested by injecting raw data programmatically.

1. **Setup:** Two headless Chromium browsers for Tom & Jerry in Global chatroom.
2. **Tom creates flow talk** `"Tennis Partner"` → broadcasts it.
3. **Jerry answers match branch.** Status bar shows ≥1 match on both pages.
4. **Stranger default:** Tom opens Contacts → Jerry appears in list with "stranger" meta label. Detail view confirms Stranger status.
5. **Save relationship:** Click Edit Relationship → select "Friend" from dropdown → save.
6. **Update confirmed:** Back to list → Jerry now shows "Friend" (not "Stranger").
7. **Sort verification:** Sort by relationship → Friend-sorted visible; sort back to weighted.
8. **Persistence across reloads:** Navigate Contacts list → detail → full page reload at detail URL `#/contacts/jerry-id` → after sync, profile still shows Jerry's ID and name, and meta label still "Friend" (loaded from encrypted localStorage).

9. **Additional relationships via programmatic injection:** Inject four more contacts with Blocked, Following, Co-worker, and Mentor relationships → filter by each type using `#contacts-filter-relation` dropdown → verify correct count per filter (1–2 depending on label) → toggle between all/stranger/friend/specific labels.

## Verifications:

- ✅ New match defaults to "Stranger" in Contacts meta line
- ✅ Relationship can be changed from Stranger to Friend and UI updates immediately
- ✅ Relationship persists after full page reload at contact detail URL (#/contacts/jerry-id)
- ✅ Sort by relationship works (Friend, Blocked, Following, Co-worker, Mentor all sortable/filterable)
- ✅ Filter dropdown correctly restricts visible contacts per relationship label

> **Why this matters:** Validates the entire relationship lifecycle — from first match to edit, persist, filter, and sort. D6 acceptance closure for Contacts tab.

---

**Helpers used:** `maybeClearGunDatabases`, `injectIdbClear`, `gotoWebApp`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `bootstrapUser`, `createTalksFromCompanyPage`, `completeTalkInAppByAnswerIds`, `waitForStatusBarMatchCountAtLeast`, `attachE2eBrowserTabLabel`, `attachFilteredConsoleLog`
