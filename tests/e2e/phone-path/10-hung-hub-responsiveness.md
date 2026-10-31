# Journey: a phone with a hung hub

**File:** 10-hung-hub-responsiveness.spec.ts
**Plan / findings:** `docs/testing/gui-responsiveness-test-plan.md` (P4), `docs/testing/gui-responsiveness-audit.md`

## What this test does (in plain English)

1. Starts a "hub" that accepts connections and never answers (Wi-Fi with no internet) and a phone
   node relaying to it.
2. Opens the app on that phone: it must finish starting.
3. Clicks every control on every tab and each tab's app bar: each must react within 1 s and the
   page must never freeze for 1 s.
4. Renames the user (confirmed within 3 s — saving your own data never waits for the hub) and taps
   New Room (the form opens within 2 s).
