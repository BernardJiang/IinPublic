# Test: Two Talks, Two Responders — Status Bar & Answers Tab

**Features tested:** Multiple talks broadcast to multiple responders, mixed match/mismatch patterns, status bar match count, Answers tab listing

---

## What this test does (in plain English):

Three users: Tom, Jerry, and Bob, all in the "Global" chatroom.

1. **Tom creates two talks:**
   - "TwoTalks e2e Tennis" (question: "Want tennis?")
   - "TwoTalks e2e Coffee" (question: "Coffee?")
   Both have Yes=match and No=ignore branches.

2. **Tom broadcasts** both talks

3. **Jerry answers:**
   - Tennis → "Yes" (**Match!**)
   - Coffee → "No" (Mismatch)

4. **Bob answers:**
   - Coffee → "Yes" (**Match!**)
   - Tennis → "No" (Mismatch)

5. **Tom checks the status bar** → it should show "2 matches" (one from Jerry for tennis, one from Bob for coffee)

6. **Jerry opens the Answers tab** → both "TwoTalks e2e Tennis" and "TwoTalks e2e Coffee" appear listed

## Verifications:

- ✅ When different responders match on different talks, the status bar correctly counts all matches (not per-responder)
- ✅ Each responder's Answers tab shows ALL talks they answered (not just the matches)
- ✅ Tom has 2 total matches from 2 different people on 2 different topics
