# Physical-device verification

Hardware routes are not “supported” merely because an API exists or an emulator test passes. Add one record per direction, device pair, OS/build, route, lifecycle state and network condition to `runs.json`, then run `npm run verify:devices`.

A route becomes supported only when its records include successful contract, integration and physical-device results. Physical results must include device model, OS, app build, route, battery state, network type, direction, foreground/background/locked state, latency, throughput, battery drain, reconnect time and forwarding bytes. Failed and unsupported runs are retained as evidence rather than removed.

The repository intentionally begins with no physical-device claims. iOS/Android Wi-Fi Aware, BLE and background behavior remain unchecked in `TODO_codex.md` until real signed-off records exist.
