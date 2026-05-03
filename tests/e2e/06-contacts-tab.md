# Test: Contacts Tab — Matching & Viewing Shared Talks

**Features tested:** Contacts list after talk matching, per-contact detail showing which talks matched, bidirectional contact visibility

---

## What this test does (in plain English):

Three users (Tom, Jerry, Bob) are in the "Global" chatroom. Tom creates two talks and broadcasts them.

### Step 1: Tom creates and broadcasts two talks

1. **"Tennis" talk** — Question: "Want a tennis partner?" (Yes = match, No = ignore)
2. **"Coffee" talk** — Question: "Want to grab coffee?" (Yes = match, No = ignore)

### Step 2: Jerry and Bob answer

3. **Jerry answers:**
   - Tennis → "Yes, let's play." (**Match!**)
   - Coffee → "Not now." (No match)

4. **Bob answers:**
   - Coffee → "Yes, coffee sounds good." (**Match!**)
   - Tennis → "No thanks." (No match)

### Step 3: Tom's Contacts tab

5. **Tom's Contacts tab** should show **Jerry** and **Bob** (both matched on at least one talk).

### Step 4: Tom clicks each contact

6. **Tom clicks Jerry** → should show:
   - Contact detail showing Jerry's name
   - The matching talk: "Tennis"

7. **Tom clicks Bob** → should show:
   - Contact detail showing Bob's name
   - The matching talk: "Coffee"

### Step 5: Jerry and Bob see the reverse

8. **Jerry's Contacts tab** shows Tom → clicking Tom shows the "Tennis" talk
9. **Bob's Contacts tab** shows Tom → clicking Tom shows the "Coffee" talk

## Verifications:

- ✅ Both matched users appear in Tom's Contacts list (not the users who didn't match)
- ✅ Clicking a contact shows only the talks that matched between that pair
- ✅ Contacts relationship is bidirectional — Jerry sees Tom, Bob sees Tom
- ✅ Each contact detail shows only the relevant matching talks (Tennis for Jerry, Coffee for Bob)
