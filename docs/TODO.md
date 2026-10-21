# IinPublic TODO

Last reconciled: 2026-10-20.

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

- [ ] **OPEN-70 — Nearby v3: personal nearby lists instead of shared Nearby rooms (proposed
  2026-10-18; design `docs/design/nearby-and-place-chatrooms.md` §3.7).** Each person keeps their own
  list of at most `C` signed cards, ranked by distance and then their own hash order, built by
  gossip; the hub keeps only statistics, a headcount pyramid and a bounded introduction sample per
  cell. Places stay rooms but are never full. Supersedes OPEN-68 and the v2 heartbeat-size problem
  below. Needs a new protocol epoch.
  - [x] Model and experiment: `src/test/support/nearby-gossip-model.ts`,
    `scripts/nearby-gossip-experiment.ts` → `docs/testing/nearby-gossip-experiment.md`; unit gate
    `nearby-gossip-personal-lists.test.ts` (host-only).
  - [x] Product owner accepts the v3 design (§3.7), including retiring the yellow map dots and
    Nearby room chat (2026-10-19). Implementation plan: §3.7 "Implementation plan".
  - [ ] **Deferred (2026-10-18; Android first):** Credit model (§3.7 "Fake accounts and reputation"; decided 2026-10-18): open reputation,
    minimum Contacts / Talks sent / Me-tab answers, fewer than N blocks; Places need backers and stay
    live only while used by enough reputable people. Each user's own app checks the rules; Settings
    → Credit shows them read-only; the hub only refuses to register Places (and count backings or
    visits) from apps without an official-build credential. Still to choose: the thresholds
    (signed-manifest values), and what website, desktop and iOS users do without platform
    attestation.
  - [ ] **Deferred (2026-10-18):** Block count: Adam's app adds one to Eve's count (only if Adam is reputable), stored without
    the blocker's identity and counted once per pair; Eve sees only the number.
  - [x] Read `C` and every v3 tunable (gossip period, cards per swap, card lifetime, hub sample size,
    incoming limits) from the signed manifest; nothing hard-coded. Changing `C` needs no epoch in v3.
    (`nearby-v3-config.ts`, 2026-10-19.)
  - [x] Phase 1 (2026-10-19): signed cards, ranking, pyramid, list with digests and gossip offers,
    the hub's counts / introductions / heat (`NearbyV3Hub`, `/api/nearby/v3/*`), and the phone's
    `NearbyV3Service` (not wired into the app yet). Tests `nearby-v3-core`, `nearby-v3-hub`,
    `nearby-v3-service`.
  - [x] Phase 2 (2026-10-19): peer link — a signed knock lets someone on my list open a session to
    me although I am not on theirs (incoming limit); gossip over the mesh DataChannel. A block stops
    Talks only, never gossip or knocks (otherwise the blocker vanishes from the blocked person's
    list at once and gives himself away).
  - [x] Phase 3: Nearby is the personal list everywhere (2026-10-19, done: `nearby-v3` scope, no hub
    roster or chat; broadcast loop with adaptive concurrency; knock on link open; unreachable people
    leave the list and come back only with a newer card; the hub introduces only phones heartbeating
    in the last two periods; all 13 phone-path journeys pass, 6.6 min vs 9.1 on v2). Web e2e suites
    and "Sent to N of M" done. Real phones: 05, 33, 37, 38, 30 (four phones) on 1.0.178–1.0.180;
    33 and 38 again on 1.0.181 (C10 + FRD, 2026-10-20); 39 on 1.0.181 above.
  - [x] No compatibility (product owner 2026-10-19: no official release yet): the v2 code is removed
    (2026-10-19; partition, cohorts and their mesh frame, control presence, micro-rooms, capacity
    splits and evictions, routing, map presence, Nearby in the room list — now Places only; server
    stores and routes; unit and web e2e tests). The web e2e run on v3 found real bugs, all fixed with
    unit tests (design §3.7 "Gossip" and "Delivering a Talk broadcast"): renamed and knock cards
    reach peers at once, announce to the three nearest, swap retry and a 15 s swap timeout, link
    failures probe instead of dropping, stale knocks, stale sessions, Talks and answers to people
    outside the list.
  - [x] Phase 4 (2026-10-19): map (green list dots, ★, heat, fitted to the list; tile grid and the
    unused browse tree removed), "People near you", "N near you · M online" (my list without me,
    then the hub's count), "Show more people here", "Sent to N of M". Web e2e `95-nearby-screens`;
    headcount specs now count the list without me.
  - [x] Phase 5 (2026-10-19): Places on lists (design §3.7 "Places in v3", "Implemented"). A Place
    is a list scoped `place:<id>` with my card at its pin; no seats, reservations or reconciliation
    (Place admission code, `place-admission-claims` and the "Nearby around a full Place" offer
    removed; the hub refuses Place roster calls with `PLACE_HAS_NO_ROSTER`); the hub's Place counts
    feed the room list and mark the Place visited; the chat feed is kept; no "Full" rooms. Found and
    fixed: knocks never crossed between phones (Gun only; now also a hub mailbox, long-polled);
    the hub kept introducing people in the list they had left, and counted a Place newcomer only
    from the next window; a Place's count lingered two windows after everyone left (now the live
    cards); a phone that went home kept its Place card while a slow swap held its tick (the runtime
    now watches its position, a refresh reissues at once and drops a card signed for a position it
    already left); an emptied Place vanished from "Places near you" behind a stale local count.
  - [x] Room-wide mesh overlay removed (2026-10-20): the rotating K window
    (`direct-talk-scheduler.ts`), `maxNeighbors`, the room-candidate FIFO, peer exchange (PEX: the
    `peer-exchange` frame, `peer-exchange.ts`, `PeerExchangeCacheStore`) and the libp2p discovery
    fallback are gone. Outside a personal list (Contacts only: a DM warm-up, a Talk's recipients)
    the mesh links to the members it was given, at most 64. `talks-matching/06` now rejoins in that
    explicit mode.
  - [x] Verified 2026-10-19 on 1.0.180: Jest 3,149; phone path 13/13 (5.8 min); web Place, room
    list and mesh specs 21/21; real phones: native-app 33 and 38 (P30 + C10), 30 on four phones
    (P30, C10, Honor FRD, PH-1; Talks 8.7–10.3 s, p50 9.6 s).
  - [x] Real phones (2026-10-19, P30 + C10, 1.0.178): native-app 05, 33, 37 and all three of 38
    pass. Found and fixed: swaps sent while the mesh was between rooms dropped live people; direct
    contact now lifts a tombstone; 🏠 from a Place never re-synced the mesh, so Nearby never came
    back. Still to run: 30 (needs four phones; reworked to read Nearby lists) and 39.
  - [x] Offline Nearby (2026-10-19): a phone that cannot reach the hub posts its card on a local
    board (`nearby-v3-local.ts`, `GunNearbyLocalBoard`: a Gun channel per level-10 cell under
    `p2p-signal`); phones read the 3×3 block around them. Real phones: native-app/30 offline over
    Wi-Fi Direct passes with the P30 + C10 (found each other in ~2 s; Talks 7.6 s / 5.7 s).
  - [ ] **Deferred (product owner 2026-10-19):** Wi-Fi Direct on the Honor FRD-L04 (Android 7): in the 3-phone offline run it never started
    offline discovery (no `[nearby-offline]` events); the other two formed a group without it.
  - [x] Daily beacon and identity-age rule (2026-10-20, design §3.7 "Daily beacon and
    identity-age rule"): the hub's attestor key signs each UTC day's beacon (`HMAC(seed, day)`) and,
    per key, the day it first saw it; cards carry the age proof; in dense ties keys seen before
    today rank first; swaps carry the beacon for phones without the hub. Unit test
    `nearby-v3-attestation.test.ts`. The production key is pinned by manifest M3 (2026-10-20, K3);
    its vault is backed up in `secrets/nearby-attestor-production.key.json` and
    `~/nearby-attestor-key.backup.json` on the VPS.
  - [x] `find-similar-people.spec.ts` hang fixed (2026-10-20): each incoming Talk queued its own
    read–merge–encrypted rewrite of the whole owner envelope; under six browsers a rewrite took
    1–7 s and the queue reached 155 s, so the seeded Talks waited past the timeout. Unchanged
    clusters also counted as changed (key order). Saves arriving during a rewrite now join the next
    one, and clusters compare key-order-free (`client-incoming-talk-mirror.ts`, unit tests). The
    spec passes in ~1 min.
  - [x] Found by the web suites (2026-10-20): a reloaded page never searched Nearby — the service
    waited for the mesh before pushing the roster that makes the mesh join (stage2/01, stage3/02;
    unit test in `nearby-v3-service.test.ts`). Stale v2 copy fixed in stage1/00.
  - [x] Incoming limits chosen (2026-10-20, 1.0.181, `docs/testing/android-transport-measurements.md`):
    a phone accepts one Talk in ~2.2–3 s, so 24 new Talks a minute from people who are not contacts
    (`IncomingTalkBudget`; an offer over it goes unanswered and the sender's outbox retries) and 8
    incoming connections. Wi-Fi and offline Wi-Fi Direct measured on the C10, FRD and PH-1.
  - [x] Mobile data and four phones on 1.0.182 (2026-10-20): cellular reconnects 5 of 5, ~4 s per
    contact, 2.7–5.6 s to accept; `native-app/30` on four phones passes (Talks p50 9.4 s).
  - Only the deferred items above (credit model, block count, FRD Wi-Fi Direct) remain.
  - [x] Implement: cards, hub statistics/pyramid/introductions, gossip, the adaptive broadcast
    loop, Places on lists, the daily beacon and identity-age rule, map/list/headcount UI (phases
    1–5 and 2026-10-20). No epoch migration: there is no v2 release to stay compatible with.
  - [x] v2 removed (2026-10-19, see "No compatibility" above).
- [ ] **OPEN-80 — Bound a big Place's chat feed (found 2026-10-20 while designing groups).** Talks
  in a Place reach at most `C` people per sender, but its chat feed (`chatrooms/<placeId>/messages`)
  is one shared Gun path that every member syncs in full, so an arena Place with 10,000 members
  carries every message to everyone. Decide: show only messages from my own group, page by
  recency, or cap the feed to `C` members; then implement with a scale test.
- [ ] **OPEN-76 — Physical transport, radio and battery measurements (carried over from OPEN-40
  G2.5 and its P1 discovery item on 2026-10-20).** The 2026-10-18/20 rounds
  (`docs/testing/android-transport-measurements.md`) cover hub, LAN, offline Wi-Fi Direct and mobile
  data. Still missing, on at least three phones: isolated BLE, a long unplugged battery run,
  duplicate bytes, scan duty cycle and battery per discovery timer (the 30 s / 10 min / 30 min
  values are untested defaults), and an online and an offline phone exchanging Talks over a nearby
  link with Wi-Fi STA + Wi-Fi Direct concurrency on PH-1, P30, C10 and Honor. Only if duplicates
  show on hardware: wire `NearbyCandidateRegistry`'s logical peer into `PeerMeshService` route
  selection. Pick the production discovery timers from the results.
  Also carried from OPEN-72: on a phone, writing the incoming cluster (~0.8 s) and
  `cacheReceivedTalk` (~0.6 s) dominate accepting a Talk, and the mesh ACK wait
  (`DEFAULT_MESH_ACK_TIMEOUT_MS`, 3 s) is shorter than a phone's ~3.7 s round trip, so a slow
  receiver gets one redundant re-flood (deduplicated). Tune with the measurements, not before.
- [ ] **OPEN-77 — Protocol release key custody (operator action, carried over from OPEN-40 on
  2026-10-20).** Place the K3 and K4 vault/passphrase pairs in separate durable offline backups,
  verify restoration, and remove the working copies from the development machine when the release
  ceremony no longer needs them. K3 signed M3 and is spent; K4 signs M4, which must commit a newly
  generated K5. Do not call custody production-ready merely because the local encrypted files exist.
- [ ] **OPEN-79 — Delegate roster watcher: read the log (from 2026-10-24; carried over from OPEN-32).**
  Read `~/IinPublic/delegate-roster-monitor.jsonl` on the VPS after several days of uptime. OPEN-32's
  root cause stays open until a `cache` line is caught; none caught means the cache keeps covering it.

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
