# Completion evidence map

This map distinguishes software convergence from physical-route support. A green deterministic test does not promote an unmeasured native route to “supported.”

| Requirement | Direct evidence |
|---|---|
| Gun authoritative for durable data classes | `authoritative-data-invariants.test.ts`, `gun-talk-repository.test.ts`, `gun-delivery-repository.test.ts`, `gun-chatbot-memory-repository.test.ts`, `gun-message-store.test.ts` |
| Exactly-once convergence over any permitted modeled connection | `deterministic-connectivity-harness.test.ts`, using a stable soul/object ID and persisted receipt oracle |
| Discovery/route isolation and failover | `peer-discovery-provider.test.ts`, `peer-discovery-manager.test.ts`, `deterministic-connectivity-harness.test.ts` |
| Chatbot/manual transport independence | `chatbot-talk-flow.test.ts`, `gun-chatbot-memory-repository.test.ts`, deterministic route cases |
| Vendor adapter removability | Common `PlatformConnectivityAdapter`; Android declares Google Nearby unnecessary; Apple omits Multipeer; neither is imported as a dependency |
| Independent open protocol and provenance | `LICENSE`, `docs/protocol/connectivity-v1.md`, executable vectors, threat model and CycloneDX SBOM |
| Hardware support | Only `docs/device-verification/runs.json` may establish it. Current report has zero supported hardware routes. |

The full legacy/Gun-native E2E suite and physical-device rows remain separate release gates and must not be inferred from this map.
