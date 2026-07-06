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
