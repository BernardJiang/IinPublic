# Test: Super User — Copy Talk, Broadcast Toggle & Delete

**Features tested:** Copying a received talk to your own collection, enabling/disabling broadcast for copied talks, deleting talks from history

---

## What this test does (in plain English):

Two users: "TechSupport" (talk creator) and "Tom" (talk receiver and copier).

### Step 1: TechSupport creates and broadcasts one talk

1. **TechSupport creates a talk** called "CopyTestTalk" with a simple question: "Want to connect for CopyTestTalk?" (Yes/No)
2. **TechSupport broadcasts it** to the chatroom

### Step 2: Tom receives, answers, and copies the talk

3. **Tom receives the talk** in his Talks tab, opens it, and answers "Yes, match." → it's saved to his Answers tab
4. **Tom copies the talk** from the Answers tab → it now appears in his Talks list as a "Copied" talk
5. **Tom disables broadcast** for the copied talk (toggles a switch)

### Step 3: Verify disabling removes it from broadcast

6. **Tom clicks "Broadcast"** → the system should NOT include "CopyTestTalk" because broadcast was disabled

### Step 4: Re-enable and verify it's back

7. **Tom re-enables broadcast** for "CopyTestTalk"
8. **Tom clicks "Broadcast"** → now "CopyTestTalk" should be included

### Step 5: Delete the copied talk

9. **Tom opens "My Talks"** from the Me tab
10. **Tom deletes "CopyTestTalk"** from his talk history
11. **The UI shows "Talk removed from history"** confirmation
12. **Tom opens "My Talks" again** → "CopyTestTalk" is gone

## Verifications:

- ✅ Received talks can be copied to the user's own talk collection
- ✅ Disabling broadcast for a copied talk excludes it from broadcast
- ✅ Re-enabling broadcast includes it again
- ✅ Deleting a talk removes it permanently from the talk history
