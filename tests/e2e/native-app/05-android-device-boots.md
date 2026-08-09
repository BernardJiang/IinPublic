# 05-android-device-boots

The Android equivalent of `01-desktop-app-boots.spec.ts`, but the shell is a real phone (or
emulator) attached over adb, not a process on this machine. Playwright's `_android` module
attaches to the app's WebView over ADB/Chrome DevTools Protocol and hands back a normal
`Page` — from that point on it behaves like any other native-app spec's window.

Two changes made the app support this at all (previously a documented hard blocker — see
`docs/testing/manual-platform-test-plan.md`'s Android section):

1. `MainActivity.kt` now calls `WebView.setWebContentsDebuggingEnabled(true)` in debug
   builds only — without it the WebView is invisible to any external CDP client regardless
   of adb access.
2. The hub URL, previously a hardcoded production constant
   (`NodeForegroundService.HUB_GUN_URL`), is now overridable via an `adb shell am start`
   Intent extra (`--es hub_gun_url "..."`) that `MainActivity` forwards to the service —
   mirroring how the desktop Electron app already reads `IINPUBLIC_HUB_GUN_URL` from its
   environment. Production launches (no extra) are unaffected.

Skips itself when no adb device is attached, so it's safe left in the suite's default run.

Not yet verified against real hardware — written and typechecked, but this repo's
environment has no phone attached. The next person (or session) with a phone plugged in
and `adb devices` showing it should be the first real run.
