# Test: Contacts — Relationship Settings (Nickname, Label, Rating, Notes)

**Features tested:** Contact relationship editor, saving nickname/label/rating/notes, persistence of relationship settings

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

### Step 1: Create a match

1. **Tom creates a talk** ("Relationship Match Talk" — question: "Want coffee?")
2. **Tom broadcasts it**
3. **Jerry receives it** and answers "Yes" → **Match!**

### Step 2: Tom edits Jerry's relationship

4. **Tom opens the Contacts tab**, clicks Jerry
5. **Tom clicks "Edit Relationship"** → the relationship modal opens with these fields:
   - **Label:** changed from default to "Friend"
   - **Nickname:** set to "J"
   - **Rating:** set to 4 (out of 5)
   - **Notes:** set to "coffee buddy"
6. **Tom saves** the relationship → the modal closes

### Step 3: Tom verifies the updated relationship

7. **Tom goes back to the contacts list** → Jerry's name now shows as **"J (Jerry)"** (the nickname with real name in parentheses) with "Friend" label
8. **Tom clicks Jerry again** and opens the relationship editor → all fields are pre-filled with the saved values:
   - nickname = "J"
   - rating = "4"
   - notes = "coffee buddy"

## Verifications:

- ✅ The relationship editor allows editing nickname, label, rating, and notes
- ✅ Saved nickname appears before the real name in the contacts list
- ✅ Saved label (Friend) displays in the contacts list
- ✅ All fields persist and reappear when opening the editor again
