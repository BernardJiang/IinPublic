# 10 — Android + MacMini device sync: conversation merge

covers: SPEC-29.11, SPEC-6.5

Real-hardware variant of the WP5 device-sync scenario: one real Android phone and the packaged
macOS Electron app each talk independently to the same website user BEFORE being linked,
producing two separate conversations under two separate SEA identities (every device has its
own keypair). After QR/code pairing and "Enable sync" on both sides, backfill ships each
device's pre-existing conversation to the other, so either app shows BOTH conversations —
including the other device's real message text. Opt-in via
E2E_REAL_ANDROID_DESKTOP_DEVICE_SYNC=1.
