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
"Actionable Implementation Plan" section (near its end) for open work there.

## Priority 2 — identity linking and public-device handoff

### I. Multi-device identity linking

- [x] Freeze v1 semantics: direct mutual `LINK_IDENTITY` edges between independent SEA identities;
  no transitive cluster, implicit sync, merged authorship, or recovery authority. See
  `docs/architecture/identity-v1-semantics.md`.
- [x] Start the **Identity & devices** Settings shell with identity fingerprint/status, local
  protection status, renameable privacy-minimized installation metadata, and linked identities.
- [x] Review and approve `docs/security/local-identity-password-custody-design.md` for staged
      implementation. The exact scrypt profile, authenticated v2 envelope, and IndexedDB
      compare-and-swap foundation, crash-safe set/change coordinator, startup unlock, explicit
      lock, atomic v1 migration, and staged set/change/remove UI are implemented. Password removal
      requires the current password and explicitly warned, verified v2-to-v1 downgrade. Native
      lifecycle adapters/benchmarks and the remaining production release conditions are in
      `docs/security/local-identity-password-custody-review.md`.
- [ ] Later harden password-free custody beyond v1 with a reviewed non-extractable WebCrypto-key
      format for supported browsers and OS Keychain/Keystore adapters for native shells.
- [x] Wire `WebIdentityLinkService` into `app.ts`; entered codes now publish a real SEA-signed
  one-sided attestation and display **Waiting for approval** until mutual confirmation exists.
- [x] Complete the two-installation mutual approval path with a versioned expiring code, real QR,
  optional camera scan, signed request discovery, graph-verified rows, replay rejection, and
  revocation convergence. Covered by `stage2-two-user/73-identity-link-mutual.spec.ts`.
- [x] Make removal local-first with a durable signed revocation outbox, immediate trust denial,
  startup/Settings retry, pending/removed/conflicted/invalid states, and lost-device reconnection
  coverage in `stage2/73`.
- [x] Show verified direct links in peer detail without merging Contacts, authorship, reputation,
  blocks, or Q&A. `WebIdentityLinkService.isLinked(peerPub)` is self-scoped (resolves the edge
  between the viewer's own identity and a given pubkey), so this shows "this peer is one of MY
  OWN verified-linked identities" — the only relationship v1's direct-mutual-only, no-transitive-
  cluster semantics actually define; there is no general "does this peer have any links to
  anyone" index. New `#peer-linked-identity-section` in the peer-detail overlay
  (`ui-manager.ts`), populated by `user-detail-view.ts`'s `openPeerDetailView` via a new
  `UserDetailViewDeps.isLinkedIdentity(peerId)` dep — async, guarded against a stale resolution
  landing after the user has navigated to a different peer (same pattern `resolvePeerStageName`
  already used). Wired end to end: `ui-manager.ts`'s `isLinkedIdentityLive` resolves the peer's
  pub via `gunService.getPublicUser`, then calls a new `identityLinkChecker` hook
  (`setIdentityLinkHooks({ isLinked })`) backed by `WebIdentityLinkService.isLinked` in `app.ts`.
  Purely informational (a small badge + note) — no data is aggregated or merged across the two
  identities. Covered by `user-detail-view.test.ts` (5 tests: renders/doesn't render, clears on
  peer switch, discards a stale resolution for an abandoned peer).
- [x] Wire URL-fragment, loopback, and clipboard same-device linking shortcuts (spec §10.3).
  New `identity-link-fragment.ts` (`buildLinkFragmentUrl`/`parseLinkFragmentPayload`/
  `clearLinkFragmentFromUrl`) and `loopback-probe.ts` (`probeLoopbackNode`/`loopbackLinkUrl`).
  URL-fragment: "Copy link" in the code dialog copies `<origin><path>#link=<code>`; on boot,
  `app.ts`'s `checkForPendingIdentityLinkFragment` decodes and clears a `#link=` fragment
  entirely client-side (never reaches a server) and opens the Enter-code dialog pre-filled,
  skipping typing. Clipboard: a "Paste" button (`navigator.clipboard.readText`, feature-detected)
  in the Enter-code dialog; Copy/Copy-link already existed. Loopback: the "app on this computer"
  is this same codebase in embedded-node mode on `127.0.0.1:<port>` (`embedded-node-config.ts`) —
  a silent `/health` reachability probe (no new endpoint, no new CORS/security surface) decides
  whether to show a one-click "Link with the app on this computer" button, which composes with
  the URL-fragment mechanism (`window.open(loopbackLinkUrl(code))`) rather than inventing a
  separate secret-carrying protocol. **Known gap:** the reverse "Open in app to link" direction
  (browser → native app via a custom URL scheme) needs native-shell deep-link registration not
  buildable/testable without a real Electron/mobile shell (Priority 3, not yet connected to CI).
  Side effect: found `qrcode` (a real `package.json` dependency `link-code-qr.ts` already used)
  was missing from `node_modules` — `npm ci` restored it, which also fixed 6 previously-broken
  test suites (`linked-devices-dialog.test.ts`, `link-code-qr.test.ts`,
  `ui-startup-chatrooms.test.ts`, `identity-password-custody-manager.test.ts`,
  `identity-custody-store.test.ts`, `production-topology-contract.test.ts`) that had nothing to
  do with this change. Covered by `identity-link-fragment.test.ts` (10 tests), `loopback-probe.test.ts`
  (8 tests), and new cases in `linked-devices-dialog.test.ts` (prefill, paste, copy-link,
  loopback-button visibility).
- [x] Enable and pass X8 same-device linking E2E. **Landed 2026-08-26** — see
  `docs/completed.md`. Also found+fixed a real `E2E_GUN_MEMORY_ONLY`/`DEV_GUN_FRESH` env-leak
  bug that was silently zeroing the embedded-node child's upstream Gun peers (affected the
  pre-existing S3 embedded-node spec too). **New known gap surfaced by this work:** the
  production-default embedded-node relay mode (`explicit-http`) only relays a narrow allowlist
  (discovery/signaling/presence/room-membership) between a native shell and the hub —
  `identity-link-requests` isn't in it, so whether same-device linking (or mesh talk delivery,
  which S3 also needs) actually completes on a real native shell talking to the real public hub
  is still open; X8 forces `IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer` as a test-only workaround, not
  proof of the production path. Needs a dedicated look at whether `identity-link-requests` (and
  whatever S3 needs) should join the relay allowlist, or whether same-device linking should
  instead lean on LAN discovery to bypass the hub restriction entirely.
