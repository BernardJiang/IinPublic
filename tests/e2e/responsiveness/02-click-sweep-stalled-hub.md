# Test: GUI responsiveness — click sweep with the hub stalled

**File:** 02-click-sweep-stalled-hub.spec.ts
**Features tested:** every visible control on the five tabs, each tab's app bar, and every Settings section
**Plan / findings:** `docs/testing/gui-responsiveness-test-plan.md` §3, `docs/testing/gui-responsiveness-audit.md`

---

## What this test does (in plain English)

1. **Setup:** one browser at 640×1000, one user. After boot, every request to the hub is held
   forever (`SWEEP_HUB=fail` makes them fail at once instead; `healthy` leaves the hub alone).
2. **For each surface** (a tab's panel, its app bar, each Settings section): find every visible
   control (buttons, links, checkboxes, radios, selects, menu items). Then, for each control in
   turn: go back to the same starting screen, wait until the page is quiet, click, and watch.
3. **Pass:** within 1 s, something visible changes (a dialog, a toast, the list, a checkbox tick, a
   picker), and the main thread never stalls for 1 s. If nothing changes, the test keeps watching
   4 s more and reports `late` or `no-reaction`. If something covers the control, it reports
   `not-clickable` and names what covers it.
4. Controls in `KNOWN_FINDINGS` (open audit findings) are reported but do not fail the run. A new
   dead control fails it, and so does a known one that now responds.

Destructive controls (erase, lock, unlink, remove password), the UI language select, file inputs
and external links are never clicked (`SWEEP_DENYLIST`).

## Verifications

- ✅ Every swept control (~100) reacts within ~60 ms, with the hub stalled, failing or healthy
- ✅ No known findings left (F3, F4, F10, F11, F14, F15 fixed 2026-10-30; F12 was a harness false alarm)

**Helpers used:** `sweepClickables`, `stallHub`, `failHub`, `installMainThreadProbe`, `formatSweepFailures` (`helpers/ui-responsiveness.ts`), `openSettingsSection`, `backToSettingsMenu`
