# IinPublic TODO

Last updated: 2026-05-14

This is the forward backlog for the current repository. Completed feature ledgers belong in
[Project Status](reports/PROJECT_STATUS.md) or the [Spec Gap Matrix](roadmap/spec-gap-matrix.md),
not in TODO.

Authoritative product scope lives in
[docs/specs/iinpublic-technical-specification.md](specs/iinpublic-technical-specification.md).

## Current Focus

Continue the P2P roadmap:
[P2P Node Network Roadmap](roadmap/p2p-node-network.md).

## P2 — User-Permission Local Node

- [ ] Define the permission UX for running a local node: explain storage, bandwidth, battery, background behavior, local port use, and how to stop/delete it.
- [ ] Create a local node supervisor interface that can start, stop, restart, health-check, and wipe a user-owned node.
- [ ] Prototype desktop local node packaging with Node.js: one process for the UI shell, one process for the local Gun/libp2p service.
- [ ] Add browser-to-local-node connection discovery: localhost/WebSocket bridge with signed session pairing instead of trusting any page on localhost.
- [ ] Store the local node identity separately from the web identity, then bind them with a signed proof.
- [ ] Add local-only persistence controls for user data, neighbor cache, private profile data, message history, and encrypted backup export/import.

## P3 — SEA Identity, Key Custody, and Encryption

- [ ] Define the canonical SEA identity model: each user publishes public keys (`pub`, `epub`) and never publishes private keys (`priv`, `epriv`).
- [ ] Replace raw private-key localStorage with encrypted-at-rest key custody: WebCrypto passphrase/device-key wrapping in browsers and OS keychain/keystore on desktop/mobile.
- [ ] Add user-controlled key export/import and recovery flows with clear warnings that losing the private key means losing encrypted local/private data.
- [ ] Add multi-device linking with unlinkable public identities: each device keeps its own SEA identity, while linked devices privately share encrypted sync keys and data manifests.
- [ ] Add QR/code-based device pairing where an existing trusted device grants a new device access to selected encrypted data without publishing a shared account ID.
- [ ] Store linked-device manifests as encrypted, random-id records so relays can sync ciphertext blobs without learning which public device identities belong to the same person.
- [ ] Let users choose which data classes sync across linked devices: profile/private answers, contacts, blocked peers, neighbor cache, message history, talks, and chatbot memory.
- [ ] Add unlink/revoke flows that remove a device from future sync, rotate group keys, and preserve audit visibility for the owner without notifying the public network.
- [ ] Require every node/session to prove ownership of its public key with SEA signatures before accepting discovery, signaling, or P2P messages.
- [ ] Define public relay envelopes that expose only routing metadata needed for discovery/signaling; message bodies and private profile data must never be plaintext on relay paths.
- [ ] Add per-conversation/session encryption for direct P2P using SEA-derived shared secrets or an audited double-ratchet/session-key layer; do not rely on transport encryption alone.
- [ ] Sign encrypted P2P message envelopes so recipients can verify sender identity and reject spoofed/replayed messages.
- [ ] Add tests that verify server/relay storage contains public keys and relay metadata only, while private keys and plaintext P2P messages never appear in Gun/server storage.
- [ ] Add tests that prove two linked devices can sync selected encrypted data while an outside relay observer cannot infer that both device public keys belong to the same user.

## P4 — Real P2P Transport After Match

- [ ] Add a transport abstraction so conversations can use `star-gun`, `server-relay`, or `direct-p2p` without changing UI code.
- [ ] Use the existing server only for signaling at first: peer offer, answer, ICE candidates, and short-lived connection state.
- [ ] Open a WebRTC DataChannel for browser-to-browser matched conversations; stop writing post-match message bodies to Gun in direct mode.
- [ ] Add TURN fallback for restrictive NATs and label it clearly as relay transport, not server data storage.
- [ ] Encrypt direct messages end-to-end using the SEA identity/session-key requirements from P3.
- [ ] Store delivery receipts and message history according to user settings: local-only by default, optional encrypted backup later.

## P5 — Shared P2P Network Across Platforms

- [ ] Define a platform-neutral node protocol: identity, peer discovery, handshake, capabilities, neighbor score, message envelope, and sync policy.
- [ ] Choose the networking substrate for non-browser nodes: Gun mesh, libp2p, Hyperswarm, or a thin custom WebSocket/WebRTC layer.
- [ ] Build a Windows desktop package with the local node supervisor and autoupdate plan.
- [ ] Build an Ubuntu desktop package with the same node supervisor and system service/desktop-session behavior.
- [ ] Build Android node support with foreground-service controls for long-running P2P, battery limits, notifications, and GPS permission boundaries.
- [ ] Decide the iOS strategy: foreground-only peer, PushKit/notification-assisted wakeup, or no always-on node because iOS background execution is constrained.
- [ ] Add cross-platform compatibility tests where Web, Windows, Ubuntu, Android, and iOS clients join the same network and exchange signed discovery messages.

## P6 — Active Neighbor Memory

- [ ] Define the neighbor cache schema: peer id, endpoint hints, last seen, successful sessions, latency, transport type, capabilities, trust/block status, and expiry.
- [ ] Keep the most recent active neighbors locally first; never publish a user's private neighbor graph by default.
- [ ] Add neighbor scoring that prefers recent successful direct peers, nearby chatroom peers, contacts, and low-latency relays.
- [ ] Add cache pruning and user controls: clear neighbors, disable neighbor memory, export encrypted neighbor state, and block a remembered peer.
- [ ] Use remembered neighbors as bootstrap candidates before falling back to the public star server.
- [ ] Add tests for neighbor expiry, blocked-peer exclusion, stale endpoint failure, and successful reconnect through remembered peers.

## P7 — Data Ownership and Migration

- [ ] Add "Delete this device's local data" and "Request/delete server-held data" flows.
- [ ] Add migration logic that moves eligible server-persisted private data to local/encrypted user-owned storage.
- [ ] Add relay-only TTLs for discovery, signaling, presence, and room membership paths.
- [ ] Add telemetry-free diagnostics that let users see whether a message used direct P2P, relay fallback, or star-server mode.
- [ ] Update the technical specification once the transport and storage boundaries are implemented.

## Working Rule

- Remove completed TODOs instead of keeping stale checked-off work.
- Link each future item to the technical specification or a focused roadmap doc.
- Archive old snapshots under `docs/archive/` when they stop representing the current repo.
