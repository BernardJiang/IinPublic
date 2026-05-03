# Test: Blocking System — Block a User

**Features tested:** Blocking a contact, blocked user receives no new talks, blocked user sees "Profile unavailable" and "blocked" notice

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

### Step 1: Establish a relationship

1. **Tom creates and broadcasts a talk** ("Blocking Warmup Talk")
2. **Jerry receives it** and answers "Yes" → **Match!**

### Step 2: Tom blocks Jerry

3. **Tom opens Contacts**, clicks Jerry → opens the relationship editor
4. **Tom clicks "Block User"** → the modal closes
5. **Server API confirms** Jerry's user ID is in Tom's block list
6. **Tom's contacts list** now shows Jerry with a "Blocked" status

### Step 3: Tom checks Jerry's peer detail (blocked state)

7. **Tom opens the Global chatroom**, clicks Jerry → peer detail opens:
   - The "Send My Talks" button is **disabled**
   - The block button shows **"Unblock User"** (Tom can unblock if wanted)

### Step 4: Tom broadcasts another talk — Jerry doesn't receive it

8. **Tom creates and broadcasts** "Blocked Delivery Talk"
9. **Server API confirms** Jerry does NOT receive this talk (blocked users don't get broadcasts)

### Step 5: Jerry sees Tom is blocking him

10. **Jerry opens the Global chatroom**, clicks Tom → peer detail opens:
    - Shows **"Profile unavailable"** (blocked users can't see each other's profiles)
    - Shows a **"blocked"** subtitle

## Verifications:

- ✅ Blocking a user adds them to the block list (confirmed via API)
- ✅ Blocked contacts show "Blocked" status in the contacts list
- ✅ Blocked users appear in chatroom member lists (they're still in the same room) but:
  - Tom's "Send My Talks" to Jerry is disabled
  - An "Unblock User" button is available
- ✅ New broadcasts from Tom are NOT delivered to Jerry
- ✅ Jerry sees "Profile unavailable" and "blocked" notice when viewing Tom
