# 1.0.200 phone field run — OPEN-81 and OPEN-76

The automated bench runs cover Nearby, offline catch-up and native screen-off replies. These two
issues still need evidence from phones carried away from USB, through real movement and a long
unplugged battery interval. Keep this page with your notes. Do not reset or uninstall IinPublic:
the 1.0.200 debug APK was installed as an in-place update to preserve each phone's local identity.

## Phones and the result to send back

| Phone | Android | Serial | Suggested role |
| --- | ---: | --- | --- |
| Honor FCP-AN10 | 16 | `AG2H024712001421` | carried receiver; newer Android comparison |
| Huawei P30 | 10 | `DUM0219418001663` | outing author and cellular transition |
| C10 | 14 | `PADC100013000534` | stationary or carried peer; background receiver |
| Essential PH-1 | 10 | `PM1LHMA7A2707315` | second-vendor receiver; battery optional (aged cell) |
| Honor FRD-L04 | 7 | `RNV0217207000190` | legacy Android comparison; do not use as a Wi-Fi Direct gate |

Before leaving, open **Settings → Apps → IinPublic** on each phone and confirm version **1.0.200**.
If a phone shows another version, stop that phone's run and tell me. In IinPublic, confirm each
phone's own stage name/identity, Nearby and location permissions, Bluetooth, and the same intended
Nearby room. Grant background location/nearby permission where Android asks. For the background
receiver, choose **Settings → Nearby → “Always — background Talk exchange”** and confirm its
persistent notification. Record any vendor battery restriction you have to change; do not silently
disable it. Charge the phones and synchronize their clocks. Do not use mock location or forced Doze.

Use a note with one row per event:

`local date/time | phone | place/route | Wi-Fi/cellular/offline | GPS available? | screen on/off | action | expected peer/Talk | actual result | delay/duplicate/error`

Give each test Talk a distinct short title, such as `walk-out`, `walk-return`, and `train-late`.
Record the Talk title and the stage names, not private message text. A screenshot of the outing
summary and any failure is useful; redact private replies before sharing it.

## OPEN-81 G7: carried movement and late replies

1. At a safe starting point, leave one phone (suggest C10) stationary, online, powered and with
   IinPublic's background mode **Always**. Carry P30 and FCP-AN10; bring PH-1 if practical. On
   P30, prepare two small Talks and one exact automatic answer on a receiver. In the Nearby screen
   tap **Start collecting**. Note the start time, visible people count and public location/area.
2. While the phones are close, tap **Broadcast** for `walk-out`. Confirm which receiver shows the
   Talk, whether its exact answer returns, and the outing's reached/reply/match counts. Put the
   receiver's screen off for at least one send; leave its app in **Always** mode. Note the time to
   reply and any delayed or missing notification.
3. Walk a real route away from the stationary phone and later return to it. Record approximate
   distance, indoor/outdoor segments, when a phone loses GPS, and when Nearby peers disappear and
   reappear. Broadcast the distinct `walk-return` Talk on the return. Verify the outing review has
   both encounters, rather than overwriting the first one, and that each Talk result appears once.
4. For a late reply, broadcast another distinct Talk, immediately tap **Stop collecting**, then
   allow the receiver's answer. Reopen the ended outing review after the reply. Record whether its
   reached/pending/replied/matched counts change, and whether the late row appears exactly once.
   Restart the author app once and check that the ended outing and its rows remain.
5. On a real transit/subway trip (or a genuine tunnel/indoor route with location loss, recorded as
   that rather than as subway), begin a new outing before entry. Carry two phones, with one screen
   off in **Always** mode. Note the exact entry/exit times, whether Android location becomes
   unavailable, and whether the app labels the encounter location as unavailable rather than a
   precise point. Send `train-late` before losing service or on return; switch one receiver from
   Wi-Fi to cellular and then through a real offline interval if safe. Restore connectivity and
   confirm one catch-up Talk and one reply, with no duplicate outing rows. Do not change radio
   settings while driving or in an unsafe place.

If a step cannot be performed, record **not run** and why. A simulated location or a home-desk
radio toggle cannot close the carried movement or genuine GPS-loss gate.

## OPEN-76: unplugged battery measurement

Use at least **P30, C10 and FCP-AN10**; PH-1 and FRD-L04 are useful extra vendor observations.
Measure with real batteries, no USB cable, power bank, battery-emulation command or profiler.
Charge each selected phone to at least 80%, then record its start charge **before unplugging**,
local time, Android version, screen brightness/timeout, Wi-Fi/cellular/Bluetooth/location state,
signal strength if shown, battery-saver setting, IinPublic Nearby mode, and whether its persistent
notification appears. Keep these settings unchanged during a measurement phase.

1. **Screen-off background interval:** choose **Always — background Talk exchange**, put each
   phone's screen off, and leave the phones unplugged for **at least six hours** in the same ordinary
   environment. Record start/end times and battery percentages. Do not open the apps during the
   interval. At the end, before plugging in, note whether IinPublic's notification still exists,
   whether the phones still discover peers, and Android Settings → Battery → IinPublic usage if
   available. Record any OS restriction or process kill notification.
2. **Active interval:** recharge or record the new starting charge, then run **one hour unplugged**
   with the app visible, Nearby open, and a few distinct Talk sends/replies. Record elapsed time,
   start/end battery percentage, screen-on time, radios and approximate number of Talks. If the
   phone gets hot or the battery becomes low, stop and record the shortened interval.
3. Reconnect the phones to this Mac after recording the final unplugged percentages. Tell me the
   start/end times and values for each phone so I can collect Android batterystats, app logs and
   retained transport counters, compare background/active drain, and append the evidence to the
   transport report. Do not reset Android battery statistics or app data before that collection.

The six-hour and one-hour intervals are a measurement protocol, not a promised battery-life
threshold. I will keep OPEN-76 open if vendor behavior or missing evidence prevents a conclusion.
The older USB bench's battery estimate is not a substitute for these readings.

## Send me this compact report

For each phone: version, role, permissions/background mode, outing titles and counts, each
movement/GPS/offline event, any missing/late/duplicate result, and battery start/end/time for both
intervals. Include whether the stationary phone was actually left behind and whether the transit
route was a subway or another location-loss environment. Keep the five phones available for USB
reconnection afterward; I will collect logs and decide which issue gates are satisfied.
