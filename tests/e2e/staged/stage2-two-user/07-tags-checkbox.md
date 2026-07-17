# Test: Tag Type — Create Tags, Checkbox Answers (Match/Ignore)

covers: SPEC-3.5  <!-- auto-seeded; refine by hand -->

**File:** 07-tags-checkbox.spec.ts  
**Features tested:** Tag-type talks, checkbox-based matching, broadcast of tags, match/mismatch outcomes, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Two browsers — Alice and Tom — both log in and join "Global" chatroom. Databases are cleared.

2. **Alice creates two tag-type talks:**
   - "Coffee" tag
   - "Cat" tag

3. **Alice broadcasts both tags** using the broadcast button with the tag preamble modal.

4. **Server confirms Tom received the broadcast:** Polls `/api/users/tom/incoming-talks` until at least 1 incoming talk arrives.

5. **Tom opens "Coffee" tag, checks the match checkbox, and submits** → Result: MATCH. Tom's status bar shows 1 match. Alice's status bar also confirms 1 match.

6. **Tom opens "Cat" tag, leaves checkbox UNchecked, and submits** → Result: MISMATCH (ignored).

7. **Alice verifies:** Opens the Talks tab — "Coffee" shows "Matched with: Tom". Status bar confirms "1 match".

8. **Tom verifies Answers tab:** "Coffee" is marked as Match, "Cat" is marked as Mismatch.

> **Why this matters:** Verifies the complete tag-type workflow — tags with checkbox matching work correctly for both match (checked) and ignore (unchecked) outcomes, and sync to the creator's view.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `openIncomingTalkModal`, `confirmBroadcastTagPreambleIfVisible`, `waitForStatusBarMatchCountAtLeast`, `waitForResponseModalClosed`
