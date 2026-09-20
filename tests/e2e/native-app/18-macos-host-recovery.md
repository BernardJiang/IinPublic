# macOS host recovery

These opt-in tests exercise real Mac-mini host boundaries that ordinary browser emulation cannot
prove.

- `E2E_REAL_MACOS_SLEEP_WAKE=1` schedules a one-shot `pmset relative wake`, sleeps the host, and
  verifies that the Electron app retains the exact SEA public identity, reconnects to the shared
  hub, republishes after wake, and returns to the Global roster.
- `E2E_REAL_MACOS_FIREWALL=1` serves one browser through `127.0.0.2`, installs a narrowly scoped PF
  rule for only that loopback destination and hub port, and proves a `127.0.0.1` peer continues
  publishing while the isolated peer cannot. Removing the rule must restore publication without
  changing the isolated peer's identity.

Both commands require narrowly scoped, non-interactive sudo access to `/usr/bin/pmset` or
`/sbin/pfctl`, respectively. Their scripts fail before changing host state when that preflight is
unavailable. PF uses the stock `com.apple/*` anchor, never replaces
the main ruleset, flushes only its own rules on every exit path, and releases its own PF enable
reference token. Sleep uses a bounded one-shot wake event and never creates a repeating schedule.
