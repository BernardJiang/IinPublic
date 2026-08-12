# PeerMesh frame inventory and exit gates

`PeerMeshService` is a transport/control overlay, not an authoritative body store. Every accepted legacy body is committed to receiver-local Gun before ACK.

- Retain: ping/pong, signed Talk offers, persisted ACKs, retractions, bounded forwarding and discovery control.
- Adapt: complete Talk bodies and encrypted responses become selective Gun deltas when both peers advertise `gunNativeSync`.
- Compatibility: body requests and full-body frames remain enabled for peers without the capability.
- Preserve across every hop: `msgId`, original SEA proof/authorship, recipient, and decreasing `ttlHops`.

The memory body cache and legacy retry translation may be deleted only after two shipped release cycles with Gun-native parity and old/new interoperability evidence. Until then `legacyTalkBodyFrames` defaults to true and disabling Gun-native mode is a rollback path.

