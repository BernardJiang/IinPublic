# IinPublic Cross-Platform E2E Test Matrix TODO

## Starting Point

Current baseline:

- macOS / Mac mini is the primary test controller.
- Existing Playwright E2E tests run on macOS.
- Current browser baseline is Chromium.
- Goal: gradually extend the same E2E scenarios across browsers, desktop apps, Android devices, Windows, and Ubuntu.
- Prefer incremental expansion: each stage should work reliably before adding the next layer.
- Keep one central test command and one combined test report on the Mac mini when practical.

---

# Stage 1 — Expand macOS Browser E2E Coverage

## 1.1 Add Safari/WebKit

- [ ] Add a Playwright WebKit project to `playwright.config.ts`.
- [ ] Run the existing E2E suite under WebKit.
- [ ] Identify tests that depend on Chromium-specific behavior.
- [ ] Fix or isolate browser-specific assumptions.
- [ ] Confirm networking, storage, IndexedDB, WebSocket, and Gun.js behavior under WebKit.
- [ ] Add WebKit results to the normal Playwright HTML report.
- [ ] Add a convenient command such as:

```bash
npm run test:e2e:webkit
```

## 1.2 Add Firefox

- [ ] Add a Playwright Firefox project.
- [ ] Run the existing E2E suite under Firefox.
- [ ] Fix or document Firefox-specific failures.
- [ ] Verify Gun.js/P2P behavior under Firefox.
- [ ] Verify local storage, IndexedDB, permissions, WebSocket, and reconnect behavior.
- [ ] Add a command such as:

```bash
npm run test:e2e:firefox
```

## 1.3 Run All Three Browsers

- [ ] Run Chromium, WebKit, and Firefox from one Playwright configuration.
- [ ] Add a command such as:

```bash
npm run test:e2e:browsers
```

- [ ] Make test data and ports safe for parallel browser execution.
- [ ] Prevent browser instances from accidentally sharing identities or state unless the test explicitly requires it.
- [ ] Give each test peer a visible identity such as:
  - chromium-alice
  - webkit-bob
  - firefox-eve

## 1.4 Add Mixed-Browser P2P Scenarios

Do not only run the same test independently in each browser. Add scenarios where different browsers communicate with each other.

- [ ] Chromium -> WebKit
- [ ] WebKit -> Chromium
- [ ] Chromium -> Firefox
- [ ] Firefox -> Chromium
- [ ] WebKit -> Firefox
- [ ] Firefox -> WebKit
- [ ] Three-peer scenario:
  - Chromium
  - WebKit
  - Firefox

Suggested scenarios:

- [ ] Peer discovery.
- [ ] Join the same chatroom.
- [ ] Send and receive a Talk.
- [ ] Answer a Talk.
- [ ] Verify tag/question matching.
- [ ] Verify state propagation.
- [ ] Disconnect and reconnect one browser.
- [ ] Verify state convergence after reconnection.
- [ ] Restart one browser and verify persisted identity/state.

Milestone:

> macOS can reliably run IinPublic E2E tests with Chromium, WebKit, Firefox, and mixed-browser peer combinations.

---

# Stage 2 — Add the macOS Desktop App

Keep the Mac mini as the only physical host at this stage.

## 2.1 Create an App Test Harness

- [ ] Determine how the macOS IinPublic desktop app can be launched with a clean test profile.
- [ ] Add command-line/environment options for:
  - test identity
  - test data directory
  - application port
  - peer name
  - log directory
- [ ] Ensure multiple app instances can run without sharing unintended state.
- [ ] Add deterministic app startup and shutdown commands.

## 2.2 Automate the macOS App

Depending on the desktop app architecture:

- [ ] Reuse Playwright directly if the app is Electron and exposes a suitable Electron test interface.
- [ ] Otherwise select a macOS desktop automation adapter only for native UI operations.
- [ ] Keep application/P2P scenario logic shared with existing E2E tests.

## 2.3 Add macOS App + Browser Matrix

Test combinations such as:

- [ ] macOS App -> Chromium
- [ ] Chromium -> macOS App
- [ ] macOS App -> WebKit
- [ ] WebKit -> macOS App
- [ ] macOS App -> Firefox
- [ ] Firefox -> macOS App
- [ ] macOS App -> macOS App, using separate test profiles

Suggested scenarios:

