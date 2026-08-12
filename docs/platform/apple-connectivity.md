# Apple connectivity adapter

The iOS target contains an open `AppleConnectivityBridge` using Network.framework peer-to-peer Bonjour and Core Bluetooth. It reports candidates to the same WebView event contract as Android, always with `authenticated: false`; SEA binding verification remains the trust boundary.

Bonjour advertises/discovers `_iinpublic._tcp` and exposes the embedded local Gun endpoint. BLE emits a rotating 15-minute digest and is discovery-only with mandatory route upgrade. The share action invokes `UIActivityViewController`; AirDrop is therefore an explicit user-directed attachment/export mechanism, never background synchronization.

Multipeer Connectivity was evaluated as an Apple-only accelerator and intentionally omitted from v1: it cannot provide Android interoperability and duplicates the common Bonjour/IP path. The adapter capability record declares it non-required, so removing all vendor acceleration cannot affect Gun data.

Apple's documented Wi-Fi Aware framework begins at iOS 26 and requires declared services/entitlements plus compatible physical hardware. The checked-in adapter reports API availability, but its publish/subscribe data path remains a physical-device prototype gate rather than a simulator support claim.