- [ ] X3 website↔app remains skipped — needs a real native-shell CI runner (Priority 3), not a
  same-machine mechanism gap like X8 was.

### J. Sync-then-erase

- [x] Wire encrypted P2P handoff transfer and receiver import (spec §11.2). New
  `shared/handoff-protocol.ts` (pure, mirrors `identity-linking.ts`'s own signed-record
  shape: `EpubAnnouncement`, `HandoffEnvelope`, `HandoffAck`, all pipe-delimited signing
  inputs to avoid `SEA.verify`'s JSON-auto-parse trap) and
  `web-device-handoff-service.ts` (SEA/Gun wiring). Linked devices are known only by
  their signing `pub` (v1 never resolves userId), but encrypting requires the
  recipient's separate `epub` — every identity now publishes a signed `pub→epub` binding
  on boot (`identity-epub/<pub>`) so a linked device can find it without needing a
  userId. Sender: build archive → encrypt to receiver's verified epub → publish signed
  envelope (`handoff/<toPub>/<fromPub>`) → poll for the receiver's signed ack
  (`handoff-ack/<senderPub>/<receiverPub>`); `erase-device-dialog.ts` now shows an error
  and keeps Done disabled on any failure (no epub, ack timeout, verify/decrypt failure)
  instead of the old stub's silent local-only success. Receiver: `readIncomingHandoff`
  checked only against pubs the device already knows it's linked to (never a general
  discovery scan), surfaced as an explicit "Data available to import" card in Identity &
  devices (`linked-devices-dialog.ts`) — nothing merges until the user presses Import,
  which calls the existing `mergeHandoffArchive` and a new
  `WebUserService.importHandoffData` for the persisted fields, then publishes the ack.
  All flat/exact-key Gun paths (never `.map()` discovery) since both sides always
  already know both pubs before they need to read anything — see
  `web-device-handoff-service.ts`'s own doc comment. Found and fixed a real bug via the
  E2E run: `SEA.decrypt` auto-JSON-parses a JSON-shaped plaintext back into an object
  (the same class of quirk already documented for `SEA.verify` in
  `web-ledger-service.ts`), so a bare `String(dec)` produced the literal text
  `"[object Object]"` instead of the archive JSON — fixed by re-stringifying a non-string
  result. `stage2-two-user/72-sync-before-erase.spec.ts` was rewritten from its old stub
  assumption (any sync always locally "succeeds") to its now-correct one: a send to an
  unreachable device must fail loudly and never enable Done. Unit coverage:
  `handoff-protocol.test.ts` (14 tests, including forged-signature/wrong-recipient/
  cross-binding attacks), `web-device-handoff-service.test.ts` (10 tests, full two-
  instance send→read→decrypt and ack round trips over a shared fake Gun store),
  `erase-device-dialog.test.ts` (3 tests for the new error path).
- [x] Enable and pass a real send→ack→import round trip:
  `stage2-two-user/74-device-handoff-transfer.spec.ts` — two real linked browser
  installations, a real encrypted transfer, a real receiver Import click, and an
  assertion that the transferred data actually lands on the receiver. **Known gap:** the
  official `cross-platform/x7-sync-then-erase.spec.ts` stays `test.skip` — it
  specifically wants a hosted *website* linked to a native *webapp* (Electron/
  embedded-node), which needs a real native-shell CI runner not yet connected
  (Priority 3), not a mechanism gap; see that spec's own updated doc comment.

## Priority 3 — native and cross-platform verification

- [ ] Connect the Mac mini, Windows, and Linux native-app jobs to real CI runners.
- [ ] Enable and pass X4 mobile↔desktop matching and threads.
- [ ] Enable and pass X5 three-platform thread isolation.
- [ ] Enable and pass X6 bidirectional offline/mailbox delivery.
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
- [ ] Verify Gun.js/P2P behavior under Firefox.
- [ ] Verify local storage, IndexedDB, permissions, WebSocket, and reconnect behavior.
- [x] Add a command such as:

