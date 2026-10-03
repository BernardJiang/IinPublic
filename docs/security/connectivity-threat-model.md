# Connectivity threat model

This document covers IinPublic discovery, SEA connectivity bindings, route selection, Gun delta synchronization, forwarding and mailbox delivery. SEA public keys are application identities; libp2p PeerIDs and radio identifiers are replaceable transport coordinates.

## Trust boundaries and protected assets

- Local Gun is authoritative for durable application objects. Relay, mailbox, discovery and transport caches are untrusted accelerators.
- SEA private signing and encryption keys, private Q&A/chatbot memory, pair-private responses and block policy must not leave their authorized boundary.
- Discovery candidates are hints until a fresh SEA-signed connectivity binding and proof of transport-ID control succeed.
- Relays may observe bounded routing metadata but must not forge authorship, expand graph authorization or read pair ciphertext.

## Threats and required controls

| Threat | Attack | Required controls | Residual risk / release gate |
|---|---|---|---|
| Discovery poisoning | Inject fake or oversized candidates, addresses or rendezvous results | Strict schema/size/expiry limits, per-provider rate limits, provenance, dedup, provider isolation; authenticate before use | A malicious provider can delay or bias route choice. Multiple independent providers and diagnostics reduce availability impact. |
| Binding replay/identity substitution | Replay an old SEA↔transport binding or substitute a PeerID | SEA signature, separate transport-control challenge, expiry, monotonic sequence, revocation and SEA-level block checks | Compromised SEA keys remain authoritative until recovery/revocation semantics exist. |
| Malicious relay | Alter, replay, suppress or inspect forwarded traffic | End-to-end SEA signature, pair encryption, message IDs, hop TTL, seen set, persisted receipts and alternate routes | Relays can suppress traffic and observe timing/size. Never claim anonymity. |
| Sybil flooding | Create many candidates/peers to consume memory, CPU or bandwidth | Candidate/address caps, bounded gossip, rate limits, backoff, forwarding byte/hop budgets and abuse counters | Distributed Sybils can still degrade public discovery; cellular forwarding remains off by default pending external review. |
| Metadata leakage | Expose Talk bodies, private Q&A, chatbot memory or transport IDs as identity | Metadata-only offers, intake before graph grant, scoped/expiring grants, user-private path denylist, encrypted mailbox and export tests | Hubs and nearby observers can infer coarse participation and timing. |
| Graph over-subscription | Request a broad prefix or smuggle a private soul in a delta | Exact authorization prefixes, participant checks, path normalization, private-path rejection, signed deltas and checkpoints | New durable graph classes require explicit authorization review before release. |
| Parser/resource attack | Send malformed/deep/large JSON or invalid signatures | Pre-auth byte limits, fail-closed validators, fuzz/property tests, bounded caches and no exception escape from ingress | Native platform parsers require device-specific fuzzing when implemented. |
| Wi-Fi Direct link upgrade (OPEN-36) | Learn group credentials, join a group to sniff traffic, or impersonate the elected host | Credentials travel only inside the SEA-signed DTLS DataChannel of an already-authenticated session (never via the hub); group link is IP-only — the WebRTC session is carried by each phone's own loopback TURN relay (embedded node, loopback-only route, per-instance long-term credential so other apps cannot use it as an open relay) and DTLS stays end to end, so the group owner and other group members forward ciphertext; strict schema on `wd-*` frames; flag-gated | The group owner and anyone holding the WPA2 passphrase see who is in the group, packet timing and sizes, and the `192.168.49.x` addresses. A peer can re-share credentials it legitimately received (by design, to let a third phone join). Radio MACs are randomized per group on Android 10+. |
| Route-policy bypass | Use cellular/BLE or third-party forwarding despite policy | Central ConnectionManager, immediate pre-send policy recheck, metered permission and BLE bulk exclusion | OS network classification can be wrong; display route diagnostics and meter actual bytes. |

## Security invariants

1. No delivery receipt is emitted before the authorized object rereads from receiver Gun.
2. Transport identifiers never authorize application writes and never appear as a person identity.
3. Changing route or forwarding hops cannot change object ID, Gun soul or SEA author.
4. Rejected Talks and unauthorized private paths do not enter durable receiver Gun.
5. Mailbox/server exports contain ciphertext/control metadata, never plaintext Talk bodies or private chatbot memory.

## Review triggers

Re-run this model when adding a discovery provider, transport, graph soul class, cryptographic construction or bridge behavior. Cellular peer forwarding and BLE data transport may not become defaults before physical-device measurement and independent security review.
