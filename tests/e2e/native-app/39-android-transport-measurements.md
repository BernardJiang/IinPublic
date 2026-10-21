# 39 — Transport measurements on real phones

A measurement run, not a pass/fail gate: it records numbers for one transport mode on every phone
named in `NATIVE_APP_ANDROID_SERIALS` (2–5 phones). It clears the IinPublic app data on those
phones. It covers the transport part of OPEN-40-G2.5, the physical discovery-timer gate, and
OPEN-70's per-contact connection cost.

## What one run does

1. **Discovery.** Launches every phone, then moves them all into the same Nearby room at the same
   moment, and times how long until the hub lists everyone, every phone lists everyone, (LAN mode)
   every phone sees the others over LAN discovery, and every pair has a live link with a
   confirmed encrypted session. In offline mode it times the Wi-Fi Direct group instead.
2. **Connection cost.** For every pair, opens a fresh WebRTC connection several times and records
   how long each took and which candidate types were used (local network, server-reflexive,
   relay).
3. **Broadcast loop.** Each phone in turn sends one Talk to every other phone, first one at a time
   (the Nearby v3 delivery model), then to all at once, and records the time per contact and until
   everyone has it.
4. **Background.** The phone with the newest Android goes to the background for a few minutes, gets
   a Talk, and the run records whether it arrived while backgrounded or only after reopening.
5. **Idle window.** With Android's battery accounting reset and charging hidden, the phones idle in
   Nearby for a few minutes; the run records the app's estimated power, CPU time, network bytes
   and wakelocks, and how often each phone's discovery state changed.

## Modes

| `E2E_MEASURE_MODE` | Network |
|---|---|
| `hub-lan` (default) | local hub reachable, LAN discovery on |
| `hub-only` | local hub reachable, LAN discovery off |
| `wifi-direct` | hub unreachable, LAN discovery off: the phones must form a Wi-Fi Direct group |
| `cellular` | public hub in a private run-unique room; phones in `E2E_MEASURE_CELLULAR_SERIALS` use mobile data |

Knobs: `E2E_MEASURE_RECONNECTS` (5), `E2E_MEASURE_BACKGROUND_MIN` (5), `E2E_MEASURE_IDLE_MIN` (15).

Diagnostics:

- `E2E_MEASURE_SCREEN_OFF=1` idles with the screens off (a phone in a pocket); otherwise they stay
  on.
- `E2E_MEASURE_PROFILE=1` also records, for 60 s of the idle window: a CPU profile of each phone's
  embedded node with its requests by route and Gun writes by record shape
  (`GET /api/debug/runtime-window`, loopback-only, debug builds), a CPU profile and main-thread
  timings of the WebView page over CDP (skipped on Android 7, whose WebView drops the page), and
  `top` per process and per thread. Profiles are saved as `.cpuprofile` next to the results.

## Output

`test-results/android-measurements/<mode>-<time>.json`, summarised in
`docs/testing/android-transport-measurements.md`.

The battery figure is Android's model estimate for the app while the phones stay on USB, not a
measured drain.

## Found by this spec

- 2026-10-18: after a reconnect, a pair could stay "connected" while unable to exchange anything:
  the previous channel's encrypted handshake finished after the reset and the two phones derived
  different sessions. Four of six pairs never delivered a Talk. Fixed in 1.0.166
  (`p2p-webrtc-session.ts`; unit test `p2p-session-handshake-race.test.ts`).
