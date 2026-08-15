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
when automatic LAN-address detection selects the wrong interface. The suite preserves
SEA key custody and preferences, clears high-volume prior test projections/Gun cache,
then runs a seven-node matching ring (seven authors, seven broadcasts, seven completions).
Use test devices or profiles because it creates ordinary test talks and exchanges.
