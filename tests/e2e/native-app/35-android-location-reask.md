# 35 — Android: ask for location again (J-START-04, OPEN-54)

A person who refused location, or was never asked, must not be stuck.

1. Location is revoked and the app starts. After the 15-second GPS wait the phone appears as a
   Traveler ✈, and Settings → Your location shows **Use my location**.
2. Tapping it shows Android's location dialog. Allowing it grants the permission, the page is told
   (`iinpublic-location-granted`), and once a real fix arrives the button disappears (the person is
   a Resident again).
3. If the person keeps refusing until Android stops showing the dialog ("don't ask again"), the
   button opens the app's Android settings page instead of doing nothing.

Run: `E2E_REAL_ANDROID_LOCATION=1 NATIVE_APP_ANDROID_SERIAL=<serial> npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/35-android-location-reask.spec.ts`.
The sweep runs it in the one-phone step. Location is granted again afterwards.