```bash
npm run test:e2e:firefox
```

Implemented and passing for the platform smoke gate; HTTP, WebSocket,
localStorage, IndexedDB, and local Gun read/write are covered. Permissions,
reconnect, and cross-peer Firefox behavior remain open.

##### 1.3 Run All Three Browsers

- [x] Run Chromium, WebKit, and Firefox from one Playwright configuration (platform smoke gate).
- [x] Add a command such as:

```bash
npm run test:e2e:browsers
```

Implemented; all projects contribute to one HTML report.

- [ ] Make test data and ports safe for parallel browser execution.
- [x] Prevent browser instances from accidentally sharing identities or state unless the test explicitly requires it (fresh context and browser IndexedDB plus server-graph clear per smoke test).
- [ ] Give each test peer a visible identity such as:
  - chromium-alice
  - webkit-bob
  - firefox-eve

##### 1.4 Add Mixed-Browser P2P Scenarios

Do not only run the same test independently in each browser. Add scenarios where different browsers communicate with each other.

- [x] Chromium -> WebKit (first matching-thread slice).
- [x] WebKit -> Chromium (bidirectional reply in the same slice).
- [ ] Chromium -> Firefox
- [ ] Firefox -> Chromium
- [x] WebKit -> Firefox (verified in the seven-runtime physical ring).
- [ ] Firefox -> WebKit
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

Current mixed-engine slice: `chromium-alice` creates a one-question matching
Talk, `webkit-bob` answers it, and the resulting thread carries one message in
each direction. The physical matrix additionally proves simultaneous three-engine
presence and Chromium -> WebKit -> Firefox propagation. The remaining directed
engine pairs, reconnect, and restart persistence are still open.

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
- [ ] macOS App -> Firefox
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

##### 5.2 Add Ubuntu Browsers

- [ ] Chromium.
- [ ] Firefox.
- [ ] WebKit through Playwright where applicable.

Run:

- [ ] Browser tests locally on Ubuntu.
- [ ] Ubuntu browser -> Mac browser.
- [ ] Ubuntu browser -> Windows browser.
- [ ] Ubuntu browser -> Android.

##### 5.3 Add Ubuntu Desktop App

- [ ] Build/install the Linux IinPublic app.
- [ ] Add isolated test profiles.
- [ ] Add remote startup/shutdown.
- [ ] Add desktop UI automation only where required.
- [ ] Reuse shared scenario logic wherever possible.

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
3. [ ] macOS Firefox.
4. [ ] Mixed browser tests on Mac.
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

### BB. Typed opposite-tag matching follow-ups

