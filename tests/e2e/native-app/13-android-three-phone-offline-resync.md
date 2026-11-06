# 13 — Three-phone offline resync
covers: SPEC-3.4, SPEC-5.2, SPEC-19.4

Three physical Android phones propagate Talks concurrently. One phone then goes offline while
the other two continue exchanging; after Wi-Fi returns, the disconnected phone catches up the
Talk it missed into its local incoming-Talk store.

Run with `E2E_REAL_ANDROID_THREE_PHONE_RESYNC=1` and three configured Android devices.
