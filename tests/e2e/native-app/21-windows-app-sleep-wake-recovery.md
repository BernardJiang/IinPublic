# 21 — Windows app sleep/wake recovery
covers: SPEC-5.2, SPEC-5.5, SPEC-19.4

The installed Windows application survives a real host suspend/resume cycle with its identity
unchanged, reconnects to the LAN hub, rejoins presence, and converges on a Talk broadcast after
wake by the macOS application.

Run with `E2E_REAL_WINDOWS_SLEEP_WAKE=1`; this test really suspends the configured Windows host.
