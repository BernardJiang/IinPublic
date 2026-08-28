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
NATIVE_APP_ANDROID_SERIALS=serial1,serial2,serial3 \
  npm run test:e2e:real-device-matrix
```

The phones reach the test hub over the LAN; set `NATIVE_APP_ANDROID_HOST` only
when automatic LAN-address detection selects the wrong interface. It never reloads an attached
WebView: Android's Activity owns the one startup navigation, and high-volume test projections are
cleared without navigation during teardown. The suite runs a seven-node matching ring (seven
authors, seven broadcasts, seven completions). Use test devices or profiles because it creates
ordinary test talks and exchanges.

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
