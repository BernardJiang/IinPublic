# Test: Talk Editor — Create Talk, View in Talks Tab, Edit with Prefilled Data

**File:** 05-talks-edit.spec.ts  
**Features tested:** Talk creation, talk listing in Talks tab, edit talk with prefilled data, title update, flow-type talks

---

## What this test does (in plain English):

1. **Setup:** Single browser launched. Databases are cleared. User "EditTestUser" logs in and navigates to Chatrooms.

2. **User creates a talk:** Clicks "Create Talk", fills in the talk editor:
   - Title: "Coffee Meetup"
   - Type: "flow"
   - Question: "Do you drink coffee?"
   - Answer 1: "Yes" → status: "noticed" (match)
   - Answer 2: "No" → status: "ignore" (no match)
   Submits the form. After sync, the talk appears.

3. **Verification — Talks tab shows the talk:** The user clicks the Talks tab. The talk appears with its title, a "created" badge, and an "Edit" button.

4. **User clicks Edit:** The talk editor modal opens with all data prefilled — the existing title, type, question, and answers are visible.

5. **User edits the title** to "Coffee Meetup (Edited)" and saves.

6. **Verification — Updated title appears in the list:** After sync, the talk in the list now shows the updated title.

> **Why this matters:** Verifies the complete talk CRUD cycle: creation, listing with badges, editing with prefilled data, and title updates persisting correctly.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `attachE2eBrowserTabLabel`
