# 11 — Android cross-engine directional pairs
covers: SPEC-3.4, SPEC-5.5, SPEC-19.4

A physical Android phone, the packaged macOS app, Chromium, WebKit, and Firefox share one hub.
Explicit Talk completions cover Chromium → Android, Android → WebKit, Android → Firefox, and
Android → macOS App rather than inferring those edges from a larger ring.

Run with `E2E_REAL_ANDROID_DIRECTIONAL_PAIRS=1` and a configured Android device.
