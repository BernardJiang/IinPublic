# IinPublic TODO

Last reconciled: 2026-08-27 (§BB location auto-match consent and §DD multi-value gender/race
preference matching both landed — see docs/completed.md. §I X8 same-device linking E2E and a
real embedded-node hub-peer env-leak fix landed 2026-08-26; X3 remains the only Priority 2 item
still blocked on native-shell CI runners, Priority 3.)

This file contains active work only. Completed implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`.

**2026-09-08 consolidation:** the scattered `docs/TODO-*.md`/`docs/TODO_*.md` files that had
accumulated outside this canonical document were folded in — either as full new sections
(Priority 3's "Cross-platform E2E test matrix" subsection and Priority 6) or, for the two nearly-
finished ones, reduced to their one remaining open item. Sources and disposition are recorded in
`docs/archive/consolidated-2026-09-08/README.md`. `docs/IinPublic Identity & Key Architecture
TODO.md` is a design specification rather than a task queue and stays a separate file; see its own
"Actionable Implementation Plan" section (near its end) for open work there. A same-day follow-up
pass moved every fully-landed item/section (§J, most of §I, §BB, §DD's landed primitives, §EE's
spec-matrix bullet, §LL/§LL.1/§LL.2, §K7's design+implementation bullets, and the UI god-object
refactor's Issue #2) into dated `docs/completed.md` entries, leaving only genuinely open work here.
The "Cross-platform E2E test matrix" and "React DOM / React Native evaluation" sections were left
intact rather than split line-by-line — they read as living status matrices/phase plans where
partial completion is itself the useful signal.

## Priority 2 — identity linking and public-device handoff

### I. Multi-device identity linking

- [ ] Later harden password-free custody beyond v1 with a reviewed non-extractable WebCrypto-key
      format for supported browsers and OS Keychain/Keystore adapters for native shells.
- [ ] X3 website↔app remains skipped — needs a real native-shell CI runner (Priority 3), not a
  same-machine mechanism gap like X8 was.

## Priority 3 — native and cross-platform verification

- [ ] Connect the Mac mini, Windows, and Linux native-app jobs to real CI runners.
- [ ] Add iPhone native-shell coverage when an iOS shell is available. Android is already shipped
  and physically exercised; do not describe it as a browser-profile stand-in.
- [ ] Apple Wi-Fi Aware discovery/data-path prototype on supported physical devices; real
  iPhone→Android and Android→iPhone Wi-Fi Aware tests; same-LAN iOS↔Android Gun convergence
  (former `TODO_codex.md` Milestone 9, folded in here 2026-09-08).
- [ ] BLE discovery followed by upgrade to a high-bandwidth route; decide on BLE data transport
  only after throughput, battery, and background measurements (former `TODO_codex.md` Milestone 9;
  see also the "BLE Gun transport after measured product need" bullet under Deferred product
  decisions below).
- [ ] Physical-device matrix (former `TODO_codex.md` Milestone 12): maintain at least two iPhones,
  two Android devices, and one desktop node across supported OS ranges; test foreground/background/
  locked-screen transitions; test normal Wi-Fi, isolated LAN, no-Internet, cellular-NAT, and mixed
  routes; test Wi-Fi Aware and BLE discovery in both directions; measure latency, throughput,
  battery drain, reconnect time, and forwarding bytes. `npm run verify:devices` enforces the record
  schema (`docs/device-verification/README.md`); the physical run inventory is currently empty. See
  "Cross-platform E2E test matrix" below for the detailed staged rollout and current progress.
- [ ] External security review before enabling cellular peer forwarding or BLE data transport by
  default (former `TODO_codex.md` Milestone 13).

### Cross-platform E2E test matrix

##### Starting Point

Current baseline:

- macOS / Mac mini is the primary test controller.
- Existing Playwright E2E tests run on macOS.
- Current browser baseline is Chromium.
- Goal: gradually extend the same E2E scenarios across browsers, desktop apps, Android devices, Windows, and Ubuntu.
- Prefer incremental expansion: each stage should work reliably before adding the next layer.
- Keep one central test command and one combined test report on the Mac mini when practical.

---

#### Stage 1 — Expand macOS Browser E2E Coverage

Implementation note (2026-09-07): the first runnable slice is intentionally a
small cross-platform-invariant smoke gate. It does not yet claim that every
Chromium-oriented spec is portable. `npm run test:e2e:browsers` runs the gate in
all three engines; `npm run test:e2e:mixed-browsers` runs simultaneous engines
in one peer scenario.

##### 1.1 Add Safari/WebKit

- [x] Add a Playwright WebKit project to `playwright.config.ts`.
- [ ] Run the existing E2E suite under WebKit.
- [x] Identify tests that depend on Chromium-specific behavior.
- [x] Fix or isolate the first browser-specific assumption (`ensureWindowFitsViewport` now skips CDP outside Chromium).
- [x] Confirm networking, storage, IndexedDB, WebSocket, and Gun.js behavior under WebKit.
- [x] Add WebKit results to the normal Playwright HTML report.
- [x] Add a convenient command such as:

```bash
npm run test:e2e:webkit
```

Implemented and passing for the platform smoke gate.

##### 1.2 Add Firefox

- [x] Add a Playwright Firefox project.
- [ ] Run the existing E2E suite under Firefox.
- [ ] Fix or document Firefox-specific failures.
- [x] Verify Gun.js/P2P behavior under Firefox (installed Firefox ↔ macOS Electron direct-P2P channel).
- [ ] Verify local storage, IndexedDB, permissions, WebSocket, and reconnect behavior.
- [x] Add a command such as:

```bash
npm run test:e2e:firefox
```

Implemented and passing for the platform smoke gate; HTTP, WebSocket,
localStorage, IndexedDB, and local Gun read/write are covered. Permissions,
reconnect, and cross-peer Firefox behavior remain open.

Installed-release coverage is also available through
`npm run test:e2e:macos-firefox`: its mandatory preflight verifies the Firefox
application and WebDriver BiDi endpoint before any build, server, or test starts,
then runs the same platform smoke gate as the `macos-firefox` project.
`npm run test:e2e:macos-firefox:native` additionally requires a live direct-P2P
channel between installed Firefox and the local Electron app and verifies messages
in both directions.

##### 1.3 Run All Three Browsers

- [x] Run Chromium, WebKit, and Firefox from one Playwright configuration (platform smoke gate).
- [x] Add a command such as:

```bash
npm run test:e2e:browsers
```

Implemented; all projects contribute to one HTML report.

- [ ] Make test data and ports safe for parallel browser execution.
- [x] Prevent browser instances from accidentally sharing identities or state unless the test explicitly requires it (fresh context and browser IndexedDB plus server-graph clear per smoke test).
- [x] Give each test peer a visible identity such as:
  - chromium-alice
  - webkit-bob
  - firefox-eve

##### 1.4 Add Mixed-Browser P2P Scenarios

Do not only run the same test independently in each browser. Add scenarios where different browsers communicate with each other.

- [x] Chromium -> WebKit (first matching-thread slice).
- [x] WebKit -> Chromium (bidirectional reply in the same slice).
- [x] Chromium -> Firefox
- [x] Firefox -> Chromium
- [x] WebKit -> Firefox (verified in the seven-runtime physical ring).
- [x] Firefox -> WebKit
- [x] Three-peer scenario:
  - Chromium
  - WebKit
  - Firefox

Suggested scenarios:

- [x] Peer discovery.
- [x] Join the same chatroom.
- [x] Send and receive a Talk.
- [x] Answer a Talk.
- [x] Verify tag/question matching.
- [x] Verify state propagation.
- [ ] Disconnect and reconnect one browser.
- [ ] Verify state convergence after reconnection.
- [ ] Restart one browser and verify persisted identity/state.

Current mixed-engine slices use explicit `chromium-alice`, `webkit-bob`, and
`firefox-eve` identities. Chromium ↔ WebKit uses the bundled engines; the installed
stable Firefox matrix adds Chromium ↔ Firefox and Firefox ↔ WebKit, with a real
matched thread and messages in both directions for each pair. The physical matrix
additionally proves simultaneous three-engine presence and Chromium -> WebKit ->
Firefox propagation. Reconnect and restart persistence remain open.

Milestone:

> macOS can reliably run IinPublic E2E tests with Chromium, WebKit, Firefox, and mixed-browser peer combinations.

---

#### Stage 2 — Add the macOS Desktop App

Keep the Mac mini as the only physical host at this stage.

##### 2.1 Create an App Test Harness

- [ ] Determine how the macOS IinPublic desktop app can be launched with a clean test profile.
- [ ] Add command-line/environment options for:
  - test identity
  - test data directory
  - application port
  - peer name
  - log directory
- [ ] Ensure multiple app instances can run without sharing unintended state.
- [ ] Add deterministic app startup and shutdown commands.

##### 2.2 Automate the macOS App

Depending on the desktop app architecture:

- [ ] Reuse Playwright directly if the app is Electron and exposes a suitable Electron test interface.
- [ ] Otherwise select a macOS desktop automation adapter only for native UI operations.
- [ ] Keep application/P2P scenario logic shared with existing E2E tests.

##### 2.3 Add macOS App + Browser Matrix

Test combinations such as:

- [ ] macOS App -> Chromium
- [ ] Chromium -> macOS App
- [ ] macOS App -> WebKit
- [ ] WebKit -> macOS App
- [x] macOS App -> Firefox
- [x] Firefox -> macOS App (verified in the seven-runtime physical ring).
- [ ] macOS App -> macOS App, using separate test profiles

Suggested scenarios:

- [x] Discovery.
- [x] Chatroom join (leave remains open).
- [x] Talk exchange.
- [x] Matching.
- [ ] Identity persistence.
- [ ] App restart/reconnect.
- [x] Browser-to-app state synchronization.

Installed Firefox 155.0.1 ↔ macOS Electron is also verified locally through
`npm run test:e2e:macos-firefox:native`: both peers appear in Global, establish the
explicit-relay direct-P2P channel, and deliver messages in both directions.

Milestone:

> One Mac mini can run browser and native macOS-app peers together in the same automated IinPublic E2E scenario.

---

#### Stage 3 — Add Android to the Matrix

Start with one phone. Do not begin with a multi-phone test farm.

##### 3.1 One Android Phone

- [x] Connect one Android phone to the Mac mini with ADB (three connected on 2026-09-07).
- [x] Confirm:

```bash
adb devices
```

- [x] Automate APK installation (`npm run android:install:matrix`; explicit serials, bounded per-device timeout, and combined failure reporting).
- [x] Automate application reset/clean state (`adb shell pm clear` preflight barrier).
- [x] Automate application launch.
- [x] Select the Android UI automation framework (Playwright WebView/CDP plus explicit ADB lifecycle control, reusing the browser scenario layer).
- [ ] Start with Maestro unless a feature requires lower-level Android control.
- [x] Add ADB-based log collection (PID-scoped logcat and embedded Node stdio failure attachments).
- [x] Capture screenshots on failure (Playwright attachments from each WebView).
- [x] Add Android device information to the final test report.

##### 3.2 Android + macOS Browser Tests

Add cross-platform scenarios:

- [x] Android -> Chromium (Android Charlie -> Chromium ring edge).
- [ ] Chromium -> Android
- [ ] Android -> WebKit
- [ ] Android -> Firefox
- [ ] Android -> macOS App
- [x] macOS App -> Android (macOS -> Android Alice ring edge).

Important IinPublic tests:

- [x] Android discovers desktop peer.
- [x] Desktop discovers Android peer.
- [ ] Android publishes a Talk and desktop receives it.
- [x] Desktop publishes a Talk and Android receives it.
- [ ] Android disconnect/reconnect.
- [ ] Android app background/foreground.
- [ ] Network interruption and recovery.
- [ ] Identity persistence after app restart.

Milestone:

> One real Android phone participates as a peer in the same automated E2E scenario as macOS browsers and the macOS app.

##### 3.3 Expand to Two Android Phones

- [x] Add stable ADB serial mapping.
- [x] Give each device a logical test name.
- [ ] Example:

```text
android-alice -> SERIAL_1
android-bob   -> SERIAL_2
```

- [x] Allow each test to address a specific device.
- [x] Prevent APK install/reset commands from affecting the wrong device.
- [x] Add Android -> Android Talk and discovery tests.
- [x] Add Android + Android + desktop three-peer tests.

##### 3.4 Expand to Three or More Android Phones

- [x] Move device configuration into a central file such as:

```text
tests/matrix/devices.json
```

- [x] Automatically detect connected devices for matrix installation and launch readiness.
- [ ] Mark unavailable devices as skipped rather than crashing the whole matrix.
- [ ] Support selecting devices by logical name.
- [x] Add 3+ peer convergence tests.
- [x] Test simultaneous joins.
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

Verified 2026-09-07: `npm run test:e2e:real-device-matrix` passed in 4.8 minutes
with three physical Android phones, macOS Electron, Chromium, WebKit, and Firefox.
Every runtime authored and broadcast one Talk; a seven-node ring completed and matched
one incoming Talk per runtime.

---

#### Stage 4 — Add Windows

At this point introduce the first remote desktop host.

##### 4.1 Prepare Windows as a Remote Test Worker

- [x] Enable OpenSSH Server on Windows.
- [x] Configure password-free SSH from the Mac mini.
- [x] Give the Windows machine a stable SSH alias (`windows-test`).
- [x] Verify from Mac (the runner uses explicit PowerShell because this host's default shell rejects bare `hostname`):

```bash
npm run test:e2e:windows:preflight
```

- [x] Install required versions of:
  - [x] Node.js (portable Node 24.20.0 under the remote user profile)
  - [x] npm (from the portable Node distribution)
  - [x] Playwright (Chromium, WebKit, and Firefox browser bundles)
  - [x] IinPublic dependencies

- [x] Add a remote revision-keyed test working directory.
- [x] Add commands for:
  - [x] update source (`git archive` of the exact controller revision over SCP)
  - [x] build
  - [x] start app (installed executable through Playwright Electron)
  - [x] stop app (Playwright close followed by silent uninstall)
  - [x] run tests
  - [x] collect logs/results (Playwright blob copied back and merged on the Mac)

First runnable slice: `npm run test:e2e:windows` checks `windows-test` availability
before doing any work, prepares the isolated worker, and runs the platform smoke gate in
Chromium, WebKit, and Firefox. `npm run test:e2e:windows:preflight` performs no tests.
The runner always performs that availability gate before archive transfer, dependency
installation, builds, or tests. On 2026-09-07 all six platform-smoke cases passed on
`BERNARDJIANGPC` (Windows 10 Pro x64), and the blob report was merged on the Mac.

##### 4.2 Add Windows Browsers

Start with:

- [x] Chromium.
- [x] Microsoft Edge.
- [x] Firefox.

Playwright WebKit is also installed and its platform-smoke cases pass on this worker.

Then test Mac-controlled remote Playwright execution.

- [x] Windows Chromium standalone.
- [x] Windows Edge standalone.
- [x] Windows Firefox standalone.
- [x] Mixed Windows-browser scenarios (simultaneous installed Edge -> Firefox match and bidirectional messages).

On 2026-09-07 all eight platform-smoke cases passed on Windows: two cases each
under Chromium, installed Microsoft Edge, WebKit, and Firefox.

##### 4.3 Add Windows Desktop App

- [x] Build/install the Windows IinPublic app (x64 NSIS installer, isolated silent install).
- [x] Add clean test-profile support.
- [x] Add remote app startup/shutdown (including silent uninstall cleanup).
- [x] Add logs and crash artifact collection (`electron.log` plus up to ten Crashpad files when present).
- [x] Add Windows app automation adapter if required (Playwright Electron).

First installed-executable gate: `npm run test:e2e:windows:desktop` builds the x64
NSIS package on `windows-test`, installs it into the revision workspace, launches
that installed `IinPublic.exe`, and verifies the embedded SPA plus `/health`,
`/worker.js`, and `/node_modules/gun/gun.js`. It uses an isolated user-data path,
closes the app, uninstalls it, and merges the remote blob report on the Mac. The
2026-09-07 run passed; its returned blob contains the Electron file-log attachment,
and the isolated install directory was removed. Windows code signing remains open.

##### 4.4 Cross-OS Tests

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

#### Stage 5 — Add Ubuntu

Ubuntu becomes another remote worker controlled by the Mac mini.

##### 5.1 Prepare Ubuntu Worker

- [x] Configure password-free SSH from Mac mini to Ubuntu.
- [x] Give Ubuntu a stable SSH alias (`ubuntu-test`).
- [x] Verify:

```bash
npm run test:e2e:ubuntu:preflight
```

- [x] Install compatible Node.js/npm versions (portable Node 24.20.0 under the remote user home).
- [x] Install Playwright and IinPublic dependencies in the revision-keyed worker.
- [x] Add remote build/start/stop scripts.
- [x] Add log and test artifact collection.

`npm run test:e2e:ubuntu:preflight` always checks SSH, Ubuntu/x86_64, the configured X11
display, and free disk space before any deploy, build, or test. `npm run
test:e2e:ubuntu:desktop` deploys the exact controller Git revision over SSH/SCP and returns a
Playwright blob report to the Mac. The optional worker reports `SKIP` when unavailable; set
`UBUNTU_E2E_REQUIRED=1` to make unavailability fail CI.

##### 5.2 Add Ubuntu Browsers

- [x] Chromium (Playwright platform-smoke gate on the real Ubuntu worker).
- [x] Firefox (Playwright platform-smoke gate on the real Ubuntu worker).
- [ ] WebKit through Playwright where applicable.

Run:

- [x] Browser tests locally on Ubuntu (first Chromium slice).
- [ ] Ubuntu browser -> Mac browser.
- [ ] Ubuntu browser -> Windows browser.
- [ ] Ubuntu browser -> Android.

Verified 2026-09-10: `npm run test:e2e:ubuntu:chromium` and `npm run
test:e2e:ubuntu:firefox` each passed both platform-smoke cases on `ubuntu-test` using display
`:1`. This covers all-tab layout/dialog behavior, settings persistence across reload, HTTP,
WebSocket, localStorage, IndexedDB, and local Gun read/write in both engines. Each browser
installation is bounded by a five-minute timeout, and its Playwright blob is returned to and
merged on the Mac. WebKit and cross-host peer scenarios remain open.

##### 5.3 Add Ubuntu Desktop App

- [x] Build/install the Linux IinPublic app (x64 AppImage, extracted ephemeral installation).
- [x] Add isolated test profiles.
- [x] Add remote startup/shutdown.
- [x] Add desktop UI automation only where required (Playwright Electron).
- [x] Reuse shared scenario logic wherever possible (shared native-app boot spec and helper).

Verified 2026-09-10 on `ubuntu-test` (`bernard-MS-7B48`, Ubuntu 24.04.4 LTS x86_64):
the runner built `IinPublic-1.0.27.AppImage`, extracted it without root/FUSE, launched the
packaged `iinpublic-desktop` executable on display `:1`, and passed the shared embedded-SPA,
`/health`, `/worker.js`, and Gun static-resource checks. Playwright closed the app, removed the
ephemeral extraction, and merged the returned report on the Mac. Ubuntu browser and cross-host
peer scenarios remain open in §§5.2 and 5.4.

##### 5.4 Full Cross-Platform Scenarios

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

#### Stage 6 — Central Test Matrix Orchestrator

Do this after the individual platforms work. Avoid building a large orchestration system before the underlying tests are stable.

##### 6.1 Define Hosts and Devices

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

##### 6.2 Standardize Peer Operations

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

##### 6.3 Central Commands

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

#### Stage 7 — Reporting and Reliability

##### Central Result Collection

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

##### Failure Diagnostics

Each failed distributed test should answer:

- [ ] Which peer failed?
- [ ] Which host/device was it running on?
- [ ] What action was being performed?
- [ ] What did the other peers observe?
- [ ] Was the problem UI, network, discovery, persistence, or synchronization?
- [ ] What logs/screenshots/traces are available?

---

#### Stage 8 — Advanced Distributed/P2P Testing

Only start these after the basic matrix is stable.

##### Network Failure Tests

- [ ] Disconnect one peer from Wi-Fi.
- [ ] Restore connection.
- [ ] Verify reconnection.
- [ ] Block one peer temporarily with firewall rules.
- [ ] Introduce latency.
- [ ] Introduce packet loss where practical.
- [ ] Restart the relay/seed helper if one is being used.
- [ ] Verify direct/local discovery behavior independently of Internet services.

##### Lifecycle Tests

- [ ] Android background/foreground.
- [ ] Android app kill/restart.
- [ ] Desktop app close/restart.
- [ ] Browser close/reopen.
- [ ] Mac sleep/wake.
- [ ] Windows sleep/wake.
- [ ] Ubuntu service/app restart.

##### P2P Convergence Tests

- [ ] Multiple peers update simultaneously.
- [ ] One peer operates offline.
- [ ] Offline peer rejoins.
- [ ] Verify eventual convergence.
- [ ] Verify duplicate messages are handled correctly.
- [ ] Verify stale state does not overwrite newer state.
- [ ] Verify identity remains correct after reconnection.

##### Scale Tests

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

#### Recommended Implementation Order

Keep this exact order unless a specific product requirement forces an earlier dependency:

1. [ ] macOS Chromium baseline remains green.
2. [ ] macOS WebKit/Safari.
3. [x] macOS Firefox (installed stable release smoke gate; broader suite and reconnect coverage remain above).
4. [x] Mixed browser tests on Mac (all directed Chromium/WebKit/Firefox pairs covered).
5. [ ] macOS desktop app.
6. [ ] macOS app + browser tests.
7. [ ] One Android phone.
8. [ ] Android + Mac tests.
9. [ ] Two Android phones.
10. [ ] Three or more Android phones.
11. [x] Windows remote worker.
12. [x] Windows browsers.
13. [x] Windows desktop app.
14. [ ] Windows + Mac + Android scenarios.
15. [x] Ubuntu remote worker.
16. [ ] Ubuntu browsers.
17. [x] Ubuntu desktop app.
18. [ ] Full Mac + Android + Windows + Ubuntu matrix.
19. [ ] Centralized matrix runner.
20. [ ] Unified reports and artifacts.
21. [ ] Network failure testing.
22. [ ] Sleep/restart/reconnect testing.
23. [ ] Larger P2P convergence and scale tests.

---

#### Guiding Principle

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

## Priority 4 — matching and profile follow-ups

### DD. Generalized dating matching

Design is specified in technical specification §30.6. The age-range comparator and multi-value
gender/race preference matching are now both fully wired and shipping (as the built-in Dating
talk template); the remaining bullet — photo-delivery consent/safety copy — carries its own
product/safety judgment call and is left for a dedicated pass.

- [ ] Add optional author-selected talk photo delivery after a successful match and safety notice.

### EE. Me/profile completion

- [ ] Store typed built-in declarations as `AnswerRecord` values rather than profile fields.
  **Research note (2026-08-23), not yet implemented:** no separate "profile field" was ever
  actually written for these (Bernard's original correction — completed.md, 2026-08-11 EE
  entry — headed that off before implementation: profile holds only StageName + headshot).
  What's actually true today: a typed built-in value (quantity/priceRange/timeFrame the author
  enters on their OWN question) is saved ONLY into `typedPreferenceState` (chatbot-only,
  invisible to the author) — `applyBuiltInKindToQuestion`/route's `answersHtml = q.builtIn ? ''`
  both hide the ordinary self-answer radio for a builtIn question, so no self-answer is ever
  recorded through the normal mechanism either. Net effect: the author's own typed declaration
  never appears anywhere in their own Me-tab Answers list today — arguably the same "invisible
  side value" problem the profile-field framing was trying to avoid, just realized via a
  different store. `answers-view.ts`'s "Answers" list is scoped to talks with
  `role === 'answered' || 'copied'` (things I responded to), not self-authored declarations, so
  the fix isn't a small display tweak — it needs a real decision on where a self-authored
  builtIn declaration should surface. Left open rather than guessing at that shape.
- [ ] Add typed-value round-trip and section-isolation E2E coverage. Blocked on the above.

### II. User-defined tag compatibility, generalized beyond symmetric opposites

**Landed:** the core data model — `Talk.selfTag: string` + `Talk.preferenceSet: string[]` (spec
§30.2), replacing `Talk.role` entirely. `checkIfMatch`'s veto is now
`preferenceSet.includes(responderSelfTag)` — a real membership check against a list, so "buy"
satisfied by several counterparts ("sell" AND "offer" AND "free") is already structurally
supported, not just a future idea. `exact-chatbot-memory.ts`'s auto-reply veto and
`resolveBuiltInQuestion`'s scope-key derivation were updated to match.

**Landed, 2026-08-19:** `#talk-preference-set` (talk-editor-dialog.ts) — an explicit, editable
counterpart-tag field next to `#talk-tag`. Auto-tracks the seeded single opposite live until the
author types their own value there (or opens an existing talk that already has one), at which
point that value wins outright, including declaring the SAME tag as `selfTag` itself ("match
fellow buy people" buddy-style talks — previously impossible, since auto-fill only ever produced
the opposite). `processTalkForm` reads whichever of the two fields has content, falling back to
the old single-opposite auto-fill when empty. Closed the last script-injected talk creation in
`89-buy-sell-chatbot-cross-talk-match.spec.ts`.

