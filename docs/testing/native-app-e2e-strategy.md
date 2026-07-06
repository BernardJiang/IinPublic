# Native App E2E Strategy

This document describes how to extend the E2E suite so packaged/native app
instances participate as real users, while keeping the existing browser E2E
suite for broad coverage.

## Recommendation

Do not convert every E2E test to native app instances.

Keep two complementary suites:

- Browser E2E: broad UI, talks, contacts, chatroom, and mesh behavior coverage.
- Native app E2E: startup, embedded-node packaging, multi-device topology, and
  real desktop/mobile user participation.

Browser E2E is faster, easier to parallelize, and easier to debug. Native app
E2E is more realistic for packaging and embedded-node behavior, but heavier.

## Existing Coverage

`tests/e2e/embedded-node/` already tests the first version of this idea:

- one ordinary browser peer
- one spawned embedded-node process
- both peers connected through the worker hub
- talk exchange and direct-P2P conversation checks

That suite validates the embedded-node process, but it does not yet launch the
full Electron app window as the user-facing client.

## Target Native App Harness

Add a new harness under:

```text
tests/e2e/native-app/
```

Core helper:

```ts
launchNativeUser({
  name: 'mac-user-a',
  localPort: 8088,
  hubGunUrl: 'http://127.0.0.1:8080/gun',
  userDataDir: testInfo.outputPath('mac-user-a-profile'),
})
```

For Electron desktop, the helper should launch:

```ts
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  executablePath: '/Applications/IinPublic.app/Contents/MacOS/IinPublic',
  env: {
    ...process.env,
    IINPUBLIC_LOCAL_PORT: String(localPort),
    IINPUBLIC_HUB_GUN_URL: hubGunUrl,
    IINPUBLIC_USER_DATA_DIR: userDataDir,
  },
});
```

The app window should load:

```text
http://127.0.0.1:<localPort>/
```

The embedded Node process inside that app should peer to:

```text
<hubGunUrl>
```

## Required Desktop Testability Hook

Desktop should support:

```text
IINPUBLIC_USER_DATA_DIR=/path/to/profile
```

Without this, two app instances on the same machine share Electron's default
`userData` directory and can accidentally share browser storage, IndexedDB, or
native profile state.

Native test instances also need distinct local ports:

```text
app A -> IINPUBLIC_LOCAL_PORT=8088
app B -> IINPUBLIC_LOCAL_PORT=8089
app C -> IINPUBLIC_LOCAL_PORT=8090
```

## First Native App Specs

Start with a small suite before porting larger flows.

### 1. Desktop App Boots

Proves:

- app starts
- embedded node listens on `127.0.0.1:8088`
- `/health` returns OK
- `/worker.js` and `/node_modules/gun/gun.js` are served
- UI replaces the static `Connecting to IinPublic network...` placeholder

### 2. Browser + One Desktop App

Proves:

- browser TechSupport or end user joins `8080/gun`
- desktop app joins through its embedded node
- both identities appear in the shared network
- basic talk exchange works

### 3. Two Desktop Apps on One Machine

Proves:

- app A uses `8088`
- app B uses `8089`
- app A and app B have separate user data directories
- both peer to `8080/gun`
- they discover each other and browser users

### 4. WebRTC Regression Spec

Use this for bugs like:

```text
Failed to execute 'setRemoteDescription' on 'RTCPeerConnection':
Failed to set remote answer sdp: Called in wrong state: stable
```

The value of native-app E2E is high here because the failure depends on real
multi-user timing and signaling behavior.

## What Not To Port First

Do not start by porting the full staged or mass suites. They are broad,
expensive, and already covered in browser mode.

Avoid converting tests that only verify DOM form behavior, filters, rendering,
or basic CRUD. Browser E2E is the better layer for those.

## Port Allocation In Native E2E

Use one shared hub per test worker unless the test specifically verifies
cross-worker isolation:

```text
worker hub:      8080 + workerIndex
browser UI:      3001 + workerIndex
native app A:    8088 + workerIndex * 10
native app B:    8089 + workerIndex * 10
native app C:    8090 + workerIndex * 10
```

The `* 10` block gives each worker enough local app ports without colliding
with another worker.

Example for worker 2:

```text
hub: 8082
browser UI: 3003
app A: 8108
app B: 8109
app C: 8110
```

## Development vs CI

Local development can use the installed app:

```text
/Applications/IinPublic.app/Contents/MacOS/IinPublic
```

CI should prefer the freshly built unpacked app:

```text
platforms/desktop/dist/mac-arm64/IinPublic.app/Contents/MacOS/IinPublic
```

That avoids testing an old installed build.

## Migration Plan

1. Add `IINPUBLIC_USER_DATA_DIR` support to `platforms/desktop/main.js`.
2. Add `tests/e2e/native-app/helpers/native-app.ts`.
3. Add the desktop boot spec.
4. Add browser + one desktop app spec.
5. Add two desktop apps on one machine spec.
6. Reproduce and pin the WebRTC `setRemoteDescription` race.
7. Only then consider porting selected existing browser tests.

## Success Criteria

A native app E2E test should prove all of these:

- the user-facing app window loads the real UI
- the embedded Node process owns local APIs and `/gun`
- the embedded Node peers to the configured hub
- app profile data is isolated per launched instance
- browser users and app users discover each other
- failures are observable through Playwright traces/logs
