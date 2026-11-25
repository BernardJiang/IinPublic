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
- **Health:** `test:all` runs ~28–44 min (~380 Playwright cases + ~3,600 Jest tests). Each full run
  fails a rotating 1–3 cases that pass alone (`82-tag-graph-tour`, `14-contacts-relationship`,
  taxi 05 most often), so every release currently needs a manual "load flakes only" judgement
  (OPEN-117). 1.0.285 phone smoke passed on FRD + C10.
- **Recommended order:** OPEN-112 (a) → OPEN-117 → the phone proofs in OPEN-114 / OPEN-113 / OPEN-101.

## Active maintenance queue — website and Android first

- [ ] **OPEN-117 — Load-only E2E flakes block a clean `test:all` (2026-11-24).** Each full run
  fails a different 1–3 of ~380 cases that pass alone: `82-tag-graph-tour`,
  `14-contacts-relationship`, taxi 05 (1/10 alone after 8c7c153c). Find the race behind each, as
  was done for the HR Talks-count flake (09279948), so a release no longer needs a manual
  "only load flakes" call and real regressions are not hidden among them. Likely related to the
  core queue backing up >45 s under load (OPEN-112 (a)).

- [ ] **OPEN-112 — Automatic Talk exchange, no Broadcast button (owner, 2026-11-13).** Users only
  decide which Talks are public (Broadcast On); each public Talk goes to everyone on my list
  (capped at room capacity) and the chatbot answers. Spec §6.1a. Done in code: catch-up no longer
  needs a Broadcast in the room, create/edit/switch-on offer at once, editor box is "Public",
  edits keep the choice, capture drafts start private, T1 toast on publish, button removed.
  Phone check passed 2026-11-13 on 1.0.247, C10 + FRD (native-app/42, browser twin stage2/98):
  publish → arrival 30 s with no tap → match 11 s; the other's chatbot answered a Talk with nobody
  tapping → match 49 s. Note: a question a pair already exchanged is not offered again
  (REQ-LEDGER-16), and one author reaches a person with at most 10 distinct Talks a day.
  Open: (a) when a link opens with many public Talks owed (stage5/00d: 20 at once), 1–4 sometimes
  never arrived (5 of ~12 runs, all while the machine was busy; 0 of 6 when idle). No receiving-limit
  declines were logged (`[intake]` warning added). Next: find where they stop (sender's pair log vs
  receiver's intake). 2026-11-15: an offer that failed before anything was recorded as sent (a busy
  core timing out, a storage read missing) was never made again until the next catch-up trigger; it
  is now retried with backoff (`retryOfferLater`, 5 s → 60 s, 6 tries). Not proven to be this gap:
  00d passed 6/6 (with stage2/98) and in the 2026-11-15 test:all, where no offer failed. The same
  test:all failed stage5 starter-tags on load: Fay's core requests timed out (45 s, 70 outcome
  records + 15 delivery records lost) and her shared counts with two people stayed short; it
  passes alone (8.9 min). Next: why one browser's core queue backs up over 45 s under load.
  (b) and (c) are done (`docs/completed.md`, 2026-11-24).
- [ ] **OPEN-114 — Talk exchange that scales: batched pair log, own link frames, content once
  (owner, 2026-11-14).** A tag exchange cost ~1.6 s a Talk (one signed entry per Talk per person,
  the receiver pulling each Talk node by node over the link, a fixed Gun wait on every read); under
  load it surfaced as one-sided "in common" counts. Owner design: on connect two people set up their
  pair's event chain; strangers send each other everything in one go, people met before send only
  the difference; small data goes together in one transmission; any network (cellular, Wi-Fi,
  Wi-Fi Direct, BLE); no work repeated across the many people one exchanges with.
  Done in code 2026-11-14 (spec §31.9, §31.9a, REQ-GRAPH-50..52): step 1 batched entries + the
  version in the offer + reads from Gun's graph (560350a9); steps 2–3 own link frames (`hi`, `log`,
  `ack`, `cp`, `part`, `want`/`blob`) and content blobs made once per version (ee809cc4). Unit
  benchmark: 1590 → 65 ms a Talk; 0.2 frames a Talk; intake limit counts people, not Talks (d6661891).
  Open: test:all + phones; a phone measurement; remembered local reads (20 ms a Talk) read stale
  records in stage1/04 and stage4/05 — cause not found, off;
  a BLE transport (frames already split to its size); UDP multicast for content only as an optional
  route on Android Wi-Fi (researched: not on web, iOS needs an entitlement, lossy in crowds); local
  storage is the next cost. 2026-11-15 (REQ-GRAPH-53): a Talk read once per step and passed on, a
  root-only "do I have it" check (the root is written last), folder links only for a new bucket, no
  stored blob (made again from the nodes): ~142 → ~96 reads and ~50 → ~36 writes a Talk, 65 → 62 ms
  (time is bound by chains of dependent reads, not their count).
