# Test: Multi-User — Three Users Enter Sequentially, Exit FIFO, Re-Enter Random Order

covers: SPEC-3.3, SPEC-3.1, SPEC-3.7  <!-- auto-seeded; refine by hand -->

**File:** 02-multi-user-headcount.spec.ts  
**Features tested:** Multi-user headcount (3 users), FIFO exit, storage state persistence, random re-entry order, real-time sync

---

## What this test does (in plain English):

1. **Setup:** Three browsers are launched at positions (0,0), (640,0), (1280,0). Databases are cleared.

2. **User 1 enters:** Headcount in "Global" chatroom shows `1` on User 1's browser.

3. **User 2 enters:** Headcount updates to `2` on BOTH User 1's and User 2's browsers.

4. **User 3 enters:** Headcount updates to `3` on ALL three browsers.

5. **User 1 exits (FIFO):** User 1 calls `manualCleanup()`, saves storage state to JSON, closes page + context. After sync, the remaining browsers (User 2, User 3) see headcount drop to `2`.

6. **User 2 exits:** Same pattern — saves storage state, closes. User 3 sees headcount drop to `1`.

7. **User 3 exits:** Same pattern. Room is now empty.

8. **Users re-enter in random order (User 2, then User 3, then User 1):** Each re-logs in using saved storage states. Headcounts update correctly: User 2 enters (1), User 3 joins (2), User 1 joins (3). All three see headcount of `3`.

> **Why this matters:** Verifies that three concurrent users can join, leave in FIFO order, and re-enter in any arbitrary order with headcounts staying accurate throughout — proving storage-state persistence and Gun.js sync reliability.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `wait`, `attachE2eBrowserTabLabel`, storage state save/restore
