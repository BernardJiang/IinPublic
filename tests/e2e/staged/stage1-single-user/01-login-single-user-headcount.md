# Test: Single User — Login, Headcount, Exit, and Re-Login Persistence

covers: SPEC-3.3, SPEC-3.1, SPEC-3.7

**File:** 01-login-single-user-headcount.spec.ts
**Features tested:** User login, the Nearby headcount, session persistence, browser tab labels, screenshots

---

## What this test does (in plain English):

1. **Setup:** Databases are cleared. A browser page starts with IndexedDB cleared (`injectIdbClear`).
2. **User logs in:** The user opens the app and lands in Nearby.
3. **Headcount shows "0 near you":** Nearby's headcount is the user's own list (design §3.7), which
   leaves out the user and TechSupport, so a lone user reads `0 near you`. A screenshot is saved.
4. **User exits:** `manualCleanup()` runs and the page closes.
5. **User re-logs in (same browser context):** a new page reopens the app as the same user, with
   the TechSupport conversation intact and the headcount again `0 near you`.

> **Why this matters:** the session persists across closing and reopening a tab, and a lone user
> never counts themselves or TechSupport.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `attachE2eBrowserTabLabel`
