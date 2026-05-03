# Test: Two Users — Headcount Changes & Room Navigation

**Features tested:** Real-time headcount updates between two users, chatroom switching

---

## What this test does (in plain English):

1. **User 1 logs in** and lands in the "Global" chatroom. Headcount shows `1`.

2. **User 2 logs in** in a separate browser. Both User 1 and User 2 should now see the "Global" headcount change to `2`.

3. **User 2 leaves** (cleans up and closes their page). After a short wait, User 1 should see the "Global" headcount drop back to `1`.

4. **User 2 logs back in.** Both users should see the headcount go back to `2`.

5. **User 2 navigates to the "North America" chatroom** instead of "Global". After switching, User 1 should see the "Global" headcount drop to `1`, and User 2 should see the "North America" headcount show `1`.

6. **User 2 navigates back** to the chatroom list using the back button.

7. **Both users leave** the app.

## Verifications:

- ✅ Global headcount follows the pattern: 1 → 2 → 1 → 2 → 1 (when second user switches rooms)
- ✅ When User 2 switches from Global to North America, both rooms show correct separate headcounts
- ✅ Back button returns to the chatroom list
