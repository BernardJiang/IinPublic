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

## Conversion plan (2026-10-17)

Where things stood on 2026-10-17: the phone sweep ran 30 Android-only tests and 6 hand-written
contracts. The rest of the suite ran only on the Mac:

| Suite | Files | Tests | On a phone before |
|---|---|---|---|
| `tests/e2e/staged/stage0–5` | 228 | ~346 | no |
| `tests/e2e/talks-matching/` | 14 | 15 | no |
| `tests/e2e/phone-path/` | 6 | 11 | phone code path, but in host Chromium |
| `src/test/unit` + `integration` | 350 | thousands | 6 contracts only |

Porting every journey is not the goal: ~346 journeys at 1–3 min each on four shared phones would
take 8–15 hours, and many check host or layout concerns (app bar, Chinese UI walk-throughs, the
stats dashboard) where a phone adds nothing. The order:

1. **Unit files unchanged on phones (done 2026-10-17).** Not hand-copied contracts: the real Jest
   files run as they are, through a small Jest-compatible runtime
   (`src/test/support/portable-jest/runtime.ts`: describe/it/test with .each/.skip/.only/.todo,
   the four hooks, and the matchers these files use). It registers exactly the same 1,155 test
   names as Jest, file by file. `node scripts/build-portable-core-test-bundle.mjs --select` picks
   the files: every unit file with no `jest.*` mocks, Node built-ins, DOM, or server/web imports,
   minus any that does not bundle for Chrome 61 (the Honor's WebView) or does not pass in host Node
   and headless Chromium. It writes `src/test/support/portable-jest/suites.json` with a reason for
   every file left out, so a reduction is visible in review. 92 files run, covering the match engine
   (`talk-engine`, `talk-types`, tag similarity), intake filters, reputation and content filters,
   room routing and tiles, Nearby partitions, cohorts and overflow certificates, the P2P
   trust/handshake/abuse/presence rules, protocol manifests, SEA-signed records, TechSupport, and
   conversation reconcile. Two scale simulations stay host-only by design.
   - The WebView gets the bundle over the adb/CDP channel (like the contracts). Embedded Node runs
     it from `/api/test/portable-core`, which loads `nodejs-project/device-tests/` only if present;
     Gradle stages that file into `src/debug/assets`, so release APKs never carry it.
   - `scripts/run-portable-jest-host.mjs` records the host's test ids; `native-app/34` fails a phone
     whose WebView or embedded Node reports any failure or a different id set.
   - First runs (2026-10-17): every WebView passed 1,155/1,155, including the Honor's WebView 61.
     Embedded Node (v18.20.4) failed the same tests on all four phones, two real gaps the Mac's
     Node cannot show (fixed; `embedded-node-runtime-gaps.test.ts` recreates each on the host):
     it has no global WebCrypto, so `sha256Hex` (Nearby ids, Wi-Fi Direct host choice) threw
     `crypto is not defined`; and it has no ICU, so `normalize('NFKC')` is a no-op and the
     dirty-word filter let fullwidth "ｆｕｃｋ" through.
   - Also found in the host run: `nearby-partition.test.ts` tampered a room id by setting its last
     hex digit to `0`, a no-op 1 time in 16, so the test failed at random in Jest too (2 of 12
     runs). Fixed.
   - Single tests can be host-only (`HOST_ONLY_TESTS` in the builder; reported as skipped): the
     `find-similar` 100k-population 1 s budget took 1,051 ms on the C10.
   - Next, to grow it: give the runtime `jest.fn`/`jest.spyOn` (119 files are excluded only for
     `jest.*`), and inject `Buffer` where the app ships one.
2. **Two-phone journeys behind `TestActor`:** Talk delivery, answering, matching, the resulting
   conversation, blocks, change of mind, and retraction (`staged/stage2`, `talks-matching`). One
   spec runs with browser actors on the Mac and with phone actors in the sweep.
3. **Three- and four-phone journeys:** Nearby splits, capacity, and cohorts, picked from
   `staged/stage3`/`stage4`.
4. **Stays on the Mac:** stage-1 UI and layout specs, the browser-engine matrix, desktop-native
   specs, and scale tests.

## Sweep speed (2026-10-17)

The four-phone `test:android:full` took 68 minutes on 1.0.154. Where it went: 20 minutes installing
the same APK one phone at a time, twice (after the mixed-release gate, and again as the final
restore); 13 minutes of one-phone gates on one phone while three sat idle; the rest are the
multi-phone gates and the mixed-release gate. Changes:

- **One-ABI test APKs.** The debug APK carried `libnode.so` for three ABIs (150 of its 204 MB).
  Sweeps set `IINPUBLIC_ANDROID_ABIS` from the phones' ABIs (`scripts/lib/android-test-abis.mjs`);
  the APK is 70 MB. Gradle refuses the variable for any release task.
- **Skip phones that already have the APK.** `install-android-matrix.mjs` compares the installed
  `base.apk` MD5 with the local APK; the final restore and the install after the mixed-release gate
  now cost seconds when nothing changed. The mixed-release runner restores with the current
  `app-debug.apk` so the next install can skip those phones.
- **Phones in parallel** (`scripts/lib/parallel-steps.mjs`, each lane on its own hub port, output
  prefixed by lane): the one-phone gates split across two phones with X3 on a third; 28 + 33 on
  the first pair while 09 runs on the second; spec 34 on all phones at once. Only one lane at a time
  launches the macOS app.
- **Rejected: parallel installs.** The phones' USB links differ (the C10 took 70 MB at 134 MB/s,
  the P30 at 0.9 MB/s); four parallel installs of the 204 MB APK left three timed out at 5 min.
- **Measured (1.0.159, 2026-10-17): 43 min 52 s** on the same four phones (was 68). Two lanes
  failed on port choices, both fixed: lane B's hub at 9178 served its page on 4099, and the web
  app maps only pages on 3001-4000 to their hub, so spec 12's browser peer never met the phone;
  and 09's hub at 9178 collided with the release-capacity hub 33 starts there. Lane ports now count
  down from 9078 (lane B 8978, 09 8878, spec 34 9078/8978/8878/8778), and the native config refuses
  a hub port outside 8080-9079.
- **Added 2026-10-17 (OPEN-67):** the Honor FCP (Android 16, SIM) is the fifth phone in
  `tests/matrix/devices.json`, which now lists phones in the sweep's qualified order (P30, C10,
  PH-1, FRD, FCP; 28 needs an Android 12+ second phone) and marks SIM phones for `--plan`. New
  steps: spec 29 again with both SIM phones on mobile data (~2 min), and spec 36 on all phones at
  once (71 s for five). Each parallel step writes to its own `test-results/android-sweep/<step>`
  folder; Playwright empties its output folder at start, which could delete a neighbor lane's
  failure screenshots and traces.

## Completion criteria

OPEN-59 is complete when the supported phone matrix records matching reports from Jest, host Node,
Android WebView, and embedded Android Node; the selected actor journeys pass at their required
device counts; native instrumentation covers the Android boundaries; and a missing expected lane
or contract is a release-blocking failure rather than a silent reduction in coverage.
