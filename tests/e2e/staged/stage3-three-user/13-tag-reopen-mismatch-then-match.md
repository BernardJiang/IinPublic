# Test: Tag — Reopen Mismatch and Change to Match

covers: SPEC-3.5, SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**Features tested:** Reopening already-answered tags, changing a mismatch to a match, updated sync between broadcaster and responder

---

## What this test does (in plain English):

Two users: Alice and Tom, both in the "Global" chatroom.

### Step 1: Alice broadcasts a tag

1. **Alice creates a tag** called "E2E Tag Reopen Coffee"
2. **Alice broadcasts it** to the room

### Step 2: Tom ignores the tag (unchecked)

3. **Tom opens the tag modal** → leaves the checkbox **unchecked** → submits
4. **NO "Match!" notification** appears for either Alice or Tom
5. **Tom's Answers tab** shows the tag labeled as "Mismatch"

### Step 3: Tom reopens the tag and checks the box

6. **Tom reopens the same tag** (navigates back to it)
7. **Tom checks the checkbox** this time → submits
8. **Now both sides' status bars** show "1 match"
9. **Tom's Answers tab** now shows the same tag labeled as "Match" (changed from Mismatch)

## Verifications:

- ✅ A tag that was initially submitted as unchecked (mismatch) can be reopened
- ✅ Changing the checkbox from unchecked to checked converts a mismatch into a match
- ✅ Both the broadcaster and responder see the updated match count
- ✅ The Answers tab reflects the change (Mismatch → Match for the same tag)
- ✅ The system handles answer overwrites correctly without data corruption
