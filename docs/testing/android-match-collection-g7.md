# Android match-collection G7 qualification

This records the physical-device portion of OPEN-81 G7 run on 2026-10-21 PDT with Android app
version 1.0.187. It complements the deterministic 498-person and 16-client host models; it does
not turn a four-phone bench run into a crowd-scale or real-world movement claim.

## Devices

- Huawei P30 / VOG-L29, Android 10, SIM (`DUM0219418001663`)
- FancyDay C10, Android 14 (`PADC100013000534`)
- Essential PH-1, Android 10, SIM (`PM1LHMA7A2707315`)
- Honor FRD-L04, Android 7 (`RNV0217207000190`)

The same debug APK was installed on all four devices. The Honor did not have enough free space for
an in-place update, so only `com.iinpublic.app` was uninstalled and reinstalled; unrelated apps and
data were not touched.

## Automated physical results

All of these Playwright native-app gates passed against real attached phones:

- `40-android-background-talk-agent.spec.ts` — P30 author and C10 receiver, 1/1 in 2.5 minutes.
  The C10 Activity was closed, its screen was turned off, Doze was forced, and its app process was
  killed. Android restarted the foreground-service process without reopening the Activity. The
  native agent decrypted the Talk, applied the exact pre-approved answer, returned the encrypted
  response, and consumed its pending event. The outing was stopped immediately after send, before
  the reply arrived; the reply was still attached to the ended outing. Measured response time was
  5.727 seconds, with the result captured 3.920 seconds after `endedAt`. Reopening the Activity
  reconciled exactly one responder-ledger row and zero pending native events.
- `13-android-three-phone-offline-resync.spec.ts` — P30, C10 and PH-1, 1/1 in 2.3 minutes. It
  covered concurrent Talks, a real Wi-Fi off/on transition, and catch-up of the Talk missed while
  the PH-1 was offline.
- `29-android-cellular-talk-exchange.spec.ts` — P30 cellular-only and C10 on Wi-Fi, 1/1 in 1.4
  minutes. Talk delivery measured 33 ms cellular-to-Wi-Fi and 48 ms Wi-Fi-to-cellular; match
  delivery measured 32 ms. DM delivery measured 2.010 seconds cellular-to-Wi-Fi and 142 ms in the
  reverse direction. Cleanup restored P30 Wi-Fi.
- `30-android-four-phone-nearby.spec.ts` — all four phones, 1/1 in 3.8 minutes. Four ring Talk
  deliveries measured 7.670, 18.520, 8.528 and 8.061 seconds, plus a 6.105-second background
  delivery; p50 was 8.061 seconds and p95 was 18.520 seconds. The C10 background delivery, group
  round trip and online query all passed. This gate used the online LAN paths, not Wi-Fi Direct.

The focused background run writes its raw local artifact to
`test-results/40-android-background-talk-*/g7-background-agent-evidence.json`; `test-results` is
intentionally not committed.

## Defects found by the gate

The first background run exposed two real integration gaps:

1. Authoritative direct delivery sent only a content-free wake through the durable mailbox. A
   WebView that was merely paused could still receive the peer message, but a restarted native-only
   receiver had no Talk body to process. Direct delivery now also puts the encrypted body in every
   pending receiver's mailbox and limits the extra wake envelope to likely-asleep receivers.
2. Saving an exact answer from the product UI stores it as `temporary`; native policy export only
   accepted `auto` and `whenever`, producing an empty native answer-rule set. Shared policy export
   now accepts all three automatic modes, preserves the offered answer frame and selected texts,
   and continues rejecting manual answers.

Focused unit coverage exercises the mailbox selection and policy export. The corrected packaged
app then passed the screen-off/process-death physical gate above.

## 2026-10-28 — regression checks on app 1.0.199

After merging the native/core Gun migration, the four-phone ring initially failed during Nearby
convergence. The connection/RPC corrections and their regression evidence are described in
[the transport report](android-transport-measurements.md#2026-10-28--four-phone-convergence-after-the-native-gun-migration).
The same corrected ARM64 APK was installed on all four phones listed above.

- `30-android-four-phone-nearby.spec.ts`: all four phones passed in 3.7 minutes. Every phone
  retained all three peers, with zero failed gossip swaps and zero duplicate accepted Talk bodies.
  The four ring deliveries took 15.322 / 10.922 / 13.070 / 11.620 seconds, C10 background delivery
  took 10.260 seconds, and the group round trip and online query passed.
- `13-android-three-phone-offline-resync.spec.ts`: P30/C10/PH-1 passed in 2.6 minutes. Concurrent
  Talk propagation and a missed Talk after PH-1 Wi-Fi off/on were verified; Wi-Fi was restored.
- `40-android-background-talk-agent.spec.ts`: all four receiver variants passed sequentially.
  Each receiver recovered its native service after process death with the Activity closed, returned
  the exact approved encrypted answer while screen-off after Doze was requested, attached the late
  reply to the ended outing, and reconciled once on Activity relaunch with zero pending native events.

| Receiver | Author | Process termination | Screen-off reply | Full gate |
| --- | --- | --- | --- | --- |
| PH-1, Android 10 | C10 | ActivityManager crash | 6.313 s | 2.6 min, passed |
| Honor FRD-L04, Android 7 | P30 | run-as SIGKILL | 5.895 s | 2.4 min, passed |
| P30, Android 10 | C10 | ActivityManager crash | 6.153 s | 2.7 min, passed |
| C10, Android 14 | P30 | run-as SIGKILL | 5.626 s | 2.9 min, passed |

The background gate now checks the exact responder identity set. A tag answer intentionally records
both the whole-Talk identity and its selected-tag identity; each must have exactly one version-1 row
for the author. It also requires one author outcome, one outing result and no pending native events.
The previous one-row assertion incorrectly treated these two suppression identities as duplicates.
Where a vendor rejects `run-as ... kill -9`, the harness uses ActivityManager's debug crash for the
exact app PID. Both paths must produce a replacement service PID without a resumed app Activity;
neither uses force-stop to test service recovery.

Raw local outputs are under `test-results/four-phone-2026-10-28/` (`ring-gun-fixed-four/`,
`offline-resync/`, `background-{ph1,honor,p30,c10}-qualified/`, and `gun-fixed-apk.sha256`).
Each background directory contains `g7-background-agent-evidence.json` with process IDs, restart
method, reply time, ended-outing association and exact responder identities. These USB-connected
fixed-location runs do not complete the carried field or unplugged battery gates.

## Remaining manual field gate

G7 remains open. A person must still carry the phones through literal walking movement and a
transit/subway route with genuine location loss, then revisit peers for physical repeated
encounters. Fixed test coordinates, toggled radios and simulated reconnects are useful deterministic
bench coverage, but are not evidence for RF behavior, GPS behavior or encounter timing while
moving. All four vendors now have screen-off/process-recovery bench coverage; background delivery
still needs carried, unplugged field coverage under their real battery restrictions.
