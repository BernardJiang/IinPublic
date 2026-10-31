# Test: GUI responsiveness — stalled hub regressions

**File:** 01-stalled-hub-regressions.spec.ts
**Features tested:** taps that wait on the network; boot with one hung request; toasts covering the app bar
**Plan / findings:** `docs/testing/gui-responsiveness-test-plan.md`, `docs/testing/gui-responsiveness-audit.md`

---

## What this test does (in plain English)

One browser, one user, one test per audit finding. "Stalled hub" means every request to the hub
is held forever and its WebSocket stays silent: a phone on Wi-Fi with no internet. A tap that
waits for such a request looks dead.

1. **F1:** boot with only `/api/debug/storage` held finishes (it used to hang forever); boot with
   the **whole** hub stalled finishes within 15 s (~7.5 s) and Create talk works. Control: a
   healthy boot is ready in ~3 s.
2. **F3:** with the hub stalled, rename yourself in Settings → Profile. "Stage name updated"
   appears within 3 s (it used to take ~13.5 s).
3. **F4:** with the hub stalled, tap New Room. The form opens within 2 s (it used to never open).
   Control: with hub requests failing fast, it opens at once.
4. With the hub stalled, every bottom-nav tab switches within 1 s and the main thread never stalls
   for 1 s.
5. With the hub stalled, Create talk opens the editor and Escape closes it.
6. **F9:** right after first launch, with the start-up toasts showing, Create talk can be tapped
   (toasts used to sit over the app bar).

All findings here were fixed on 2026-10-30. For a new finding, add its test with `test.fail()`
(it passes while the bug exists and turns red once fixed — then delete the marker).

## Verifications

- ✅ Bottom navigation and Create talk respond with the hub stalled (R1, R2)
- ✅ F1/F3/F4/F9 stay fixed

**Helpers used:** `stallHub`, `stallHubPath`, `installMainThreadProbe`, `expectClickResponds` (`helpers/ui-responsiveness.ts`), `dismissNotificationOverlays`, `openSettingsSection`
