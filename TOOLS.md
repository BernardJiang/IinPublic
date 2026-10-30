# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Android test devices

- User authorization (2026-10-29): address the five-second blank Settings transition and update
  the five connected phones. Android 1.0.203 installs in place with identities preserved.
- User authorization (2026-10-29): fix the Map → Center on me freeze and update the five connected
  phones. Android 1.0.202 installed in place; no app data reset. Field validation of the exact
  freeze is still needed.
- User authorization (2026-10-29): update all five connected phones in place to 1.0.201 with the
  GUI responsiveness fixes. The five devices reported versionCode 1000201 after installation;
  no app data was cleared. C10 still needs its Android Nearby permission granted by the user for
  offline Wi-Fi Direct discovery.
- User authorization (2026-10-29): install release 1.0.200 on five connected phones, including
  Honor FCP-AN10 `AG2H024712001421`. The prior four-phone restriction below is superseded for
  this release install. Do not clear FCP-AN10 data without separate authorization.
- User authorization (2026-10-27): use the four available phones to fix open issues, superseding
  the 2026-10-26 C10-only restriction for this task. Selected devices: P30 `DUM0219418001663`,
  C10 `PADC100013000534`, PH-1 `PM1LHMA7A2707315`, Honor FRD-L04 `RNV0217207000190`.
  Target these serials explicitly; do not operate other phones or run device-wide commands.
- Run physical Nearby suites sequentially even when their selected phones are disjoint: BLE and
  Wi-Fi Direct share the room capability and radio environment, so another suite can influence
  host election, group membership and transport measurements.

- After every physical-phone test session, restore any temporary battery/Doze/radio state and turn
  off the screen on the authorized test phone with `adb -s <authorized-serial> shell input keyevent KEYCODE_SLEEP`.
- If a phone is disconnected at cleanup time, report it explicitly and turn off its screen as soon
  as it reconnects.
