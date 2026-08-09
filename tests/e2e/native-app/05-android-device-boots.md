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

## Real-hardware findings (2026-08-08, Honor FRD-L04 / Android 7.0 / SDK 24)

The app itself now boots and runs stably on real hardware — three real bugs were found and
fixed along the way (none specific to this spec; they'd have hit any real-device run):

1. `android/app/build.gradle` was missing `-DANDROID_STL=c++_shared` on the CMake
   `externalNativeBuild` args. `native-lib.so` links against the shared C++ runtime, so
   without this AGP never bundles `libc++_shared.so` into the APK — `NodeBridge`'s
   `System.loadLibrary("native-lib")` crashed with `UnsatisfiedLinkError` on real hardware
   (emulators/x86 often mask this).
2. `platforms/mobile/nodejs-project` (the embedded Node project staged into the APK) had an
   empty `package.json` `dependencies` and no `node_modules` — `dist/server`'s compiled
   `require('express')` failed with `MODULE_NOT_FOUND` a few hundred ms into every launch.
   Fixed by declaring the actual runtime-only deps (cors/express/gun/helmet/socket.io/uuid —
   the same set `scripts/stage-desktop-prod-deps.sh` already isolates for desktop) and
   wiring `npm --prefix platforms/mobile/nodejs-project install --omit=dev` into
   `android:build`.
3. `src/shared/reputation.ts` had a `/[\p{L}\p{N}']+/gu` regex *literal* — nodejs-mobile's
   embedded V8 is built without full ICU, so that literal fails to even *parse*,
   crashing the whole process at module load (not lazily, at call time). Fixed by building
   the same pattern via `new RegExp(...)` in a try/catch, falling back to a script-agnostic
   non-ICU tokenizer.

All three were invisible in `adb logcat` — Node's own stdout/stderr had nowhere to go
(inherited `/dev/null` from Zygote), so `native-lib.cpp` now `freopen`s them to
`node-stdio.log` in the app's data dir (`adb shell run-as com.iinpublic.app cat
files/node-data/node-stdio.log`) specifically so this class of bug is diagnosable at all.

With those fixed, the app was confirmed stable via manual verification (screenshot +
direct CDP inspection over `adb forward` + `/json/list`, showing a live page titled
"IinPublic - Location-Based Matching" serving real `/api/presence/nearby` traffic from the
WebView) — **but this spec itself still cannot pass on this device**: Playwright 1.57's
`_android` driver has a real, reproducible incompatibility with this old
Android 7/EMUI WebView. `device.webViews()` finds the webview (confirming the driver *can*
see it) but reports `pkg: ''` instead of `com.iinpublic.app`, so the `{pkg}`-filtered
`device.webView()` call times out; bypassing the filter entirely and calling `.page()` on
the unfiltered handle still hangs indefinitely (tested up to 90s) — the page-attach
handshake itself doesn't complete on this WebView build, not just the pkg lookup. Generic
`playwright.chromium.connectOverCDP()` against the same socket fails outright
(`Browser.setDownloadBehavior: Browser context management is not supported` — WebView's CDP
surface is a reduced subset `connectOverCDP` isn't built for).

This looks like a Playwright/old-Android-WebView compatibility gap, not an app bug — the
next real attempt at making this spec pass should either try a newer/different real device,
or investigate Playwright's Android driver source (`playwright-core`'s `android.js`) for
what the page-attach handshake actually sends and whether there's a version gate that could
be worked around from userland.