`Talk.role` ('offer'/'request') has been fully replaced by `Talk.selfTag`/`preferenceSet` (spec
§30.2) — `checkIfMatch`, `exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, and the talk editor
all read the new fields; `role`/`TalkRole` no longer exist anywhere in the codebase. Price-overlap
matching (`intervalsOverlap` + `builtIn.priceRange`) is E2E-covered end to end with
non-identical, genuinely overlapping ranges (`stage2-two-user/87-price-overlap-buy-sell-
match.spec.ts`) — a `type: 'route'` talk turned out unnecessary for that case; a single-question
`type: 'flow'` talk with one `builtIn` question already covers it.

- [x] Design a privacy-safe source for the responder's blurred location/radius, then wire location
  auto-resolution using the existing mutual-containment comparison. **Landed 2026-08-27** — see
  `docs/completed.md`. Bernard's design: blurred location may auto-answer once the user grants a
  one-time opt-in consent (default OFF); precise location stays entirely separate/manual, never
  auto-sent by chatbot (e.g. taxi/meetup use cases where a driver/passenger explicitly chooses to
  share precisely) — that precise-location feature remains its own deferred item, untouched.
  New `locationAutoMatchConsent` setting (`ui-settings-storage.ts`) gates a new
  `myMostRecentLocationTalk` lookup (`answer-preference-resolution.ts`, over the already-local
  `getMyTalks()`) that sources side "b" of `locationsMutuallyContained` from my own most-recent
  matching-scope talk's `authorLocation`/`locationRadiusMiles`, exactly the shape the original
  research note below proposed.
- [x] Persist user-created opposite-tag pairs; seeded pairs already work. **Landed 2026-08-23** —
  see `docs/completed.md`.
- [x] Support talk-level shared time/location questions before route item branches. **Landed
  2026-08-23** — see `docs/completed.md`.
- [x] Add E2E cases for missing preference and `location`'s unconditional-ASK_USER fallback to
  the human inbox. **Landed 2026-08-26** — see `docs/completed.md`.
  `stage2-two-user/95-builtin-ask-user-fallback.spec.ts`. (Real cross-browser route matching is
  covered separately — `stage2-two-user/92-route-shared-builtin-root-branches.spec.ts`.)

### DD. Generalized dating matching

Design is specified in technical specification §30.6. The age-range comparator and multi-value
gender/race preference matching are now both fully wired and shipping (as the built-in Dating
talk template); the remaining bullet — photo-delivery consent/safety copy — carries its own
product/safety judgment call and is left for a dedicated pass.

- [x] Implement mutual preference-set membership and the age point-in-range primitive. **Landed
  2026-08-23** — `mutualPreferenceSetMembership`/`ageRangeMutuallyAcceptable`
  (`src/shared/built-in-comparisons.ts`), 9 new unit tests. Pure functions only, matching the
  file's existing `intervalsOverlap`/`quantitySufficient`/`locationsMutuallyContained` style —
  `mutualPreferenceSetMembership` generalizes `checkIfMatch`'s existing one-directional
  `preferenceSet` veto to a real two-sided check (both sides' own selfTag/preferenceSet
  supplied), matching that veto's exact permissive default for a missing counterpart selfTag.
- [x] Wire `ageRange` as a real `BuiltInQuestionKind`, and force+lock `isAdult` for talks that use
  it. **Landed 2026-08-24** — see `docs/completed.md`.
- [x] Wire multi-value gender/race preference matching. **Landed 2026-08-27** — see
  `docs/completed.md`. Bernard's design: NOT `mutualPreferenceSetMembership` (a single Pair-tag
  question can only ever have one accepted answer, `singleNonIgnoreAnswer` — a preference SET on
  one question would break the exact-text hash a Pair-tag match relies on, and isn't unique/
  order-independent) — instead, several independent Pair-tag branches (one per accepted gender)
  fan out in parallel off the shared `ageRange` root, `parallelMatchThreshold: 1` (OR semantics).
  `mutualPreferenceSetMembership` itself stays unwired/unused — superseded by this approach for
  Dating; still available for some other future use case needing a genuine two-sided
  (selfTag, preferenceSet) check outside a question tree.
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
- [x] Update the technical-specification implementation matrix. **Landed 2026-08-23** — Appendix
  18's stale "opposite-attribute preference-sets + typed built-ins... not yet implemented" row
  split to accurately reflect that §BB has substantially shipped, with `location` auto-resolution
  and §DD (dating) called out as the remaining not-implemented pieces.

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

### LL. Unify `type: 'tag'` and `selfTag`/`preferenceSet` into one mechanism (design, 2026-08-19; landed, 2026-08-19)

Design settled (Bernard, 2026-08-19), then implemented same day. Supersedes §II's now-struck-through
"multi-value editing UI" item and §KK's "tag position is not fixed to root" item above; both were
pointing at the same underlying redundancy.

**Landed exactly as originally proposed, no veto:** `type: 'tag'` talks carry NO `selfTag`/
`preferenceSet` at all — `processTalkForm`'s tag branch (`ui-manager.ts`) only ever produces one
ordinary `Talk.questions` entry: `text = keyword` (the tag word/title), one match answer whose
`text` is a new `#talk-answer` field's value (talk-editor-dialog.ts), defaulting to the same word
as the keyword when left untouched (self-match), and one "Ignore." answer. That question/answer
pair IS the whole declaration; `checkIfMatch`'s `preferenceSet` veto (talk-engine.ts) is untouched
code-wise but structurally a permanent no-op for tags now, since they never set the field. Matching
— manual checkbox or chatbot auto-reply — is the exact same plain text-based mechanism every other
question already uses (`exact-chatbot-memory.ts`'s exact-question-text memory): "buy"→"buy"
self-match and "buy"→"sell" opposite-pair both just fall out of whatever question/answer text the
two independent authors happened to choose — per Bernard: "for chatbot matching, there is no
concept of opposite, just answer matching," and "opposite meaning is defined by user in
question/answer format, they can be anything." `#talk-tag`/`#talk-preference-set` (spec §30.2
Phase 5) are UNCHANGED and stay flow/route-only (now single-value, no comma-split), hidden from the
tag form entirely. `?`-notation (ui-manager.ts's `tagAnswerSuffix`) renders by reading the answer
text straight off `Talk.questions[0].answers` for tag-type, or `selfTag`/`preferenceSet` (unchanged)
for flow/route. One accepted, deliberate consequence: two independently-created tag talks with the
literal same question AND answer text (e.g. both "sell" with both defaulting their accepted answer
to "buy") can wrongly auto-match via the chatbot's exact-text memory — no protection, by design,
since tag talks are meant to be simple/low-stakes and any real veto would just be re-adding the
special-case machinery this whole design pass exists to remove. A second, separate consequence:
`isDealEligibleTalk` (app.ts) requires both `selfTag` and a non-empty `preferenceSet`, so a
tag-talk match is never deal-eligible — no "Confirm Deal" step, the talk simply never auto-disables
on a tag match (same as any other plain talk; unaffected feature, not touched by this pass). The
seeded opposite-tag registry (`tag-opposite-pairs.ts`) is confirmed editor-autofill only — a
convenience default in `wireTagAnswerAutoFill`, never read by any matching/runtime path.

**The core idea:** `type: 'tag'` (the one-checkbox talk — hardcoded "Match."/"Ignore." answer
text) and `selfTag`/`preferenceSet` (talk-level metadata on flow/route talks, checked once as a
special veto in `checkIfMatch`) are the same concept expressed two different ways. A tag is
really just a single-question talk: title = question text (already true for `type: 'tag'`,
`processTalkForm`'s tag branch), and the single answer's TEXT is the accepted counterpart —
defaulting to the SAME word as the question (self-referential: "I'm tagged buy; match anyone else
tagged buy" — the classic "Tennis" interest-tag case), overridden by typing a different word when
the author wants an opposite-pair match ("buy" the question, "sell" the answer). Matching then
needs no special veto at all — it's the ordinary flattened-answer-store (§KK) lookup already used
for every other question, keyed on question text + answer text, exactly like any other
single-question flow talk.

**Real behavior change, not just a refactor:** today, a `#talk-tag`/`selfTag` with no known
seeded opposite falls back to "no `preferenceSet`, matches anyone" — inconsistent with what a
plain interest tag ("Tennis") has always actually meant (self-match, not "matches anyone"). Under
this design self-match becomes the one universal default; "matches anyone" is no longer a
distinct fallback state.

**Single answer only — draw the line there, not at multi-value.** Considered and rejected: an
author typing several accepted counterparts on one tag question ("buy" accepting "sell" OR
"free"). Rejected because a bare word like "free" is ambiguous outside its own dedicated
question — "free" could mean giving away or wanting to receive, and a single tag chip has no room
to disambiguate that. If an author genuinely needs multiple accepted answers, it's not a tag
anymore — it's an ordinary multi-answer question (the editor's existing "+ Add Answer" /
`answerSelectionMode` machinery already handles this for flow/route questions), not a
comma-separated list bolted onto the tag's own single-answer shape. This retires the shipped
`#talk-preference-set` free-text field (talk-editor-dialog.ts, §II) once implemented — that field
correctly closed the immediate gap, but a comma-separated string is the wrong shape once the
single-answer rule is settled; a second accepted tag should be a second answer ROW using the same
UI every other question already has, not a parsed string.

**Display notation:** when the answer differs from the question, render the tag as
`{question}?{answer}` — e.g. "buy?sell" for an opposite-pair tag, plain "buyer" (no `?`) for the
self-match/buddy case where question and answer are the same word. Distinguishes "Buy iPhone"
(seeking a seller) from "Buy Buddies iPhone" (seeking fellow buyers) at the chip/row level instead
of relying on the talk's title alone to carry that meaning — the exact ambiguity
`stage2-two-user/89-buy-sell-chatbot-cross-talk-match.spec.ts`'s two Adam talks exist to catch.

**Route placement (on hold): drag-and-drop, not typed metadata.** The longer-term vision for "tag
position is not fixed to root" is a graphical route editor where an author drags an existing tag
onto any node of a route DAG and it drops in as an ordinary question/answer pair at that
position — no separate label-and-type-out-a-question step, since the tag already carries its own
question/answer text. Depends on a drag-and-drop route editor that doesn't exist yet (today's
route editor is the custom DOM tree in talk-editor-dialog.ts, no graphical canvas) — explicitly
parked until that exists, not part of this design pass.

**Net effect: simplifies rather than adds.** One matching mechanism (ordinary question/answer via
the flattened-answer store) instead of two (checkbox-tag booleans + `selfTag`/`preferenceSet`
veto); one UI answer-editing surface (the existing question/answer rows) instead of two (that
surface plus a separate free-text preference field); one default rule (self-match) instead of an
inconsistent "matches anyone" fallback for the unrecognized-tag case.

Resolved during implementation:
- [x] `type: 'tag'` stayed a distinct wire type — still renders as a one-line chip, no Gun data
  migration; its answer TEXT (via the new `#talk-answer` field) became meaningful directly, no
  talk-level metadata involved.
- [x] `checkIfMatch`'s veto code was left in place (untouched) but is now a permanent no-op for
  `type: 'tag'`, since tags never set `preferenceSet`. Every existing caller
  (`exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, `myEffectiveTagContext`) still applies to
  flow/route talks exactly as before, unaffected; `myEffectiveTagContext` also got the self-match
  responder-side fix described above, relevant to flow/route buddy-tag talks now (not tag-type,
  which no longer uses that code path at all).
- [x] No migration/rewrite for existing stored talks — old flow/route talks with no
  `preferenceSet` keep today's "matches anyone" read behavior; old tag talks with hardcoded
  "Match."/"Ignore." answer text are untouched too; only the editor's output for newly-saved
  tag talks changed.
- [x] Confirmed the seeded opposite-tag registry (`tag-opposite-pairs.ts`) is editor-autofill only
  (`talk-editor-dialog.ts`'s `wireTagAnswerAutoFill`), never read by any matching/runtime path.

### LL.1 Per-question `reciprocalTagContext` — generalizes the root-only tag fields (Bernard, 2026-08-20; landed same day)

The root-only `#talk-tag`/`#talk-preference-set` fields (spec §30.2 Phase 5, unchanged by this
item) can only declare ONE buy/sell-style context for a whole talk. This adds a checkbox next to
every question in the flow/route editor (`Question.reciprocalTagContext`, types.ts): when checked,
that question's own (text, its one non-`ignore` answer's text) pair defines the tag context for
every question after it in the same branch — usable anywhere in a tree, not just the root. A
nearer-scoped override: `myEffectiveTagContext` (ui-manager.ts) now tries
`findReciprocalTagAncestor` first (branch-aware via `Question.contextPath` for route, linear array
position for flow), falling back to the unchanged talk-level `selfTag`/`preferenceSet` fields when
no qualifying ancestor exists.

