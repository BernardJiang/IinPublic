# Test: UX — Contacts, Talks Navigation, and Answers Details

**Features tested:** Contacts include mismatched contacts, contacts and chatroom detail share the same peer info, Talk list splits into Incoming/Outgoing, Answers tab shows question + answer details

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

### Step 1: Each user creates and broadcasts a talk

1. **Tom creates** "Tom Out Talk" (question: "Do you want to join Tom?")
2. **Jerry creates** "Jerry Out Talk" (question: "Do you want to join Jerry?")
3. **Tom broadcasts** his talk, **Jerry broadcasts** his talk

### Step 2: Jerry answers Tom's talk

4. **Jerry receives Tom's talk** and answers "No thanks." (mismatch — NOT a match)

### Step 3: Tom's Contacts tab shows Jerry anyway

5. **Tom opens Contacts tab** → Jerry appears (even though they only have a mismatch, not a match)
6. **Tom clicks Jerry** → Jerry's contact detail shows:
   - Jerry's name
   - "2 talks" (both Tom's and Jerry's talks)
   - "Tom Out Talk" is listed

### Step 4: Same person from Chatroom vs Contacts

7. **Tom opens the Global chatroom** and clicks Jerry
8. **Jerry's peer detail overlay** opens (showing Jerry's name) — same information as the Contacts tab

### Step 5: Talks tab split navigation

9. **Tom opens the Talks tab** → sees both "Tom Out Talk" and "Jerry Out Talk" listed
10. **Tom clicks "IN" filter** → only shows "Jerry Out Talk" (talks Jerry sent to Tom)
11. **Tom clicks "OUT" filter** → only shows "Tom Out Talk" (talks Tom sent)
12. **Tom clicks "Back"** → shows both talks again

### Step 6: Jerry's Answers tab details

13. **Jerry opens the Answers tab** → sees:
    - The talk title "Tom Out Talk"
    - The original question: "Do you want to join Tom?"
    - His answer: "No thanks."
    - "1 item", "answered 1 time"
    - Labeled as "Mismatch"

## Verifications:

- ✅ Contacts list includes users who only interacted via mismatch (not just matches)
- ✅ Chatroom member detail and Contacts detail show the same peer
- ✅ Talks tab can be filtered by Incoming (IN) or Outgoing (OUT)
- ✅ Answers tab shows the question text, the answer given, and the Match/Mismatch status