- [ ] Discovery.
- [ ] Chatroom join/leave.
- [ ] Talk exchange.
- [ ] Matching.
- [ ] Identity persistence.
- [ ] App restart/reconnect.
- [ ] Browser-to-app state synchronization.

Milestone:

> One Mac mini can run browser and native macOS-app peers together in the same automated IinPublic E2E scenario.

---

# Stage 3 — Add Android to the Matrix

Start with one phone. Do not begin with a multi-phone test farm.

## 3.1 One Android Phone

- [ ] Connect one Android phone to the Mac mini with ADB.
- [ ] Confirm:

```bash
adb devices
```

- [ ] Automate APK installation.
- [ ] Automate application reset/clean state.
- [ ] Automate application launch.
- [ ] Select the Android UI automation framework.
- [ ] Start with Maestro unless a feature requires lower-level Android control.
- [ ] Add ADB-based log collection.
- [ ] Capture screenshots on failure.
- [ ] Add Android device information to the final test report.

## 3.2 Android + macOS Browser Tests

Add cross-platform scenarios:

- [ ] Android -> Chromium
- [ ] Chromium -> Android
- [ ] Android -> WebKit
- [ ] Android -> Firefox
- [ ] Android -> macOS App
- [ ] macOS App -> Android

Important IinPublic tests:

- [ ] Android discovers desktop peer.
- [ ] Desktop discovers Android peer.
- [ ] Android publishes a Talk and desktop receives it.
- [ ] Desktop publishes a Talk and Android receives it.
- [ ] Android disconnect/reconnect.
- [ ] Android app background/foreground.
- [ ] Network interruption and recovery.
- [ ] Identity persistence after app restart.

Milestone:

> One real Android phone participates as a peer in the same automated E2E scenario as macOS browsers and the macOS app.

## 3.3 Expand to Two Android Phones

- [ ] Add stable ADB serial mapping.
- [ ] Give each device a logical test name.
- [ ] Example:

```text
android-alice -> SERIAL_1
android-bob   -> SERIAL_2
```

- [ ] Allow each test to address a specific device.
- [ ] Prevent APK install/reset commands from affecting the wrong device.
- [ ] Add Android -> Android Talk and discovery tests.
- [ ] Add Android + Android + desktop three-peer tests.

## 3.4 Expand to Three or More Android Phones

- [ ] Move device configuration into a central file such as:

```text
tests/matrix/devices.json
```

- [ ] Automatically detect connected devices.
- [ ] Mark unavailable devices as skipped rather than crashing the whole matrix.
- [ ] Support selecting devices by logical name.
- [ ] Add 3+ peer convergence tests.
- [ ] Test simultaneous joins.
- [ ] Test concurrent Talk propagation.
- [ ] Test one device going offline while others continue.
- [ ] Test peer return and resynchronization.

Example target:

```text
Android 1
Android 2
Android 3
macOS Chromium
macOS App
```

Milestone:

> The Mac mini controls three or more Android phones plus local macOS peers as one distributed IinPublic test environment.

---

# Stage 4 — Add Windows

At this point introduce the first remote desktop host.

## 4.1 Prepare Windows as a Remote Test Worker

- [ ] Enable OpenSSH Server on Windows.
- [ ] Configure password-free SSH from the Mac mini.
- [ ] Give the Windows machine a stable hostname or static DHCP lease.
- [ ] Verify from Mac:

```bash
ssh windows-test hostname
```

- [ ] Install required versions of:
  - Node.js
  - npm
  - Playwright
  - IinPublic dependencies

- [ ] Add a remote test working directory.
- [ ] Add commands for:
  - update source
  - build
  - start app
  - stop app
  - run tests
  - collect logs/results

## 4.2 Add Windows Browsers

Start with:

- [ ] Chromium.
- [ ] Microsoft Edge.
- [ ] Firefox.

Then test Mac-controlled remote Playwright execution.

- [ ] Windows Chromium standalone.
- [ ] Windows Edge standalone.
- [ ] Windows Firefox standalone.
- [ ] Mixed Windows-browser scenarios.

## 4.3 Add Windows Desktop App

- [ ] Build/install the Windows IinPublic app.
- [ ] Add clean test-profile support.
- [ ] Add remote app startup/shutdown.
- [ ] Add logs and crash artifact collection.
- [ ] Add Windows app automation adapter if required.

## 4.4 Cross-OS Tests

Start with simple two-peer combinations:

- [ ] Mac Chromium -> Windows Chromium.
- [ ] Windows Chromium -> Mac Chromium.
- [ ] macOS App -> Windows App.
- [ ] Windows App -> Android.
- [ ] Android -> Windows App.

Then expand:

- [ ] Mac browser + Windows browser + Android.
- [ ] macOS App + Windows App + Android.
- [ ] Mixed browser engines across operating systems.

Milestone:

> Mac mini centrally orchestrates macOS, Android, and Windows peers over the intranet.

---

# Stage 5 — Add Ubuntu

Ubuntu becomes another remote worker controlled by the Mac mini.

## 5.1 Prepare Ubuntu Worker

- [ ] Configure password-free SSH from Mac mini to Ubuntu.
- [ ] Give Ubuntu a stable hostname/IP.
- [ ] Verify:

```bash
ssh ubuntu-test hostname
```

- [ ] Install compatible Node.js/npm versions.
- [ ] Install Playwright dependencies.
- [ ] Add remote build/start/stop scripts.
- [ ] Add log and test artifact collection.

## 5.2 Add Ubuntu Browsers

- [ ] Chromium.
- [ ] Firefox.
- [ ] WebKit through Playwright where applicable.

Run:

- [ ] Browser tests locally on Ubuntu.
- [ ] Ubuntu browser -> Mac browser.
- [ ] Ubuntu browser -> Windows browser.
- [ ] Ubuntu browser -> Android.

## 5.3 Add Ubuntu Desktop App

- [ ] Build/install the Linux IinPublic app.
- [ ] Add isolated test profiles.
- [ ] Add remote startup/shutdown.
- [ ] Add desktop UI automation only where required.
- [ ] Reuse shared scenario logic wherever possible.

## 5.4 Full Cross-Platform Scenarios

Test representative combinations rather than every possible permutation on every commit.

Examples:

- [ ] macOS App + Windows App.
- [ ] macOS App + Ubuntu App.
- [ ] Windows App + Ubuntu App.
- [ ] Android + Windows App.
- [ ] Android + Ubuntu App.
- [ ] Android + macOS App.
- [ ] macOS Chromium + Windows Edge + Ubuntu Firefox.
- [ ] Android 1 + Android 2 + Windows App + Ubuntu App + macOS App.
- [ ] Browser peers and native-app peers simultaneously.

Milestone:

> Mac mini orchestrates a real distributed IinPublic environment containing macOS, Windows, Ubuntu, and multiple Android devices.

---

# Stage 6 — Central Test Matrix Orchestrator

Do this after the individual platforms work. Avoid building a large orchestration system before the underlying tests are stable.

## 6.1 Define Hosts and Devices

Create something similar to:

```text
tests/matrix/
  hosts.json
  devices.json
  scenarios/
  run-matrix.ts
  collect-results.ts
```

Example conceptual configuration:

```json
{
  "mac": {
    "type": "host",
    "platform": "macos",
    "host": "localhost"
  },
  "windows": {
    "type": "host",
    "platform": "windows",
    "host": "windows-test"
  },
  "ubuntu": {
    "type": "host",
    "platform": "linux",
    "host": "ubuntu-test"
  }
}
```

## 6.2 Standardize Peer Operations

Each platform adapter should expose roughly the same operations:

- [ ] prepare
- [ ] install
- [ ] reset
- [ ] start
- [ ] stop
- [ ] execute scenario action
- [ ] collect logs
- [ ] screenshot
- [ ] report status

Avoid putting platform-specific commands directly into scenario definitions.

Conceptually:

```typescript
await alice.start();
await bob.start();

await alice.createTalk("Looking for a bicycle");
await bob.waitForTalk("Looking for a bicycle");

await bob.answerTalk();
await alice.verifyMatch(bob);
```

`alice` could be Android while `bob` could be Windows, macOS, Ubuntu, or a browser.

## 6.3 Central Commands

Target commands:

```bash
npm run test:matrix -- browsers
```

```bash
npm run test:matrix -- android
```

```bash
npm run test:matrix -- desktop
```

```bash
npm run test:matrix -- discovery
```

```bash
npm run test:matrix --   --alice android1   --bob windows-app
```

Eventually:

```bash
npm run test:matrix --all
```

---

# Stage 7 — Reporting and Reliability

## Central Result Collection

