# Test: Profile Editing — Stage Name & Public Profile

**Features tested:** User profile creation, stage name editing, public profile Q&A fields, real-time profile visibility between peers

---

## What this test does (in plain English):

### Step 1: First user (Tom) sets up profile

1. **Tom logs in** as a new user.
2. **Tom edits their "Stage Name"** to "Tom" — this is their display name.
3. **Tom confirms the stage name appears** both on their profile page and in the header bar.
4. **Tom edits their public profile** with the following details:
   - Avatar: 😎 emoji
   - Languages: "en, zh" (English and Chinese)
   - Q1: "Favorite drink" → answer "Coffee"
   - Q2: "Usual city" → answer "San Francisco"
5. **Tom saves the profile.**
6. **The test checks the server API** to verify Tom's profile data (languages and 2 profile Q&As) was properly saved and propagated to the backend.

### Step 2: Second user (Jerry) sees Tom's profile

7. **Jerry logs in** as a separate user.
8. **Both Tom and Jerry enter the "Global" chatroom.**
9. **Jerry sees Tom in the member list**, clicks on Tom's name.
10. **Jerry views Tom's peer detail overlay** and confirms all of Tom's profile information is visible:
    - Stage name: "Tom"
    - Avatar: 😎
    - Languages: "en, zh"
    - Q&A: "Favorite drink → Coffee", "Usual city → San Francisco"

## Verifications:

- ✅ Stage name is saved and appears in the header/profile after editing
- ✅ Public profile fields (avatar, languages, Q&A pairs) are saved correctly on the server
- ✅ Another user in the same chatroom can view the profile via the peer detail overlay
- ✅ Profile data syncs in real-time between users through Gun.js
