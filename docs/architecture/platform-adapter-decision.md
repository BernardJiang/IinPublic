# Platform adapter decision

All nearby/platform integrations implement `PlatformConnectivityAdapter`; vendor APIs remain optional accelerators. An adapter that creates IP connectivity must expose a temporary Gun WebSocket peer, so Gun Wire remains the synchronization wheel.

Gun-over-libp2p is not selected for platform IP paths: current Wi-Fi Aware, Wi-Fi Direct, LAN, and Network.framework plans provide IP connectivity, and no measurement demonstrates a need for another Gun framing implementation. Byte-stream-only BLE remains discovery/control-only pending physical throughput and battery evidence.

Permission denial degrades only that adapter. Internet discovery and every other provider continue independently.

