# Android connectivity adapter

The Android shell exposes `window.IinPublicNearby`, backed only by documented Android framework APIs:

- NSD/DNS-SD advertises and discovers `_iinpublic._tcp` temporary Gun endpoints.
- Wi-Fi Aware publishes/subscribes `iinpublic-v1` and can request an IP data path for a discovered peer.
- Wi-Fi Direct discovers/connects peers and returns the group-owner embedded Gun endpoint.
- BLE advertises/scans a 15-minute rotating digest derived from the local SEA public key. BLE candidates are discovery hints with `upgrade-required`; BLE data and IPFS are disabled.

Native events are emitted as `iinpublic-nearby-candidate`, `iinpublic-nearby-status`, and `iinpublic-nearby-permission`. Candidates explicitly carry `authenticated: false`; the web adapter never assigns a SEA identity from a radio identifier. After an IP route exists, the common adapter exposes it as a temporary Gun WebSocket peer, preserving Gun synchronization instead of defining another application protocol.

The capability record declares `vendorIndependent: true` and `googleNearbyRequired: false`. Google Nearby Connections is therefore not a required dependency; it may only be evaluated later as a removable accelerator.

Compilation and browser-side contract tests do not establish physical-device support. The permission/device/direction matrix remains gated by `docs/device-verification/runs.json`.