"Exactly one answer" turned out to mean exactly one NON-`ignore` answer, not `answers.length===1`
— `TalkValidator.validateQuestion` requires every question to carry an Ignore option regardless, so
an ordinary single-`match`/`next` + one `ignore` question (the editor's normal 2-answer default)
already qualifies; no special answer-count authoring step needed. `findReciprocalTagAncestor` and a
matching early-exit in `resolveAnswerPreferenceForTalkQuestion` both share one helper,
`singleNonIgnoreAnswer`.

That early-exit was itself a necessary addition, not just wiring: a reciprocal question whose own
text differs from anything the responder has ever answered before (e.g. a "buy" root vs. a "sell"
root — the whole point of an opposite pair) can never win the ordinary flattened-store/exact-text
memory lookup, since that lookup is inherently keyed on having seen this exact text before. Checking
the box already IS the full declaration, so a reciprocal question with exactly one real answer now
auto-proceeds unconditionally (`mode:'auto'`, `autoAnswerReason:'RECIPROCAL_TAG_CONTEXT'`) — the
same "no real decision to make" pattern `type:'tag'` already established for its own single
match-answer (§LL).

Explicitly out of scope, confirmed unaffected: `checkIfMatch`'s `preferenceSet` veto and
`resolveResponderSelfTagForAnswers` (talk-level only); `resolveBuiltInQuestion`/
`typed-preference-store.ts` (separate typed quantity/price mechanism); `talk-response-dialog.ts`
(responder UI unchanged — this is purely editor-authoring + matching-engine); survey and tag types
(survey has no branching; tag's single Q&A is already fully expressed via title/`#talk-answer`).

New coverage: `90-reciprocal-tag-context-non-root-question.spec.ts` — a "buy" flow talk and a
"sell" flow talk, each declaring their tag via an ordinary Q1 (not talk-level metadata), zero-click
auto-match on a shared downstream "Is it an iPhone?" question.

### LL.2 Explicit `Question.tagKind: 'simple'` + ancestor-aware match veto (Bernard, 2026-08-21; landed same day)

§LL/§LL.1 left two tags conflated under one boolean: a `type:'tag'` talk's own answer could still
diverge from its keyword with no explicit marker for *why*, and `reciprocalTagContext` (the
asymmetric "Pair tag" — question text = my declared tag, its one real answer = the accepted
counterpart) never actually gated a match anywhere but the talk root — it only ever fed chatbot
auto-fill context for downstream questions.

This adds `Question.tagKind?: 'simple'` (types.ts) as the explicit, mutually-exclusive counterpart
to `reciprocalTagContext`: a "simple tag" is self-match by definition — its one non-`ignore` answer
MUST equal the question's own text — usable on any question in any talk type (tag/flow/survey/route),
the same atomic building block `reciprocalTagContext` already was. `TalkValidator` enforces both
shapes now: a literal `type:'tag'` talk defaults to simple-tag text-equality unless
`reciprocalTagContext` is set (scoped to `talk.type === 'tag'` only — `validateTalk`'s "tag by
structure" heuristic also routes non-tag-type single-question/two-answer talks, e.g. a flow talk
with one `builtIn` comparison question, through the same validator and must stay permissive); a
`reciprocalTagContext` question's "exactly one non-ignore answer" rule — previously only gracefully
skipped at read time by `findReciprocalTagAncestor`, never actually enforced at save time — is now a
hard validation error too, via a shared `validateTagKindFields` helper (`validateQuestion` for
flow/survey, and route's own inline per-question loop, since route never routed through
`validateQuestion`). `TalkAutofix.fix` silently force-corrects a `tagKind:'simple'` question's
answer text to match its question, one shared step ahead of every type-specific branch.

The real generalization: `findReciprocalTagAncestor`'s ancestor-walk logic moved from
`ui-manager.ts` (web-only) into `talk-engine.ts` as an exported `findTagPairAncestor`, so
`checkIfMatch`'s own preference veto can consult it directly — a mid-tree `reciprocalTagContext`
ancestor now wins over the talk-root `preferenceSet` and actually vetoes a mismatched
`responderSelfTag`, the same precedence the chatbot-context derivation already used. `ui-manager.ts`
now delegates to the shared function instead of keeping its own copy.
`exact-chatbot-memory.ts`'s independent `PREFERENCE_CONFLICT` gate (`findAutoAnswer`/
`findAutoAnswerMultiple`, fed by a flat `incomingTalkPreferenceSet`) got the same treatment at its
caller (`resolveAnswerPreferenceForTalkQuestion`) — otherwise the chatbot could auto-answer past a
mid-tree conflict manual answering would now correctly refuse.

Editor UI: the tag-talk form gets an explicit "Pair tag" checkbox (`#tag-pair-checkbox`,
unchecked/simple by default, hides `#talk-answer` entirely until checked — no more silent
divergence). The flow/survey shared question template (`addQuestionToForm`) gets a sibling "Simple
tag" checkbox next to the existing "Pair tag" one, mutually exclusive; the route editor gets the
identical pair. Product-facing term for what internal code still calls `reciprocalTagContext`:
**"Pair tag."**

Explicitly out of scope, deferred to a separate design pass: an actual drag-and-drop node/graph
canvas editor for route (the generic per-question form is extended everywhere in this pass, not
replaced); decoupling "seeds context for later questions" from the pair-tag match itself (kept
coupled, as before).

## Priority 5 — TechSupport productionization

### K7. Delegated TechSupport answers

- [x] Write the design note first: co-operator discovery, signed redirect, relayed answer,
  `answeredByDelegate` audit trail, timeouts, abuse controls, and privacy boundaries. —
  `docs/design/techsupport-k7-design-note.md` (2026-09-07).
- [x] Implement only after that design is approved. — approved (delegation-credential model;
  no in-app master phone sign-in for now) and implemented 2026-09-07. See
  `docs/completed.md` for the summary and `techsupport-bootstrap-contract.md` for the
  amended invariants. E2E: `stage2-two-user/00m-techsupport-delegate-answers.spec.ts`.

- [ ] Define production TechSupport key custody and rotation tooling.
- [ ] Package the headless/off-server TechSupport agent.

## Priority 6 — UI architecture: god-object refactor & React evaluation

### UI god-object refactor

**Status:** Issue #2 (React dependency cleanup) ✅ **DONE** in `2f0b7355`. Issue #1
(`ui-manager.ts` decomposition) is **in progress** as of 2026-08-24; extraction clusters #1
(route editor), #2 (survey statistics), #3 (application shell), and #4 (answer-preference
resolution) are complete; the current ratchet after extraction cluster #8 is 8,938 lines.
**Written:** 2026-08-18; execution plan refreshed 2026-08-23 against merged `dev.codex` after
`origin/dev.claude` was merged at `28e92eca`.
**Execution rule:** work one cohesive cluster at a time. Preserve the public `UIManager` contract,
characterize behavior before moving it, ratchet the size ceiling down after the extraction, and
run the canonical verification gate before beginning another cluster.

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

