# Test: Real cellular phone ↔ Wi-Fi phone through the public hub

**File:** 29-android-cellular-talk-exchange.spec.ts
**Gate:** `E2E_REAL_ANDROID_CELLULAR=1`, `NATIVE_APP_ANDROID_CELLULAR=<serial with SIM>`, `NATIVE_APP_ANDROID_WIFI_PEER=<serial>`
**Both on mobile data:** `E2E_CELLULAR_PEER_TOO=1` (the peer needs a SIM too; its Wi-Fi is turned off and back on)
**Hub:** `NATIVE_APP_CELLULAR_HUB` (default `https://www.iinpublic.com/gun` — production)

## What this test does (in plain English)

1. Wakes both phones, turns Wi-Fi OFF on the SIM phone and confirms its default network is cellular.
2. Resets both apps and boots them against the public hub; pings the hub from the SIM phone's shell.
3. Both phones join a private, run-unique room (never Global — this runs against production).
4. The Wi-Fi phone authors and broadcasts a tag Talk; the cellular phone must receive it.
5. The cellular phone authors and broadcasts a tag Talk; the Wi-Fi phone must receive it.
6. The cellular phone answers the Wi-Fi phone's Talk with a match; both phones must get the conversation.
7. Each phone sends a DM; the other must see it (direct P2P transport across carrier NAT).
8. `afterAll` turns Wi-Fi back on.

## First run (2026-10-07, 1.0.120)

HONOR FCP-AN10 on Mint/T-Mobile LTE ↔ PH-1 on Wi-Fi: Talks ~450 ms each way, match ~570 ms,
DMs ~5 s each way. 1 passed (1.5 m).

## SIM matrix (2026-10-17, 1.0.156) — 5 of 5 passed

| Cellular phone | Peer | Talk → cell | Talk → peer | Match | DM cell → peer | DM peer → cell |
|---|---|---|---|---|---|---|
| HONOR FCP (Android 16, Mint) | C10 on Wi-Fi | 11.1 s | 14.5 s | 0.6 s | 8.1 s | 1.9 s |
| P30 (Android 10, AT&T) | C10 on Wi-Fi | 14.4 s | 14.4 s | 0.6 s | 8.2 s | 1.9 s |
| PH-1 (Android 10, AT&T) | C10 on Wi-Fi | 14.5 s | 14.5 s | 0.6 s | 8.2 s | 2.0 s |
| P30 (AT&T) | PH-1, also on AT&T data | 14.5 s | 14.5 s | 0.6 s | 8.1 s | 3.0 s |
| HONOR FCP (Mint) | PH-1, also on AT&T data | 14.5 s | 11.2 s | 0.6 s | 7.7 s | 3.0 s |

The first P30/PH-1 runs failed in the test, not the app: Android 10 prints
`NetworkAgentInfo{ ni{…}  network{N}`, which the "on mobile data only" check did not match.
Talk delivery was ~11–14.5 s each way versus ~450 ms on 1.0.120 — fixed in 1.0.158, below.

## Slow Talks fixed (2026-10-17, 1.0.158)

Two fixed waits, both found on the host phone-path journey 02 (same ~10 s as the phones):

- **The receiver (app bug):** on a phone's first incoming Talk, the encrypted incoming-Talk store
  did not exist yet, and every `getPrivate()` of a missing key waited 4 s for a pre-1.0.124 copy
  on the peered graph that cannot exist (that key was born local-only). Twice per first Talk:
  ~8.7 s. The store now reads local-only, and `getPrivate()` skips that probe entirely for an
  identity created on this device. Unit tests in client-incoming-talk-mirror and
  web-gun-service-private-boundary.
- **The sender (test bug):** `clickBroadcastUntilBulkAck` probed `127.0.0.1:8080+slot/health`,
  which phone-path, native and public-hub runs never serve, and waited out 10 s each broadcast.

| Cellular phone | Peer | Talk → cell | Talk → peer | Match |
|---|---|---|---|---|
| HONOR FCP (Mint) | C10 on Wi-Fi | 0.35 s | 0.35 s | 0.6 s |
| P30 (AT&T) | C10 on Wi-Fi | 0.34 s | 0.63 s | 0.6 s |
| P30 (AT&T) | PH-1, also on AT&T data | 1.26 s | 1.15 s | 0.6 s |
| HONOR FCP (Mint) | PH-1, also on AT&T data | 0.53 s | 0.40 s | 0.6 s |

PH-1 → Honor FRD (Android 7, Wi-Fi) stopped at the pre-check: the PH-1's shell ping to the hub
over AT&T got no reply (network, before the app was involved); it passed on 1.0.157.

## Slow DMs fixed (2026-10-17, 1.0.160, OPEN-66)

`E2E_CELLULAR_DM_TRACE=1` logs where each DM spends its time on both phones. The WebRTC hop
itself took 0.1–0.5 s; the rest was two lookups of the other user's public record (~1.7 s each
over mobile data): the sender's pub before every send and the receiver's epub before every
decrypt. Both keys never change, so the DM transport now caches them (filled when the
conversation opens), and the receiver decrypts while the local Gun write runs instead of after
it. Unit tests in direct-p2p-conversation-transport.

| Cellular phone | Peer | DM cell → peer | DM peer → cell |
|---|---|---|---|
| P30 (AT&T), 1.0.159 | C10 on Wi-Fi | 4.04 s | 1.97 s |
| P30 (AT&T), 1.0.160 | C10 on Wi-Fi | 0.20 s | 0.14 s |
| P30 (AT&T), 1.0.158 | PH-1, also on AT&T data | 5.11 s | 2.99 s |
| P30 (AT&T), 1.0.160 | PH-1, also on AT&T data | 0.16 s | 0.16 s |
