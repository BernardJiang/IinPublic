# Android transport measurements

Measured with `tests/e2e/native-app/39-android-transport-measurements.spec.ts` on real phones. Raw
results: `test-results/android-measurements/<mode>-<time>.json` (not committed). Covers the transport
slice of OPEN-40-G2.5, the discovery-timer physical gate, and OPEN-70's per-contact cost.

Phones: P30 (VOG-L29, Android 10, SIM), C10 tablet (Android 14), Honor FRD (Android 7), all on one
home Wi-Fi; the PH-1 sat out the long runs (bad battery). Each mode ran 5 fresh reconnects per
pair, one Talk loop per phone (one receiver at a time, then all at once), a Talk to the C10 after
5 minutes in the background, and a 15-minute idle window.

## 2026-10-18, build 1.0.168

| | hub + LAN | hub only | Wi-Fi Direct, hub unreachable | mobile data (P30 on SIM) |
|---|---|---|---|---|
| Phones | P30, C10, FRD | P30, C10, FRD | P30 (owner), C10 | P30, C10, FRD |
| Discovery: every roster complete | 2.3 s | 2.0 s | 13.2 s (group 11.4 s) | 4.1 s |
| Discovery: every pair's encrypted link confirmed | 2.4 s | 2.0 s | 17.5 s | 8.1 s |
| Fresh WebRTC connection p50 / p95 | 0.97 / 1.37 s | 1.52 / 1.77 s | none succeeded (OPEN-74) | 2.30 / 2.87 s |
| Fresh connections failed | 3 of 15 | 4 of 15 | 5 of 5 | 2 of 15 |
| Candidate types | host/host | host/host | – | srflx, prflx and relay with the SIM phone; host/host on Wi-Fi |
| Talk delivery p50 / p95 | 3.3 / 6.8 s | 3.7 / 6.1 s | 2.2 / 36 s | 3.9 / 6.5 s |
| Talks lost | 0 of 12 | 0 of 12 | 0 of 4 | 0 of 12 |
| Sender time per contact, one at a time (p50) | 3.6 s | 3.3 s | 0.6 s | 3.6 s |
| Talk to the C10 after 5 min in the background | 0.38 s | 0.37 s | 0.37 s | 0.35 s |
| Idle 15 min, P30: Wi-Fi bytes | 63 MB | 12 MB | 0.3 MB | – |
| Idle 15 min, estimated mAh (P30 / C10 / FRD) | 72 / 48 / 94 | 37 / 43 / 68 | 9 / 39 / – | 10 / 38 / 55 |
| Idle 15 min, CPU seconds (C10 / FRD) | 836 / 765 | 682 / 646 | 375 / – | 597 / 574 |
| Discovery-state changes while idle (P30) | 0 | 0 | 3 | 12 (offline-quiet ↔ offline-searching) |

How to read it:

- **Battery** is Android's per-app estimate with charging hidden (`dumpsys battery unplug`); the
  phones stay on USB, so it is the model's estimate, not measured drain. The P30 (Huawei) reports
  near-zero app CPU time and the C10/FRD report no per-app network bytes on this path, so those
  cells are missing.
- **Delivery** includes the receiver accepting the Talk. One Talk to one phone over LAN took
  ~3.8 s end to end on 1.0.166: 0.7 s for the sender's outbox writes, 0.9 s for the receiver's
  announcement check, 2.4 s for its body handling (OPEN-72 cut that to 1.45 s in 1.0.167), and the
  sender's 3 s ACK wait timed out before the ACK came.
- **Idle cost** is the largest problem found (OPEN-73): an idle phone kept most of a CPU core busy.

## 2026-10-18, build 1.0.169 (idle-polling fixes, OPEN-73)

