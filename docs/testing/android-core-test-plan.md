# Android core-logic test plan

Status: OPEN-59, implementation started 2026-10-14.

Physical parity milestone (2026-10-14): the first six contracts passed in both the WebView and
embedded Node on four devices spanning Android 7, 10, and 14 (WebView 61, 153, and 154). The C10 is
now the fourth configured matrix device. On 2026-10-15 the parity gate passed again after a broad
physical sweep. The same run passed four-phone online Nearby convergence/background delivery,
website↔phone identity linking, three-phone offline/resync, and three-phone capacity-3 cohort
traversal. Offline BLE/Wi-Fi Direct election remains open as OPEN-60. Multi-user actor-journey
conversion remains open.

## Goal and boundary

The goal is to execute IinPublic's portable core logic in the real Android runtimes, not to copy
the entire Mac test process onto a phone. `npm run test:all` remains authoritative for server APIs,
large-load simulations, browser-engine compatibility, desktop shells, build tooling, and other
host responsibilities. Android adds three complementary layers:

1. deterministic contracts run unchanged in Jest, Node 18, the app WebView, and embedded Node;
2. selected multi-user journeys run through runtime-neutral test actors;
3. Android instrumentation covers lifecycle, permissions, foreground services, notifications,
   keystore, BLE, Wi-Fi Direct, and other native boundaries.

Passing Android cannot replace the host suite, and passing the host suite cannot replace Android.

## Implemented device-free foundation

`npm run test:android:coverage` inventories all `src/test/**/*.test.ts` and
`tests/e2e/**/*.spec.ts` files. It classifies their current execution lane and one of these
conversion dispositions:

- `already-on-android`: existing real-device Playwright specs;
- `portable-contract-candidate`: core Jest cases that may be distilled into deterministic
  cross-runtime contracts;
- `actor-journey-candidate`: browser journeys worth porting behind `TestActor`;
- `keep-host-side`: scale, browser-matrix, server, or non-Android native responsibilities.

The report is derived from the repository every run, so counts do not become a stale handwritten
snapshot. Use `npm run --silent test:android:coverage -- --json` for complete file-level
machine-readable output (silent mode keeps npm's command banner out of the JSON stream).

The initial portable bundle covers six core contracts:

- release-version ordering;
- decentralized room-capacity FIFO ordering;
- Contacts-only and Residents-only Talk audiences;
- reusable question defaults when option ids change;
- Nearby privacy/range projection rules;
- direction-independent private block-pair keys.

These contracts live in `src/shared/portable-core-contracts.ts`. They deliberately avoid
the DOM, filesystem, network, Gun, clocks in expected values, and platform-specific APIs. A
contract failure reports a stable id and error in JSON.

`TestActor` is the minimum Playwright-facing abstraction for portable journeys: actor id, runtime,
page, and optional background/foreground/restart lifecycle hooks. New portable journeys should
accept actors rather than launching Chromium in the journey body. Providers retain control of
browser contexts, adb/WebView attachment, cleanup, and platform lifecycle.

## Commands

Device-free commands:

```text
npm run test:android:coverage
npm run test:android:core:plan
npm run test:android:embedded-core:host
npm run test:android:core:host
```

`test:android:core:host` performs the inventory check, creates both bundles under
`dist/device-tests/`, executes them in host Node and headless Chromium, builds the actual mobile
embedded-Node artifact, and boots that artifact against the fixed parity endpoint. Jest runs the
same contract source through `portable-core-contracts.test.ts`.

With one or more authorized phones connected:

```text
NATIVE_APP_ANDROID_HOST=192.168.x.x npm run test:android:core
NATIVE_APP_ANDROID_HOST=192.168.x.x npm run test:android:core -- --serial SERIAL_A --serial SERIAL_B
NATIVE_APP_ANDROID_HOST=192.168.x.x npm run test:android:core -- --install
```

Without `--install`, the command tests the already-installed APK after rebuilding the host assets
needed by the harness. With `--install`, it builds and installs the current debug APK on every
selected phone first. The WebView spec injects its test bundle through the adb/CDP automation
channel. For embedded Node, the debug Activity forwards an explicit E2E flag through the service
and JNI layer; that enables a fixed-function, loopback-only endpoint which accepts no code or
module input. Release builds do not honor the Activity flag, `NODE_ENV=production` does not
register the endpoint, and an unflagged debug app returns 404.

The broad hardware sweep is:

```text
npm run test:android:full:plan
npm run test:android:full
```

It runs the existing mixed-release and phone-journey sweep first. That sweep restores the current
build. The portable core sweep then runs last against that latest build even when an earlier phone
journey reports a failure, so every completed command still records core parity against—and leaves
the phone matrix on—the latest APK rather than an old compatibility fixture. The command exits
nonzero if either phase fails.

Like `test:all`, it ends with one report for the whole run: a table of every step in both phases
(pass or fail, time) and one HTML report merged from every Playwright step, at
`playwright-report-android/` (`npx playwright show-report playwright-report-android`). Each step
writes a blob under `blob-report/<run id>/`; `scripts/lib/android-sweep-report.mjs` does the rest.
`test:android:core` and the phone sweep alone produce the same report when run by themselves.

## Remaining conversion work

The debug/E2E-only embedded-Node bridge is implemented. The next work is to exercise it on the
supported phone matrix, then port high-value staged journeys in increasing actor count:

1. single-user creation, persistence, filters, and restart;
2. direct Talk delivery, answers, matching, contacts, and blocks;
3. decentralized Nearby split/convergence and redundant path selection;
4. capacity/overflow and traveler/Place behavior.

Scale tests and synthetic hundreds-of-users tests stay host-side. They answer a different question
and should not consume or destabilize physical phones.

## Completion criteria

OPEN-59 is complete when the supported phone matrix records matching reports from Jest, host Node,
Android WebView, and embedded Android Node; the selected actor journeys pass at their required
device counts; native instrumentation covers the Android boundaries; and a missing expected lane
or contract is a release-blocking failure rather than a silent reduction in coverage.
