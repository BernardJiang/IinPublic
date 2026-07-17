# Test: Two Users — Headcount 1→2→1→2 With Chatroom Navigation

covers: SPEC-3.3, SPEC-3.1  <!-- auto-seeded; refine by hand -->

**File:** 01-login-two-users-headcount.spec.ts  
**Features tested:** Multi-user headcount, chatroom switching, headcount updates on join/leave, persistence across re-login, screenshots

---

## What this test does (in plain English):

1. **Setup:** Two browsers are launched. Databases are cleared. Two browser contexts and pages are created with IndexedDB cleared.

2. **User 1 logs in:** Headcount for "Global" chatroom shows `1`. Screenshot saved.

3. **User 2 logs in:** Headcount on BOTH browsers updates to show `2` in the "Global" chatroom. Screenshot saved. This confirms real-time headcount sync via Gun.js.

4. **User 2 exits:** User 2 calls `manualCleanup()`, waits, closes the page. After sync, User 1's headcount drops back to `1`.

5. **User 2 re-logs in (same session):** A new page opens in User 2's context. Headcount on both browsers goes back to `2`. This persists User 2's identity.

6. **User 2 clicks into "North America" room:** Global headcount drops back to `1` on User 1's browser (User 2 left the room). "North America" room shows `1`. User 2 sees the "back to chatrooms" button and clicks it.

> **Why this matters:** Verifies that chatroom headcounts correctly reflect users joining and leaving rooms in real-time, and that user identities persist across page close/reopen.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `wait`, `attachE2eBrowserTabLabel`
