# 26 — Android camera and file-picker permissions
covers: SPEC-4.2, SPEC-6.5, SPEC-10.3

On physical Android hardware, the installed package declares Camera but not microphone access,
requests system permission when needed, opens a live video track after grant, and launches the
system file picker from Profile settings.

Run with `E2E_REAL_ANDROID_CAMERA=1` and a debuggable build on the configured phone(s).
