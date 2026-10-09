# Test: TechSupport — Contacts-only and Away With No Device Running

covers: docs/TODO.md K1 item 7

**File:** 02-techsupport-away-headcount.spec.ts
**Features tested:** Nearby headcount stays 1 with one ordinary user; TechSupport remains a pinned
Contact whose liveness reads away, and no support row appears in room details.

---

## What this test does (in plain English):

1. **Login:** one ordinary browser user logs in via the normal stage1 flow. No TechSupport client
   is ever launched anywhere in this test — this is the "device not running" scenario by
   construction, not by any special flag.
2. **Headcount:** the current Nearby badge reads exactly `1`; there is no support floor.
3. **Contacts row:** switches to the Contacts tab and finds the built-in support contact row
   (`data-support-contact="true"`), then asserts its presence dot has settled to `away`
   (`data-techsupport-online="false"`) and never shows the `online` class.
4. **Nearby roster:** switches back to Chatrooms and proves there is no TechSupport member row.

> **Why this matters:** Contact liveness must never be confused with room membership or headcount.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `waitForTabActive`,
`ensureWindowFitsViewport`, `attachE2eBrowserTabLabel`.
