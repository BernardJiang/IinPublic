# IinPublic connectivity protocol v1

This is an independently written description of the open IinPublic wire and graph contracts. Implementations may interoperate from this document and the schemas in `src/shared`; vendor-specific discovery is optional.

## Identity and transport binding

The only application identity is the SEA signing public key (`seaPub`). A libp2p PeerID, Wi-Fi endpoint or rotating BLE identifier is a subordinate `connectivityId`, never a user ID. A binding contains version, SEA pub, connectivity kind/ID, addresses, capabilities, monotonic sequence, issue/expiry timestamps and a SEA proof over the canonical object. Receivers additionally challenge control of the connectivity ID. Bindings expire within 24 hours and stale sequences fail closed.

## Discovery candidate

A candidate is an untrusted hint with source provenance, observation/expiry time, optional SEA/transport hints, bounded addresses, capabilities and rooms. Candidate records do not authorize graph reads or writes. Hub, known-peer, DHT/bootstrap, mDNS and gossip providers share the same contract and fail independently.

## Control frame

`P2PMeshFrame` v1 carries small metadata/control traffic: ping/pong, Talk announce, body request, legacy body compatibility, encrypted Talk response, retraction and ACK. The SEA signature covers all immutable fields except hop TTL, allowing a relay to decrement TTL without becoming the author. `msgId` plus a bounded seen set deduplicates multipath forwarding.

## Selective Gun synchronization

After receiver intake accepts a metadata-only Talk offer, the author issues a short-lived grant for the minimum soul prefix. A delta contains grant ID, soul, stable object ID, JSON value, current/previous checkpoint heads, author SEA pub and SEA proof. The receiver verifies recipient, issuer, expiry, prefix, private-path exclusion, signature and checkpoint continuity before committing to local Gun. A persisted receipt is sent only after read-back.

User-private `meQa`, chatbot memory, filters, blocks and reputation inputs are never ordinary peer subscriptions. Pair responses synchronize only between the two SEA participants. BLE is discovery-only and never carries IPFS blocks by default.

## Route behavior

The connection manager selects among equivalent delivery routes while IDs and Gun souls remain stable. Default policy reuses a healthy path, then prefers free, direct, stable/fast and battery-appropriate routes. Newly metered routes require permission. Optional peer forwarding preserves original SEA proof, uses hop/byte/rate limits and may be disabled without disabling the user's own traffic.

## Compatibility and versions

New receivers accept legacy `talk-body` frames while Gun-native migration is active. Version-1 implementations must reject unknown schema versions and malformed/oversized ingress. Removing legacy body caches requires an explicit compatibility decision after the documented release window.

Executable structural vectors live in `docs/protocol/test-vectors/connectivity-v1.json` and are checked by the unit suite.
