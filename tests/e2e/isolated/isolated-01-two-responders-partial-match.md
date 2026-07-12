# Test: Two Responders — One Match, One Mismatch → Exactly 1 Match

**Features tested:** Match counting with multiple responders, conversation creation only for matches (not mismatches), conversation badge count

---

## What this test does (in plain English):

Three users: Tom, Jerry, and Bob, all in the "Global" chatroom.

### Step 1: Tom creates and broadcasts one talk

1. **Tom creates a talk** called "E2E Partial Match Tennis" (question: "Want tennis?" — Yes=match, No=ignore)
2. **Tom broadcasts it** to the room

### Step 2: Jerry matches, Bob mismatches

3. **Jerry answers** "Yes" → **Match!**
4. **Bob answers** "No" (no match)

### Step 3: Tom checks his conversations

5. **Tom's Me tab badge** shows "1" (exactly one unread conversation — from Jerry only)
6. **Tom's conversation list** shows **only Jerry** as a conversation partner
7. **Tom's conversation list has exactly 1 item** — Bob does NOT appear (since Bob was a mismatch, no conversation was created)

### Step 4: Jerry also sees Tom

8. **Jerry's Me tab badge** also shows "1" (unread conversation with Tom)

## Verifications:

- ✅ When two responders answer and only one matches, the broadcaster sees exactly 1 match (not 2)
- ✅ Mismatched responders do NOT create conversations
- ✅ The badge count reflects only actual matches
- ✅ Conversations are bidirectional — Tom sees Jerry, Jerry sees Tom
- ✅ Bob (the mismatched responder) remains invisible in Tom's conversation list

> **Why this matters:** Tests that the system correctly distinguishes between matches and mismatches and only creates conversational links for actual matches, even when the same talk is answered by multiple people.