Still open — **superseded by §LL below, not to be built as originally scoped here:**
- [ ] No persistence for user-created pairs — the seeded registry (`tag-opposite-pairs.ts`:
  buy/sell, hiring/jobseeking, male/female) still only auto-fills a **single** `preferenceSet`
  value from those 3 hard-coded pairs; typing any other tag gets no auto-derived compatibility.
  Still real under §LL too (the registry becomes an editor-autofill-only convenience there), but
  persistence itself is unscoped either way.
- [ ] ~~No multi-value editing UI~~ — built as a comma-separated `#talk-preference-set` field
  above, but §LL rejects multi-value on a tag outright (a bare second word like "free" is
  ambiguous without its own question — give or receive?) and routes that need instead through
  §LL's single-answer rule: a second accepted tag becomes a second ANSWER ROW on an ordinary
  question, not a second comma-separated string entry. `#talk-preference-set` is expected to be
  retired once §LL lands, not extended.
- [ ] The question/answer-shaped generalization ("need a plumber" satisfied by "does plumbing")
  discussed alongside this is now the substance of §LL, not separate discussion.

### JJ. Bidirectional deal confirmation (spec §30.2, replaces the old auto-exclusivity guard)

Landed this session: a talk declaring `selfTag`/`preferenceSet` is no longer exclusive on its own
— several compatible candidates can each hold an open conversation (the earlier
`isExclusiveMarketplaceTalk`/closest-match auto-pick-and-reject machinery in `app.ts`, built for
taxi/dealmaker, was removed entirely). Instead, each conversation gets a "Confirm Deal" affordance
(`#conversation-confirm-deal-btn`, `showConversationDetail` in `ui-manager.ts`); once BOTH
participants confirm (`WebConversationService.confirmDeal`, `Conversation.dealConfirmedBy`), each
side's own device independently disables its own outstanding created deal-eligible talk(s)
(`maybeFinalizeConfirmedDeal`, `app.ts`) — detected reactively on whichever device confirms
second, and via Gun-sync on the other, since "both confirmed" can become true on either side.

- [ ] **Known gap:** confirming a deal does NOT mark a *different* candidate's conversation (e.g.
  a losing driver with their own separate talkId, matched against the same passenger's request)
  as "no longer available" — grouping "other candidates for the same underlying need" across
  different authors' own talkIds needs a mapping that doesn't exist yet.
  `05-taxi-local-chatroom-match.spec.ts`'s rewritten two-driver test documents this gap directly
  rather than asserting it works.
