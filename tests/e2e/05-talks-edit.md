# Test: Talk Creation, Listing, and Editing

**Features tested:** Creating a "flow-type" talk, viewing talks in the Talks tab, editing existing talks with prefilled data

---

## What this test does (in plain English):

1. **A user logs in** and calls themselves "EditTestUser".

2. **The user creates a new talk** called "Coffee Meetup" with one question:
   - Question: "Do you drink coffee?"
   - Answer option 1: "Yes" → marked as "noticed" (matching branch)
   - Answer option 2: "No" → marked as "ignore" (non-matching branch)

3. **The user navigates to the Talks tab** and confirms:
   - The "Coffee Meetup" talk appears in the list
   - It shows a "Created" badge (indicating the user is the talk's creator)
   - An "Edit" button is visible

4. **The user clicks Edit.** The talk editor modal opens with:
   - The title "Coffee Meetup" already filled in
   - Talk type set to "flow" already selected
   - The question and answer options already prefilled

5. **The user changes the title** to "Coffee Meetup (Edited)" and saves.

6. **The user confirms the updated title** appears in the Talks tab.

## Verifications:

- ✅ New talks appear in the Talks tab with the "Created" badge and Edit button
- ✅ Clicking Edit opens the editor with all existing data pre-filled
- ✅ After editing and saving, the changes are reflected in the Talks tab