##### Issue #2 — unused React dependency graph

- **Zero `.tsx` files** in `src/`. `grep` for React imports in `src/{web,server,shared}` (excluding
  `examples`) returns **nothing**.
- All historical React usage is confined to `docs/archive/examples/gun-react/` and
  `docs/archive/examples/opencodedemo/`:
  - `docs/archive/examples/gun-react/*.js` import `react`, `react-dom`, `react-cytoscapejs`, and also
    `react-router-dom`, `react-svg`, `react-load-image` — the last three are **not** in `package.json`,
    so the demo does not even build as-is.
- `webpack.config.js:95` **excludes** `/src\/examples/` from the babel rule; the real entry is
  `./src/web/index.ts` (a non-React TS entry).
- `jest.config.js:34` **excludes** `!src/examples/**/*.js` from test collection.
- `.eslintrc` has **no** `ecmaFeatures.jsx`, no `react` plugin, no `react/jsx-*` rules.
- `styled-components` and `@testing-library/react` are referenced **nowhere** in `src/` (non-examples).
  Note: `webpack.config.prod.js:10` still has a `ProvidePlugin` entry for `styled-components` even
  though it is not a declared dependency and the active config is `webpack.config.js`.

The following `devDependencies` are therefore part of the stale React graph (exact names/versions
as of `package.json` 2026-08-18):