| | hub + LAN (P30, C10, FRD) | mobile data, both SIM phones (P30, PH-1) + C10 on Wi-Fi |
|---|---|---|
| Discovery: every roster / every encrypted link | 2.5 s / 2.5 s | 3.7 s / 7.4 s |
| Fresh WebRTC connection p50 / p95 (failed) | 0.72 / 1.94 s (2 of 9) | 2.24 / 2.66 s (0 of 9) |
| Talk delivery p50 / p95 | 3.9 / 7.4 s | 3.9 / 6.9 s |
| Talk to the backgrounded C10 (1 min) | 0.35 s | 0.38 s |
| Idle, P30: Wi-Fi bytes | 57 MB / 15 min (63 before) | – |
| Idle, estimated mAh (P30 / C10 / FRD) | 61 / 38 / 86 per 15 min | PH-1 16 per 5 min |
| Idle, CPU seconds (C10 / FRD) | 847 / 719 per 900 s (836 / 765 before) | – |
| Idle, PH-1 mobile data | – | 1.9 MB per 5 min (~23 MB/h) |

The 1.0.169 fixes cut the page's idle requests on the host from ~550 to ~190 per 2 minutes, but
they did **not** reduce the phones' idle CPU or LAN traffic: the busy thread is the embedded node
(`Thread-3`), and LAN mode still adds ~45 MB per 15 minutes over hub-only. The next step is a
profiler or event-loop counters inside the embedded node (OPEN-73).

The two SIM phones on the same carrier connected host-to-host; the pairs with the Wi-Fi tablet used
relay, srflx and prflx candidates.

## 2026-10-19, builds 1.0.170–1.0.174 (OPEN-73 idle cost)

Profiling (`E2E_MEASURE_PROFILE=1`) showed the idle cost was not one hot loop but constant churn:
every phone's embedded node sent ~230 writes a minute to `chatrooms/<room>/users/<id>` and
`chatroomMembers/<room>/<id>`, because mirroring the hub roster rewrote every member with a fresh
`lastSeen` on every sync (a 5 s poll per room plus each member-list request). Gun replicated each
write to the hub, the other phones and every subscribed page. Fixed in 1.0.172
(`RelayMemberTouchThrottle`): a mirrored member is rewritten only when new, changed, or older than
60 s — 14 writes a minute. 1.0.173–1.0.174 slow the mailbox, TechSupport and delegate polls while
the app is paused (MainActivity now tells the page; its WebView kept reporting "visible").

Idle 15 minutes, P30 / C10 / FRD on LAN with the hub, nothing happening:

| Build, screen | P30 mAh | P30 Wi-Fi data | C10 CPU s | FRD CPU s | FRD mAh |
|---|---|---|---|---|---|
| 1.0.168, on | 72 | 63 MB | 836 | 765 | 94 |
| 1.0.172, on | 20 | 9.2 MB | 407 | 446 | 38 |
| 1.0.172, off | 20 | 8.9 MB | 323 | 526 | 46 |
| 1.0.174, off | 12.7 | 5.0 MB | 201 | 469 | 31 |

With profilers on (1.0.172, 60 s), the embedded node's thread fell from 23–30 % to 12–17 % of a core;
the WebView renderer stayed at 24–32 % with the screen on (map drawing). Fresh reconnects: 13 of 15
succeeded on 1.0.173; the failures are each pair's first reconnect, as in earlier runs (OPEN-74).
The C10's per-app mAh is unreliable (2–3 mAh at 200–320 CPU s); read its CPU seconds.

## 2026-10-20, build 1.0.181 (OPEN-73 pollers and map, OPEN-74 reconnects)

The P30 was off USB, so hub + LAN ran on the C10 and the Honor FRD, and offline Wi-Fi Direct on the
C10 (owner) and the PH-1 (client; shorter windows for its battery). Profilers on, screens on.

| | hub + LAN (C10, FRD) | Wi-Fi Direct, hub unreachable (C10, PH-1) |
|---|---|---|
| Fresh WebRTC connections that succeeded | 5 of 5 (0.90–1.24 s) | 5 of 5 (4.8–6.0 s); none of 5 on 1.0.168 |
| Sender time per contact, one at a time | 4.0–4.2 s | 3.8–4.1 s |
| Receiver: one Talk accepted after | 3.0–3.2 s | 2.4–2.7 s |
| All at once (one receiver), until received | 2.2–2.3 s | 2.2–2.3 s |
| Idle CPU seconds per 15 min | C10 174 (407 on 1.0.172), FRD 215 (446–469 on 1.0.172–174, 765 on 1.0.168) | C10 ~195 (65 per 5 min; 375 on 1.0.168) |
| Embedded node, 60 s profile | 95 % idle on both; ~50 requests a minute (mailbox 6, delegate grants 3–4) | – |
| C10 page, 60 s profile (map on screen) | 56 of 60 s idle | – |

