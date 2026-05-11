# Test: Profile — Edit Stage Name and Public Profile, Peer Visibility

**File:** 04-profile-edit-stage-name.spec.ts  
**Features tested:** Stage name editing, public profile Q&A editing, profile persistence, server-side propagation, peer visibility of profile data, avatar setting, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Two browsers launched (Tom's browser and Jerry's browser). Databases are cleared. Tom logs in with stage name "Tom".

2. **Tom creates profile:** Tom edits stage name to "Tom", verifies the stage name appears in the UI header.

3. **Tom edits public profile:** Clicks "Edit Profile", selects avatar emoji (😎), sets languages to "en, zh", adds two Q&A entries:
   - "Favorite drink" → "Coffee"
   - "Usual city" → "San Francisco"
   Clicks save.

4. **Verification — Profile displays on Tom's own page:** The profile section shows languages, Q&A entries, and the emoji avatar. The server API is polled to confirm the user object has `languages: [en, zh]` and `profile` array with 2 entries.

5. **Jerry (peer) logs in, navigates to Global chatroom with Tom:** Jerry clicks on Tom's name in the chatroom member list. Tom's profile detail overlay opens for Jerry.

6. **Verification — Jerry sees Tom's complete profile:** Jerry can see "Public Profile", "Languages: en, zh", "Favorite drink: Coffee", "Usual city: San Francisco", and the 😎 emoji avatar.

> **Why this matters:** Verifies that profile edits (stage name, avatar, languages, Q&A) persist to the server and are visible to other users viewing the profile — proving cross-user profile sync works.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterNav`, `afterAction`, `attachE2eBrowserTabLabel`