| Package | Version | Only used by |
|---|---|---|
| `react` | ^19.2.4 | `src/examples/` (excluded) |
| `react-dom` | ^19.2.4 | `src/examples/` (excluded) |
| `react-cytoscapejs` | ^2.0.0 | `src/examples/` (excluded) |
| `cytoscape` | ^3.33.1 | only via `react-cytoscapejs` (excluded) |
| `@testing-library/react` | ^16.3.2 | nowhere (no .tsx/.jsx) |
| `@babel/preset-react` | ^7.28.1 | `babel.config.js` line 1 |

> **Keep** (these are general TS/JS transpilation, NOT React-specific): `@babel/preset-env`,
> `@babel/plugin-transform-arrow-functions`, `@babel/plugin-proposal-class-properties`,
> `@babel/plugin-transform-class-properties`, `@testing-library/jest-dom`, `jest-environment-jsdom`.
> Do **not** remove these.

---

#### Issue #2 — Remove the unused React dependency graph  (start here: small, safe, verifiable)

> Order rationale: #2 is low-risk and independently verifiable, and it de-risks the bundle/manifest
> before the larger #1 refactor. Keep the two on separate commits.

- [x] **2.1 Freeze the evidence.** ✅ (2026-08-22) `find src -name '*.tsx'` → `0`; no react/ReactDOM imports outside the examples; no `react` in `.eslintrc`; no `@testing-library/react` usage. Confirmed. Also found `cytoscape-dagre` is dead too (missing from the table) — removed it as well.
      - `find src -name '*.tsx' | wc -l`  → expect `0`
      - `grep -rn "from ['\"]react\|require(['\"]react\|ReactDOM" src/test src/web src/server src/shared` (excl. `examples`) → expect empty
      - `grep -rn "react" .eslintrc` → expect empty
      Confirm none of the table in the Evidence section is imported outside `src/examples/`.
