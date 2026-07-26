# Test: TechSupport — Away Headcount With No Device Running

covers: docs/TODO.md K1 item 7

**File:** 02-techsupport-away-headcount.spec.ts
**Features tested:** Global headcount stays 2 (ordinary user + built-in TechSupport) with no
TechSupport device process ever started; the built-in contact/roster row is listed; its liveness
indicator reads "away" everywhere it renders (contacts list and Global roster), never "online".

---

## What this test does (in plain English):

1. **Login:** one ordinary browser user logs in via the normal stage1 flow. No TechSupport client
   is ever launched anywhere in this test — this is the "device not running" scenario by
   construction, not by any special flag.
2. **Headcount:** the Global chatroom badge reads exactly `2`. Not `1` (TechSupport missing) and
   not `3` (double-counted between the client-side floor and the relay's seeded row) — those are
   the two failure modes items 1 and 2 exist to prevent.
3. **Contacts row:** switches to the Contacts tab and finds the built-in support contact row
   (`data-support-contact="true"`), then asserts its presence dot has settled to `away`
   (`data-techsupport-online="false"`) and never shows the `online` class.
4. **Global roster row:** switches back to Chatrooms, opens Global's member list, and asserts the
   same thing on the roster row for TechSupport.

> **Why this matters:** liveness must never be confused with headcount (decision K1-2). This test
> is the one place that proves both halves at once — the count is unconditional while the presence
> dot correctly reflects that nothing has actually connected.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `waitForTabActive`,
`ensureWindowFitsViewport`, `attachE2eBrowserTabLabel`.
