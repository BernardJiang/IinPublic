# Test: Tags — Checkbox Match/Ignore System

**Features tested:** Tag-type talks (simple checkbox yes/no), tag matching, mismatch handling, status bar match counts

---

## What this test does (in plain English):

Two users (Alice and Tom) are in the "Global" chatroom.

### Step 1: Alice creates two tags and broadcasts them

1. **Alice creates a tag called "Coffee"** (tag type = just a checkbox, no questions)
2. **Alice creates a tag called "Cat"** (same tag type)
3. **Alice broadcasts both tags** to the chatroom

### Step 2: Tom responds to each tag

4. **Tom opens the "Coffee" tag modal** → checks the checkbox → submits → this counts as a **Match!**
5. **Alice sees a "Match!" notification** for Coffee
6. **Tom opens the "Cat" tag modal** → leaves the checkbox **unchecked** → submits → this counts as **no match (ignore)**

### Step 3: Verification on Alice's side

7. **Alice opens her Talks tab:**
   - Shows "Matched with: Tom" for the Coffee tag
   - Status bar shows "1 match"

### Step 4: Verification on Tom's side

8. **Tom opens his Answers tab:**
   - Coffee tag is listed with status "Match"
   - Cat tag is listed with status "Mismatch"

## Verifications:

- ✅ Checking the checkbox on a tag produces a Match notification for both parties
- ✅ Leaving the checkbox unchecked produces no match (ignore)
- ✅ The Talks tab correctly shows match count and matched contacts
- ✅ The Answers tab correctly labels each tag as Match or Mismatch
