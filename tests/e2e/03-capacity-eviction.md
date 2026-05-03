# Test: Room Capacity & Eviction (FIFO Bumping)

**Features tested:** Maximum room capacity enforcement, FIFO (first-in-first-out) eviction, persistent chatroom assignment after eviction

---

## What this test does (in plain English):

> **Setup:** The "Global" chatroom is limited to a maximum of 3 users. When a 4th user tries to enter, the first user who joined gets bumped to the "North America" chatroom.

### Phase 1: Filling the room and eviction

1. **User 1 joins Global** → headcount = 1
2. **User 2 joins Global** → headcount = 2
3. **User 3 joins Global** → headcount = 3 (room is now full)
4. **User 4 joins Global** → because the room is at capacity (3/3), User 1 gets **evicted** and automatically moved to the "North America" chatroom (FIFO rule: first person in goes first out)

5. **All four users leave** (their sessions are saved to files for Phase 2)

### Phase 2: Re-entry with persistent eviction

6. **All four users re-enter** using their saved sessions.
7. **User 1 should still be in "North America"** (the eviction is permanent — re-entering doesn't put them back in Global).
8. **Users 2, 3, and 4 should be in "Global".**

## Verifications:

- ✅ When the room reaches capacity and a new user joins, the earliest user is bumped to "North America"
- ✅ The evicted user's status bar shows "North America"
- ✅ After re-entering, the evicted user stays in "North America" (eviction is persistent, not temporary)
- ✅ Non-evicted users return to "Global" after re-entry
