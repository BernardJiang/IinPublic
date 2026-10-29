# IinPublic TODO

Last reconciled: 2026-10-29.

This file contains the current execution focus plus explicitly deferred open work. Completed
implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`. The separate
`docs/IinPublic Identity & Key Architecture TODO.md` is a design specification and keeps its own
implementation plan.

Actions that require the product owner, physical handling, privileged host changes, credentials or
an outside reviewer are mirrored in `docs/OWNER-TODO.md`. This file remains the canonical issue
record.

The current product priority is the **website and Android app**. Work on their shared web runtime,
browser behavior, Android shell, and website↔Android interoperability before any other platform.
The order below, not the numeric issue ID, defines execution priority. Do not start a deferred issue
unless it directly blocks the website/Android focus or the product owner explicitly promotes it.
Run the Android availability preflight before physical-device work. When an issue is completed,
move its outcome and verification evidence to `docs/completed.md`, remove it here, and do not reuse
its ID.

## Active execution queue — website and Android first

- [ ] **OPEN-91 — Device core: one Gun, one copy of the app logic, a thin GUI (adopted
  2026-10-25).** Design: `docs/design/device-core-architecture.md`; privacy rules:
  `docs/design/data-sharing-privacy-rules.md`. On every native app (Android, Windows, Ubuntu, macOS,
  iOS) one Gun instance and all app logic live in the embedded Node.js process; on the web they live
  in a background worker; the GUI only draws from an in-memory view model and sends intents. The
  same `src/core/` TypeScript runs in both hosts. The original page-hosted layout had two Gun
  instances and ~25 localStorage logs (the S3 design drifted). Phases, each shippable: P1 the core
  seam + the exchange log (OPEN-88); P2 the sharing policy (default-deny `out`/`in` filter; pair
  responses and the delivery journal move under it to prevent hub-visible reply relationships);
  P3 the other local logs; P4 the domain logic out of `app.ts`; P5 the native host runs the core;
  P6 one Gun on the web. **P1 done 2026-10-25** (OPEN-88, see `docs/completed.md`): `src/core/`
  holds the protocol, the graph store, the exchange log and the web worker host
  (`core-worker.js`, replacing `public/worker.js`). **P2 first slice done 2026-10-25:** the
  sender's response copy and delivery journal moved into the core (`local/`), and the page's Gun runs
  the sharing policy's `out` filter; spec 09 fails on any private soul on the hub wire.
  **P2 boundary hardening implemented 2026-10-28:** unknown namespaces are denied in both
  directions, with explicit compatibility entries for existing protocols. Network input is filtered
  before Gun can merge it into storage; signed private answer memory and private links are blocked
  too. Pair/room content requires SEA ciphertext envelopes; violations increment content-free
  counters. **Inbound subscriptions enforced 2026-10-29:** local reads grant bounded record/subtree
  permissions; unsolicited nodes and sibling fields are dropped before storage. Remote GETs cannot
  authorize writes; cancelled listeners lose permission before their first callback too. One-shot
  reads retain a 30-second late-reply window. **Pair/room relay audience enforced 2026-10-29:**
  only configured hub connections carry these encrypted Gun namespaces; unbound LAN peers cannot
  request or receive them, and public records to those peers lose pair/room links. Legacy shared
  roots retain their old protocols and still require migration and audience review. Remaining P2:
  compatibility migration, legacy audiences and sharing-setting enforcement.
  **P3 started 2026-10-26:** keyed collections in the core (`src/core/collections.ts`, GUI view
  `core-collection-view.ts`, views in `core-views.ts`);
  chatbot templates and My Talks moved (specs read `window.__iinpublic_collection('myTalks')` and
  edit via `__iinpublic_collection_edit`; seeding the old blob still works — it is imported) and
  My Conversations (`my-conversations-storage.ts`) and the talk ledger (one entry per record,
  `<section>::<key>`), the Me tab's answer history, the deal maps, and the answer preferences
  and chatbot memory (`answer-preferences-storage.ts`, via `mapStore`/`sectionedDocStore`).
  **P4 rules extraction done 2026-10-26:** the domain rules live in
  `src/core/` (see the design doc's P4 entry for the module list); `app.ts` keeps the effects
  (10,272 → 9,863 lines). **The move off localStorage done 2026-10-26:** the remaining app data is
  the core's `appData` collection (`appStorage`), settings and UI state its `settings` collection
  (`settingsStorage`, localStorage kept as a start-up copy); only identity custody, legacy/fallback
  Gun page storage and the user id / cached user (mirrored to IndexedDB) stay in localStorage.
  **P5.1–P5.3 implemented 2026-10-26, merged 2026-10-27:** the native embedded node hosts the
  core and its one Gun; the WebView uses authenticated loopback core/Gun RPC, migrates its worker
  data, and shuts down that worker. iOS retains the web-worker fallback until its shell supplies
  the node secret. **P6 single-worker Gun implemented 2026-10-26, merged 2026-10-27:** the web
  worker's Gun peers with the hub and the page uses `RemoteGun` over messages. Outbound filtering
  now covers private namespaces, private links, acknowledgement payloads and reconnect mesh sends.
  **P6 origin ownership implemented 2026-10-28:** tabs share a named SharedWorker, with a
  Web Locks/BroadcastChannel owner when dedicated workers are needed. Request IDs, subscriptions
  and login state belong to each tab; ownership/session replacement restores login and listeners
  without blindly retrying writes. Browser startup fails closed if safe storage cannot start;
  `?pageGun=1` remains an explicit diagnostic layout. The native migration worker stays isolated.
  Stage1/96 covers concurrent records, per-tab logout/subscriptions, owner closure and persisted
  edits across Chromium, Firefox and WebKit; spec 09 now captures SharedWorker sockets and requires
  a public probe from both participants before accepting its privacy result.
  **P5.4 first host commands implemented 2026-10-29:** ledger mutation/quota decisions serialize
  across GUI sessions. Response commit assigns CID/version, checks completeness/retraction, and
  stores encrypted per-recipient copies, journal and ledger before returning a sendable payload.
  Unacknowledged writes now fail. These are ordered writes, not an atomic multi-record transaction.
  Retries preserve `sent`/receipt journal states instead of resetting them to `committed`.
  Validation: 228 focused unit tests; all 12 stage1/96 Chromium/Firefox/WebKit cases; wire09 and
  two ledger UI regressions; native37 Talk→answer→match→P2P chat on C10/PH1 (2.1 minutes).
  **Remaining:** P2 compatibility migration, legacy audiences and sharing settings; P5.4 host
  execution of encryption, transport/fanout, chatbot, Nearby and conversation effects, plus live
  views replacing cached GUI decisions.

- [ ] **OPEN-81 — Match collection outings: prepare Talks, walk through a mall or ride transit,
  collect replies, then review the few people who matter most (started 2026-10-20).** The transport
  is substantially ready (multiple OUT Talks, Nearby v3, delayed mailbox replies, Android offline
  links and background mode), but the product still treats the activity as unrelated broadcasts,
  replies and Contacts. The shipping gate is one continuous, resumable workflow with an honest
  summary and useful ranking. Do not call the use case ready from the 498-person simulation alone:
  physical qualification currently covers four phones, including the native background agent, but
  literal walking/transit qualification is still outstanding.
  - [x] **G1 — Durable outing identity and evidence (first slice, 2026-10-20).** Add a bounded,
    versioned local collection-session store; snapshot the active scope, selected Talk ids and
    blurred public point; associate each intended peer + Talk delivery with the active outing; keep
    late match/mismatch/ignore results attached after Stop or process restart; stamp the existing
    local exchange projection with the collection id. Focused unit tests cover delayed replies,
    receiver narrowing, repeated encounters and corrupt storage.
  - [x] **G2 — One Start/Stop collection control (2026-10-21).** Put the control beside the current Nearby/Place
    group, show elapsed time / people reached / replies / matches, restore an active outing after a
    restart, and make Broadcast clearly feed it. Starting a new outing ends the previous one; Stop
    freezes the send/location context but continues accepting late replies.
    The restored card now reports elapsed/reached/replies/pending/matches, has a primary Broadcast
    action using the existing audited send path, and opens the latest outing review. Starting a new
    outing still ends the previous one; late replies continue to attach after Stop.
  - [x] **G3 — Correct place and time semantics (2026-10-21).** Snapshot a freshly confirmed, privacy-blurred
    location at send time rather than relying on `Talk.authorLocation` from Talk creation; retain
    distance-at-encounter; handle indoor/no-GPS and subway movement without pretending the reading
    is precise; define when a moving outing rolls to a new area. Each send now records GPS,
    traveler, Place or unavailable explicitly; only the public snapped cell is stored. Encounter
    distance uses the peer's public Nearby card, and a changed public cell starts a new area segment
    inside the same outing.
  - [x] **G4 — Materialized outing review (2026-10-21).** Add a collection detail screen with reached, pending,
    matched, mismatched and late counts; preserve repeated peer + Talk outcomes instead of the
    current latest-only `peerId::talkId` projection; link each person to their replies and chat;
    allow pin, dismiss and private notes. Review preserves the repeated outcome timeline, exposes
    late/location evidence, links each row to the existing replies + DM view, and persists local-only
    pin/dismiss/note state.
  - [x] **G5 — Importance-aware ranking (2026-10-21).** Let the author mark Talks/questions as important or
    must-have, then rank within this outing by must-have failures, weighted answer strength,
    matched-Talk breadth, trust/relationship, distance-at-encounter and freshness. Reuse the
    weighted `find-similar` primitives rather than the Contacts tab's current fixed relevance
    formula. Explain the top reasons and never silently hide candidates. Talk and question editors
    now persist Normal/Important/Must-have weights; outing ranking uses shared `matchScore`, hard
    failures, breadth, relationship history, blurred encounter distance and freshness. The default
    review includes every person and explains its leading signals; pin/dismiss are explicit.
  - [x] **G6 — Real background collection (2026-10-21, code gate).** Move the minimum receive/match/outbox/session work out
    of the Android WebView into the foreground-service path, survive screen-off and process death,
    reconcile without duplicate outcomes, and disclose vendor battery restrictions. "Always" mode
    must resume the exact active outing; "While open" must say collection is paused.
    - [x] The reviewed boundary is now implemented: Android keeps approved policy in a
      Keystore-encrypted store, reads the SEA pair through an app-internal custody method (never the
      new WebView bridge), and provisions a bearer-protected loopback processor in the embedded
      foreground node. It decrypts Talk mailbox bodies/responses, enforces room/intake/contact/age/
      block policy, uses only exact pre-approved auto-answers, durably relays the response outbox,
      classifies matches and binds late responses to the snapshotted outing.
    - [x] Reconciliation is encrypted, persistent and idempotent: the native processor journals
      before mailbox acknowledgement; WebView resume replays through the existing Talk/ledger
      handlers and acknowledges only completed events. The active room, outing associations and
      policy survive ordinary Android process recreation. Rejected/blocked mail is consumed rather
      than waking repeatedly; unsupported non-Talk mail remains for the foreground UI.
    - [x] Product disclosure distinguishes **Always — background Talk exchange** from **While open —
      pauses in background**, states that a persistent notification is used, and warns that vendor
      battery savers can still delay/stop delivery unless unrestricted battery use is allowed.
      Host SEA-cycle, authorization, durable-relay, policy, mailbox-relay and packaged-mobile gates
      pass. Physical screen-off/process-death bench paths now pass on P30, C10, PH-1 and Honor
      FRD-L04 (2026-10-28); carried-field and real vendor battery behavior remain open under G7.
  - [ ] **G7 — Qualification gate.** Add a deterministic 498-person model for ranking and storage,
    a 10–20 simulated-client outing, and physical Android runs for walking movement, subway/no-GPS,
    Wi-Fi ↔ cellular ↔ offline transitions, screen-off, restart, delayed replies and repeated
    encounters. Keep the existing four-phone test, but do not use it as the crowd-scale claim.
    - [x] Deterministic host gates (2026-10-21): 498-person delivery/storage/review and a 16-client
      moving outing with pending, cold-start, delayed and repeated cases
      (`match-collection-scale.test.ts`, `match-collection-outing-model.ts`).
    - [x] Automated physical Android bench matrix (2026-10-21, app 1.0.187): P30/C10/PH-1
      Wi-Fi-off catch-up; P30 cellular-only ↔ C10 Wi-Fi; four-phone online ring; and a C10 receiver
      with Activity closed, screen off, forced Doze and killed process. Android restarted the
      foreground service, returned the exact approved encrypted answer in 5.727 s after the outing
      had stopped, and WebView resume reconciled it exactly once. See
      `docs/testing/android-match-collection-g7.md`. **2026-10-28 regression:** repaired native
      Gun RPC acknowledgement stalls and connection-replacement races; the 1.0.199 four-phone
      ring (3.7 min) and P30/C10/PH-1 offline catch-up (2.6 min) pass again. Native screen-off
      process recovery, late reply and exact replay pass with all four phones as receivers:
      P30 6.153 s, C10 5.626 s, PH-1 6.313 s, Honor FRD-L04 5.895 s. Every run retains one
      outing result, the exact whole-Talk/selected-tag responder identities and zero pending events.
    - [ ] Carried field gate: literal walking movement, a transit/subway route with genuine no-GPS,
      physical repeated encounters and broader vendor battery behavior. Fixed coordinates, radio
      toggles and simulated reconnects do not qualify those real-world conditions.
  - [ ] **G8 — Adoption and abuse edges.** Measure the cold-start case where receivers lack saved
    auto-answers, add actionable pending states, carry the completed starter credit/block-count
    policy into launch review, and treat iOS as unsupported until its native background/discovery
    work is qualified.
    - [x] Cold-start pending pairs are measured in the 16-client model; review has a default-visible
      **Needs follow-up** filter and opens the person's existing replies/chat directly.
    - [x] The OPEN-70 starter credit/block-count defenses are complete: 12 distinct incoming Friend
      marks, fewer than three received blocks, one lifetime Place, and continuing lifecycle checks.
      Optional stronger Place defenses remain a separate owner decision; iOS remains unsupported
      until its separate native qualification exists.
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
  - [x] **Automatable A — Measurement harness:** add per-provider scan-window/duty-cycle counters,
    logical-delivery and wire-byte/duplicate accounting, timer overrides, and retained JSON evidence.
  - [x] **Automatable B — Physical bench matrix:** on at least three attached phones, isolate BLE
    discovery, exercise 30 s / 10 min / 30 min schedules, and run online↔offline Talk exchange with
    Wi-Fi STA + Wi-Fi Direct concurrency across PH-1, P30, C10 and Honor where supported.
    Completed on P30, C10 and PH-1 on 2026-10-22. The supported Honor FCP-AN10 closeout then passed
    the complete three-phone offline Wi-Fi Direct journey with P30 and C10 (ring Talks plus Honor
    background delivery); the old Honor Android 7 remains unable to join a credentialed group. The
    hardware run used accelerated windows while deterministic tests cover the production 30 s /
    10 min / 30 min caps.
  - [x] **Automatable C — Tune from evidence:** select production discovery timers and adjust the
    mesh ACK timeout only if the measurements justify it; wire `NearbyCandidateRegistry` route
    selection only if duplicate hardware routes are observed.
    Retained 30 s / 10 min / 30 min and the 3 s ACK: 306 sent and 306 received frames produced zero
    duplicate frames and zero duplicate Talk bodies, so neither ACK inflation nor route-selection
    wiring is justified. Native idempotence reduced P30 BLE advertiser starts from 67 to 4 per
    ~200 s mixed run. **2026-10-27 follow-up:** fixed conflicting scan policies in the discovery
    tick and advertisement refresh. The P30/C10 mixed-nearby bench passed with native P30 scan
    starts reduced from 19 to 3 over comparable ~200 s windows; all four Talk bodies arrived
    without duplicate accepted bodies. Both online owner/client regression tests pass. This
    removes the repeated scan-toggle defect, but does not establish real unplugged energy use;
    timers and the ACK timeout remain unchanged. See the transport report for limitations.
  - [x] **Automatable D — Regression/reporting:** add focused deterministic tests, rerun the relevant
    Android matrix, and append the measurements and limitations to the transport report.
  - [ ] **Owner action:** perform the long unplugged battery run after the automated harness is
    ready; procedure and acceptance evidence are tracked in `docs/OWNER-TODO.md`.
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