- [x] **2.2 Decide disposition of `src/examples/`** ✅ owner chose **archive + drop deps**: moved to `docs/archive/examples/` via `git mv` (88 files, git history preserved); note added to `docs/archive/README.md`.
      - Recommended: move `src/examples/gun-react/` and `src/examples/opencodedemo/` into
        `docs/archive/` (or a top-level `archive/`) so they are clearly historical and out of the
        active source tree; this makes the dependency removal unambiguous and future-proofs the
        "examples look like live code" confusion.
      - If the owner prefers to keep the demos in-tree, then keep the deps and **stop** — do not
        remove them. Do not do both.
- [x] **2.3 Remove the dead `devDependencies`** from `package.json` (2.2 = archive) ✅ dropped: `react`, `react-dom`, `react-cytoscapejs`, `cytoscape`, `@testing-library/react`, `@babel/preset-react`, and **`cytoscape-dagre`** (extra vs table).
      `react`, `react-dom`, `react-cytoscapejs`, `cytoscape`, `@testing-library/react`,
      `@babel/preset-react`.
- [x] **2.4 Remove `@babel/preset-react`** from `babel.config.js` (line 1) ✅ kept `@babel/env` + the transform plugins.
      the three transform plugins.
- [x] **2.5 Clean stale React hooks:**
      - `webpack.config.prod.js:10` — remove the `styled-components` `ProvidePlugin` entry (or the
        whole ProvidePlugin if it becomes empty). It references a package that isn't a dependency.
      - Verify no other `webpack.*` / `jest` / `.eslintrc` / `tsconfig*` React-specific config
        (`jsx`, `jsxFactory`, `jsxImportSource`, `emotion`/`styled-components` globals) remains.
        ✅ **DEVIATION (verified-irrelevant):** `webpack.config.prod.js` is a fully **orphaned**
        legacy config — referenced by NO build/test script (every webpack invocation uses
        `webpack.config.js`), and its `styled-components` reference sits in `externals` of an
        unrelated "ReactSimpleChatbot" UMD build, **not** a `ProvidePlugin`. It is already dead
        and out of every pipeline, so it was left untouched rather than force an edit describing
        a mechanism the file doesn't have. tsconfig/jest `src/examples/**` exclusions now resolve
        to nothing (harmless future-proof guard).
- [x] **2.6 Reinstall to sync the lockfile:** ✅ did `npm install` (deviation: lighter than the full `rm -rf` wipe, same lockfile result — npm removed 21 packages: the 7 + transitive react-dom/cytoscape tree). Also regenerated `docs/dependency-sbom.json` via `npm run sbom`.
      (this is a devDependency-only change; do **not** `npm prune --production` before any build).
- [x] **2.7 Verify:** ✅ all green (2026-08-22): `test:type` RC0, `lint` RC0, `test:unit` 1478/1478, `build:web` (bundle.js 1.3M > 500KB), `build:server` OK, live boot HTTPS :8080 serving SPA at `/` + `/health` → 200.
      `npm run test:unit` all green. Then `npm run build:web` and `npm run build:server` succeed.
      Confirm the produced `dist/web/bundle.js` is still > 500 KB and the app boots
      (`npm run dev` → health check 200).
- [x] **2.8 Commit** — done as `2f0b7355` on branch `refactor/ui-decompose-and-deps-clean`.
      `chore: remove unused React 19 dependency graph (framework-free TS UI; examples archived)`.

**Definition of done #2:** `package.json` no longer lists any React artifact; `npm ls react react-dom`
returns "empty" / not-found; the app builds and boots identically; all unit tests + type check green. ✅ **Met.** (Caveat: `npm ls react` is *not* empty — `react` survives as a react-native transitive via `helia → @libp2p/webrtc`, part of the native client, correct to keep. All *direct* React artifacts are gone; `npm ls react-dom` and each other return not-found.)

---

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
- [x] **1.6 Record progress** in `docs/completed.md` per the docs maintenance rule
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
16. Re-measure and choose cluster #9 as a separate commit-sized change; continue to defer
    `displayTalksList` until its ownership boundary is reduced.

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
authorship/architecture-prose landed. See `docs/completed.md`.)

- [ ] Consider an asymmetric/containment similarity metric for tag-based user similarity, because
  "50 of Eve's 50 tags match Adam" conveys information symmetric Jaccard/cosine may not fully
  capture. Does not block the already-shipped symmetric-metric implementation
  (`jaccardSimilarity()`/`cosineSimilarity()`, `FindSimilarIndex.topK({ metric })`). Former
  `docs/TODO_item.md`, folded in 2026-09-08.
- [ ] Later evaluate PMTiles/Protomaps for the chatroom map view if offline, self-hosted, or
  decentralized map tile distribution becomes useful; the shipped map view currently uses the
  OSM-based OpenFreeMap Liberty vector style (overridable via `IINPUBLIC_MAP_STYLE_URL`). Former
  `docs/iinpublic_map_chatrooms_todo.md`, folded in 2026-09-08.

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
