# Native App E2E Specs

These specs launch the real Electron desktop shell, not just a browser pointed
at an embedded-node process.

Run with:

```bash
npm run test:e2e:native-app
```

The suite builds `dist/web` and `dist/server`, starts one local hub on port
9078 by default (`NATIVE_APP_E2E_GUN_PORT` can override it), serves the browser
SPA on the matching dev/e2e web port 3999, then launches Electron with:

- `IINPUBLIC_LOCAL_PORT` for the app-owned loopback node
- `IINPUBLIC_HUB_GUN_URL` pointed at the test hub
- `IINPUBLIC_USER_DATA_DIR` pointed at a per-test profile directory

Keep these specs narrow. Browser E2E remains the broad UI/regression layer;
native app E2E should cover packaging, embedded-node startup, profile
isolation, and mixed browser/app topology.

## Seven-client real-device matrix

`06-seven-client-real-device-matrix.spec.ts` mirrors the browser-only X1/X2
presence and talk/match gates across three attached Android phones, the macOS
Electron app, Chromium, WebKit, and Firefox. It is opt-in and never runs in the
ordinary native suite:

```bash
npm run android:build
npm run android:install:matrix
npm run test:e2e:real-device-matrix
```

The installer gives each phone five minutes by default and continues to the next serial
after a timeout or ADB failure, then exits nonzero with one combined failure list. Override
the bound when needed with `ANDROID_INSTALL_TIMEOUT_MS=240000 npm run android:install:matrix`.

The normal device names and serials live in `tests/matrix/devices.json`. An
explicit `NATIVE_APP_ANDROID_SERIALS=serial1,serial2,serial3` still overrides
that file for an ad-hoc set. Every install and launch uses `adb -s <serial>`;
commands cannot silently target whichever phone ADB happens to enumerate first.
For the configured inventory, select a subset by stable logical name with
`NATIVE_APP_ANDROID_NAMES=android-alice,android-charlie`; both the installer and
real-device matrix preserve that order and reject unknown names before touching a device.
The matrix deliberately runs `adb shell pm clear com.iinpublic.app` on each
configured phone before launch, leaving the APK installed while removing identities,
rate-limit history, and Gun/Radisk data from earlier runs. Use dedicated test devices.

The phones reach the test hub over the LAN; set `NATIVE_APP_ANDROID_HOST` only
when automatic LAN-address detection selects the wrong interface. Matrix-launched native peers
disable mDNS/LAN discovery so an unrelated IinPublic node on the same network cannot contaminate
the controlled test graph; normal app launches keep LAN discovery enabled. It never reloads an attached
WebView: Android's Activity owns the one startup navigation, and high-volume test projections are
cleared without navigation during teardown. The suite runs a seven-node matching ring (seven
authors, seven broadcasts, seven completions). Use test devices or profiles because it creates
ordinary test talks and exchanges.

On failure, the Playwright result includes each configured phone's PID-scoped logcat tail and
embedded `node-stdio.log`, alongside the normal screenshots and device metadata attachments.

To isolate a phone that displays "Failed to create talk," run the authoritative-commit
regression against that adb serial. It rejects local ghost OUT rows and requires the device's
Gun repository record to be readable:

```bash
E2E_REAL_ANDROID_TALK_COMMIT=1 \
NATIVE_APP_ANDROID_SERIAL=serial \
NATIVE_APP_ANDROID_HOST=192.168.10.50 \
npx playwright test --config tests/e2e/native-app/playwright.config.ts \
  tests/e2e/native-app/07-android-authoritative-talk-commit.spec.ts
```
