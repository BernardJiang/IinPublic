# 30 — Four-phone Nearby convergence
covers: SPEC-3.4, SPEC-5.2, SPEC-19.8

Four physical Android phones at the same confirmed location converge on one opaque Nearby room,
exchange Talks around a ring, and deliver to a phone that is backgrounded and then foregrounded.
The ordinary run keeps the LAN hub reachable and does not claim offline Wi-Fi Direct coverage.

Run with `E2E_REAL_ANDROID_FOUR_PHONE_NEARBY=1` and four configured phones.
