# P2P Node Network Roadmap

Last updated: 2026-05-13

## Goal

Keep the current star-shaped IinPublic system working first, then evolve toward a user-owned P2P network where web, Windows, Ubuntu, Android, and iOS clients can join the same network, remember recent active neighbors, and use the server primarily for discovery/signaling instead of long-term user data storage.

## Sequence

1. Preserve star mode as the compatibility baseline.
2. Add a permissioned local node that users can start, stop, inspect, and delete.
3. Harden SEA identity, private-key custody, signatures, and message encryption.
4. Move matched conversations to direct P2P transport.
5. Package the same node model across desktop and mobile platforms.
6. Add private, local-first active neighbor memory.

## Architecture Principles

- Star mode stays available until P2P behavior is reliable and test-covered.
- Server persistence must be explicit by path and purpose.
- Post-match message bodies should not be stored on the public Gun hub in direct mode.
- User-owned local storage is the default for private data.
- Each user publishes only public SEA identity material (`pub`, `epub`); private SEA keys (`priv`, `epriv`) must remain encrypted at rest on user-controlled devices.
- A user may link multiple devices, but linked devices must not be publicly collapsed into one global identity; device linking is private encrypted state.
- Relay communication may expose routing/signaling metadata, but private profile data and P2P message bodies must be encrypted before they touch relay paths.
- P2P communication must use authenticated encryption derived from both users' public/private key material, plus signed envelopes to prevent spoofing and replay.
- The neighbor graph is private local state unless a user explicitly shares it.
- Mobile platforms may have weaker background-node behavior than desktop; the protocol must tolerate intermittent peers.

## Storage Classes

- Durable public: profile preview, public reputation summaries, public room metadata.
- Encrypted user-owned: private profile rows, answer memory, contacts, blocked list, message history, local node key material.
- Relay-only: presence, signaling offers/answers/candidates, temporary room membership, direct-transport rendezvous state.
- Derived/cache: active neighbor cache, local search indexes, delivery receipts, UI snapshots.

## First Implementation Slice

- Add feature flags for star mode versus local node/P2P behavior.
- Document current Gun paths and classify each storage path.
- Add a dev-only storage visibility panel.
- Introduce a `ConversationTransport` interface with the current Gun path as the first implementation.
- Add a no-op/local mock P2P transport behind a disabled flag so UI code starts depending on the abstraction.

## SEA Identity and Security Requirements

- Public identity: store `pub` and `epub` in public discovery/profile records so peers can verify signatures and derive shared secrets.
- Private identity: never write `priv` or `epriv` to Gun, server logs, relay envelopes, analytics, or plaintext browser localStorage.
- Key storage: wrap private keypairs with WebCrypto in browsers; use OS keychain/keystore facilities for Windows, Ubuntu, Android, and iOS packages where available.
- Device model: every device has its own SEA keypair and public identity; a human's multi-device relationship lives only in encrypted owner-controlled sync state.
- Device pairing: use a QR code or short-lived pairing code from an already trusted device to exchange device public keys and deliver encrypted group/sync keys.
- Private sync group: store shared data as encrypted records under random group or manifest ids that are not publicly tied to the user's chat/profile identity.
- Selective sync: let the owner choose which data classes sync across devices, including private profile data, contacts, blocks, neighbor memory, talks, chatbot memory, and message history.
- Revocation: unlinking a device must rotate future sync keys and prevent that device from reading new encrypted updates.
- Session authentication: every local node and app session signs a fresh challenge before it can publish presence, signaling, or neighbor announcements.
- Relay visibility: relay paths may carry sender id, recipient id or rendezvous id, timestamp/expiry, transport hints, and signed encrypted payloads only.
- Direct P2P encryption: use SEA shared secrets as the minimum baseline, then evaluate an audited ratcheting/session-key layer before durable private messaging.
- Message integrity: sign each encrypted envelope with the sender key and include nonce/timestamp/message id fields for replay protection.
- Verification: add tests that scan persisted Gun/server state and browser storage fixtures for leaked private keys or plaintext direct-message bodies.
- Linkability verification: add tests proving relays can sync encrypted multi-device data without learning that two public device identities belong to the same user.

## Platform Notes

- Web browser: can use WebRTC directly, but cannot run unrestricted Node.js inside a normal webpage. A permissioned companion/local node must be installed or launched separately.
- Windows/Ubuntu: best fit for a bundled Node.js local node plus desktop shell.
- Android: possible with a foreground service or embedded runtime, but battery and background restrictions must shape the UX.
- iOS: cannot assume an always-running Node.js process. Plan for foreground-only or notification-assisted behavior unless a native networking layer replaces Node.js.
