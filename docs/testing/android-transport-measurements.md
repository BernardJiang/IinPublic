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

## What the runs found and fixed

- **OPEN-71** (1.0.166): after a reconnect a pair could stay "connected" but exchange nothing, from
  a late handshake on the previous channel. On 1.0.165 four of six pairs never delivered and a
  backgrounded phone got its Talk only after reopening (75 s); on 1.0.166+ every Talk arrived and
  backgrounded delivery is ~0.4 s.
- **OPEN-72** (1.0.167–1.0.168): every incoming Talk asked the hub twice whether either side blocked
  the other (~0.9 s each on a phone).
- **OPEN-73** (1.0.169, partly): idle polling through the embedded node.
- **OPEN-74** (open): fresh reconnects never succeed over an offline Wi-Fi Direct group.

## Not measured yet

- Isolated BLE (no mode turns off every other discovery path).
- A long unplugged battery run (real drain, not the model estimate).
- Duplicate bytes per delivery; total network bytes on the C10 and FRD.
- The per-contact cost at scale: the loop here has two or three receivers. For OPEN-70's 498-contact
  loop, the sender's ~3.5 s per contact must overlap (adaptive concurrency), and each receiver's
  ~1.5 s of processing per Talk bounds how many Talks a phone can take in.
