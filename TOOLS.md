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

- User restriction (2026-10-26): use only the C10 phone when physical-device testing is needed.
  Do not operate other phones, including for cleanup. Target C10 explicitly; do not run device-wide commands.

- After every physical-phone test session, restore any temporary battery/Doze/radio state and turn
  off the screen on the authorized test phone with `adb -s <authorized-serial> shell input keyevent KEYCODE_SLEEP`.
- If a phone is disconnected at cleanup time, report it explicitly and turn off its screen as soon
  as it reconnects.
