# IinPublic TODO

Last reconciled: 2026-09-21.

This file contains the current execution focus plus explicitly deferred open work. Completed
implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`. The separate
`docs/IinPublic Identity & Key Architecture TODO.md` is a design specification and keeps its own
implementation plan.

The current product priority is the **website and Android app**. Work on their shared web runtime,
browser behavior, Android shell, and website↔Android interoperability before any other platform.
The order below, not the numeric issue ID, defines execution priority. Do not start a deferred issue
unless it directly blocks the website/Android focus or the product owner explicitly promotes it.
Run the Android availability preflight before physical-device work. When an issue is completed,
move its outcome and verification evidence to `docs/completed.md`, remove it here, and do not reuse
its ID.

## Active execution queue — website and Android first

The balanced production-security decision is documented in
`docs/security/techsupport-and-user-production-security.md`. Implement it in this order; keep the
ordinary-user browser-v3 and Android Keystore defaults automatic and do not introduce HSM/seed
phrase complexity into normal use.

- [ ] **OPEN-27 — Remove the TechSupport root from the production browser/relay boundary.**
  Enforce keyless production-relay startup. Add a local root-control path that can issue and revoke
  short-lived delegate grants while sending only signed public records to the relay. Migrate every
  remaining rare root operation to a local signer/decrypter or offline command, then delete the
  `iinpublic_techsupport_keypair_v1` browser injection and retire the persistent root agent. Prove
  with tests that production relay startup rejects `TECHSUPPORT_KEY_FILE` and legacy plaintext-key
  configuration, invalid delegate grants are rejected, and normal website/Android support via a
  delegate does not expose the root pair.
  - [x] Fail production relay startup before reading a configured TechSupport vault or legacy key.
  - [x] Add `npm run techsupport:delegate -- issue|revoke`: signing stays in a short-lived local
    Node process and the relay receives/verifies only the signed public grant.
  - [x] Reconcile HTTP, embedded-node, live Gun, and cached grant reads monotonically: once an
    installation or relay request has observed a newer issue/revocation, an older signed record
    cannot restore authority.
  - [x] Publish signed revocations under a separate append-only discovery root and reconcile that
    history with mutable HTTP, embedded-node, live Gun, and cached state. This protects a fresh
    install from a stale mutable slot; no protocol can prove freshness if every transport withholds
    both the current record and its tombstone, so independent recovery/checkpoints remain OPEN-29.
  - [x] Reject and erase root injection in production web builds and restrict the legacy headless
    root harness to loopback development/E2E origins.
  - [x] Move production issue/revoke behind the local signer, use delegates for routine answering.
  - [ ] **Regression found 2026-09-22, first real-hardware run since the local-signer rewrite
    (`4e2dd21b`, 2026-09-21): the opt-in `09-android-techsupport-delegate-answers` physical-device
    scenario does not actually pass.** The rewrite replaced the old desktop-TechSupport-browser
    approve flow (Honor's signed request seen live over Gun, master approves in the UI — lots of
    natural wall-clock time and a real Gun live-subscription path) with a direct
    `fetch(POST /api/support/delegate-grants)` from the test process itself, mirroring
    `techsupport:delegate issue`. Root-caused on real hardware (Honor/RNV0217207000190):
    - The POST succeeds (`published.ok === true`).
    - Honor's on-device embedded-node relay is correctly configured (confirmed via `adb logcat`:
      `hub=http://<mac-lan-ip>:9078/gun`, matching the test's own hub exactly — not a
      production/test-hub mismatch).
    - A direct `fetch(apiBase + '/api/support/delegate-grants')` from Honor's own WebView, run
      manually mid-test, gets a clean `200 {"grants":[],"revocations":[]}` — the relay chain
      itself works end-to-end, but the grant is simply not there.
    - `techSupportDelegateOptedIn`/`techSupportDelegateGrant` on Honor's app never become
      truthy across 30+ seconds of 5s-interval relay polling — not a slow-sync timing issue.
    - Ruled out: this session's own OPEN-29 relay-poll addition (`fetchRecoveryAnchorFromServer`)
      — disabling it and rebuilding made no difference; the poll's delegate-grants step was
      already returning empty before that call ever runs in the same tick.
    - Likely a genuine gap in `GET/POST /api/support/delegate-grants`'s server-side
      `gunService.getSet(DELEGATE_GRANTS_ROOT)` (or the write side) specific to the *native relay
      poll* code path — 00m (the browser-only sibling scenario) never exercises this route at all,
      since a browser session relies entirely on its own live Gun `.on()` subscription instead.
      This exact server route may genuinely never have been verified end-to-end against real
      Android hardware since the rewrite.
    - Separately (and already fixed in this pass): the settings-tab menu-first drill-down
      (`3503cf13`) also broke this test's navigation to `#support-delegate-optin-toggle` — fixed
      with the same `openSettingsSection` call 00m already needed. That fix is real and necessary
      but not sufficient; the grant-visibility gap above remains open.
  - [ ] Remove `iinpublic_techsupport_keypair_v1`, `dev:techsupport`/root-agent injection, and every
    production code path that exposes `priv`/`epriv` to page JavaScript.