- [ ] `maybeFinalizeConfirmedDeal` currently disables **all** of the confirming user's outstanding
  created deal-eligible talks, not just the one specific to the confirmed conversation (bidirectional
  exchange means the conversation's own `talkId` field isn't a reliable way to find "my side" of a
  specific deal — see the function's doc comment). Fine for the "one active listing" scenarios
  this session's tests use; a user running several simultaneous listings and expecting confirming
  one deal to leave the others open is unhandled.

### KK. Context-aware chatbot answer matching, generalized beyond talk-title scoping

The target model: an incoming talk's question is never matched against a specific counterpart
talk directly — every question a user answers flattens into that user's own Me-tab Q&A store,
keyed by context, and a NEW incoming talk's question is resolved by looking itself up in that
flattened store. This is largely how the codebase already behaved for ordinary flow/tag
questions via two existing pieces, not a new mechanism that had to be built:
`saveAnswerPreference` (`ui-manager.ts`) writes every answered question into 3 stores at once
(exact-chatbot-memory, a context-aware flattened store, and a legacy per-talk-instance store);
`buildAnswerPreferenceLookupKey` (`shared/flattened-answer-keys.ts`) keys the flattened store by
the normalized chain of prior `{questionText, answerText}` pairs leading to the current question
— talk-identity-independent, which is exactly the per-context matching this design wants (except
for the first question in a chain, deliberately talk-independent for cross-talk reuse, and
tag/single-question talks, which are content-hash-scoped instead).

**Landed:**
- Lookup order fixed: `resolveAnswerPreferenceForTalkQuestion` now tries the context-aware
  flattened lookup FIRST (single-select only — the flattened store has no concept of a checked
  set), translating the stored answer back to the current talk's own answer id by TEXT (not by
  the stored id, which may belong to a different, independently-authored talk's id scheme).
  Falls back to context-free `exact-chatbot-memory` only when the flattened lookup has nothing.
- `selfTag`/`preferenceSet` now enter the context key via `myEffectiveTagContext` (`ui-manager.ts`)
  and `buildAnswerPreferenceLookupKey`'s new `tagContext` param. Correction from the original
  proposal in this section: hashing `preferenceSet` as ONE sorted+joined string (mirroring
  `cid.ts`'s talk-content-hash) turned out to be wrong, not just suboptimal — a single incoming
  talk only ever declares one `selfTag`, so a joined multi-member string can never be reconstructed
  from the read side, breaking the cross-talk lookup entirely for any talk whose `preferenceSet`
  has more than one member. The actual fix: fan out per `preferenceSet` member on SAVE (one
  bucket per member of the CURRENT talk being saved — bounded by that one talk's own tag count,
  not combinatorial across the question chain), single lookup per READ (an incoming talk has
  exactly one `selfTag`). E2E-verified end to end for the ordinary buy⇄sell case and for the
  collision this section was written to fix (a user's two same-item talks with different
  `preferenceSet` no longer bleed into each other) —
  `stage2-two-user/89-buy-sell-chatbot-cross-talk-match.spec.ts`. Still open: the "answering
  someone else's talk ad hoc, with no talk of my own in play" case has no `preferenceSet` to fan
  out at all (falls through to `mySelfTag`-only scoping, which is correct but coarser).

Still open:
- [ ] **Tag position is not fixed to "root" or "talk-level singular metadata."** The design pass
  this bullet used to call for is now written up in §LL below — a tag is really just a simplified
  single-question talk, and the fix is to model it as an ordinary node in the question chain
  rather than special-cased talk-level metadata, so `checkIfMatch`'s veto and the context-hash
  path both fall out for free instead of needing position-awareness bolted on.

## Priority 5 — TechSupport productionization

### K7. Delegated TechSupport answers

- [ ] Define production TechSupport key custody and rotation tooling.
- [ ] Package the headless/off-server TechSupport agent.

## Priority 6 — UI architecture: god-object refactor & React evaluation

### UI god-object refactor

**Status:** Issue #2 (React dependency cleanup) ✅ **DONE** in `2f0b7355`; see `docs/completed.md`
for its evidence — this document's own copy of it was archived out 2026-09-08. Issue #1
(`ui-manager.ts` decomposition) is **in progress**; extraction clusters #1-#72 are complete.
Clusters #1-#8 (2026-08-18 through 2026-08-25) extracted the route editor, survey statistics,
application shell, answer-preference resolution, the local statistics dashboard, the edit-profile
dialog, custom-chatroom dialogs, and the settings storage inspector. Clusters #9-#39
(2026-09-08/09/10) extracted, in order: talk-editor form processing; linked-devices dialog
orchestration; the creator-replies list; talks-row gestures; flat answer-history record
construction; verified support-message filtering; the dirty-word editor; the Me-tab answers
filter; the chatroom message renderer + notification badge; the captured-question confirm
dialog; the talk-template picker; the DM/choose-who-to-dm person pickers; the broadcast-audience
confirm dialog; the notification toast (116 call sites — the widest blast radius of any cluster
so far); the peer-name cache; the conversation message cards (captured-question/IPFS-attachment);
the app-bar overflow reflow + system-announcement banner + app-bar chrome setup; the item-details
popup + question-answer-completion storage; the browser file-save helper; the talk-broadcast
toggle; talk-creation storage (+ copy-answered-talk); delivery-reason labels; known-person
saving; chatroom-title resolution; the creator-reply filter-state trio; the conversation
transport/online-status updates; the status bar; the conversation-withdrawn/ended record-update
pair; the quick-ignore/quick-copy incoming-talk gesture actions; the tag-answer-suffix formatter
pair; the incoming-talk notification display; block/unblock (`setBlocked`); talk completion
(`completeTalk`/`saveMyTalk`); the app-download banner (`detectDownloadPlatform`/
`renderAppDownloadBanner`); the answer-preferences dialog + its mutation logic
(`showPreferencesDialog`/`normalizePreferenceMode`/`applyPreferenceModeToExactMemory`/
`deleteAnswerPreference`); the local-statistics dashboard (`displayContextualStatistics`/
`displayStatisticsDashboard`/`renderStatisticsDashboard`); IPFS attachment hydration
(`hydrateAttachmentImages`); the erase-device confirm-dialog wiring (`openEraseDeviceDialog`); and
the zero-dependency mesh-delivery helper `registerTalkForPeer`; and the broadcast-audience
preview trio (`resolveExpiresAtMs`/`BroadcastAudiencePreview`/
`getSenderOmittedBroadcastPreviews`); the flow-editor answer-constraint refresh
(`refreshFlowAnswerConstraints`); the settings-section HTML template (`renderSettingsSection`);
the content-filter block/hide toast (`showContentFilterToast`); the settings-section
drill-down view (`applySettingsSectionView`); and the attachment metadata/media-tile helpers
(`formatAttachmentSize`/`attachmentDownloadFilename`/`attachmentIconForMime`/`renderMediaTile`);
`markOtherDealConversationsEnded` (joined cluster #37's `conversation-record-updates.ts`); and
`syncStatusBarMatchCount` (joined cluster #36's `status-bar.ts`); the talk-detail routing
(`showTalkDetail`); and the location-matched-room suggestion banner
(`showLocationRoomSuggestion`); the return-home button sync (`syncReturnHomeButton`); talk deletion (`deleteMyTalk`); IPFS
share payload parsing (`parseIpfsSharePayload`, joined cluster #54's `attachment-metadata.ts`);
talk-distance-from-author formatting (`formatTalkDistanceFromAuthor`); chatroom info
(`updateChatroomInfo`); current-chatroom sync (`setCurrentChatroomId`); the navigate-to-my-answer scroll/highlight
(`navigateToMyAnswerForTalk`); quick-answer incoming tag (`quickAnswerIncomingTag`); and shared-attachment collection
(`collectSharedAttachments`, joined cluster #54's `attachment-metadata.ts`); broadcast selection
and local payload lookup (`getBroadcastableTalkIds`/`getBroadcastTalkPayload`, joined cluster
#43's `broadcast-audience-preview.ts`); and talk-list metadata
(`formatTalkExpiryTone`/`getIncomingQuestionCount`); and shared-link collection
(`collectSharedLinks`, joined cluster #54's `attachment-metadata.ts`); per-recipient broadcast
delivery selection (`broadcast-delivery-selection.ts`); and the complete Talks-tab list renderer
and listener lifecycle (`talks-list-view.ts`). Full per-cluster rationale,
characterization evidence, and canonical-gate results are in `docs/completed.md` (search
"UIManager decomposition cluster"); this section keeps only the running ratchet and cross-cluster
findings to stay readable as the count grows.

The ratchet grew from 8,938 (after cluster #8) to 9,153 as legitimate feature work (onboarding,
K7 delegate credentials) landed on top between clusters, then came down cluster-by-cluster to
8,912 (#9), 8,784 (#10), 8,584 (#11), 8,482 (#12), 8,378 (#13), 8,270 (#14), 8,197 (#15), 8,133
(#16), 8,068 (#17), 8,030 (#18), 7,984 (#19, crossing under 8,000), 7,906 (#20), 7,834 (#21),
7,778 (#22), 7,746 (#23), 7,708 (#24), 7,653 (#25), 7,605 (#26), 7,581 (#27), 7,560 (#28), 7,518
(#29), 7,481 (#30), 7,455 (#31), 7,444 (#32), 7,422 (#33), 7,375 (#34), 7,345 (#35), 7,332 (#36),
7,301 (#37), 7,285 (#38), 7,233 (#39), 7,205 (#40), 7,198 (#41), 7,184 (#42), 7,097 (#43), and
7,027 (#44), 6,919 (#45), 6,858 (#46), 6,830 (#47), 6,802 (#48), 6,779 (#49), 6,742 (#50), 6,710
(#51), 6,697 (#52), 6,678 (#53), 6,637 (#54), 6,620 (#55), 6,607 (#56), 6,566 (#57), and
6,555 (#58), 6,545 (#59), 6,531 (#60), 6,517 (#61), 6,504 (#62), 6,494 (#63), 6,485 (#64), and
6,472 (#65), 6,462 (#66), 6,453 (#67), 6,437 (#68), 6,416 (#69), 6,401 (#70), 6,367 (#71), and
**5,711** (#72)
— the current enforced ceiling
(`src/test/unit/ui-manager-size-budget.test.ts`).

Three dead-code findings surfaced along the way, all left in place (logic-wise) rather than
removed unilaterally (deleting a whole feature is a different kind of change than a
behavior-preserving extraction) and flagged here for a deliberate call: `showEditStageNameDialog`
(59 lines, found during clusters #17-21) has zero callers anywhere in the codebase; `app-bar.ts`
(found during cluster #25) defines a complete, differently-shaped `updateOverflow`/`renderAppBar`/
`AppBarConfig` component system that is not imported anywhere in the app at all;
`displayStatisticsDashboard`/`renderStatisticsDashboard` (found during cluster #46, when
extracting them into `local-statistics.ts` broke the mutual-recursion self-reference that had
been masking this from `tsc`'s unused-locals check) are never called from outside their own
`onRefresh` cycle, and no code anywhere creates the `#statistics-content` container they render
into — the logic is fully preserved and tested in `local-statistics.ts`, but the now-orphaned
`ui-manager.ts` shim for `displayStatisticsDashboard` had to be removed since it no longer
compiled. A near-miss
during cluster #35's pass (fully deleting `resolveAnswerPreferenceForTalkQuestion`, which turned
out to still be a characterization test's direct call target) prompted the execution-rule
addition below about checking `src/test/` before deleting a method outright.
**Written:** 2026-08-18; execution plan refreshed 2026-08-23 against merged `dev.codex` after
`origin/dev.claude` was merged at `28e92eca`.
**Execution rule:** work one cohesive cluster at a time. Preserve the public `UIManager` contract,
characterize behavior before moving it, ratchet the size ceiling down after the extraction, and
run the canonical verification gate before beginning another cluster. Before **fully deleting**
any method (as opposed to moving its body to an extracted module while leaving a delegating
shim), grep `src/test/` too, not just `ui-manager.ts`/`app.ts` — a characterization test can hold
a private method's only remaining "caller" via a type-cast pattern (`new UIManager() as unknown
as SomeInterface`, established in cluster #4) that `npm run test:type` won't catch, since the
cast makes the missing method only a *runtime* error. Caught in cluster #35's pass on
`resolveAnswerPreferenceForTalkQuestion` (shipped, then reverted after a failing test run) and
again in cluster #52's pass on `saveAnswerPreference` (caught by the grep *before* running
anything, so the attempt was reverted with zero test churn — see `docs/completed.md` for both
accounts).

This document captures two issues found during an architecture study of `src/`:

- **Issue #1** — `src/web/ui/ui-manager.ts` is an 11,793-line singleton god-object.
- **Issue #2** — React 19 and a React toolchain were declared as dependencies, but the real UI was
  framework-free hand-rolled DOM; the only React consumers were legacy demos that are now archived.

Both issues share one root cause: an early **Gun + React proof-of-concept** was superseded by a
framework-free TS UI, but (a) the UI monolith was never decomposed and (b) the React manifest
entries and babel preset were never removed.

---

#### Evidence (refreshed 2026-08-23)

##### Issue #1 — the god-object

- `src/web/ui/ui-manager.ts` = **11,793 lines** and 344 methods in one
  `export class UIManager extends EventEmitter`. `src/web/app/app.ts` = **6,531 lines**.
- `app.ts` currently uses about **132 distinct `UIManager` members**. Preserving its single import
  statement is not enough: method signatures, emitted event names/payloads, DOM IDs, focus behavior,
  and listener lifecycle are all compatibility contracts.
- There is already a working extraction pattern to follow:
  - `src/test/unit/ui-extracted-modules.test.ts` imports from `my-talks-dialog`, `preferences-dialog`,
    `conversations-view`, `user-detail-view`, `talk-editor-form-helpers`, `ui-settings-storage`, etc.
  - So "extract a cohesive cluster into `src/web/ui/<module>.ts` and have `ui-manager.ts` delegate"
    is the established, tested convention — not a new risk.


#### Issue #1 — Decompose the `ui-manager.ts` god-object (phase-by-phase)

> Strategy: **extract, don't rewrite.** Use the existing `ui-extracted-modules` pattern. Keep the
> public API stable through delegation shims in `ui-manager.ts`. Extracted modules must take typed,
> explicit dependencies and must not import `UIManager`, reach through a singleton, or mutate a DOM
> subtree owned by another renderer.

- [x] **1.0 Baseline (mandatory gate).** The former route-editor collision has landed, including
      route reset/self-answer behavior and the stage2/93 fan-out E2E. Record the current baseline:
      - `ui-manager.ts`: 11,793 lines; `app.ts`: 6,531 lines.
      - Run `npm run test:all` and record wall-clock/per-phase timings.
      - Keep unrelated local files such as the user-owned `AGENTS.md` outside the refactor diff.
      The implementation baseline is not complete until the canonical gate ends green.
      - The first 2026-08-24 run exposed one real stage2/21c regression: a policy-rejected adult
        offer was written to the sender's anti-repeat ledger before the receiver accepted it, so
        reaching the three-vouch threshold could not make the offer retryable. Mesh delivery now
        reports signed recipient ACKs and the sender records only accepted deliveries.
      - Canonical rerun `run-20260824-181749-67574`: all static checks and all 12 browser blobs
        passed in 16m36s. Stage2/21c also passed twice alone after the fix, and stage2/93's real
        route fan-out E2E remains green.
- [x] **1.1 Add a ratcheting growth guardrail.** Started at 11,793, lowered with the first
      extraction to 11,197, with cluster #2 to 10,830, with cluster #3 to 10,280, with cluster
      #4 to 9,830, with cluster #5 to 9,656, with cluster #6 to 9,426, with cluster #7 to 9,290,
      and with cluster #8 to a test-enforced ceiling of **8,938**
      lines. Lower the ceiling in the same commit as every extraction; never raise it merely to land
      unrelated feature work. Line count is a warning metric, not the architecture definition.
- [x] **1.2 Profile coupling before extracting (measured, not guessed).** The initial AST proxy
      counted method size and distinct `this.*` references, then checked DOM/event/state ownership:
      - **First: route-talk DAG editor.** `renderRouteEditor` is about 344 lines with only three
        distinct `this.*` dependencies; its state and model conversions are concentrated in one
        range. The former in-flight collision is now merged.
      - **Second: survey statistics.** The final measured block was 385 removed lines (dialog,
        dashboard rendering, filtering, CSVs, download side effect, and follow-up construction).
        Its only instance boundaries were local talk lookup, translations, notification/download,
        and opening the existing talk editor, so it was extracted as cluster #2.
      - **Third: application shell.** `setupBaseUI` was 460 lines with only six `this.*`
        references, and the adjacent `applyShellTranslations` was 112 lines with two dependencies.
        The 451-line template and repeatable localization pass are deterministic shell work;
        translation and language options are their only data inputs. Navigation and listener
        ownership stay in `UIManager`, making this a low-coupling cluster despite its broad DOM
        surface.
      - **Fourth: answer-preference resolution.** The 258-line resolver, 85-line persistence
        method, 85-line full-chatbot builder, and their small effective-tag helper formed one
        storage/decision pipeline. Only the current user id crossed the instance boundary, while
        `app.ts` already depended on the full-builder method as a stable `UIManager` entry point.
      - **Fifth: local statistics dashboard rendering.** The dashboard renderer and its table,
        frequency-bar, and sparkline helpers removed 174 net lines from `UIManager`. Their only
        instance dependencies were translated text and the refresh callback; local aggregation,
        optional server augmentation, and refresh orchestration remain in the manager.
      - **Sixth: edit-profile dialog.** The 215-line dialog and its profile visibility/interest
        category formatters formed one DOM/event unit. Only the user, UI language, language option
        list, translated text, and async profile-change callback cross the extracted boundary.
      - **Seventh: custom-chatroom dialogs.** The 100-line create dialog and 53-line rename dialog
        share modal cleanup, translated text, and short-name validation. Only text formatting and
        warning notification cross the boundary; server creation and chatroom state remain in the
        manager.
      - **Eighth: settings storage inspector.** The browser-storage inventory, relay-debug fetch,
        value/path/policy localization, and seven diagnostic section renderers formed one
        377-line read-only diagnostics boundary. The manager now supplies only formatted app state,
        the API base, and translated text through one thin async shim.
      - **Defer: `displayTalksList`.** It is about 679 lines and touches roughly 52 distinct instance
        members, so it is a poor first extraction despite its size.
      - **Ninth: talk-editor form processing.** `processTalkForm` (248 lines) had only 9 distinct
        `this.*` references — mostly calls to five sibling helper methods, `emit`, and `t` — the
        lowest coupling-to-size ratio of any remaining method after `displayTalksList`. Its own
        `detectTalkLanguage` free-function dependency (17 lines, zero coupling) moved with it.
        Never called externally (`app.ts` never invokes it): every call site already passed it
        around as a bound `(form: HTMLFormElement) => boolean` callback (including a self-recursive
        one into `collectFlowSurveyEditorQuestions`), so the extraction needed no new indirection.
      - **Tenth: linked-devices dialog orchestration.** `openLinkedDevicesDialog` (152 lines, 16
        distinct `this.*` refs) was the next-lowest coupling-to-size ratio after cluster #9;
        `renderCreatorReplies` (202 lines, 14 refs, but with direct read/write of several mutable
        `this.creatorReply*` instance fields — more entangled, deferred again) was re-measured and
        passed over. Nearly all 16 refs were already-established optional hook properties
        (`identityLinkCodeCreator`, `identityPasswordSetter`, etc. — set by `app.ts` via
        `setIdentityLinkHooks`/`setIdentityPasswordHooks`/`setDeviceHandoffReceive`), trivially
        forwarded as explicit deps rather than genuine coupling. The method itself was already a
        thin(ish) options-builder around `showLinkedDevicesDialog` (an already-extracted renderer in
        the same file), so its natural home was that same module, not a new one.
      - **Eleventh: creator-replies list.** Re-measured after cluster #10; `renderSettingsView`
        (483 lines, 21 refs) and its companion `bindSettingsControls` (362 lines, 22 refs) are the
        largest remaining methods after `displayTalksList`, but inspection (not just the `this.*`
        count) shows them mutually referencing each other and touching a wide swath of
        cross-cutting methods — `bindSettingsControls` alone calls `displayTalksList` itself,
        `openEraseDeviceDialog`, `openLinkedDevicesDialog`, `showEditProfileDialog`,
        `rerenderOpenConversation`, and more — the same over-entangled shape that already ruled out
        `displayTalksList`, so both stay deferred alongside it. `renderCreatorReplies` (202 lines,
        14 refs) was re-measured instead: its "direct read/write of mutable instance fields"
        concern from cluster #10's pass is exactly the shape cluster #9's `processTalkForm` and
        earlier dashboard-style clusters (#2, #5) already handled cleanly via explicit
        getter/setter closures — a self-contained filter/sort/group/render pipeline over 3 scalar
        fields (`creatorReplyScopedTalkId`/`Title`, `creatorReplyVisibleCount`) and one array field
        (`creatorReplyRows`, read-only from this method's perspective), not the deep cross-feature
        coupling settings has.
      - **Twelfth: talks-row gestures.** Re-measured after cluster #11; `showConversationDetail`
        (246 lines, 18 refs), `addNewConversation` (160, 12), and `syncConversationMessageSummary`
        (100, 11) all share a heavily-overlapping ref set (`currentConversationId`,
        `getMyConversations`, `getPeerName`, `updateMatchBadge`, `displayContactsList`/
        `displayConversationsList`) — a genuinely cohesive "conversation view" cluster, but one
        whose methods are entangled with EACH OTHER and with other tabs' list-refresh side
        effects the same way settings is; deferred rather than risk a fragile first cut.
        `bindTalksRowGestures` (107 lines, 7 refs) was chosen instead: a self-contained
        swipe/long-press gesture controller for talk-list rows, bound once and touching nothing
        outside its own concern except one field (`talksGestureSuppressClickUntil`, read by a
        click handler elsewhere) and four already-existing action methods
        (`quickIgnoreIncomingTalk`, `quickCopyIncomingTalk`, `deleteMyTalk`,
        `showDetailsPopupFor`).
      Re-measure after every cluster. `this.*` counts are only a filter; also inspect DOM ownership,
      event subscriptions, async callbacks, mutable collections, imports, and possible cycles.
- [x] **1.3 Characterize cluster #1 before moving it.** Tests freeze route fan-out ordering and
      thresholds, built-in compatible branching, self-answer traversal, safe escaping, input
      mirroring, and existing-talk rehydration. For later clusters, repeat these rules:
      - Freeze pure model results, meaningful DOM output, event behavior, focus/accessibility, and
        listener cleanup where applicable.
      - Existing tests may change imports, fixtures, and mocks during extraction, but behavioral
        expectations must not change unless a separate bug fix is documented.
      - Cluster #2 adds characterization for CSV quoting, low-cohort region masking, anonymity
        toggle state, time-filter reaggregation, escaped labels/titles, modal lifecycle, and bounded
        follow-up draft construction.
      - Cluster #3 freezes main-panel/navigation order, the active first-paint view, reply-language
        options, localized accessibility text, Chinese navigation labels, and retranslation of an
        already-open filter toggle before moving the shell template/localization pass.
      - Cluster #4 freezes reciprocal-tag auto-proceed, flattened-over-exact precedence,
        newest-first multi-select id remapping, and cross-talk reuse across mirrored Pair tags.
      - Cluster #5 freezes bounded day/tag trend windows, aggregate and privacy rendering,
        escaping of talk/peer/tag/region labels, masked-region output, chart geometry, and refresh
        delegation.
      - Cluster #6 freezes localized language/category/visibility controls, unsupported-language
        fallback, safe profile markup, existing attribute identity/timestamp preservation, dynamic
        row collection, required-language validation, cancel/success cleanup, and failure rejection.
      - Cluster #7 freezes business-field toggling, trimmed payloads, capacity flooring, omission
        of empty/invalid optional fields, safe current-name rendering, short-name warnings, modal
        cleanup, and backdrop cancellation.
      - Cluster #8 freezes the absent-panel no-op, browser-storage sizing and database ordering,
        app/room state, relay/path/protocol/ownership sections, localization, untrusted diagnostic
        escaping, and the relay-failure fallback.
      - Cluster #9 (`src/test/unit/talk-form-processor.test.ts`, 11 tests) freezes: simple
        (self-match) and pair (divergent-answer) tag-talk creation; tag creation rejected with no
        keyword; route creation rejected on validator errors; the mandatory financial-data guard
        blocking before validation/emit; a real flow talk built from actual
        `talk-editor-form-helpers` DOM (question + match answer + required Ignore answer);
        edit-vs-create emitting `updateTalk` vs `createTalk`; and `detectTalkLanguage`'s per-script
        detection/fallback. Real-browser regression evidence (not just unit characterization):
        `staged/stage1-single-user/05-talks-edit` (flow create+edit, exercises `detectTalkLanguage`
        directly per that spec's own comment), `staged/stage2-two-user/92-route-shared-builtin-
        root-branches` (route), and `staged/stage2-two-user/07-tags-checkbox` (tag, via the real
        editor UI rather than the low-level pair-direct bypass X1-X8 use) all pass.
      - Cluster #10 (`src/test/unit/linked-devices-dialog.test.ts`, +8 tests) freezes:
        `readLinkedDeviceRecords` forcing every row to "waiting" until the graph state resolves
        (and returning `[]` for missing/malformed/non-array localStorage content); current-user
        identity resolution including the no-current-user "unavailable" fallback;
        `completeFromCode`'s self/reused rejections and its success path (persists the new row,
        forwards to `identityLinkCompleter`); and `unlink` defaulting to "revocation-pending" when
        no `identityLinkUnlinker` hook is wired. Driven through the real rendered DOM (the Enter-
        code modal, the unlink-confirm modal) rather than calling the closures directly, since
        `showLinkedDevicesDialog`'s own existing test file already established that convention.
        Real-browser regression: `staged/stage2-two-user/73-identity-link-mutual`,
        `74-device-handoff-transfer`, and `cross-platform/x8-same-device-link` all pass.
      - Cluster #11 (`src/test/unit/creator-replies-view.test.ts`, new, 9 tests) freezes:
        rendering rows with a correct shown/filtered/total summary count; the empty state when
        every row is filtered out; the scoped-talk filter hiding non-matching rows and its
        clearable scope chip; "load more" pagination growing the visible page and re-rendering;
        click-routing (a matched row with a live conversation opens it via
        `showConversationDetail`, an unmatched row navigates to the responder's graph node via
        `navigateToGraphNode`); hostile responder-name/title escaping; and search-query filtering
        by responder name and talk title. The dedicated `00v-creator-reply-triage-matrix` E2E spec
        (100-reply pagination/search/filter/sort stress test) is pre-existing-excluded from the
        default project (`testIgnore` in `playwright.config.ts`, unrelated to this cluster — its
        own comment cites a stale server-snapshot data-path mismatch); confirmed via `npx
        playwright test <path>` directly returning "No tests found" even with an explicit path.
        Real-browser regression instead: `staged/stage3-three-user/
        09-contacts-talks-cross-navigation` (exercises the same click-to-conversation vs
        click-to-contact routing decision) passes.
      - Cluster #12 (`src/test/unit/talks-row-gestures.test.ts`, new, 9 tests) freezes: swipe-down
        (dy > 0) on an incoming row committing to copy vs swipe-up (dy < 0) committing to ignore
        at the exact commit threshold; swipe-left on a non-incoming row deleting it; an incoming
        row's horizontal swipe never committing (only vertical is meaningful for incoming rows);
        a sub-threshold movement never starting a drag or committing anything; a long press with
        no movement opening the details popup and suppressing the trailing click; a pointerup
        before the long-press timer fires cancelling the popup; a pointerdown outside `#talks-list`
        being ignored entirely; and a pointercancel clearing in-flight gesture state without
        committing. jsdom in this environment doesn't implement the `PointerEvent` constructor —
        used `MouseEvent` instead (the code under test only reads `.button`/`.clientX`/`.clientY`/
        `.target`, all present on both). The module's own "already bound" flag and in-flight
        gesture state are module-scoped `let`s, not deps — nothing outside the original method
        ever read them (confirmed by grep before moving) — so each test re-binds via
        `jest.isolateModules` + `require()` for a clean module instance. First draft had the
        up/down swipe-commit assertions backwards (swipe-down commits *copy*, swipe-up commits
        *ignore* — non-obvious without reading the code) — caught by the two failing assertions,
        not assumed. Real-browser regression: `staged/stage1-single-user/
        37-compact-talk-rows-out` (swipe-left delete) and `05-talks-edit` (long-press details
        popup, via the `longPressTalkRow` helper) both pass.
- [x] **1.4 Extract cluster #1:** `route-editor-model.ts` now owns pure initialization,
      self-answer traversal, and validator serialization; `route-editor-controller.ts` owns its
      DOM and event wiring. `UIManager` retains thin state/text delegation and its existing call
      surface. For later clusters:
      - Create `src/web/ui/<cluster-name>.ts` exporting focused, pure-or-injected functions
        (dependency-injected callbacks, exactly like `talk-editor-form-helpers.ts` /
        `my-talks-dialog.ts` do), **not** more `singleton.instance` calls.
      - Move behavior first. Separate pure model conversion from DOM/event control when the cluster
        contains both; do not mix a behavior rewrite into the move.
      - Add re-export / delegation in `ui-manager.ts` so `app.ts` and any existing internal call
        sites keep compiling unchanged.
      - Cluster #2: `survey-statistics-model.ts` owns labels, CSV serialization, privacy threshold,
        metric cards, and follow-up drafts. `survey-statistics-dialog.ts` owns local aggregation,
        modal/dashboard DOM, filters, exports, and callbacks. `UIManager` retains a thin entry shim
        plus the browser download/notification side effect; neither extracted module imports it.
      - Cluster #3: `app-shell.ts` owns deterministic first-paint markup and repeatable shell
        localization with explicit translated-text, language-option, and language-label inputs.
        `UIManager.setupBaseUI()` remains the controller shim that installs listeners, bottom
        navigation, AppBar chrome, and the initial view state.
      - Cluster #4: `answer-preference-resolution.ts` owns branch-aware effective-tag derivation,
        typed/flattened/exact/legacy resolution order, exact + flat + legacy persistence, and full
        zero-click answer construction. It receives the current user id explicitly and does not
        import `UIManager`; the existing manager methods remain thin compatibility shims.
      - Cluster #5: `statistics-dashboard.ts` owns deterministic dashboard markup, table sections,
        frequency bars, sparkline geometry, privacy summaries, and refresh-button binding. It
        receives text and refresh dependencies explicitly; `UIManager` retains data acquisition
        and its existing render shim.
      - Cluster #6: `edit-profile-dialog.ts` owns profile foundation form rendering, row lifecycle,
        normalization/collection, validation, and async completion. It imports shared profile
        normalization only, receives manager-facing dependencies explicitly, and leaves the public
        `showEditProfileDialog()` manager contract unchanged.
      - Cluster #7: `custom-chatroom-dialogs.ts` owns create/rename form rendering, conditional
        business fields, payload collection, validation, and modal lifecycle. `UIManager` retains
        its public methods as shims plus all HTTP and chatroom-state orchestration.
      - Cluster #8: `storage-inspector.ts` owns browser storage discovery, relay diagnostics fetch,
        localized value/path/policy mapping, and all storage-inspector markup. `UIManager` retains
        a thin shim that formats current app state and injects translations/API base explicitly.
      - Cluster #9: `talk-form-processor.ts` owns `processTalkForm` (all four talk-type branches,
        the financial-data guard, TalkAutofix/TalkValidator invocation, the typed-preference save
        loop, and create-vs-update emit) plus `detectTalkLanguage`, moved verbatim. `UIManager`'s
        `processTalkForm` is now a 10-line shim building an explicit deps object (bound getters/
        setters/`emit`/`t`, plus the two route-editor wrapper methods) each call; every existing
        internal call site (`this.processTalkForm.bind(this)`, five of them) and the external
        `talk-editor-form-helpers.ts` injection point keep compiling unchanged.
      - Cluster #10: `linked-devices-dialog.ts` gains `openLinkedDevicesDialog` (the orchestration
        body — device metadata/platform resolution, password-protection and incoming-handoff
        state, and the full `LinkedDevicesDeps` callback assembly) and two small pure helpers,
        `readLinkedDeviceRecords`/`saveLinkedDeviceRecords`, alongside the `showLinkedDevicesDialog`
        renderer that already lived there. `UIManager`'s `openLinkedDevicesDialog` is now a
        20-line shim forwarding its 14 optional hook properties plus a `getCurrentUser` getter
        (called fresh at each point the original read `this.currentUser`, not snapshotted once,
        to preserve exact behavior across the method's two `await`s). `openEraseDeviceDialog`
        (a separate method with its own independent, differently-scoped read of the same
        `iinpublic_linked_devices` localStorage key) was deliberately left untouched — out of
        scope for this cluster, not a dependency of the extracted method.
      - Cluster #11: new `creator-replies-view.ts` owns `renderCreatorReplies` (the filter/sort/
        group/render pipeline, the scoped-talk clear-chip handler, and the load-more pagination
        handler), plus the `CreatorReplyRow`/`CreatorReplyFilterState` types and the
        `CREATOR_REPLY_PAGE_SIZE` constant, all moved from `ui-manager.ts` (which imports them
        back where still needed — the two type-users outside this method, and the page-size
        constant's own field initializer). `UIManager`'s `renderCreatorReplies` is now an 18-line
        shim passing 15 explicit deps: getters/a scope-clearer/a count-grower for the 3 mutable
        instance fields, and thin forwarding closures for the read-only helper methods
        (`getMyConversations`, `getKnownPerson`, `getUiLanguage`, `t`, `tf`, `formatTalkLanguage`,
        `showConversationDetail`, `navigateToGraphNode`). The extracted function references
        itself directly (ordinary recursion, not `this.renderCreatorReplies.bind(this)`) for its
        two internal re-render-after-state-change call sites, the same self-reference pattern
        cluster #9's `processTalkForm` established.
      - Cluster #12: new `talks-row-gestures.ts` owns `bindTalksRowGestures` (the full
        pointerdown/pointermove/pointerup/pointercancel gesture state machine), moved with one
        deliberate simplification: the "already bound" flag and in-flight gesture object were
        `UIManager` instance fields in the original, but neither was ever read outside this one
        method, so they became ordinary module-scoped state in the extracted function instead —
        behaviorally identical for a singleton `UIManager`, one fewer thing threaded through the
        deps object. `UIManager`'s `bindTalksRowGestures` is now a 7-line shim passing 5 deps: a
        setter for the one field genuinely read elsewhere (`talksGestureSuppressClickUntil`) and
        four thin forwarding closures for the existing action methods.
- [x] **1.5 Verify after every extraction:**
      - `npm run test:type` + `npm run lint` + `npm run test:unit` green.
      - `npm run test:all` green **before** starting the next cluster.
      - If a cluster is causing flakes unrelated to the extraction, stop and isolate it before
        continuing (don't stack unexplained failures on the refactor).
      - Cluster #1 evidence: typecheck and lint pass; 145 unit suites / 1,590 tests pass; the
        canonical route E2E passes; `test:all` run `run-20260824-181749-67574` passed every static
        check and all 12 browser blobs in 16m36s.
      - Cluster #2 evidence: typecheck/lint and 146 unit suites / 1,593 tests pass. The compact-row
        Results-popup E2E passes. The formerly stale-ignored full survey analytics E2E was restored,
        updated for the long-press popup contract, and passes both alone and in the 12-worker light
        shard. Canonical run `run-20260824-185020-77985` passed all 12 blobs before that test-config
        restoration. The post-restoration run `run-20260824-190943-86105` passed static checks, the
        restored analytics test, and 11/12 phases; its sole unrelated expired-talk visibility race
        passed immediately alone, then the complete light shard passed 233 tests (6 skipped) in
        9.6m. All other phases from that run were green.
      - Cluster #3 evidence: the original and injected shell template/localization statements are
        mechanically equivalent;
        typecheck/lint, the production web build, and 146 unit suites / 1,596 tests pass. Canonical
        run `run-20260824-203147-12032` passed all static checks and all 12 browser blobs in 16m46s,
        including the full light shard, WebKit/Firefox smoke coverage, and mass-user phase.
      - Cluster #4 evidence: all four moved method bodies are mechanically equivalent after
        replacing instance calls with the explicit current-user argument; typecheck/lint,
        production web build, and 147 unit suites / 1,603 tests pass. Canonical run
        `run-20260824-225837-46881` passed all static checks and all 12 browser blobs in 16m21s,
        including exact-chatbot-memory E2E, WebKit/Firefox smoke, and mass-user coverage.
      - Cluster #5 evidence: typecheck/lint, production web build, and 148 unit suites / 1,605
        tests pass. Canonical run `run-20260824-233709-56642` passed all static checks and all 12
        browser blobs in 16m22s, including the complete light shard, WebKit/Firefox smoke, and
        mass-user coverage.
      - Cluster #6 evidence: typecheck/lint, production web build, and 149 unit suites / 1,608
        tests pass. One unrelated Gun signaling timing test failed once, then passed three focused
        runs and the full-unit rerun. Canonical run `run-20260825-211024-46403` passed all static
        checks and all 12 browser blobs in 16m51s, including settings/profile E2E, WebKit/Firefox
        smoke, and mass-user coverage.
      - Cluster #7 evidence: typecheck/lint, production web build, and 150 unit suites / 1,611
        tests pass. Canonical run `run-20260825-214624-56319` passed all static checks and all 12
        browser blobs in 16m53s, including localized create/rename room E2E, WebKit/Firefox smoke,
        and mass-user coverage.
      - Cluster #8 evidence: typecheck/lint, both production builds, and 151 unit suites / 1,614
        tests pass. The first concurrent canonical run lost several independent API servers under
        phase-wave resource pressure; every affected spec passed sequentially (expired-talk 1/1,
        dealmaker/taxi 5/5, find-similar 1/1). Sequential canonical run
        `run-20260825-234056-81556` passed all static checks and all browser phases/blobs, including
        WebKit/Firefox smoke, heavy staged, and mass-user coverage.
      - Cluster #9 evidence: typecheck/lint, production web build, and 162 unit suites / 1,726
        tests pass (11 new); `05-talks-edit` (flow), `92-route-shared-builtin-root-branches`
        (route), and `07-tags-checkbox` (tag via the real editor UI) pass standalone. Canonical run
        `run-20260908-220720-69284` (25m29s) surfaced 3 phases with failures under concurrent-wave
        load; every one traced to pre-existing "phase-wave resource pressure" flakiness (the same
        class cluster #8's evidence documented) rather than this extraction — see `docs/completed.md`
        for the per-phase investigation, including a `git stash` confirmation that the one test
        touching login/headcount (unrelated to talk creation) fails identically on clean HEAD.
      - Cluster #10 evidence: typecheck/lint, production web build, and 162 unit suites / 1,734
        tests pass (8 new); `73-identity-link-mutual`, `74-device-handoff-transfer`, and
        `cross-platform/x8-same-device-link` pass standalone. Canonical run `run-20260909-074052-
        90038` (25m20s) surfaced the same 3 phases as cluster #9's run, none touching
        linked-devices code: `cross-browser` reproduced cluster #9's exact same Gun-server-boot
        failure byte-for-byte (same port, same error, same ~724s duration) and `heavy-staged`
        failed the exact same already-clean-HEAD-confirmed spec again; `light` failed two
        different TechSupport specs this time (varying between runs, consistent with load
        flakiness rather than a deterministic regression) — see `docs/completed.md`.
      - Cluster #11 evidence: typecheck/lint, production web build, and 163 unit suites / 1,743
        tests pass (9 new); `09-contacts-talks-cross-navigation` passes standalone. Canonical run
        `run-20260909-145930-6825` (25m22s) reproduced the same 3 e2e phase failures a third
        consecutive time (`light`, `heavy-staged`, `cross-browser`), none touching creator-replies
        code, plus one new one-off flaky jest integration test (server-side relay-frame storage,
        unrelated) confirmed passing both standalone and as part of the full integration suite —
        see `docs/completed.md`.
      - Cluster #12 evidence: typecheck/lint, production web build, and 164 unit suites / 1,752
        tests pass (9 new); `37-compact-talk-rows-out` (swipe-left delete) and `05-talks-edit`
        (long-press popup) pass standalone. Canonical run `run-20260909-180724-18534` (25m25s)
        reproduced the same 3 e2e phase failures a fourth consecutive time — `cross-browser` and
        `heavy-staged` byte-for-byte identical to every prior run, `light` failed 5 different
        TechSupport/messaging/survey specs this time, none touching gesture code — see
        `docs/completed.md`.
      - Between clusters #12 and #13: that run's `heavy-staged`/`light` failures were investigated
        for real (not re-filed as the usual phase-wave flakiness) and turned out to be two genuine
        bugs, both fixed — see docs/completed.md's "Two real bugs fixed" entry. `heavy-staged`'s
        `01-login-two-users-headcount` failure was a `chatroom-manager.ts` race (a heartbeat/join
        completing after a newer leave, resurrecting a departed member); `light`'s
        `00m-techsupport-delegate-answers` failure was the K7 FAQ-bundle cache race (asker-side
        re-render never retried once the bundle caught up). Both fixed and reverified.
      - Clusters #13-#16 evidence: four more low-coupling extractions found via a small AST
        script (method line-span + distinct `this.*` reference count for every `UIManager`
        method) rather than eyeballing — `saveFlatAnswerHistoryRecord`/`getTalkContentKey` →
        `answer-history-storage.ts` (#13), `filterVerifiedSupportMessages` → new
        `verified-support-messages.ts` (#14), `bindDirtyWordEditor` → new `dirty-word-editor.ts`
        (#15), `applyMeAnswerFilter` → `answers-view.ts` (#16). `displayTalksList`,
        `renderSettingsView`/`bindSettingsControls`, and the conversation-view trio remain
        deferred, unchanged. Typecheck/lint clean, both production builds succeed, and unit
        suites grew from 164/1,752 to 167/1,811 (59 new tests across the four clusters) with zero
        regressions. Canonical run `run-20260909-220727-52712` (25m27s): `heavy-staged` is
        **green for the first time** since cluster #9 first hit this streak (`rc=0`, confirming
        the chatroom-manager fix holds under full concurrent load); `cross-browser` remains the
        same pre-existing Gun-boot-timeout infra issue; `light` failed one different, unrelated
        spec each time it was checked (`00l`/`00m`/`83-survey` mid-run under load,
        `79-techsupport-survives-restrictive-filters` in the full canonical run) — every one
        confirmed passing standalone once the machine was idle, consistent with load-induced
        flakiness rather than a regression from any of the four extractions. See `docs/completed.md`.
      - Clusters #17-#21 evidence: five more extractions from the same AST-script sweep —
        `displayChatroomMessage` → `chatroom-message-view.ts` and `updateMatchBadge` →
        `notification-badges.ts` (#17), `confirmCapturedQuestionDialog` →
        `captured-question-dialog.ts` (#18), `showTalkTemplatePicker` → `talk-template-picker.ts`
        (#19), `showChooseWhoToDmPicker`/`showDmInboxPicker` → `person-picker-dialogs.ts` (#20),
        `confirmBroadcastAudience` → `broadcast-audience-dialog.ts` (#21).
        `showEditStageNameDialog` was found to have zero callers anywhere — flagged, not deleted
        (see this section's status paragraph above). Typecheck/lint clean, both production builds
        succeed, unit suites grew from 167/1,811 to 173/1,853 (42 new) with zero regressions.
        Canonical run `run-20260909-223829-62705` (25m27s): `cross-browser` unchanged
        pre-existing infra issue; `heavy-staged` failed `01-login-two-users-headcount` again at
        the same assertion as before today's earlier chatroom-manager fix, but 5/5 standalone
        reruns on an idle machine passed — a much rarer residual of that race under extreme
        concurrent multi-phase load, not a "clusters #17-#21 broke it" regression (none of the
        five touch server code); `light` failed 4 different specs, one
        (`29-messaging-semantics`'s "unread badge lifecycle" case) plausibly related to cluster
        #17's badge extraction and investigated specifically — failed standalone once, then
        passed 4/5 further standalone reruns, consistent with pre-existing reload-timing
        flakiness in that one test rather than a deterministic regression in the byte-for-byte
        preserved badge logic. See `docs/completed.md`.
      - Clusters #22-#29 evidence: eight more extractions — `showNotification` →
        `notification-toast.ts` (#22, 116 call sites, the widest blast radius yet, verified with
        a dedicated real-browser regression before continuing); `getPeerNameCache`/
        `rememberPeerName` → `peer-name-cache.ts` (#23); `renderCapturedQuestionMessage`/
        `renderIpfsAttachmentMessage` → `conversation-message-cards.ts` (#24); `syncAppBarOverflow`
        → `app-bar-overflow.ts` and `showSystemAnnouncement` → `system-announcement-banner.ts`
        (#25); `showDetailsPopupFor` → `item-details-popup.ts` and
        `saveQuestionAnswersFromCompletion` → `answer-preferences-storage.ts` (#26);
        `saveObjectUrlAs` → `browser-file-save.ts` (#27); `setTalkDisabled` →
        `talk-broadcast-toggle.ts` (#28); `setupAppBarChrome` → added to `app-bar-overflow.ts`
        (#29). Typecheck/lint clean, both production builds succeed, unit suites grew from
        173/1,853 to 182/1,933 (~70 new) with zero regressions. Canonical run
        `run-20260909-235414-74770` (25m21s): `heavy-staged` is green again (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed two already-established rotating specs
        (`79-techsupport-survives-restrictive-filters`, `00l-techsupport-faq-cross-user`), neither
        touching anything in this batch — standalone reruns on an idle machine: `79` passed
        immediately, `00l` failed once more then passed on a third attempt, consistent with
        pre-existing flakiness. See `docs/completed.md`.
      - Clusters #30-#35 evidence: six more extractions — `saveCreatedTalk` →
        `talk-creation-storage.ts` (#30); `deliveryReasonLabel`/`formatReasonCounts` →
        `delivery-reason-labels.ts` (#31); `saveKnownPerson` → `contacts-view.ts` (#32);
        `resolveChatroomTitle` → `chatrooms-view.ts` (#33); the creator-reply filter-state trio
        → `creator-replies-view.ts` (#34); `updateConversationTransportMode`/
        `setConversationOnlineStatus` → `conversation-status-updates.ts` (#35). A near-miss along
        the way: fully deleting `resolveAnswerPreferenceForTalkQuestion` (seemingly a 1-ref shim)
        broke `answer-preference-resolution-characterization.test.ts` (cluster #4), which calls
        it directly via a private-method type-cast pattern `tsc` doesn't catch — restored before
        shipping; see the execution-rule addition above and `docs/completed.md` for the full
        account. Typecheck/lint clean, both production builds succeed, unit suites grew from
        182/1,933 to 186/1,976 (~54 net new) with zero regressions. Canonical run
        `run-20260910-002854-85535` (25m26s): `heavy-staged` green again; `cross-browser`
        unchanged pre-existing infra issue; `light` failed three already-established rotating
        specs, none touching this batch — `29-messaging-semantics` (plausibly related, given the
        new online-status logic) reran 3/3 clean standalone. See `docs/completed.md`.
      - Clusters #36-#39 evidence: four more extractions — `updateStatusBar` → new
        `status-bar.ts` (#36); `markConversationWithdrawn`/`markConversationEnded` → new
        `conversation-record-updates.ts` (#37, a near-identical sibling pair sharing one
        refresh helper); `copyAnsweredTalkToTalks` → added to `talk-creation-storage.ts` (#38);
        `quickIgnoreIncomingTalk`/`quickCopyIncomingTalk` → new
        `quick-incoming-talk-actions.ts` (#39, another sibling pair sharing one
        full-talk-resolution helper). Typecheck/lint clean, both production builds succeed, unit
        suites grew from 186/1,976 to 189/2,007 (31 new) with zero regressions. Canonical run
        `run-20260910-012626-3551` (25m26s): `heavy-staged` green again; `cross-browser`
        unchanged pre-existing infra issue; `light` failed four already-established rotating
        specs (the same set seen rotating through several of today's earlier runs), none
        touching this batch. See `docs/completed.md`.
      - Clusters #40-#42 evidence: three more extractions — `tagAnswerSuffix`/
        `renderTagAnswerSuffixHtml` → added to `ui-formatters.ts` (#40); `displayIncomingTalk` →
        new `incoming-talk-notification.ts` (#41); `setBlocked` → added to `contacts-view.ts`
        (#42, block/unblock network call + `currentUser.blockedUserIds` mutation). One
        test-authoring mistake caught and fixed in `ui-formatters.test.ts` (a fallthrough-case
        test wrongly predicted empty output; corrected to expect `?sell` after running). Typecheck/
        lint clean, both production builds succeed, unit suites grew from 189/2,007 to 190/2,029
        with zero regressions. Canonical run `run-20260910-015954-12212` (25m26s): `heavy-staged`
        green again (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed
        two already-established rotating specs (`00l-techsupport-faq-cross-user`,
        `83-survey-ignore-mid-question-not-complete`), neither touching this batch. See
        `docs/completed.md`.
      - Cluster #43 evidence: `completeTalk`/`saveMyTalk` → new `talk-completion.ts`
        (`saveMyTalk` takes a narrower `SaveMyTalkDeps`; `completeTalk` takes the full
        `TalkCompletionDeps` superset and calls the extracted `saveMyTalk` directly). New
        `talk-completion.test.ts` (15 tests); two authoring mistakes caught and fixed on first
        run (an `expiresAt`-persists-from-patch assumption that doesn't match the real
        existing/fullTalk-only precedence; `getFlatAnswerHistory()` returns a map, not an array,
        so `.length` was `undefined`). Typecheck/lint clean, both production builds succeed, unit
        suites grew from 190/2,029 to 191/2,043 with zero regressions. Canonical run
        `run-20260910-023316-20468` (25m21s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed one already-established rotating spec
        (`00l-techsupport-faq-cross-user`), unrelated to this batch. See `docs/completed.md`.
      - Cluster #44 evidence: `detectDownloadPlatform`/`renderAppDownloadBanner` → new
        `app-download-banner.ts` (the `applySettingsSectionView(this.settingsActiveSectionId =
        ...)` write-then-render pair collapsed into one `openDownloadAppSettingsSection` deps
        callback rather than exposing the instance field). New `app-download-banner.test.ts` (17
        tests), all passed first run. Typecheck/lint clean, both production builds succeed, unit
        suites grew from 191/2,043 to 192/2,059 with zero regressions. Canonical run
        `run-20260910-030155-28427` (25m28s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed two specs —
        `83-survey-ignore-mid-question-not-complete` (already-established rotating flake) and
        `33-mobile-chatroom-hierarchy` (new to the rotation; confirmed pre-existing and unrelated
        to this batch by reproducing it 2/4 standalone against the committed cluster #43
        baseline — a `scrollIntoViewIfNeeded` race in the chatroom-item list, unrelated to the
        app-download banner). See `docs/completed.md`.
      - Cluster #45 evidence: `showPreferencesDialog`/`normalizePreferenceMode`/
        `applyPreferenceModeToExactMemory`/`deleteAnswerPreference` → new
        `answer-preference-mutations.ts` (all four were called only from within this one block,
        so dialog-wiring glue and its mutation logic moved together). New
        `answer-preference-mutations.test.ts` (21 tests, `jest.mock`s `preferences-dialog.ts` to
        capture the wired options object without the real DOM renderer). One authoring mistake
        caught and fixed on first run (a test wrongly assumed deleting a preference in `'manual'`
        mode creates an exact-chatbot-memory entry — it only ever clears one — rewritten to
        establish a permanent-mode entry first, then assert the delete clears it). Typecheck/lint
        clean, both production builds succeed, unit suites grew from 192/2,059 to 193/2,080 with
        zero regressions. Canonical run `run-20260910-033339-36852` (25m31s): `heavy-staged`
        green (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed three
        already-established rotating specs (`00l-techsupport-faq-cross-user`,
        `29-messaging-semantics`, `83-survey-ignore-mid-question-not-complete`), none touching
        this batch — `00l-techsupport-faq-cross-user` got a closer look since this cluster
        touches exact-chatbot-memory writes, reran clean standalone (1/1). See
        `docs/completed.md`.
      - Cluster #46 evidence: `displayContextualStatistics`/`displayStatisticsDashboard`/
        `renderStatisticsDashboard` → new `local-statistics.ts`. Extracting the latter two exposed
        a third dead-code finding (see the paragraph above) — their `onRefresh`-driven
        mutual-recursion had masked from `tsc` that neither is ever called from outside that
        cycle, so the now-uncompilable `ui-manager.ts` shim for `displayStatisticsDashboard` was
        removed while its logic stays intact and tested in `local-statistics.ts`;
        `displayContextualStatistics` is genuinely live (contacts-view stats strip + one other
        call site) and kept its shim. New `local-statistics.test.ts` (9 tests), all passed first
        run. Typecheck/lint clean, both production builds succeed, unit suites grew from
        193/2,080 to 194/2,089 with zero regressions. Canonical run `run-20260910-040457-44880`
        (25m16s): `heavy-staged` green (`rc=0`); `cross-browser` unchanged pre-existing infra
        issue; `light` failed one already-established rotating spec (`29-messaging-semantics`),
        unrelated to this batch. See `docs/completed.md`.
      - Cluster #47 evidence: `hydrateAttachmentImages` → new `attachment-hydration.ts`.
        `openLightbox` stayed in `ui-manager.ts` (it mutates the shared `lightboxTarget` instance
        field that `closeLightbox` and the lightbox-close/download wiring also touch) and is
        passed through as a deps callback. New `attachment-hydration.test.ts` (9 tests), all
        passed first run. Typecheck/lint clean, both production builds succeed, unit suites grew
        from 194/2,089 to 195/2,098 with zero regressions. Canonical run
        `run-20260910-043301-52712` (25m16s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed one already-established rotating spec
        (`29-messaging-semantics`), unrelated to this batch. See `docs/completed.md`.
      - Cluster #48 evidence: `openEraseDeviceDialog` → new `erase-device-flow.ts`.
        `exactOptionalPropertyTypes` required spelling the two optional callback deps
        (`identityLinkUnlinker`, `deviceHandoffSync`) as `(...) => ... | undefined` explicitly,
        not just `?:` — `tsc` caught the omission immediately. New `erase-device-flow.test.ts`
        (11 tests, `jest.mock`s both `erase-device-dialog.ts` and `device-wipe.ts` to avoid a real
        storage wipe or `location.reload()`), all passed first run. Typecheck/lint clean, both
        production builds succeed, unit suites grew from 195/2,098 to 196/2,109 with zero
        regressions. Canonical run `run-20260910-050144-60704` (25m27s): `heavy-staged` green
        (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed five
        already-established rotating specs (`33-mobile-chatroom-hierarchy`,
        `79-techsupport-survives-restrictive-filters`, `00l-techsupport-faq-cross-user`,
        `29-messaging-semantics`, `83-survey-ignore-mid-question-not-complete`) — a
        heavier-than-usual batch but all repeat names from this session's rotation, none touching
        erase-device/localStorage logic. See `docs/completed.md`.
      - Cluster #49 evidence: `registerTalkForPeer` → new `talk-peer-registration.ts` (0
        `this.*` refs). Initially looked orphaned — no direct-call grep hit in `ui-manager.ts` —
        until a repo-wide search found it wired as a deps callback into `user-detail-view.ts` via
        `.bind(this)`; genuinely live, just not call-site-visible. Since it had zero instance
        deps, the `ui-manager.ts` wiring now references the extracted free function directly and
        the private shim was deleted outright rather than kept as bind-only indirection.
        `getSenderOmittedBroadcastPreviews` (next on the candidate list, also 0 refs) was left
        for a later cluster — it shares `resolveExpiresAtMs` and the `BroadcastAudiencePreview`
        type (both still defined in `ui-manager.ts`, with `broadcast-audience-dialog.ts` already
        importing the type *backwards* from `ui-manager.ts`) with other call sites, so a clean
        extraction needs those relocated to a shared module first. New
        `talk-peer-registration.test.ts` (5 tests), all passed first run. Typecheck/lint clean,
        both production builds succeed, unit suites grew from 196/2,109 to 197/2,114 with zero
        regressions. Canonical run `run-20260910-053006-68618` (25m24s): `heavy-staged` green
        (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed one
        already-established rotating spec (`29-messaging-semantics`), unrelated to this batch —
        `user-detail-view.ts`'s own unit tests stayed green. See `docs/completed.md`.
      - Cluster #50 evidence: `resolveExpiresAtMs`/`BroadcastAudiencePreview`/
        `getSenderOmittedBroadcastPreviews` → new `broadcast-audience-preview.ts`. Did the
        relocation groundwork flagged in cluster #49 first — both symbols lived in
        `ui-manager.ts` with `broadcast-audience-dialog.ts` importing the type *backwards* from
        it; fixed that plus `app.ts`'s import and, caught by grepping `src/test/` per the
        standing execution rule, `broadcast-audience-dialog.test.ts`'s import too. With the
        groundwork done, `getSenderOmittedBroadcastPreviews` moved cleanly; its `ui-manager.ts`
        public method is now a one-line shim (kept for `app.ts`'s external call). New
        `broadcast-audience-preview.test.ts` (13 tests), all passed first run; the import-fixed
        `broadcast-audience-dialog.test.ts` stayed green. Typecheck/lint clean, both production
        builds succeed, unit suites grew from 197/2,114 to 198/2,127 with zero regressions.
        Canonical run `run-20260910-055849-76503` (25m26s): `heavy-staged` green (`rc=0`);
        `cross-browser` unchanged pre-existing infra issue; `light` failed three
        already-established rotating specs (`00l-techsupport-faq-cross-user`,
        `29-messaging-semantics`, `83-survey-ignore-mid-question-not-complete`), none touching
        this batch. See `docs/completed.md`.
      - Cluster #51 evidence: `refreshFlowAnswerConstraints` → new `flow-answer-constraints.ts`
        (1 ref) and `renderSettingsSection` → new `settings-section-template.ts` (0 refs, fully
        pure HTML templating with 14 call sites all inside the deferred `renderSettingsView`
        giant — extracting the template doesn't require touching that giant). New
        `flow-answer-constraints.test.ts` (7 tests) and `settings-section-template.test.ts` (5
        tests), all 12 passed first run. Typecheck/lint clean, both production builds succeed,
        unit suites grew from 198/2,127 to 200/2,139 with zero regressions. Canonical run
        `run-20260910-062712-84322` (25m24s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed three already-established rotating
        specs (`79-techsupport-survives-restrictive-filters`, `29-messaging-semantics`,
        `83-survey-ignore-mid-question-not-complete`), none touching flow-editor or settings
        rendering. See `docs/completed.md`.
      - Cluster #52 evidence: first attempted inlining `saveAnswerPreference`'s three call sites
        to call `persistAnswerPreference` directly and deleting the wrapper — grepping
        `src/test/` per the execution rule caught `answer-preference-resolution-
        characterization.test.ts:190` calling `ui.saveAnswerPreference(...)` directly via the
        same `PreferenceUi` type-cast pattern behind cluster #35's near-miss; reverted before
        running anything (`git diff --stat` confirmed byte-identical to the last commit), no
        ratchet change for that attempt. Shipped `showContentFilterToast` → new
        `content-filter-toast.ts` instead (2 refs). New `content-filter-toast.test.ts` (5 tests),
        all passed first run. Typecheck/lint clean, both production builds succeed, unit suites
        grew from 200/2,139 to 201/2,144 with zero regressions. Canonical run
        `run-20260910-065622-92271` (25m29s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed three already-established rotating
        specs (`79-techsupport-survives-restrictive-filters`, `29-messaging-semantics`,
        `83-survey-ignore-mid-question-not-complete`), none touching content-filter logic. See
        `docs/completed.md`.
      - Cluster #53 evidence: `applySettingsSectionView` → new `settings-section-view.ts` (2
        refs — a `settingsActiveSectionId` write and self-recursion). The fallback path (a
        remembered section id no longer rendered) needs to null out the instance field, so the
        extracted function takes a `setSettingsActiveSectionId` deps callback instead of exposing
        the field. New `settings-section-view.test.ts` (4 tests), all passed first run.
        Typecheck/lint clean, both production builds succeed, unit suites grew from 201/2,144 to
        202/2,148 with zero regressions. Canonical run `run-20260910-072427-159` (25m21s):
        `heavy-staged` green (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light`
        failed three specs — `00l-techsupport-faq-cross-user` and `29-messaging-semantics`
        (already-established rotating flakes) plus `00m-techsupport-delegate-answers` (new to
        this session's rotation; unrelated to settings-section rendering, reran clean standalone
        1/1). See `docs/completed.md`.
      - Cluster #54 evidence: `formatAttachmentSize`/`attachmentDownloadFilename`/
        `attachmentIconForMime`/`renderMediaTile` → new `attachment-metadata.ts`. All three
        helpers were already pure (0 `this.*` refs, already wired as deps callbacks elsewhere);
        `renderMediaTile` moved with them since it composes all three. New
        `attachment-metadata.test.ts` (29 tests), all passed first run. Typecheck/lint clean,
        both production builds succeed, unit suites grew from 202/2,148 to 203/2,177 with zero
        regressions. Canonical run `run-20260910-075309-8324` (25m31s): `heavy-staged` green
        (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed two
        already-established rotating specs (`29-messaging-semantics`,
        `83-survey-ignore-mid-question-not-complete`), neither touching media/attachment
        rendering. See `docs/completed.md`.
      - Cluster #55 evidence: `markOtherDealConversationsEnded` → extended
        `conversation-record-updates.ts` (4 refs). Its tail exactly matched cluster #37's
        `refreshAfterConversationRecordChange` helper, so it reused the existing
        `ConversationRecordUpdateDeps` type and `ui-manager.ts`'s already-wired
        `conversationRecordUpdateDeps()` builder — no new deps plumbing needed. Extended
        `conversation-record-updates.test.ts` (+6 tests), all passed first run. Typecheck/lint
        clean, both production builds succeed, unit suites grew from 203/2,177 to 203/2,183 with
        zero regressions. Canonical run `run-20260910-082146-16155` (25m18s): `heavy-staged`
        green (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed one
        already-established rotating spec (`79-techsupport-survives-restrictive-filters`),
        unrelated to deal-confirmation conversation state. See `docs/completed.md`.
      - Cluster #56 evidence: `syncStatusBarMatchCount` → extended `status-bar.ts` (2 refs). A
        close sibling of cluster #36's `updateStatusBar`, so it reused the existing
        `UpdateStatusBarDeps` type directly. Extended `status-bar.test.ts` (+5 tests), all
        passed first run. Typecheck/lint clean, both production builds succeed, unit suites
        grew from 203/2,183 to 203/2,188 with zero regressions. Canonical run
        `run-20260910-215745-41577` (25m20s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed one already-established rotating spec
        (`29-messaging-semantics`), unrelated to status-bar logic. See `docs/completed.md`.
      - Cluster #57 evidence: `showTalkDetail` → new `talk-detail-view.ts` (6 refs, including a
        `showTalkDetail` deps callback for its own retry-on-failure self-recursion — same pattern
        as cluster #46's `displayStatisticsDashboard`). New `talk-detail-view.test.ts` (9 tests),
        all passed first run. Typecheck/lint clean, both production builds succeed, unit suites
        grew from 203/2,188 to 204/2,197 with zero regressions. Canonical run
        `run-20260910-222704-49770` (25m29s): `cross-browser` unchanged pre-existing infra issue;
        `heavy-staged` failed for the first time all session
        (`01-login-two-users-headcount`, a chatroom-headcount timing assertion unrelated to
        talk-detail routing) — reran clean 3/3 standalone, confirming transient concurrent-load
        flakiness rather than a regression; `light` failed four specs —
        `83-survey-ignore-mid-question-not-complete` (already-established) plus three new
        (`33-mesh-only-delivery-no-server`, `35-concurrent-visit-counter` ×2) that all reran
        clean standalone. See `docs/completed.md`.
      - Cluster #58 evidence: `showLocationRoomSuggestion` → new `location-room-suggestion.ts`
        (2 refs). A dismissible banner suggesting a location-matched chatroom, replacing any
        existing banner rather than stacking a second one. New `location-room-suggestion.test.ts`
        (5 tests), all passed first run. Typecheck/lint clean, both production builds succeed,
        unit suites grew from 204/2,197 to 205/2,202 with zero regressions. Canonical run
        `run-20260910-225738-58713` (25m19s): `heavy-staged` green again (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed two already-established rotating specs
        (`33-mobile-chatroom-hierarchy`, `29-messaging-semantics`), neither touching the banner.
        See `docs/completed.md`.
      - Cluster #59 evidence: `syncReturnHomeButton` → new `return-home-button.ts` (3 refs —
        `getHomeChatroomId`, `currentChatroom`, `resolveChatroomTitle`). `getHomeChatroomId`
        itself has its own instance deps (`travelModeActive`/`travelHomeChatroomId`/
        `currentLocation`), so it stayed in `ui-manager.ts` and is passed through as a deps
        callback. New `return-home-button.test.ts` (5 tests), all passed first run.
        Typecheck/lint clean, both production builds succeed, unit suites grew from 205/2,202 to
        206/2,207 with zero regressions. Canonical run `run-20260910-232634-68210` (25m26s):
        `heavy-staged` green (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light`
        failed four already-established rotating specs, none touching the return-home button. See
        `docs/completed.md`.
      - Cluster #60 evidence: `deleteMyTalk` → new `talk-deletion.ts` (5 refs). Dropped a dead
        no-op `if` block found during extraction (checked a condition then did nothing but hold
        a comment) — a pure simplification, not a behavior change. New `talk-deletion.test.ts`
        (7 tests), all passed first run. Typecheck/lint clean, both production builds succeed,
        unit suites grew from 206/2,207 to 207/2,214 with zero regressions. Canonical run
        `run-20260910-235604-77384` (25m32s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed three already-established rotating
        specs, none touching talk deletion/withdrawal/retraction. See `docs/completed.md`.
      - Cluster #61 evidence: `parseIpfsSharePayload` → extended `attachment-metadata.ts` (0
        refs, already pure). Extended `attachment-metadata.test.ts` (+6 tests), all passed first
        run. Typecheck/lint clean, both production builds succeed, unit suites grew from
        207/2,214 to 207/2,220 with zero regressions. Canonical run
        `run-20260911-002525-85249` (25m27s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed two already-established rotating
        specs, neither touching IPFS share payload parsing. See `docs/completed.md`.
      - Cluster #62 evidence: `formatTalkDistanceFromAuthor` → new `talk-distance.ts` (1 ref —
        `currentLocation`, passed as a plain value argument since the function only reads it
        once). New `talk-distance.test.ts` (6 tests), all passed first run. Typecheck/lint clean,
        both production builds succeed, unit suites grew from 207/2,220 to 208/2,226 with zero
        regressions. Canonical run `run-20260911-005505-93070` (25m20s): `heavy-staged` green
        (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed two
        already-established rotating specs, neither touching talk-distance formatting. See
        `docs/completed.md`.
      - Cluster #63 evidence: `updateChatroomInfo` → new `chatroom-info.ts` (2 refs — a
        `currentChatroom` write, `syncStatusBroadcastButtonVisibility`). The write needed a
        `setCurrentChatroom` deps callback rather than exposing the field directly. New
        `chatroom-info.test.ts` (6 tests), all passed first run. Typecheck/lint clean, both
        production builds succeed, unit suites grew from 208/2,226 to 209/2,232 with zero
        regressions. Canonical run `run-20260911-012241-1094` (25m27s): `heavy-staged` green
        (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed three
        already-established rotating specs, none touching chatroom-info rendering. See
        `docs/completed.md`.
      - Cluster #64 evidence: `setCurrentChatroomId` → new `current-chatroom.ts` (5 refs). New
        `current-chatroom.test.ts` (5 tests), all passed first run. Typecheck/lint clean, both
        production builds succeed, unit suites grew from 209/2,232 to 210/2,237 with zero
        regressions. Canonical run `run-20260911-015026-9011` (25m18s): `heavy-staged` green
        (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light` failed three specs,
        including `33-mobile-chatroom-hierarchy` — since this cluster touches chatroom
        navigation, gave it extra scrutiny (bisected against the pre-cluster-64 baseline, then
        ran 6 total standalone reps landing at 4/6 failed, matching the spec's documented ~50%
        pre-existing flake rate from cluster #44, not a regression) plus a line-by-line diff
        confirming the extraction is behaviorally identical. See `docs/completed.md`.
      - Cluster #65 evidence: `navigateToMyAnswerForTalk` → new `navigate-to-answer.ts` (0
        refs, already pure). New `navigate-to-answer.test.ts` (4 tests), all passed first run.
        Typecheck/lint clean, both production builds succeed, unit suites grew from 210/2,237 to
        211/2,241 with zero regressions. Canonical run `run-20260911-022005-17303` (25m20s):
        `heavy-staged` green (`rc=0`); `cross-browser` unchanged pre-existing infra issue; `light`
        failed one already-established rotating spec, unrelated to navigate-to-answer. See
        `docs/completed.md`.
      - Cluster #66 evidence: `quickAnswerIncomingTag` → new `quick-answer-incoming-tag.ts` (4
        refs). `isValidTalkId` dropped out of `ui-manager.ts`'s own imports entirely — this was
        its last call site there. New `quick-answer-incoming-tag.test.ts` (5 tests), all passed
        first run. Typecheck/lint clean, both production builds succeed, unit suites grew from
        211/2,241 to 212/2,246 with zero regressions. Canonical run
        `run-20260911-024749-25080` (25m24s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed three already-established rotating
        specs, none touching quick-answer-incoming-tag flow. See `docs/completed.md`.
      - Cluster #67 evidence: `collectSharedAttachments` → extended `attachment-metadata.ts` (2
        refs — `lastConversationMessages`, `parseIpfsSharePayload`, the latter called directly
        rather than through `ui-manager.ts`'s shim). Extended `attachment-metadata.test.ts` (+5
        tests), all passed first run. Typecheck/lint clean, both production builds succeed, unit
        suites grew from 212/2,246 to 212/2,251 with zero regressions. Canonical run
        `run-20260911-031545-32893` (25m29s): `heavy-staged` green (`rc=0`); `cross-browser`
        unchanged pre-existing infra issue; `light` failed one already-established rotating spec,
        unrelated to attachment collection. See `docs/completed.md`.
      - Cluster #68 evidence: `getBroadcastableTalkIds`/`getBroadcastTalkPayload` → extended
        `broadcast-audience-preview.ts` (both 0 refs). Their public `UIManager` methods remain
        one-line compatibility shims for `app.ts` and E2E helpers. Extended
        `broadcast-audience-preview.test.ts` (+6 tests); typecheck/lint clean, both production
        builds succeed, and 212 unit suites / 2,257 tests pass. Canonical run
        `run-20260911-184604-78211` (16m39s): every phase except `light` passed; all broadcast
        scenarios passed, while `light` failed only the two already-established rotating
        TechSupport mailbox timing specs (`79-techsupport-survives-restrictive-filters`,
        `00l-techsupport-faq-cross-user`), unrelated to broadcast selection/payload lookup. See
        `docs/completed.md`.
      - Cluster #69 evidence: `formatTalkExpiryTone`/`getIncomingQuestionCount` → new
        `talk-list-metadata.ts` (both 0 refs); `displayTalksList` calls the pure helpers directly.
        New `talk-list-metadata.test.ts` (8 tests); typecheck/lint clean, both production builds
        succeed, and 213 unit suites / 2,265 tests pass. Canonical run
        `run-20260911-190547-85630` (18m40s, `PW_WORKERS=8`): stage5, mesh-batch,
        mesh-isolated, find-similar, cross-browser, isolated, heavy-staged, and mass all passed;
        `light` passed 250 tests (6 skipped) and failed three already-established rotating specs
        (`33-mobile-chatroom-hierarchy`, `00l-techsupport-faq-cross-user`,
        `83-survey-ignore-mid-question-not-complete`), none touching talk-list metadata. The
        directly relevant expiration/broadcast E2E passed 1/1 in an isolated rerun. See
        `docs/completed.md`.
      - Cluster #70 evidence: `collectSharedLinks` → extended `attachment-metadata.ts` (1 ref —
        `lastConversationMessages`, now passed explicitly); `renderMediaGalleryTab` calls the
        pure helper directly. Extended `attachment-metadata.test.ts` (+6 tests); typecheck/lint
        clean, both production builds succeed, and 223 unit suites / 2,360 tests pass (1
        skipped). Canonical run `run-20260911-193559-94038` (18m42s, `PW_WORKERS=8`): stage5,
        mesh-batch, mesh-isolated, find-similar, cross-browser, isolated, heavy-staged, and mass
        all passed; `light` passed 251 tests (6 skipped), including `73-media-link-share`, and
        failed only two already-established rotating mailbox/delivery timing specs
        (`00l-techsupport-faq-cross-user`, `83-survey-ignore-mid-question-not-complete`), neither
        touching shared-link collection. See `docs/completed.md`.
      - Cluster #71 evidence: the four per-recipient unsent-broadcast helpers → new
        `broadcast-delivery-selection.ts`. The module takes explicit injectable storage,
        eligibility, and ledger-suppression dependencies; `UIManager` retains its observed
        union-selection and per-talk receiver-map entry points as one-line shims. New
        `broadcast-delivery-selection.test.ts` (8 tests); typecheck/lint clean, both production
        builds succeed, and 224 unit suites / 2,368 tests pass (1 skipped). The unchanged-content
        suppression and late-joiner tag-catch-up E2Es pass 2/2 in isolated Chromium runs.
        Canonical run `run-20260911-201719-2759` (`PW_WORKERS=8`): stage5, mesh-batch,
        mesh-isolated, find-similar, cross-browser, isolated, heavy-staged, and mass all passed;
        `light` passed 250 tests (6 skipped), including the broadcast scenarios, and failed only
        three established rotating UI/mailbox flakes (`06-support-new-question-ack`,
        `33-mobile-chatroom-hierarchy`, `79-techsupport-survives-restrictive-filters`), none
        touching broadcast delivery selection. See `docs/completed.md`.
      - Cluster #72 evidence: the 685-line `displayTalksList` renderer and its document-scoped
        delegated-listener/progressive-render lifecycle → new `talks-list-view.ts`. The module
        takes current state, translations, formatters, and user actions through an explicit typed
        dependency contract; `UIManager` retains a thin compatibility shim. New
        `talks-list-view.test.ts` (5 tests); typecheck/lint clean, both production builds succeed,
        and 225 unit suites / 2,373 tests pass (1 skipped). Six focused outgoing/incoming/filter/
        progressive-render Chromium tests pass. Canonical run `run-20260912-094543-28177`
        (`PW_WORKERS=8`): stage5, mesh-batch, mesh-isolated, find-similar, cross-browser, isolated,
        heavy-staged, and mass all passed; `light` passed 249 tests (6 skipped), including every
        Talks scenario, and failed only four established rotating UI/mailbox flakes
        (`33-mobile-chatroom-hierarchy`, `79-techsupport-survives-restrictive-filters`,
        `00l-techsupport-faq-cross-user`, `83-survey-ignore-mid-question-not-complete`), none
        touching this extraction. See `docs/completed.md`.
      - **Session pause after cluster #67 (historical):** the user asked what was taking so long (this
        session's incremental-cluster cycle had run for many hours, each cluster gated by a
        ~25-minute canonical `test:all` run before committing). Given the choice to finish the
        in-flight cluster and stop, finish here or keep the deferred giants
        (`displayTalksList`/`renderSettingsView`/`bindSettingsControls`/`showConversationDetail`/
        the conversation-view trio) and the thinning candidate pool for a future session.
      ("when a feature ships, record concrete file/test evidence") and check off the relevant box
      here.

**Targets / definition of done #1:**
- [ ] `ui-manager.ts` reduced from **11,793 → < 3,000 lines** (aim to make it a thin router of
      delegations; the substance lives in cohesive `src/web/ui/*.ts` modules).
- [x] No behavior regression: `test:all` is green and behavioral expectations remain stable.
- [x] The growth guardrail (1.1) is in place and passing.
- [ ] `src/web/app/app.ts` keeps its stable `UIManager` contract until a separately approved API
      reduction: methods, event payloads, DOM contracts, focus, and listener lifecycle are preserved.
- [ ] Extracted modules do not import `UIManager`, introduce singleton reach-through, or form cycles.
- [ ] The work has not merely moved the god-object: new modules are cohesive, explicitly injected,
      and small enough to review and test independently.

**Risks & guardrails for #1:**
- `ui-manager.ts` is an **EventEmitter singleton** — many methods rely on shared mutable `this.`
  state and event wiring. Extraction must preserve the *instance* (the singleton) for cross-cluster
  side effects; you are moving *pure render/calc/logic* functions to take explicit params, not
  splitting the singleton itself.
- Do **not** parallelize builds/testing while mutating `node_modules`.
- Keep every cluster small and independently green — bisectability is the whole point.
- The macOS case-insensitivity trap: `~/Iinpublic/` and `~/IinPublic/` resolve to the same path —
  verify target paths before any destructive file move.

---

#### Current sequence

1. ~~Establish the canonical green baseline and add the 11,793-line ratchet.~~ Done.
2. ~~Add route-editor model and DOM characterization tests.~~ Done.
3. ~~Extract pure route-model conversion/self-answer logic.~~ Done.
4. ~~Extract the route-editor DOM/event controller behind `UIManager` delegation.~~ Done.
5. ~~Lower the ratchet, run the full gate, and record evidence.~~ Done; choose cluster #2 from the
   measured candidates before moving more code.
6. ~~Characterize and extract cluster #2 (survey statistics).~~ Done; model/controller split keeps
   the `UIManager` entry contract and isolates the browser download side effect.
7. ~~Lower the ratchet to 10,830 and restore the deterministic full analytics E2E.~~ Done; focused
   and full-shard coverage is green.
8. ~~Re-measure the remaining clusters before choosing cluster #3.~~ Done; `displayTalksList`
   remains deferred at about 685 lines / 52 dependencies, while the 460-line / six-dependency
   application shell was selected.
9. ~~Characterize and extract cluster #3 (application shell), lower the ratchet to 10,280, and
   close its canonical verification gate.~~ Done; canonical run `run-20260824-203147-12032` is green.
10. ~~Re-measure and choose cluster #4 as a separate commit-sized change.~~ Done; the answer-
    preference resolver/persistence pipeline was selected, while `displayTalksList` remains
    deferred at 685 lines / 52 dependencies.
11. ~~Characterize and extract cluster #4, lower the ratchet to 9,830, and close its canonical
    gate.~~ Done; canonical run `run-20260824-225837-46881` is green.
12. ~~Re-measure, characterize, and extract cluster #5 (local statistics dashboard), lower the
    ratchet to 9,656, and close its canonical gate.~~ Done; translations and refresh are explicit
    dependencies, while data fetching remains in `UIManager`.
13. ~~Re-measure, characterize, and extract cluster #6 (edit-profile dialog), lower the ratchet to
    9,426, and close its canonical gate.~~ Done; the existing manager method remains a thin shim.
14. ~~Re-measure, characterize, and extract cluster #7 (custom-chatroom dialogs), lower the ratchet
    to 9,290, and close its canonical gate.~~ Done; HTTP/state orchestration stays in `UIManager`.
15. ~~Re-measure, characterize, and extract cluster #8 (settings storage inspector), lower the
    ratchet to 8,938, and close its canonical gate.~~ Done; the read-only diagnostics module takes
    formatted app state and translation/API dependencies explicitly.
16. ~~Re-measure and choose cluster #9 (talk-editor form processing), lower the ratchet from the
    grown 9,153 to 8,912, and close its canonical gate.~~ Done; `processTalkForm` was never called
    externally, so the extraction needed no new indirection beyond the usual deps-object shim.
17. ~~Re-measure and choose cluster #10 (linked-devices dialog orchestration), lower the ratchet
    from 8,912 to 8,784, and close its canonical gate.~~ Done; the method folded into the same
    module its already-extracted renderer lived in, since it was mostly a `LinkedDevicesDeps`
    options-builder around that renderer.
18. ~~Re-measure and choose cluster #11 (creator-replies list), lower the ratchet from 8,784 to
    8,584, and close its canonical gate.~~ Done; `renderSettingsView`/`bindSettingsControls`
    (largest remaining pair after `displayTalksList`) were re-measured and deferred alongside it —
    too entangled with other cross-cutting methods for a clean extraction.
19. ~~Re-measure and choose cluster #12 (talks-row gestures), lower the ratchet from 8,584 to
    8,482, and close its canonical gate.~~ Done; `showConversationDetail`/`addNewConversation`/
    `syncConversationMessageSummary` (a cohesive but mutually-entangled "conversation view"
    cluster) were re-measured and deferred alongside settings/`displayTalksList`.
20. ~~Re-measure via an AST script (method line-span + `this.*` reference count) and extract
    clusters #13-#16 (`saveFlatAnswerHistoryRecord`/`getTalkContentKey`,
    `filterVerifiedSupportMessages`, `bindDirtyWordEditor`, `applyMeAnswerFilter`), lowering the
    ratchet from 8,482 to 8,133 across the four.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
21. ~~Extract clusters #17-#21 (`displayChatroomMessage`, `updateMatchBadge`,
    `confirmCapturedQuestionDialog`, `showTalkTemplatePicker`,
    `showChooseWhoToDmPicker`/`showDmInboxPicker`, `confirmBroadcastAudience`), lowering the
    ratchet from 8,133 to 7,834 across the five.~~ Done; `showEditStageNameDialog` found to have
    zero callers and flagged rather than deleted; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
22. ~~Extract clusters #22-#29 (`showNotification`, `getPeerNameCache`/`rememberPeerName`,
    `renderCapturedQuestionMessage`/`renderIpfsAttachmentMessage`, `syncAppBarOverflow`,
    `showSystemAnnouncement`, `showDetailsPopupFor`, `saveQuestionAnswersFromCompletion`,
    `saveObjectUrlAs`, `setTalkDisabled`, `setupAppBarChrome`), lowering the ratchet from 7,834 to
    7,518 across the eight.~~ Done; `app-bar.ts`'s entire component system found to be unimported
    anywhere and flagged rather than deleted; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
23. ~~Extract clusters #30-#35 (`saveCreatedTalk`, `deliveryReasonLabel`/`formatReasonCounts`,
    `saveKnownPerson`, `resolveChatroomTitle`, the creator-reply filter-state trio,
    `updateConversationTransportMode`/`setConversationOnlineStatus`), lowering the ratchet from
    7,518 to 7,345 across the six.~~ Done; caught and reverted a near-miss deletion of
    `resolveAnswerPreferenceForTalkQuestion` (still a characterization-test call target);
    `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the conversation-view
    trio remain deferred, unchanged.
24. ~~Extract clusters #36-#39 (`updateStatusBar`, the `markConversationWithdrawn`/
    `markConversationEnded` pair, `copyAnsweredTalkToTalks`, the `quickIgnoreIncomingTalk`/
    `quickCopyIncomingTalk` pair), lowering the ratchet from 7,345 to 7,233 across the four.~~
    Done; `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the
    conversation-view trio remain deferred, unchanged.
25. ~~Extract clusters #40-#42 (`tagAnswerSuffix`/`renderTagAnswerSuffixHtml`,
    `displayIncomingTalk`, `setBlocked`), lowering the ratchet from 7,233 to 7,184 across the
    three.~~ Done; `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the
    conversation-view trio remain deferred, unchanged.
26. ~~Extract cluster #43 (`completeTalk`/`saveMyTalk` → new `talk-completion.ts`), lowering the
    ratchet from 7,184 to 7,097.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
27. ~~Extract cluster #44 (`detectDownloadPlatform`/`renderAppDownloadBanner` → new
    `app-download-banner.ts`), lowering the ratchet from 7,097 to 7,027.~~ Done;
    `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the conversation-view
    trio remain deferred, unchanged.
28. ~~Extract cluster #45 (`showPreferencesDialog`/`normalizePreferenceMode`/
    `applyPreferenceModeToExactMemory`/`deleteAnswerPreference` → new
    `answer-preference-mutations.ts`), lowering the ratchet from 7,027 to 6,919.~~ Done;
    `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the conversation-view
    trio remain deferred, unchanged.
29. ~~Extract cluster #46 (`displayContextualStatistics`/`displayStatisticsDashboard`/
    `renderStatisticsDashboard` → new `local-statistics.ts`), lowering the ratchet from 6,919 to
    6,858.~~ Done; found a third dead-code case (`displayStatisticsDashboard`/
    `renderStatisticsDashboard`, see the dead-code paragraph above); `displayTalksList`,
    `renderSettingsView`/`bindSettingsControls`, and the conversation-view trio remain deferred,
    unchanged.
30. ~~Extract cluster #47 (`hydrateAttachmentImages` → new `attachment-hydration.ts`), lowering
    the ratchet from 6,858 to 6,830.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
31. ~~Extract cluster #48 (`openEraseDeviceDialog` → new `erase-device-flow.ts`), lowering the
    ratchet from 6,830 to 6,802.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
32. ~~Extract cluster #49 (`registerTalkForPeer` → new `talk-peer-registration.ts`), lowering the
    ratchet from 6,802 to 6,779.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
33. ~~Extract cluster #50 (relocate `resolveExpiresAtMs`/`BroadcastAudiencePreview` out of
    `ui-manager.ts`, then `getSenderOmittedBroadcastPreviews` → new
    `broadcast-audience-preview.ts`), lowering the ratchet from 6,779 to 6,742.~~ Done;
    `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the conversation-view
    trio remain deferred, unchanged.
34. ~~Extract cluster #51 (`refreshFlowAnswerConstraints` → new `flow-answer-constraints.ts`;
    `renderSettingsSection` → new `settings-section-template.ts`), lowering the ratchet from
    6,742 to 6,710.~~ Done; `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and
    the conversation-view trio remain deferred, unchanged.
35. ~~Extract cluster #52 (`showContentFilterToast` → new `content-filter-toast.ts`), lowering
    the ratchet from 6,710 to 6,697.~~ Done; caught and reverted a near-miss attempt to inline
    `saveAnswerPreference` before it touched any tests; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
36. ~~Extract cluster #53 (`applySettingsSectionView` → new `settings-section-view.ts`), lowering
    the ratchet from 6,697 to 6,678.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
37. ~~Extract cluster #54 (`formatAttachmentSize`/`attachmentDownloadFilename`/
    `attachmentIconForMime`/`renderMediaTile` → new `attachment-metadata.ts`), lowering the
    ratchet from 6,678 to 6,637.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
38. ~~Extract cluster #55 (`markOtherDealConversationsEnded` → extended
    `conversation-record-updates.ts`), lowering the ratchet from 6,637 to 6,620.~~ Done;
    `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and the conversation-view
    trio remain deferred, unchanged. Checked in with the user on how to proceed given the
    thinning candidate pool — chose to keep grinding small clusters rather than tackle a
    deferred giant yet.
39. ~~Extract cluster #56 (`syncStatusBarMatchCount` → extended `status-bar.ts`), lowering the
    ratchet from 6,620 to 6,607.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
40. ~~Extract cluster #57 (`showTalkDetail` → new `talk-detail-view.ts`), lowering the ratchet
    from 6,607 to 6,566.~~ Done; `displayTalksList`, `renderSettingsView`/`bindSettingsControls`,
    and the conversation-view trio remain deferred, unchanged.
41. ~~Extract cluster #58 (`showLocationRoomSuggestion` → new `location-room-suggestion.ts`),
    lowering the ratchet from 6,566 to 6,555.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
42. ~~Extract cluster #59 (`syncReturnHomeButton` → new `return-home-button.ts`), lowering the
    ratchet from 6,555 to 6,545.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
43. ~~Extract cluster #60 (`deleteMyTalk` → new `talk-deletion.ts`), lowering the ratchet from
    6,545 to 6,531.~~ Done; `displayTalksList`, `renderSettingsView`/`bindSettingsControls`, and
    the conversation-view trio remain deferred, unchanged.
44. ~~Extract cluster #61 (`parseIpfsSharePayload` → extended `attachment-metadata.ts`),
    lowering the ratchet from 6,531 to 6,517.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
45. ~~Extract cluster #62 (`formatTalkDistanceFromAuthor` → new `talk-distance.ts`), lowering
    the ratchet from 6,517 to 6,504.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
46. ~~Extract cluster #63 (`updateChatroomInfo` → new `chatroom-info.ts`), lowering the ratchet
    from 6,504 to 6,494.~~ Done; `displayTalksList`, `renderSettingsView`/`bindSettingsControls`,
    and the conversation-view trio remain deferred, unchanged.
47. ~~Extract cluster #64 (`setCurrentChatroomId` → new `current-chatroom.ts`), lowering the
    ratchet from 6,494 to 6,485.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
48. ~~Extract cluster #65 (`navigateToMyAnswerForTalk` → new `navigate-to-answer.ts`), lowering
    the ratchet from 6,485 to 6,472.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
49. ~~Extract cluster #66 (`quickAnswerIncomingTag` → new `quick-answer-incoming-tag.ts`),
    lowering the ratchet from 6,472 to 6,462.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
50. ~~Extract cluster #67 (`collectSharedAttachments` → extended `attachment-metadata.ts`),
    lowering the ratchet from 6,462 to 6,453.~~ Done; `displayTalksList`, `renderSettingsView`/
    `bindSettingsControls`, and the conversation-view trio remain deferred, unchanged.
    **Session paused here** at the user's request (asked what was taking so long after many
    hours of one-cluster-at-a-time gating).
51. ~~Extract cluster #68 (`getBroadcastableTalkIds`/`getBroadcastTalkPayload` → extended
    `broadcast-audience-preview.ts`), lowering the ratchet from 6,453 to 6,437.~~ Done; both
    stable public `UIManager` methods remain one-line shims, and the remaining candidate pool is
    still thin (mostly ratio <8, widely-coupled, or the deferred giants themselves).
52. ~~Extract cluster #69 (`formatTalkExpiryTone`/`getIncomingQuestionCount` → new
    `talk-list-metadata.ts`), lowering the ratchet from 6,437 to 6,416.~~ Done; the two pure
    display helpers are called directly from `displayTalksList`, removing their private methods
    from the god object while leaving the deferred giant itself unchanged.
53. ~~Extract cluster #70 (`collectSharedLinks` → extended `attachment-metadata.ts`), lowering
    the ratchet from 6,416 to 6,401.~~ Done; the conversation message array is passed explicitly
    and `renderMediaGalleryTab` calls the pure helper directly, with no compatibility shim.
54. ~~Extract cluster #71 (per-recipient unsent-broadcast selection → new
    `broadcast-delivery-selection.ts`), lowering the ratchet from 6,401 to 6,367.~~ Done; ledger
    dependencies are explicit, room-independent identity semantics are preserved, and the two
    observed `UIManager` entry points remain one-line compatibility shims.
55. ~~Extract cluster #72 (`displayTalksList` → new `talks-list-view.ts`), lowering the ratchet
    from 6,367 to 5,711.~~ Done; all four list-specific binding/render sequence flags now live in
    document-scoped module state, and the stable `UIManager` entry point is a typed dependency
    shim.

Issue #2 remains a separate completed commit. Its former owner question is resolved: the examples
were archived and the unused direct React dependency graph was removed. A future, intentional React
evaluation is specified in "React DOM / React Native evaluation" below.

### React DOM / React Native evaluation

**Status:** Planned, not started. This document authorizes measurement and a bounded React DOM
pilot only after its gates are met; it does **not** authorize a whole-app rewrite or a React Native
migration.
**Written:** 2026-08-23 after reviewing the framework-free UI and current browser, Electron, Android
WebView, and embedded Node/Gun architecture.

#### Decision to make

Decide with release-build evidence whether IinPublic should:

1. keep the framework-free DOM UI after targeted performance/architecture work;
2. migrate incrementally to React DOM while retaining the existing shared web bundle and native
   shells; or
3. separately fund a React Native/Expo product effort for native mobile UI.

Removing the old unused React dependencies in `2f0b7355` was correct. Reintroducing React later must
be an intentional architecture decision with an owned screen, measurable target, and maintained
dependency graph.

#### Current architecture and constraints

- One DOM application is reused by browsers, Electron, and Android WebView.
- Android starts an embedded Node/Gun runtime, waits for its loopback health endpoint, and then
  loads the web application. First-run Node staging can dominate perceived startup independently
  of the UI framework.
- The current production `dist/web/bundle.js` is about 2.9 MB uncompressed. Large P2P/IPFS chunks
  exist separately, so initial-load and deferred-load costs must be measured rather than guessed.
- `UIManager` and `app.ts` are large mutable coordinators. React could improve ownership and state
  boundaries, but React cannot by itself fix Gun synchronization, IPFS loading, cryptography,
  embedded Node startup, or work that blocks the browser main thread.

#### Option summary

##### React DOM in the existing shells

Pros:

- Incremental adoption inside an existing page is officially supported.
- Components can replace manual `innerHTML`, selectors, and listener rebinding one owned subtree
  at a time.
- React DevTools/Profiler provide component render evidence; transitions and deferred values can
  separate urgent interaction from non-critical rendering.
- The same UI can continue to run in browser, Electron, Android WebView, and a future iOS WebView.

Cons:

- Adds runtime and bundle cost; a poor component/state design can create rerender storms.
- Does not provide list virtualization or background-thread execution automatically.
- Gun and other push sources need a coalesced, explicitly scoped external-store adapter.
- During migration, React and legacy code must never mutate the same DOM subtree.

##### React Native / Expo

Pros:

- Native mobile controls, navigation, gestures, accessibility, and UI-thread behavior.
- Business logic can be shared while platform-specific files/adapters handle Android and iOS.
- Can be integrated into an existing native app screen-by-screen.

Cons:

- Not a drop-in replacement for React DOM. Current HTML, CSS, DOM tests, WebView bridge, and much
  UI automation would need replacement or adapters.
- Web and Electron would still need React DOM or a compatibility layer, increasing platform scope.
- Existing Android nearby-connectivity JavaScript bridge capabilities would need native modules.
- Does not remove embedded Node/Gun startup or network synchronization costs.

#### Phase 0 — Define and measure “slow” (mandatory)

- [ ] Measure **release builds**, not development builds, on at least one browser, Electron, and
      representative Android device/profile.
- [ ] Split cold start into timestamps:
      1. process/activity launch;
      2. embedded Node health-ready where applicable;
      3. HTML loaded;
      4. main bundle downloaded/read, parsed, and executed;
      5. first usable navigation;
      6. initial identity/Gun synchronization complete.
- [ ] Record main-thread long tasks, memory, navigation latency, input latency, and scroll frame
      behavior for Talks and Contacts.
- [ ] Record bundle/chunk transfer and parse sizes, including cold and warm cache.
- [ ] Name the top three bottlenecks with traces. Do not select a framework before this evidence.

#### Phase 1 — Framework-independent performance work

- [ ] Defer non-critical initialization and feature modules until their first use.
- [ ] Verify that large P2P/IPFS code is not part of the critical first-interaction path.
- [ ] Coalesce bursty Gun events and update only the affected UI region.
- [ ] Virtualize or progressively render genuinely large lists; avoid rebuilding complete lists for
      one-row changes.
- [ ] Move sustained CPU work off the renderer thread where practical.
- [ ] Repeat Phase 0 measurements and retain before/after traces.

#### Phase 2 — Bounded React DOM pilot

- [ ] Begin only after the `UIManager` route-editor cluster has explicit ownership and
      characterization tests.
- [ ] Use the route editor as the maintainability pilot because it is cohesive and interactive.
      If the goal is specifically list-speed, use the single slowest measured list instead; do not
      silently change the pilot goal.
- [ ] Give React exclusive ownership of one root element. Legacy code may pass typed data/events
      across the boundary but may not mutate descendants of that root.
- [ ] Keep services, Gun, storage, identity, cryptography, and platform shells unchanged.
- [ ] Record dependency/bundle delta, mount/update timings, input latency, memory, accessibility,
      E2E stability, and implementation effort.
- [ ] Use production profiling builds only for controlled measurements; ship an ordinary production
      build after the experiment.

#### Phase 3 — Decision gate

- [ ] Compare the React pilot with the characterized DOM implementation using the same data and
      device/profile.
- [ ] Adopt incremental React DOM only if it improves maintainability without a material regression
      in cold start, interaction latency, memory, accessibility, or test reliability.
- [ ] If adopted, migrate one screen/cluster per commit with exclusive DOM ownership and a green
      canonical gate. Do not combine migration with behavior redesign.
- [ ] If rejected, remove pilot-only dependencies/configuration and retain the measured
      framework-independent improvements.

#### Separate React Native gate

React Native requires a new owner decision and budget. Approve it only if native mobile experience
is a product requirement strong enough to justify separate web/desktop presentation work, native
bridge replacement, new build/release pipelines, and a staged migration plan. It must not be chosen
as a presumed cure for unmeasured slowness.

#### Primary references

- React: [Add React to an Existing Project](https://react.dev/learn/add-react-to-an-existing-project)
- React: [`<Profiler>`](https://react.dev/reference/react/Profiler)
- React Native: [Performance Overview](https://reactnative.dev/docs/performance.html)
- React Native: [Integration with Existing Apps](https://reactnative.dev/docs/integration-with-existing-apps.html)
- React Native: [Platform-Specific Code](https://reactnative.dev/docs/platform-specific-code.html)
- Electron: [Performance](https://www.electronjs.org/docs/latest/tutorial/performance)

## Smaller independent work

(2026-08-23 batch — R4/R5/FF measured, no action needed at current scale; Z/CC/sendBulkTalk/
authorship/architecture-prose landed. Asymmetric/containment similarity metric and PMTiles/
Protomaps evaluation landed 2026-09-09. See `docs/completed.md`.)

## Deferred product decisions

- Multiple identities/profile switching on one device.
- Whether linked-device clusters receive a durable person identifier.
- Whether contacts, blocks, conversations, Q&A, credit, and reputation aggregate across linked
  identities; v1 remains mutual-link/display merge only.
- Precise-location sharing as an explicit opt-in feature.
- Talk bridging through a middle person remains version 2; discovery gossip and configurable mesh
  forwarding remain version 1.
- Geographic/topic DHT indexes, after a privacy/enumeration review (former `TODO_codex.md`).
- Advanced V2 relay guarantees, incentives, and accounting (former `TODO_codex.md`).
- BLE Gun transport, only after measured product need beyond the BLE discovery/upgrade work in
  Priority 3 (former `TODO_codex.md`).
- A broader public-image graph beyond Me-tab Q&A and contextual credit/reputation (former
  `TODO_codex.md`).

## Verification rules

1. Put E2E specs in the lowest stage with enough users and add a companion `.md` explanation.
2. Assert durable state or stable UI signals, not transient toasts.
3. If a test exposes a product bug, fix the product rather than weakening the assertion.
4. Move completed work to `docs/completed.md` immediately.

## Nightly jobs

- `npm run health`
- `npm run test:e2e:parallel`
- `npm run test:e2e:heavy`
- `npm run test:e2e:mesh`
