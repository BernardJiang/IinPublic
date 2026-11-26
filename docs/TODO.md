# IinPublic TODO

Last reconciled: 2026-11-24.

This file contains the current execution focus plus explicitly deferred open work. Completed
implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`. The separate
`docs/IinPublic Identity & Key Architecture TODO.md` is a design specification and keeps its own
implementation plan.

Actions that require the product owner, physical handling, privileged host changes, credentials or
an outside reviewer are mirrored in `docs/OWNER-TODO.md`. This file remains the canonical issue
record.

The current product priority is **bug fixes and improvements to the website and Android app**.
Pause new features and broad architecture work. Work on the shared web runtime, browser behavior,
Android shell, and website↔Android interoperability only where they address a verified defect,
reliability, performance, privacy, or release-readiness issue. The order below, not the numeric
issue ID, defines execution priority. Do not start paused or deferred work unless it directly
blocks this maintenance focus or the product owner explicitly promotes it.
Run the Android availability preflight before physical-device work. When an issue is completed,
move its outcome and verification evidence to `docs/completed.md`, remove it here, and do not reuse
its ID.

## Current status (2026-11-24)

- **Release:** 1.0.286 is live — deployed to iinpublic.com, tagged `release-v1` (32974e1c), and in
  Google Play Closed testing (Alpha) awaiting review. The website offers the release APK beside the
  Play .aab. **Since `release-v1` all changes stay local** (owner, 2026-11-24): commit only; no push,
  tag, deploy, Play or APK upload until the owner says otherwise.
- **Architecture is closed:** device core (OPEN-91), device graph (OPEN-106), signed event chain,
  trimming and the four tabs from the log (OPEN-108..110). The priority is bug fixes and
  improvements to existing website and Android features — no new features.
- **Health:** `test:all` runs ~23.5 min (~390 Playwright cases + ~3,600 Jest tests). Three clean
  runs in a row on 2026-11-24/25 after the 82 race fix (OPEN-117 closed). Debug 1.0.288 release
  smoke passed on P30 + C10 (2026-11-25).
- **Recommended order:** watch OPEN-99 in later phone runs; the rest of the queue is paused or deferred.

## Active maintenance queue — website and Android first

- [ ] **OPEN-99 — PH-1 Bluetooth crash loop during the walk (2026-10-31).** From 13:08:45 the
  stack aborted every ~4 s (`startup_timer_expired`, then the Bluetooth HAL) until a reboot; no
  crash in the 30 minutes after it. Storage was fine (72% free). IinPublic's involvement is
  unknown: the planned force-stop test was not run before the reboot. Treat as an observation
  unless it recurs with a BLE-using Always mode.
  **2026-11-25 (debug 1.0.289, PH-1 back on USB):** no Bluetooth abort on the PH-1 in 3 × native-app/43
  on four phones and a 30-min screen-off soak (crash buffer empty, 146k logcat lines). The soak did
  not load its radio much: offline, the PH-1 advertised once and stopped; only the P30 advertised
  throughout, restarting its advertiser 26 times in 31 min (a new payload per id rotation). New
  evidence: the C10's own Bluetooth stack (`com.android.bluetooth`) aborted 6 times 11-16..11-24
  on vendor-HAL assertions (`LE_CREATE_CONNECTION_CANCEL` ×2, `LE_ENERGY_INFO`,
  `LE_SET_EXTENDED_ADVERTISING_ENABLE` ×2 — "is the HAL sending commands, but not handling the
  events"). IinPublic opens no LE connections; whether its advertiser restarts reach those HALs is
  unproven. Possible hardening: change the advertised data in place (`AdvertisingSet
  .setAdvertisingData`, API 26+) instead of stop/start per rotation.
  **Hardening (debug 1.0.291):** on Android 8+ the presence beacon is one advertising
  set (`BlePresenceAdvertisingSet.kt`, loaded by name for Android 7's verifier) whose data is
  replaced in place; a refused update starts it over; Android 7 keeps the old path. Same air
  format (legacy, non-connectable, ~250 ms, medium power). Phones, offline 20 min: P30 and PH-1
  each 1 advertise start and 2 in-place updates (two 15-min id rotations), each saw the other's
  current id within 3 s and both earlier ids; no Bluetooth crash. Diagnostics now report
  `bleAdvertise.updates` / `inPlace`. The C10 and FRD start no beacon offline, by design: the C10
  had no Nearby-devices permission after the spec's data reset, and the FRD (Android 7) cannot join
  a group by credential, which the beacon requires. Keep OPEN-99 open as an observation; close it if
  no PH-1/C10 Bluetooth abort appears in later runs.

## Paused implementation and field qualification — track, but do not start new features

OPEN-103/OPEN-104 and OPEN-81's remaining adoption work are paused under the maintenance-only
direction. Fix an existing privacy or correctness defect if it is verified; otherwise leave their
remaining implementation scope parked. OPEN-76/77 remain open release or evidence tasks, not
active feature development.

- [ ] **OPEN-103 — OPEN-91 follow-on: sharing-policy compatibility migration and legacy audiences.**
  Complete the deferred P2 scope: migrate historical graph copies, review legacy shared roots and
  audiences, and enforce sharing settings consistently at the compatibility boundary without
  reopening hub-visible private relationships.

- [ ] **OPEN-104 — OPEN-91 follow-on: host-owned domain effects and live host views.**
  Complete deferred P5.4 scope by moving GUI-owned effects (encryption scheduling, transport/fanout,
  chatbot, Nearby, conversation side effects) into host commands and replacing cached GUI decisions
  with complete live host-backed view semantics across web/native windows.

- [ ] **OPEN-81 — Match collection outings: prepare Talks, walk through a mall or ride transit,
  collect replies, then review the few people who matter most (started 2026-10-20).** The transport
  is substantially ready (multiple OUT Talks, Nearby v3, delayed mailbox replies, Android offline
  links and background mode), but the product still treats the activity as unrelated broadcasts,
  replies and Contacts. The shipping gate is one continuous, resumable workflow with an honest
  summary and useful ranking. Do not call the use case ready from the 498-person simulation alone:
  physical qualification currently covers four phones, including the native background agent, but
  literal walking/transit qualification is still outstanding. G1–G6 and the finished parts of
  G7/G8 are in `docs/completed.md` (2026-11-24); only the items below remain.
  - [ ] **G7 — Qualification gate.** Add a deterministic 498-person model for ranking and storage,
    a 10–20 simulated-client outing, and physical Android runs for walking movement, subway/no-GPS,
    Wi-Fi ↔ cellular ↔ offline transitions, screen-off, restart, delayed replies and repeated
    encounters. Keep the existing four-phone test, but do not use it as the crowd-scale claim.
    - [ ] Carried field gate: literal walking movement, a transit/subway route with genuine no-GPS,
      physical repeated encounters and broader vendor battery behavior. Fixed coordinates, radio
      toggles and simulated reconnects do not qualify those real-world conditions.
      **2026-10-31 walking attempt, app 1.0.207, not passed:** P30 + PH-1 carried, FRD-L04 left at
      home. `walk-out` matched both peers within seconds; both encounters stayed in one outing
      with no duplicates, and the outing survived an app restart. Limits: the owner ended the
      outing mid-run (13:08:08) and it was reopened by editing its record over USB; `walk-return`
      took 10 minutes; journey-bob's `walk-late` reply never arrived, with the PH-1 rebooted and
      its app opened by hand during that step; distance walked and GPS loss were not recorded.
      See OPEN-99; OPEN-95, OPEN-96 (closed 2026-11-11 on phone journeys, no walk), OPEN-97, OPEN-98, OPEN-100 and OPEN-102 are complete. Rerun after OPEN-96. Transit remains not run.
  - [ ] **G8 — Adoption and abuse edges.** Measure the cold-start case where receivers lack saved
    auto-answers, add actionable pending states, carry the completed starter credit/block-count
    policy into launch review, and treat iOS as unsupported until its native background/discovery
    work is qualified.
- [ ] **OPEN-76 — Physical transport, radio and battery measurements (carried over from OPEN-40
  G2.5 and its P1 discovery item on 2026-10-20).** The 2026-10-18/20 rounds
  (`docs/testing/android-transport-measurements.md`) cover hub, LAN, offline Wi-Fi Direct, mobile
  data, isolated BLE, duplicate accounting, provider duty counters, and online↔offline Talk exchange
  with concurrent Wi-Fi STA + Wi-Fi Direct on three supported phones. The only remaining gate is the
  owner's long unplugged battery run; Android's USB-attached battery model cannot substitute for it.
  Also carried from OPEN-72: on a phone, writing the incoming cluster (~0.8 s) and
  `cacheReceivedTalk` (~0.6 s) dominate accepting a Talk, and the mesh ACK wait
  (`DEFAULT_MESH_ACK_TIMEOUT_MS`, 3 s) is shorter than a phone's ~3.7 s round trip, so a slow
  receiver gets one redundant re-flood (deduplicated). Tune with the measurements, not before.
  Automatable parts A–D are done (`docs/completed.md`, 2026-11-24).
  - [ ] **Owner overnight run, 2026-10-31 23:17 to 2026-11-01 10:11 (11 h 54 min, 1.0.217): not a
    pass.** No active hour was run (screen on 3 to 4 min per phone). P30 gave no result: Huawei
    scheduled power off (about 00:30, back about 08:00), so the app was gone by morning. PH-1: 89%
    to 83%, same process alive, awake 12.5%, app CPU about 3 min, Bluetooth scanning for the whole
    run, gauge unreliable (bad battery). FRD: 91% to 50% (3.4% an hour, about 1,200 mAh), same
    process alive, awake 63%, app CPU 2 h 27 min, wake locks only about 12 min, about 23,000
    wakeups, led by GPIO23 (12,857) and Wi-Fi receive; deep Doze only about 58 min. Node on the FRD
    kept polling all night while PH-1 stayed asleep. How much of the FRD drain is the app is
    unproven: it needs a control night with the app stopped. Rerun on P30 with the schedule off,
    and on the FCP. Also seen: bursts of Gun `chain not yet supported` dumps in the Node log (about 5 to
    7 MB on FRD and PH-1 at the 10:12 wake-up). Likely cause, not reproduced:
    `sweepTransientSignalGraph` deletes `p2p-signal` parent nodes that open chains still hold, so
    gun.js line 642 replays their links with no state. A delegate-invite lookup that finds nothing
    now answers 204 instead of a logged 404.
  - [ ] **Owner daytime run, 2026-11-01 about 10:52 to 17:22 (6.5 h, 1.0.217): not a pass.** No
    active hour again (screen on 3 to 9 min), and the FRD app was not stopped, so no control. C10:
    63% to 55% (1.2% an hour), app alive until 17:23:06. P30: 89% to 82% (1.1% an hour), but the app
    only ran about 15 min, so that is close to a no-app figure; last log 11:04:46, cause unknown, no
    crash record. PH-1: 92% to 80% (1.8% an hour), alive. FRD: 47% to 20% (4.2% an hour), alive,
    awake about 63% again. FRD also lost charge on the USB hub, so it needs a wall charger.
    **Crash found and fixed (source only, not on a phone yet):** C10 Node exited with status 7 on
    `send ENETUNREACH 224.0.0.251:5353`: bonjour-service throws mDNS send errors unless given an
    error callback. `LanGunDiscovery` now passes one. The error reaches logcat (tag `nodejs`) but
    not `node-stdio.log`, and Android then delayed the service restart by over an hour.
  - [ ] **Owner action:** perform the long unplugged battery run after the automated harness is
    ready; procedure and acceptance evidence are tracked in `docs/OWNER-TODO.md`.
- [ ] **OPEN-77 — Protocol release key custody (operator action, carried over from OPEN-40 on
  2026-10-20).** Place the K3 and K4 vault/passphrase pairs in separate durable offline backups,
  verify restoration, and remove the working copies from the development machine when the release
  ceremony no longer needs them. K3 signed M3 and is spent; K4 signs M4, which must commit a newly
  generated K5. Do not call custody production-ready merely because the local encrypted files exist.

OPEN-13 and the website/Android portion of OPEN-06 were completed on physical Android hardware on
2026-09-20; evidence is in `docs/completed.md`.

All other standalone Android and Mac↔Android matrix work is complete: logical device selection,
directional browser/app pairs, multi-phone convergence, background/foreground, force-stop/restart,
Wi-Fi interruption, offline resynchronization, and Android Keystore custody are archived in
`docs/completed.md`.

## Deferred open issues — not in the current execution queue

The following IDs remain open for traceability, but website/Android work takes precedence. Do not
start them unless they become a direct blocker or are explicitly promoted.

### Android distribution channels

- [ ] **OPEN-119 — Exchange transport and storage beyond OPEN-114 (deferred, new work).** Split out
  of OPEN-114 when it closed (2026-11-25). A BLE transport (link frames are already split to its
  size); UDP multicast for content only, as an optional route on Android Wi-Fi (researched: not on
  web, iOS needs an entitlement, lossy in crowds); local storage as the next cost.
  Remembered local reads: settled 2026-11-25 — the off-by-default `remembersReads` (answered repeat
  reads from Gun's own graph objects, which Gun changes and `.off()` deletes) was replaced on
  2026-11-21 by the RAM node cache (`cacheInRam`, own copies, evicted on any write), on in every
  host; the unused option was removed.

- [ ] **OPEN-115 — Website APK and Play install cannot replace each other (deferred).** Since
  2026-11-24 every release offers the signed `.apk` on iinpublic.com beside the Play `.aab`. Both
  use `applicationId "com.iinpublic.app"`, but the website copy is signed with
  `secrets/android-release.keystore` and the Play copy with Google's managed app-signing key, so a
  phone with one installed rejects the other (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) until it is
  uninstalled, which loses that phone's local identity, keys and contacts unless it was linked to
  another device first. Options (`docs/guides/DEPLOY_PRODUCTION.md`, "Android distribution channel
  strategy"): a separate `applicationId` for the website build (plan A), a guided device-link
  migration before switching (plan B), or uploading our own key to Play so both copies share one
  certificate. Deferred by the product owner 2026-11-24.
  **2026-11-25 owner decision: the website offers Play's own signed universal APK** (same
  certificate as the Play install). Done locally: `npm run release` no longer publishes our APK;
  `npm run release:website-apk -- <universal.apk> [--dry-run]` checks the Play signing certificate
  (`PLAY_APP_SIGNING_CERT_SHA256`), package, version and 16 KB alignment, then publishes it
  (`docs/guides/DEPLOY_PRODUCTION.md`). Checked on this Mac with the debug APK (wrong cert and
  wrong version refused, dry run passes).
  2026-11-26: the Play app signing certificate's SHA-256 (from Play's `deployment_cert.der`,
  `secrets/certificates/`, RSA 4096, `75:18:82:C3:…:F3:C0`; ours is `6b35ab4b…`) is built into the
  script, and with no path it takes `~/Downloads/<versionCode>.apk`. Dry run on Play's real 1.0.286 "Signed, universal APK" passes. It found two fixes:
  Play adds a v3.2 hybrid post-quantum (ML-DSA) signer for SDK 37+ that apksigner cannot read on a
  JDK before 24 (the script then verifies up to SDK 36 and says so), and a "Source Stamp Signer"
  line that is not an app signer. Left: after the next release's `.aab` upload, download the universal APK
  and run `npm run release:website-apk`; the 1.0.286 website APK (our key) moves once by device link (plan B).

### TechSupport identity protocol

- [ ] **OPEN-28 — Split TechSupport authority by role (deferred).** Introduce a versioned identity
  protocol with separate offline root/delegation authority, support DM/decryption operator keys,
  and a limited announcement signer. Give each role a distinct trust anchor, rotation window, and
  compromise procedure; do not make the online announcement role capable of reading questions,
  issuing delegates, or signing identity continuity. Deliberately deferred by the product owner
  2026-09-22: OPEN-27/29/30 must not depend on this, and it adds real protocol complexity (a new
  versioned identity format, more trust-anchor categories) that isn't worth taking on yet.

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

- [ ] **OPEN-26 — Complete other-platform custody adapters and review (deferred).** The iOS
  Keychain adapter (`AppleCustodyBridge.swift`) compiles since 2026-11-25 (a type error in `read`
  fixed) and passes `npm run check:apple-custody` (iOS type-check + the real handler against the
  macOS Keychain, 13 checks). Still to do: run it in an iOS shell (OPEN-21), select reviewed
  credential-store providers for Windows/Linux, and obtain the external custody security review.
  The website and Android custody boundary is complete under OPEN-06.

- [ ] **OPEN-21 — Add iPhone native-shell coverage (deferred).** Build an iOS shell, add
  clean-profile and automation support, and include it in the central matrix when suitable
  hardware is available.

- [ ] **OPEN-22 — Prototype and verify Apple Wi-Fi Aware (deferred).** On supported physical
  devices, test discovery and data paths in both iPhone→Android and Android→iPhone directions,
  plus same-LAN iOS↔Android Gun convergence.

- [ ] **OPEN-23 — Prototype BLE discovery and route upgrade (deferred).** Measure throughput,
  battery use, background behavior, and upgrade to a high-bandwidth route. Do not select BLE as a
  Gun data transport until measurements demonstrate a product need.
  **Android measurements 2026-11-25 (debug 1.0.291, C10 Android 14 + PH-1 Android 10, offline):**
  discovery from a cold launch: beacons on 15–25 s after launch (app start), each phone saw the
  other 0–9 s after both beacons were on (one 26 s), 3 runs. Background: with Nearby "while the
  app is open" (the default) the screen going off stops discovery by design (beacons 1–2 % of
  30 min); with "Always" both beacons ran the whole 30 min screen-off (C10 211 scan results, saw
  the PH-1 2 s before the end; the PH-1's page last saw the C10 179 s before the end although its
  radio counted 1,341 results — one sample, maybe the WebView throttled while the screen was off).
  Battery (C10 on USB, `batterystats` estimate, 30 min screen-off): the app 4.4 mAh with the beacon
  off, 3.3 mAh with it on all the time — mostly the node's wakelock; the beacon's own cost is below
  the estimate's noise (~7–9 mAh/h ≈ 0.2 %/h of 5000 mAh). A real drain number needs an unplugged
  run. Route upgrade: native-app/30 offline (`E2E_NEARBY_OFFLINE_WIFI_DIRECT=1`, 2 phones) passed —
  found over BLE only, the PH-1 hosted a Wi-Fi Direct group, the C10 joined by credential, Talks in
  3.2–5.5 s (p50 4.3 s), background delivery OK. Not measured: BLE data throughput (no BLE data
  transport; DEFERRED-08), iPhone.

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