- [ ] Keep the Mac mini as the primary report collector.
- [ ] Collect:
  - Playwright reports
  - Playwright traces
  - screenshots
  - Android logcat
  - application logs
  - desktop crash logs
  - host/device metadata
  - test duration
  - peer identities
  - scenario topology

- [ ] Produce one summary showing results by:
  - scenario
  - OS
  - browser
  - app/browser type
  - physical device

## Failure Diagnostics

Each failed distributed test should answer:

- [ ] Which peer failed?
- [ ] Which host/device was it running on?
- [ ] What action was being performed?
- [ ] What did the other peers observe?
- [ ] Was the problem UI, network, discovery, persistence, or synchronization?
- [ ] What logs/screenshots/traces are available?

---

# Stage 8 — Advanced Distributed/P2P Testing

Only start these after the basic matrix is stable.

## Network Failure Tests

- [ ] Disconnect one peer from Wi-Fi.
- [ ] Restore connection.
- [ ] Verify reconnection.
- [ ] Block one peer temporarily with firewall rules.
- [ ] Introduce latency.
- [ ] Introduce packet loss where practical.
- [ ] Restart the relay/seed helper if one is being used.
- [ ] Verify direct/local discovery behavior independently of Internet services.

## Lifecycle Tests

- [ ] Android background/foreground.
- [ ] Android app kill/restart.
- [ ] Desktop app close/restart.
- [ ] Browser close/reopen.
- [ ] Mac sleep/wake.
- [ ] Windows sleep/wake.
- [ ] Ubuntu service/app restart.

## P2P Convergence Tests

- [ ] Multiple peers update simultaneously.
- [ ] One peer operates offline.
- [ ] Offline peer rejoins.
- [ ] Verify eventual convergence.
- [ ] Verify duplicate messages are handled correctly.
- [ ] Verify stale state does not overwrite newer state.
- [ ] Verify identity remains correct after reconnection.

## Scale Tests

Gradually increase:

```text
2 peers
3 peers
5 peers
8 peers
10+ peers
```

A peer may be:

- Browser.
- macOS app.
- Windows app.
- Ubuntu app.
- Android phone.

---

# Recommended Implementation Order

Keep this exact order unless a specific product requirement forces an earlier dependency:

1. [ ] macOS Chromium baseline remains green.
2. [ ] macOS WebKit/Safari.
3. [ ] macOS Firefox.
4. [ ] Mixed browser tests on Mac.
5. [ ] macOS desktop app.
6. [ ] macOS app + browser tests.
7. [ ] One Android phone.
8. [ ] Android + Mac tests.
9. [ ] Two Android phones.
10. [ ] Three or more Android phones.
11. [ ] Windows remote worker.
12. [ ] Windows browsers.
13. [ ] Windows desktop app.
14. [ ] Windows + Mac + Android scenarios.
15. [ ] Ubuntu remote worker.
16. [ ] Ubuntu browsers.
17. [ ] Ubuntu desktop app.
18. [ ] Full Mac + Android + Windows + Ubuntu matrix.
19. [ ] Centralized matrix runner.
20. [ ] Unified reports and artifacts.
21. [ ] Network failure testing.
22. [ ] Sleep/restart/reconnect testing.
23. [ ] Larger P2P convergence and scale tests.

---

# Guiding Principle

Do not duplicate the complete E2E suite separately for every platform.

Separate the test system into:

```text
Shared IinPublic Scenario
        |
        +-- Browser adapter / Playwright
        +-- macOS app adapter
        +-- Android adapter
        +-- Windows app adapter
        +-- Ubuntu app adapter
```

The scenario describes **what IinPublic peers do**.

The adapter describes **how that particular platform performs the action**.

This makes mixed-platform scenarios possible and prevents the test system from becoming several independent, difficult-to-maintain test suites.

The final target architecture is:

```text
                         Mac mini
                     Test Orchestrator
                           |
          +----------------+----------------+
          |                |                |
        local             SSH              SSH
          |                |                |
       macOS            Windows           Ubuntu
    browsers/app      browsers/app      browsers/app
          |                |                |
          +----------------+----------------+
                           |
                        LAN / P2P
                           |
             +-------------+-------------+
             |             |             |
          Android 1     Android 2     Android 3+
             |
        ADB + mobile
        automation
```

The Mac mini should coordinate the test, but each target machine should run its own local browser/app automation. This keeps the architecture simple and allows the test environment to exercise real intranet discovery, P2P communication, OS networking, reconnect behavior, and cross-platform interoperability.
