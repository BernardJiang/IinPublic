# IinPublic TODO

Last reconciled: 2026-09-19.

This file contains active work only. Completed implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`. The separate
`docs/IinPublic Identity & Key Architecture TODO.md` is a design specification and keeps its own
implementation plan.

Open issue IDs define the current execution order. The order is based on the minimum hardware
needed: finish Mac-mini-only work first, then Android, Windows, Ubuntu, combined available-hardware
scenarios, and finally unavailable/external dependencies. Run the relevant availability preflight
before every host- or device-dependent issue. When an issue is completed, move its outcome and
verification evidence to `docs/completed.md`, remove it here, and do not reuse its ID.

## Ordered active backlog

### Tier 1 — Mac mini only

- [ ] **OPEN-03 — Test Mac sleep/wake recovery.** Verify the native app retains identity,
  reconnects, and converges after real host sleep and wake. The opt-in native-app scenario and
  bounded `pmset` helper are implemented (`npm run test:e2e:macos-sleep-wake`), but this Mac's
  current user lacks the required noninteractive `pmset` sudo permission, so no physical sleep was
  requested and the real host run remains open.

- [ ] **OPEN-04 — Exercise temporary firewall isolation on the Mac test network.** Block one peer
  with scoped, automatically reverted rules; verify unaffected peers continue, then verify
  reconnect and convergence after restoring the route. Use only a safe privileged test setup. The
  opt-in native-app scenario and loopback/port-scoped PF helper are implemented
  (`npm run test:e2e:macos-firewall`) with trap-based cleanup, but this Mac's current user lacks the
  required noninteractive `pfctl` sudo permission, so no firewall rules were changed and the real
  host run remains open.

### Tier 2 — Mac mini + Android devices

- [ ] **OPEN-06 — Finish native password-free identity custody, starting with available devices.**
  Implement and physically test the Android Keystore and Apple Keychain adapters on the Mac mini
  and Android fleet, then select reviewed credential-store providers for Windows/Linux and obtain
  external review of the custody/migration boundary. Browser v3 custody, fail-closed migration,
  erase/reset integration, and Chromium/WebKit/Firefox process-restart proof are complete.

All other standalone Android and Mac↔Android matrix work is complete: logical device selection,
directional browser/app pairs, multi-phone convergence, background/foreground, force-stop/restart,
Wi-Fi interruption, and offline resynchronization are archived in `docs/completed.md`.

### Tier 3 — Mac mini + Windows PC

- [ ] **OPEN-07 — Sign the Windows release artifacts.** Select a trusted code-signing identity,
  sign the NSIS installer and installed executable, and verify the signature in the Windows
  installed-release gate.

- [ ] **OPEN-08 — Test macOS App ↔ Windows App.** Run both directions with the installed native
  applications as simultaneous live peers, including cleanup and artifact collection.

- [ ] **OPEN-09 — Test Windows sleep/wake recovery.** Verify the installed app retains identity,
  reconnects, and converges after real host sleep and wake.

### Tier 4 — Mac mini + Ubuntu PC

- [ ] **OPEN-10 — Unblock Ubuntu Playwright WebKit.** The `ubuntu-test` owner must install
  Playwright's missing system dependencies (`libavif16`/`playwright install-deps`, as appropriate)
  with sudo; then run `npm run test:e2e:ubuntu:webkit` and retain the returned report. The SSH test
  user intentionally has no passwordless sudo.

- [ ] **OPEN-11 — Test Ubuntu service/app restart recovery.** Restart the installed Ubuntu app or
  its managed service, then verify identity persistence, peer reconnection, and convergence.

### Tier 5 — Combined available hardware

These issues use two or more of the Mac mini, Android fleet, Windows PC, and Ubuntu PC. Check every
required host/device before building, installing, or starting tests; skip with an explicit reason
when a dependency is offline.

- [ ] **OPEN-12 — Connect native jobs to real CI runners.** Register and harden the Mac mini,
  Windows, and Ubuntu hosts as CI runners for their native-app jobs. Jobs must perform availability
  checks before installation or tests and retain platform artifacts on failure.

- [ ] **OPEN-13 — Enable X3 website↔native-app linking in CI.** Remove the remaining X3 skip and
  exercise the website-to-app handoff through a real native shell. Depends on OPEN-12; the
  same-device linking mechanism itself is already covered by X8.

- [ ] **OPEN-14 — Test Windows App ↔ Android.** Cover Talk/match delivery in both directions with
  the installed Windows app and a physical Android device.

- [ ] **OPEN-15 — Test macOS App + Windows App + Android together.** Verify discovery, concurrent
  participation, and convergence in one three-platform native scenario.

- [ ] **OPEN-16 — Test mixed browser engines across operating systems.** Use at least two engines
  on different operating systems rather than Chromium on every remote host.

- [ ] **OPEN-17 — Test Windows App ↔ Ubuntu App.** Use the installed Windows executable and Ubuntu
  AppImage as simultaneous live peers and verify both directions.

- [ ] **OPEN-18 — Test Android ↔ Ubuntu App.** Use a physical Android device and the installed
  Ubuntu AppImage as simultaneous live peers and verify both directions.

- [ ] **OPEN-19 — Run macOS Chromium + Windows Edge + Ubuntu Firefox.** Exercise the named browser
  engines concurrently in one Mac-controlled scenario.

- [ ] **OPEN-20 — Run the full multi-device native matrix.** Include at least two Android phones,
  the macOS app, Windows app, and Ubuntu app in one scenario, with browser peers where useful.
  Verify simultaneous joins, Talk exchange, matching, offline recovery, and a combined report.

### Tier 6 — Additional hardware and external dependencies

Do not start these until the required iPhone/nearby-transport hardware, owner access, or external
review capacity is available.

- [ ] **OPEN-21 — Add iPhone native-shell coverage.** Build an iOS shell, add clean-profile and
  automation support, and include it in the central matrix when suitable hardware is available.

- [ ] **OPEN-22 — Prototype and verify Apple Wi-Fi Aware.** On supported physical devices, test
  discovery and data paths in both iPhone→Android and Android→iPhone directions, plus same-LAN
  iOS↔Android Gun convergence.

- [ ] **OPEN-23 — Prototype BLE discovery and route upgrade.** Measure throughput, battery use,
  background behavior, and upgrade to a high-bandwidth route. Do not select BLE as a Gun data
  transport until measurements demonstrate a product need.

- [ ] **OPEN-24 — Maintain the physical-device certification matrix.** Keep at least two iPhones,
  two Android devices, and one desktop node across supported OS ranges. Cover foreground,
  background, locked-screen, normal Wi-Fi, isolated LAN, no-Internet, cellular-NAT, and mixed
  routes; record latency, throughput, battery drain, reconnect time, and forwarding bytes.
  `npm run verify:devices` validates the inventory schema; the physical run inventory is currently
  empty.

- [ ] **OPEN-25 — Complete the external transport security review.** Review cellular peer
  forwarding and BLE discovery/data transport before either is enabled by default. Track any
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