- **OPEN-74** fixed: the phone that answered offers applied a fresh offer to its old connection,
  which refuses a new DTLS identity; it now answers on a fresh connection, and an answering phone
  that rebuilds asks for a new offer. Unit test `p2p-session-fresh-offer.test.ts`; journey
  `phone-path/07b`.
- **Incoming limit** chosen from the receiver times above: a phone accepts one Talk in ~2.2–3 s, so
  `incomingTalksPerMinute` is 24 (Talks from people who are not contacts; an offer over the limit is
  left unanswered and the sender's outbox offers it again). `incomingConnections` stays 8.

## 2026-10-20, build 1.0.182 (P30 back; production attestor key pinned)

No profilers, screens on, 15 minutes idle (mobile data: 5).

| | hub + LAN (P30, C10, FRD) | hub only (P30, C10, FRD) | mobile data (P30 on SIM, C10 on Wi-Fi) |
|---|---|---|---|
| Fresh WebRTC connections that succeeded | 15 of 15 (0.5–4.8 s) | 15 of 15 (0.9–1.8 s) | 5 of 5 (3.1–7.6 s) |
| Sender time per contact, one at a time | – | – | 3.8–4.2 s |
| Receiver: one Talk accepted after | – | – | 2.7–5.6 s |
| Talk to the backgrounded C10 | – | – | 0.35 s |
| Idle, P30 Wi-Fi bytes | 14.7 MB (63 MB on 1.0.168) | 8.4 MB | – |
| Idle, estimated mAh (P30 / C10 / FRD) | 28 / 38 / 20 (72 / 48 / 94 on 1.0.168) | 15 / 38 / 17 | – |
| Idle, CPU seconds (C10 / FRD) | 279 / 289 (836 / 765) | 238 / 274 | – |

LAN mode now adds ~6 MB per 15 minutes over hub only (~50 MB on 1.0.168). Four phones
(`native-app/30`, P30 + C10 + FRD + PH-1): Talks p50 9.4 s, p95 10.2 s (9.6 s on 1.0.180).

## 2026-10-22, build 1.0.187 (OPEN-76 radio and duplicate accounting)

The harness now records content-free commanded and native duty/start counters for LAN NSD, BLE
advertising, BLE scanning and Wi-Fi Direct discovery, plus mesh frame/byte counts, duplicate frames,
accepted Talk bodies and duplicate Talk bodies. Debug-only intent/query overrides exercise shortened
discovery schedules without changing production defaults. Deterministic policy tests cover the
production 30-second window, 10-minute offline cap and 30-minute online cap.

Isolated BLE used the P30, C10 and PH-1 with the hub unreachable and LAN and Wi-Fi Direct disabled.
Every phone observed both other phones specifically through BLE in 120.2 seconds. Native result
counts were 368 / 59 / 318 (P30 / C10 / PH-1); there were no mesh frames or Talk bodies, confirming
that BLE remains discovery-only. An accelerated 5-second scan, 5–10-second backoff schedule exercised
the physical open/quiet transitions; production-length energy qualification belongs to the unplugged
owner run.

The mixed run kept the P30's validated hub route over Wi-Fi STA while the C10 and PH-1 had
unreachable hubs and all three shared Wi-Fi Direct. The coexistence assertion passed before Talks
were sent.

| Metric | Three-phone mixed result |
|---|---|
| Wi-Fi Direct group / every roster / encrypted mesh | 0.30 s / 0.38 s / 4.70 s |
| Fresh connection p50 / p95 (failed) | 2.42 s / 3.79 s (0 of 3) |
| Talk delivery p50 / p95 | 2.71 s / 21.70 s |
| Receiver deliveries lost | 0 of 12 |
| Mesh frames sent / received | 306 / 306 |
| Mesh bytes sent / received | 479,655 / 479,655 |
| Duplicate frames / duplicate Talk bodies | 0 / 0 |
| Accepted Talk bodies | 12 (four per receiving phone) |
| Native BLE advertiser starts (P30 / C10 / PH-1) | 4 / 2 / 1 |
| Native BLE scan starts (P30 / C10 / PH-1) | 35 / 2 / 1 |

The counters changed two decisions:

- Replaying an unchanged native BLE presence command no longer restarts advertising, and changing
  only the scan state leaves the advertiser intact. On the P30 this reduced advertiser starts from
  67 to 4 over comparable ~200-second mixed runs.
- The 3-second mesh ACK timeout stays unchanged. Even with a 21.7-second tail delivery there were
  no duplicate frames or duplicate Talk bodies, so increasing the timeout would add latency without
  evidence of avoided retransmission. The candidate registry is not wired into mesh route selection
  because hardware showed no duplicate routes.

The online phone still received repeated native scan commands (35 starts in ~225 seconds) even
though the policy requested one continuous scan. A follow-up two-phone diagnostic reproduced this
on the C10 (13 starts in ~94 seconds), ruling out checkpoint replay; speculative lifecycle changes
were reverted. Keep the 30-second / 10-minute / 30-minute production policy unchanged and use the
owner's long unplugged run to determine the real energy impact before changing discovery behavior.

### OPEN-70 Honor closeout: FCP-AN10 offline Wi-Fi Direct

The deferred Honor gate was rerun on app 1.0.187 with the supported Honor FCP-AN10 (Android 16),
P30 (Android 10) and C10 (Android 14). The hub was deliberately unreachable and LAN discovery was
disabled. The P30 formed one credentialed 5 GHz group (`5765 MHz`); the Honor and C10 joined as
clients, and all three personal Nearby lists contained both other phones.

| Metric | Result |
|---|---|
| Complete `native-app/30` journey | passed in 3.0 min |
| Ring Talks (Honor → P30 → C10 → Honor) | 6.541 s / 6.751 s / 5.821 s |
| Background delivery to Honor | 9.504 s |
| Talk delivery p50 / p95 | 6.541 s / 9.504 s |
| Wi-Fi Direct topology | P30 owner; Honor + C10 clients |
| Nearby list coverage | 2 of 2 peers on every phone |

The old Honor FRD-L04/Android 7 limitation remains a device/OS capability boundary, but the new
Honor FCP replacement passes the supported Honor qualification. After the run, the group was
removed, Wi-Fi restored, the current 1.0.187 build retained, and all three screens were put to sleep.

## What the runs found and fixed

- **OPEN-71** (1.0.166): after a reconnect a pair could stay "connected" but exchange nothing, from
  a late handshake on the previous channel. On 1.0.165 four of six pairs never delivered and a
  backgrounded phone got its Talk only after reopening (75 s); on 1.0.166+ every Talk arrived and
  backgrounded delivery is ~0.4 s.
- **OPEN-72** (1.0.167–1.0.168): every incoming Talk asked the hub twice whether either side blocked
  the other (~0.9 s each on a phone).
- **OPEN-73** (1.0.169–1.0.174): idle polling and roster rewrites; idle cost down ~80 % on the
  P30 and C10, ~40 % on the FRD.
- **OPEN-74** (1.0.181): fresh reconnects never succeeded over an offline Wi-Fi Direct group, and
  each pair's first one failed online; 5 of 5 succeed in both modes now.

## 2026-10-27 — online Wi-Fi Direct BLE scan churn fixed

The P30/C10 mixed-nearby run reproduced the previously unexplained churn on the merged 1.0.199
build: the online P30 requested two scan periods but started the native scanner 19 times in
197.2 seconds. Its final requested state was scanning, but the native scanner was stopped.
`NearbyOfflineService.tick()` applied the online-member policy; `advertise()` immediately applied
the older rule that every group member stops scanning. Each following tick repeated the conflict.

Advertisement refresh now preserves the policy used by `tick()`: online group members scan for
offline peers; offline group members stop scanning. Regression tests reproduce both owner and
client cases and verify that losing the hub still stops scanning in a group. All 67 discovery and
offline-service unit tests pass.

The corrected APK passed the same P30/C10 mixed-nearby journey, with 3 native P30 scan starts in
201.8 seconds, two requested periods, and a final active scanner matching the requested state.
Both runs delivered all four Talk bodies, with zero duplicate accepted bodies. The corrected run's
single fresh connection took 1.396 seconds; delivery p50/p95 was 3.393/5.474 seconds. These are
small bench samples, not a throughput or battery-drain qualification. Frame duplicates remained
observable and were deduplicated; the ACK timeout and production discovery timers are unchanged.

Raw records (local, uncommitted):
`test-results/android-measurements/mixed-nearby-2026-10-27T16-25-45-232Z.json` and
`test-results/android-measurements/mixed-nearby-2026-10-27T20-41-59-830Z.json`.
The baseline briefly overlapped an aborted background-test setup on a third phone; its counters
demonstrate the scan conflict, but its transport timings are not a controlled performance baseline.
The corrected run used the selected P30/C10 pair alone. Both APK SHA-256 values are retained in
`test-results/four-phone-2026-10-27/`. No real unplugged energy result is claimed.

## 2026-10-28 — four-phone convergence after the native Gun migration

The merged 1.0.199 build repeatedly discovered all four LAN peers but lost Nearby entries after
failed encrypted handshakes, before any ring Talk was sent. The repaired build passed
`native-app/30` on P30, C10, PH-1 and Honor FRD-L04 in 3.7 minutes. Every phone retained all three
peers, with zero failed gossip swaps at the final snapshot. All four ring Talks arrived in
15.322 / 10.922 / 13.070 / 11.620 seconds; the C10 background delivery took 10.260 seconds.
The group round trip and online query passed. Counters recorded 286 sent and 286 received mesh
frames, zero duplicate frames and zero duplicate accepted Talk bodies. This is a small functional
bench sample, not a throughput or energy comparison.

The investigation produced these fixes:

- Handshake contact-key checks read the owner's private pinned identity directly, avoiding an
  unrelated full public-profile/reputation lookup while preserving rejection on a changed key or
  unavailable private store.
- Closing a connection cancels its connect timeout/poll; reopening a cached answering session
  requests a fresh offer. Coordinated Wi-Fi Direct switches still suppress redundant requests.
- SDP creation, remote description handling and callbacks stay bound to their original peer
  connection. Delayed old work can no longer publish an old offer under a new offer id, send a
  duplicate answer on the replacement, or cause its real answer to be ignored.
- Callback-free `RemoteGun.put()` calls no longer hold an HTTP connection waiting for an unused
  storage acknowledgement. The RPC returns after submitting the write to the device Gun; callers
  that provide callbacks retain acknowledgement/error reporting. A six-write regression reproduced
  six held requests before the fix. PH-1 startup timings also showed ~8-second Gun RPC server waits
  and ~7.2–7.4-second queue delays for core/signaling requests. The change removes that unnecessary
  wait for ephemeral signaling writes; it does not bypass acknowledged writes or encryption.

The earlier private-pin/timer/reopen candidates alone did not pass the four-phone gate. The final
hardware pass contains both the SDP guards and callback-free RPC correction, so this report does
not attribute all improvement to either in isolation. A C10/PH-1/FRD three-phone run also passed in
3.0 minutes before the full run. All 39 focused RPC, signaling, session, ledger and encryption tests
passed, together with TypeScript, targeted lint and the ARM64 APK build. The real-Gun subscription
regression additionally verifies delivery of a callback-free write.

Local evidence: `test-results/four-phone-2026-10-28/four-phone-nearby-evidence.json`,
`ring-gun-fixed-four/`, `ring-gun-fixed-three/` and `gun-fixed-apk.sha256`. The intermediate
`ring-handshake-trace` run was interrupted by P30 USB disconnection and is not a qualification run.
The production discovery timers and mesh ACK timeout remain unchanged.

## Not measured yet

- A long unplugged battery run (real drain, not the model estimate).
- Total per-app network bytes on devices whose Android batterystats omit them.
- The per-contact cost at scale: the loop here has two or three receivers. For OPEN-70's 498-contact
  loop, the sender's ~3.5 s per contact must overlap (adaptive concurrency), and each receiver's
  ~1.5 s of processing per Talk bounds how many Talks a phone can take in.
