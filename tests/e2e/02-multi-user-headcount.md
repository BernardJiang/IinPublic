# Test: Three Users — FIFO Exit & Random Re-entry

**Features tested:** Real-time headcount with 3 simultaneous users, sequential exit (FIFO order), storage state persistence, random re-entry

---

## What this test does (in plain English):

### Phase 1: Three users join one by one

1. **User 1 joins** → headcount shows 1 on User 1's screen
2. **User 2 joins** → both User 1 and User 2 see headcount = 2
3. **User 3 joins** → all three users see headcount = 3

### Phase 2: First-In-First-Out (FIFO) exit

4. **User 1 leaves** (saved to a file for later re-entry). Users 2 and 3 see headcount drop to 2.
5. **User 2 leaves** (saved to a file). User 3 sees headcount drop to 1.
6. **User 3 leaves** (saved to a file).

### Phase 3: Random re-entry (not in order)

7. **User 2 re-enters** first using their saved session. Headcount shows 1.
8. **User 3 re-enters** next. Both User 2 and User 3 see headcount = 2.
9. **User 1 re-enters** last. All three users see headcount = 3 again.

10. **All three users leave.**

## Verifications:

- ✅ Every time a user enters or leaves, all remaining users see the headcount update correctly
- ✅ Session state (cookies/storage) persists and allows re-logging in as the same person
- ✅ The order of re-entry doesn't break headcount tracking
