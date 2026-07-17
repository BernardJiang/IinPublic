# Test: Single User — Login, Headcount, Exit, and Re-Login Persistence

covers: SPEC-3.3, SPEC-3.1  <!-- auto-seeded; refine by hand -->

**File:** 01-login-single-user-headcount.spec.ts  
**Features tested:** User login, headcount display, session persistence, browser tab labels, screenshots

---

## What this test does (in plain English):

1. **Setup:** Databases are cleared. A browser is launched and a page context is created with IndexedDB cleared (`injectIdbClear`).

2. **User logs in:** The user navigates to the app root URL and waits for the page to fully load with Gun sync.

3. **Verification — Headcount shows "1":** The "Global" chatroom headcount indicator shows `1`, confirming the new user is counted. A full-page screenshot is saved.

4. **User exits:** `manualCleanup()` is called and the page is closed.

5. **User re-logs in (same session):** A new page is opened in the same browser context and navigates to the app. After Gun sync, the headcount shows `1` again — the user's identity persisted across page close/reopen. Another screenshot is saved.

> **Why this matters:** Verifies that user sessions persist (via IndexedDB) so that closing and reopening a tab re-connects the same user with the correct headcount.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `attachE2eBrowserTabLabel`
