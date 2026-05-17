# Test: Tennis Partner — First Match (Basic Flow)

**Features tested:** First talk broadcast and match in the talk-matching system (basic Happy Path)

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

1. **Tom creates a talk** called "Tennis Partner" with the question: "Want a tennis partner?" (Yes = match, No = ignore)
2. **Tom broadcasts** the talk to everyone in the room
3. **Jerry opens his Talks tab** → sees "Tennis Partner" in his incoming list
4. **Jerry opens the talk modal**, answers "Yes, let's play." → **Match!**
5. **Both Tom and Jerry's apps** navigate/redirect after the match is confirmed

## Verifications:

- ✅ A newly created talk can be broadcast to all users in the same room
- ✅ The recipient sees the incoming talk in their Talks tab
- ✅ Answering the "match" branch triggers a successful match
- ✅ Both users' apps respond correctly after a match

> **Note:** This is the simplest "Hello World" test of the matching system — single talk, single responder, match path.
