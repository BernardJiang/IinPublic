# Test: Talk Editor — Create Talk, View in Talks Tab, Edit with Prefilled Data

covers: SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**File:** 05-talks-edit.spec.ts  
**Features tested:** Talk creation, talk listing in Talks tab, edit talk with prefilled data, title and language update, flow-type talks

---

## What this test does (in plain English):

1. **Setup:** Single browser launched. Databases are cleared. User "EditTestUser" logs in and navigates to Chatrooms.

2. **User creates a talk:** Clicks "Create Talk", fills in the talk editor:
   - Title: "Coffee Meetup"
   - Language: Chinese
   - Type: "flow"
   - Question: "Do you drink coffee?"
   - Answer 1: "Yes" → status: "noticed" (match)
   - Answer 2: "No" → status: "ignore" (no match)
   Submits the form. After sync, the talk appears.

3. **Verification — Talks tab shows the talk:** The user clicks the Talks tab. The talk appears with its title, a "created" badge, and an "Edit" button.

4. **User clicks Edit:** The talk editor modal opens with all data prefilled, including the existing Chinese language selection.

5. **User edits the title and language** to "Coffee Meetup (Edited)" and Spanish, then saves.

6. **Verification — Updated data appears and reopens correctly:** After sync, the talk row shows the updated title and Spanish language badge; reopening it preserves Spanish in the editor.

> **Why this matters:** Verifies the complete talk CRUD cycle: creation, listing with badges, editing with prefilled data, and language changes remaining visible and persistent.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `attachE2eBrowserTabLabel`
