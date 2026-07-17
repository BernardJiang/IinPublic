# Test: Capacity and FIFO Eviction — Four Users Fill-to-3, Fourth Bumps First

covers: SPEC-3.3  <!-- auto-seeded; refine by hand -->

**File:** 03-capacity-eviction.spec.ts  
**Features tested:** Chatroom capacity limit, FIFO eviction, room reassignment persistence, multi-browser (4 browsers), storage state restore

---

## What this test does (in plain English):

1. **Setup:** Four browsers are launched. Databases are cleared. All users navigate with URL params `e2e_capacity=3&e2e_fifo=true` to enforce a max capacity of 3 users in Global and FIFO eviction enabled.

2. **User 1 enters:** Joins Global chatroom.

3. **User 2 enters:** Joins Global chatroom.

4. **User 3 enters:** Joins Global chatroom. Headcount shows `3` — room is now at capacity.

5. **User 4 enters:** This triggers FIFO eviction — User 1 (who was first to join) is bumped from Global and automatically reassigned to the "North America" room. User 1's status bar confirms "North America".

6. **All four users save their storage state, call cleanup, and close.**

7. **Phase 2 — All four re-enter with saved storage states:** User 1 re-enters and is persistently placed back in "North America" (not Global). Users 2, 3, 4 re-enter and land in "Global". Status bars are verified for each user.

> **Why this matters:** Verifies that chatroom capacity limits (FIFO eviction) work correctly and that room reassignment persists across browser close/reopen — eviction decisions survive page reloads.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, storage state save/restore