- [ ] **OPEN-29 — Add an independent emergency recovery authority.** Single offline recovery key
  (product owner decision 2026-09-22 — a solo-operator deployment doesn't yet justify an M-of-N
  threshold; the anchor-list-based design extends to one later without breaking clients). A real
  recovery keypair is generated and pinned (`techsupport-trust-anchors.json`'s `recovery`
  section) — its private half must still be moved to genuinely offline/cold storage before this
  is production-ready; it currently sits in this dev machine's `secrets/` (gitignored) for
  testing.
  - [x] `src/shared/techsupport-recovery.ts`: `RecoveryAnchorRecord` (revoked dm/announcement
    pubs + a next dm/announcement pub, one global record, no expiry — trust changes only by a
    newer signed record), sign/verify, and `isRecoveryAnchorRollback` (strictly-newer-only,
    mirroring `isDelegateGrantRollback`'s monotonic discipline).
  - [x] `isTrustedDmPubWithRecovery` / `isTrustedAnnouncementPubWithRecovery`: an explicit
    revocation wins even over the compiled trust-anchor list; a `next*Pub` extends trust to a pub
    the compiled list doesn't contain. Wired into `verifyFaqBundle` and `verifyDelegateGrant` /
    `isTrustedTechSupportAuthorPub` as an optional, additive parameter — every pre-existing call
    site keeps its exact prior behavior unless it opts in. A delegate grant issued by a
    since-revoked master stops authorizing its delegate immediately (found and fixed a real bug
    here during review: the delegate-grant fallback path was initially recovery-unaware and would
    have silently bypassed a revocation).
  - [x] Distribution: `GET`/`POST /api/support/recovery` (mutable current slot + append-only
    history root, same monotonic-reconciliation shape as OPEN-27's delegate-grant hardening),
    embedded-hub-relay-client passthrough for native devices, client-side cache/subscription
    (`techsupport-recovery-cache.ts`) wired into `app.ts`'s boot sequence and relay poll.
  - [x] `scripts/techsupport-recovery-tool.js` (`npm run techsupport:recovery -- generate|publish|
    status`) — genuinely separate encrypted vault and passphrase env vars from the DM tool;
    decrypts only in a short-lived local process; publishes only the signed public record.
    Verified: real generate → real encrypted vault → real signed dry-run record (recoveryPub
    matches the compiled anchor) against a live embedded-node server.
  - [x] Unit tests (19, `techsupport-recovery.test.ts`) covering sign/verify/rollback and the
    actual security property end to end; integration tests (`system-routes.test.ts`) for the
    routes; CLI arg/passphrase/publish tests (`techsupport-recovery-tool.test.js`); regression
    tests in `techsupport-faq-bundle.test.ts` proving the revocation-bypass bug above stays fixed.
  - [ ] A real live HTTP publish round trip (beyond the dry-run) wasn't proven in this session —
    hit an unresolved local networking quirk (TCP connects, HTTP hangs up) specific to that test
    session, not a code issue given every other layer (unit, integration via supertest against
    the real route handlers, and the dry-run signing path) passed. Re-verify with a real publish
    against a real deployment before relying on this in an actual incident.
  - [ ] Cross-client "stale cache / installed Android version catches up" scenario has no E2E
    coverage yet — only unit/integration. The mechanism (client-side monotonic cache +
    HTTP-relay poll, identical in shape to the already-E2E-tested OPEN-27 delegate-grant
    hardening) gives reasonable confidence, but this is asserted, not demonstrated end to end.
  - [ ] No UI surfaces a recovery event to the master operator (e.g. an audit/warning banner) —
    today it's a `console.warn` on the client and whatever `npm run techsupport:recovery --
    status` reports. Low priority: this is an emergency operator tool, not routine UI.

- [ ] **OPEN-30 — Harden website release integrity and the browser execution boundary.** Treat CSP
  as defense in depth rather than private-key custody.
  - [x] Remove CSP `scriptSrc: 'unsafe-eval'` (`src/server/bootstrap/http-bootstrap.ts`). Verified
    against the current dependency set (webpack `devtool` is `source-map`, never
    `eval-source-map`; the built bundle's only `new Function(...)` call is webpack's own benign
    `__webpack_require__.g` global-object shim, which falls back to `window`; MapLibre GL JS
    compiles style expressions to a safe interpreter, not `eval`) and confirmed live: the
    embedded-node server booted under the tightened policy, the app loaded, and the chatroom map
    view rendered (MapLibre worker + WebGL init included) with no CSP-violation console errors.
    No dev-only carve-out was needed — `npm run dev`'s split webpack-dev-server never goes through
    this Express/helmet CSP at all, only the embedded-node/production/desktop path does.
  - [x] "Untrusted content cannot become executable markup" already has real, if scattered, unit
    coverage (`conversation-message-cards.test.ts`, `chatroom-message-view.test.ts`, etc. assert
    `<script>`/`onerror=` payloads are neutralized) on top of the codebase's `escapeHtml` rendering
    convention (52 files). Not yet a single consolidated audit/test across every rendering surface
    (stage names, delegate labels, FAQ content, ...) — worth doing but not urgent given existing
    coverage.
  - [x] Release-integrity checks: published `SHA256SUMS` per release. `npm run build:embedded`
    writes `dist/web/SHA256SUMS`; `scripts/stage-app-download.mjs` writes
    `public/downloads/SHA256SUMS` for desktop installers + the Android APK. Both are
    `sha256sum -c`-compatible. `npm run release:verify-checksums -- --dir <path>` or
    `-- --base-url <origin>` re-hashes and reports any mismatch/missing file — verified live
    against a running embedded-node server, including that it actually catches a tampered file.
  - [ ] Turn the point-in-time `release:verify-checksums` check into an always-on monitor (cron/CI
    scheduling it against the production origin, alerting on failure) — not built; a manual or
    externally-scheduled check for now.
  - [ ] Subresource Integrity on `index.html`'s script/style tags — a stronger, browser-enforced
    complement to the checksum manifest (a tampered `bundle.js` would fail to execute at all, not
    just fail a later human check), deferred as separate build-pipeline work.

OPEN-13 and the website/Android portion of OPEN-06 were completed on physical Android hardware on
2026-09-20; evidence is in `docs/completed.md`.

All other standalone Android and Mac↔Android matrix work is complete: logical device selection,
directional browser/app pairs, multi-phone convergence, background/foreground, force-stop/restart,
Wi-Fi interruption, offline resynchronization, and Android Keystore custody are archived in
`docs/completed.md`.

## Deferred open issues — not in the current execution queue

The following IDs remain open for traceability, but website/Android work takes precedence. Do not
start them unless they become a direct blocker or are explicitly promoted.

### TechSupport identity protocol

- [ ] **OPEN-28 — Split TechSupport authority by role (deferred).** Introduce a versioned identity
  protocol with separate offline root/delegation authority, support DM/decryption operator keys,
  and a limited announcement signer. Give each role a distinct trust anchor, rotation window, and
  compromise procedure; do not make the online announcement role capable of reading questions,
  issuing delegates, or signing identity continuity. Deliberately deferred by the product owner
  2026-09-22: OPEN-27/29/30 must not depend on this, and it adds real protocol complexity (a new
  versioned identity format, more trust-anchor categories) that isn't worth taking on yet.

### macOS-native host testing

- [ ] **OPEN-03 — Test Mac sleep/wake recovery (deferred).** The opt-in native-app scenario and
  bounded `pmset` helper are implemented (`npm run test:e2e:macos-sleep-wake`), but this Mac's
  current user lacks the required noninteractive `pmset` sudo permission. No physical sleep was
  requested.

- [ ] **OPEN-04 — Exercise temporary Mac firewall isolation (deferred).** The opt-in scenario and
  loopback/port-scoped PF helper are implemented (`npm run test:e2e:macos-firewall`) with
  trap-based cleanup, but this Mac's current user lacks noninteractive `pfctl` sudo permission. No
  firewall rules were changed.

### Other desktop platforms

- [ ] **OPEN-07 — Sign the Windows release artifacts (deferred).** Select a trusted code-signing
  identity, sign the NSIS installer and installed executable, and verify the signature in the
  Windows installed-release gate.

- [ ] **OPEN-10 — Unblock Ubuntu Playwright WebKit (deferred).** The `ubuntu-test` owner must install
  Playwright's missing system dependencies (`libavif16`/`playwright install-deps`, as appropriate)
  with sudo; then run `npm run test:e2e:ubuntu:webkit` and retain the returned report. The SSH test
  user intentionally has no passwordless sudo.

### CI infrastructure

- [ ] **OPEN-12 — Connect native jobs to real CI runners (deferred).** Register and harden the Mac
  mini, Windows, and Ubuntu hosts as CI runners for their native-app jobs. Jobs must perform
  availability checks before installation or tests and retain platform artifacts on failure.
  Android-targeted X3 acceptance should run locally first; CI scheduling is not a prerequisite for
  OPEN-13.

### iOS, nearby transports, certification, and external review

Do not start these until the required iPhone/nearby-transport hardware, owner access, or external
review capacity is available and the issue is promoted after the website/Android queue.

- [ ] **OPEN-26 — Complete other-platform custody adapters and review (deferred).** Accept the
  Xcode license, compile and run the existing iOS Keychain adapter (`AppleCustodyBridge.swift`),
  select reviewed credential-store providers for Windows/Linux, and obtain the external custody
  security review. The website and Android custody boundary is complete under OPEN-06.

- [ ] **OPEN-21 — Add iPhone native-shell coverage (deferred).** Build an iOS shell, add
  clean-profile and automation support, and include it in the central matrix when suitable
  hardware is available.

- [ ] **OPEN-22 — Prototype and verify Apple Wi-Fi Aware (deferred).** On supported physical
  devices, test discovery and data paths in both iPhone→Android and Android→iPhone directions,
  plus same-LAN iOS↔Android Gun convergence.

- [ ] **OPEN-23 — Prototype BLE discovery and route upgrade (deferred).** Measure throughput,
  battery use, background behavior, and upgrade to a high-bandwidth route. Do not select BLE as a
  Gun data transport until measurements demonstrate a product need.

- [ ] **OPEN-24 — Maintain the physical-device certification matrix (deferred).** Keep at least two
  iPhones, two Android devices, and one desktop node across supported OS ranges. Cover foreground,
  background, locked-screen, normal Wi-Fi, isolated LAN, no-Internet, cellular-NAT, and mixed
  routes; record latency, throughput, battery drain, reconnect time, and forwarding bytes.
  `npm run verify:devices` validates the inventory schema; the physical run inventory is currently
  empty.

- [ ] **OPEN-25 — Complete the external transport security review (deferred).** Review cellular
  peer forwarding and BLE discovery/data transport before either is enabled by default. Track any
  remediation as new ordered issues.

## Deferred product decisions

These are deliberately outside the execution order above. Promote one to a new `OPEN-nn` issue
only when it receives an owner and product scope.

1. **DEFERRED-01 — Multiple identities/profile switching on one device.**
2. **DEFERRED-02 — Durable person identifier for linked-device clusters.**
3. **DEFERRED-03 — Cross-device aggregation policy** for contacts, blocks, conversations, Q&A,
   credit, and reputation; v1 remains mutual-link/display merge only.
4. **DEFERRED-04 — Precise-location sharing** as an explicit opt-in feature.
5. **DEFERRED-05 — Talk bridging through a middle person.** Discovery gossip and configurable
   mesh forwarding remain v1; content bridging remains v2.
6. **DEFERRED-06 — Geographic/topic DHT indexes** after privacy and enumeration review.
7. **DEFERRED-07 — Advanced v2 relay guarantees, incentives, and accounting.**
8. **DEFERRED-08 — BLE Gun data transport** only after OPEN-23 demonstrates measured need.
9. **DEFERRED-09 — Broader public-image graph** beyond Me-tab Q&A and contextual
   credit/reputation.
10. **DEFERRED-10 — React Native/Expo product effort.** The measured React DOM pilot was rejected;
    native presentation work requires a separate owner, budget, and migration plan.
11. **DEFERRED-11 — Enterprise TechSupport custody controls.** Consider HSM/KMS-backed signing,
    hardware tokens, threshold/two-person approval, centralized monitoring, and formal external
    audit only when product scale, staffing, regulation, or measured threat level justifies their
    operating cost. OPEN-27 through OPEN-30 must not depend on these controls.

## Verification rules

1. Put E2E specs in the lowest stage with enough users and add a companion `.md` explanation.
2. Assert durable state or stable UI signals, not transient toasts.
3. If a test exposes a product bug, fix the product rather than weakening the assertion.
4. Check platform availability before installation, build, or test work.
5. Move completed work to `docs/completed.md` immediately and retain its validation evidence.

## Nightly jobs

- `npm run health`
- `npm run test:e2e:parallel`
- `npm run test:e2e:heavy`
- `npm run test:e2e:mesh`
