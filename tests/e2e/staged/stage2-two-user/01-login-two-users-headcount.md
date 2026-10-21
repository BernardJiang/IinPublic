# Test: Two Users — Nearby Headcount Across Leave and Rejoin

covers: SPEC-3.3, SPEC-3.1, SPEC-3.7

**File:** 01-login-two-users-headcount.spec.ts
**Features tested:** the Nearby headcount ("N near you", my own list without me), leave and rejoin

---

## What this test does (in plain English):

1. **User 1 logs in:** alone in Nearby, the headcount reads `0 near you`.
2. **User 2 logs in:** each is on the other's list; both read `1 near you`.
3. **User 2 exits:** `manualCleanup()` and the page closes. Nearby has no goodbye (design §3.7):
   User 1 drops User 2 when a swap gets no answer; the helper runs swaps until the count is `0`.
4. **User 2 re-logs in (same browser context):** both read `1 near you` again.

> **Why this matters:** the headcount follows people arriving, leaving without a goodbye and
> coming back, and never counts the viewer or TechSupport.

---

**Helpers used:** `expectNearbyHeadcount` (`helpers/nearby-v3.ts`), `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `attachE2eBrowserTabLabel`