- [ ] **OPEN-113 — Live tag statistics in Contacts, Talks and Me (owner, 2026-11-14).** One model,
  three views, all from what this device holds (people I exchanged with; no hub counts):
  - Model (`src/core/tag-graph.ts` + a pure `tag-stats`): per tag — who likes it, who passed it,
    popularity rank; per person — tags in common, similarity (shared ÷ union of liked tags), rank.
    A tag I liked counts as mine whether or not I share it (today `mine` needs an active, not
    disabled, Talk — wrong now that copies start private, OPEN-112).
  - Contacts: each person's relationship with me (in common, % alike, "#1 most like you"),
    "Most like me" order. Talks: each tag row shows likes · passes · popularity rank. Me: my tag
    rows show how many people share each and its rank.
  - Views redraw when an exchange arrives (no tap). Hard rule: no new buttons in views.
  Done in code 2026-11-14 (spec §6.1b): model + Contacts chip + Talks/Me popularity + live redraw;
  unit tests, stage5 starter-tags checks the #1 rank. Open: a phone look at the three tabs; whether
  redrawing Contacts/Me on every exchange burst disturbs someone scrolling (debounced 600 ms).
  Also done: sending/receiving animation without the Broadcast button (spec §6.1a).
- [ ] **OPEN-111 — Delivery/storage findings from the stage5 HR flake hunt (2026-11-11).**
  The HR flake itself was the Talks-tab counts, not delivery: overlapping `needTalkStats` requests
  let an older read (3 outcomes) land after a newer one (4); only the newest is shown now (20/20
  runs, was ~1 in 10). Found on the way, not fixed:
  (a) is fixed (`docs/completed.md`, 2026-11-24).
  (b) `[graph] Nearby scope projection was not recorded: storage did not acknowledge write for
  local/mine/nearby/nearby-v3/members` — 108 times in 10 HR runs, on every user. The Nearby list
  projection (2026-11-09) fails its write under e2e load; find out whether it also fails on phones.
  (c) is fixed (`docs/completed.md`, 2026-11-24).

- [ ] **OPEN-99 — PH-1 Bluetooth crash loop during the walk (2026-10-31).** From 13:08:45 the
  stack aborted every ~4 s (`startup_timer_expired`, then the Bluetooth HAL) until a reboot; no
  crash in the 30 minutes after it. Storage was fine (72% free). IinPublic's involvement is
  unknown: the planned force-stop test was not run before the reboot. Treat as an observation
  unless it recurs with a BLE-using Always mode.

- [ ] **OPEN-101 — Open DM defects from the 2026-10-31 timing session.** (a) Private saves are
  slow because every private write shares one queue and each DM rewrites and re-encrypts the whole
  conversation; FRD-L04 took 7.9 s for one write and saw repeated main-thread stalls of about 1 s.
  **Phone-free repair 2026-11-05:** native-core private writes now serialize per record instead of
  sharing one device-wide queue, so a conversation save cannot wait behind unrelated owner-private
  bookkeeping; same-record ordering is preserved. Conversation history now uses a small manifest
  plus bounded encrypted segments (32 messages by default), so the common append re-encrypts only
  the final segment instead of the whole retained history. Existing v1 envelopes migrate lazily on
  their next append, with focused migration, pruning, and bounded-write coverage.
  (b) "hi 12" (P30, 16:36; probably the slow read fixed under OPEN-102, not proven) was saved, but the mailbox refused it with `epub not found` although the
  sender had just used that key. It reached FRD only about 30 minutes later, after the direct link
  reconnected and the phones synced. The key is now passed through, posting retries 5 times, and a
  successfully decrypted mailbox wrapper seeds the DM key cache immediately; this path has not been
  re-proven on phones. Outgoing messages now show and persist sender-local `sending`, `sent`, `queued`,
  or `failed` state: `sent` means the direct channel accepted the message and `queued` means the
  mailbox accepted it; neither is presented as a recipient read receipt. (c) A received message can
  stay undecrypted. Since 2026-11-01 it shows "This message could not be decrypted." instead of raw
  `SEA{...}` (not yet on a phone). The message subscription now retries unchanged ciphertext with
  bounded backoff when its peer key arrives, and no longer lets a stale initial private-store read
  overwrite a newer live message; focused unit coverage passes. Phone proof remains. (d) P30's app died 12 s after launch at
  16:51:30 with no crash record, and a local `/health` once took about 3 s; causes unknown.
  (e) DM sessions reported `WebRTC connection replaced` around start-up. A send now follows a
  coordinated replacement connection within its original deadline instead of treating that
  internal handoff as a delivery failure; phone proof remains. (f) `getUserPub` gave up on
  the first missing peer record instead of retrying; fixed in 1.0.215 with a unit test.
  **Phone run 2026-11-11, app 1.0.246 (DMs now in the device graph, OPEN-110):** FCP-AN10 ↔ P30
  `test:android:dm` both ways, each message received exactly once; `native-app/12` (lifecycle +
  network loss, mailbox after WebRTC timeout) 3/3 on FCP; `native-app/13` three-phone offline
  catch-up and `native-app/37` match → chat passed. (a) no longer applies: ordinary DMs are not in
  the private history segments any more. (b)(c)(e) were not reproduced but were not forced either;
  (d) is still unexplained.

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
