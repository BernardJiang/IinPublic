# 12 — Android lifecycle and network resilience
covers: SPEC-5.2, SPEC-5.5, SPEC-19.4

On physical Android hardware, a matched conversation converges after Wi-Fi interruption, accepts
a message while the activity is backgrounded, and preserves the same identity after force-stop
and relaunch. The scenarios exercise the real device-local persistence and delivery paths.

Run with `E2E_REAL_ANDROID_LIFECYCLE=1` and a configured Android device.
