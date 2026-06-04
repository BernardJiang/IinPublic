# IinPublic TODO

Last updated: 2026-06-04

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus — SRS §19.13 P2P Identity, Trust, Versioning, and Abuse Defense

P1 pair-private ownership graph (§19.14, REQ-P2P-21–29) is shipped and moved to `docs/completed.md`. The next SRS-backed gap is §19.13 / REQ-P2P-09–20: every direct discovery/signaling/payload exchange must have canonical peer identity, real signatures, replay protection, protocol negotiation, local trust gates, deterministic schema migrations, signed upgrades, and fake-client defenses.

## SRS Audit Snapshot (2026-06-04)

Checked current implementation against `docs/specs/iinpublic-technical-specification.md` §19.13 and §19.14.

- **§19.14 / REQ-P2P-21–29:** Shipped. Direct-mode answers and non-TechSupport DMs are pair-scoped SEA ciphertext, chatroom delivery is announcement metadata, offers use catalog refs, server APIs are scoped away from hub pair history, and `npm run test:e2e:parallel` passed in direct mode.
- **REQ-P2P-09:** Partial. SEA keypairs persist, but there is no canonical `PeerID = HASH(pub)` used consistently on discovery, signaling, and peer payload wires.
- **REQ-P2P-10 / 19:** Partial. Presence ack, signaling, and relay envelopes carry `signature` and `nonce`, but current signatures are placeholder strings in client code and server validation is field/TTL oriented, not SEA verification with durable replay rejection.
- **REQ-P2P-14 / 15:** Partial. WebRTC sessions exchange `ledger-state`, but not a signed handshake with `appVersion`, `supportedProtocols`, `features`, and fail-closed negotiation when no protocol overlaps.
- **REQ-P2P-11 / 12 / 18:** Partial. Blocks, known-person labels, local reputation, and neighbor trust status exist, but there is no distinct `Verified` trust level or capability gating for Unknown/Friend/Verified peers.
- **REQ-P2P-13 / 16:** Partial. Some records have `version: 1`, but stored application objects do not consistently carry `schemaVersion`, and there is no deterministic startup/read migration registry.
- **REQ-P2P-17:** Missing. No signed release hash/signature verification or trust-store flow exists for PWA/desktop/mobile upgrades.
- **REQ-P2P-20:** Partial. Signaling TTL and client-side seen-nonce sets exist, but there is no server/client replay cache across requests, malformed-traffic rate limit, behavioral counter, suspicious-peer flag, or peer-priority downgrade path.

## Next Action Items (Ordered)

### P2P-P — Canonical PeerID + Signed P2P Envelope

Implement one shared envelope for discovery, presence ack, signaling, relay fallback, WebRTC data-channel control frames, DM notify, and directed talk offer metadata.

Acceptance:
- Derive stable `peerId = SHA-256(pub)` from the SEA public key and preserve compatibility with existing `userId` paths during migration.
- Add shared helpers for `{ peerId, pub, timestamp, nonce, payloadHash, signature }`.
- Replace placeholder `sig_${pub}_...` signatures with real SEA signing and verification.
- Reject unsigned, modified, stale, or sender/pub mismatched envelopes in server routes and client receive paths.
- Add unit/integration coverage for valid signature, tampered payload, stale timestamp, duplicate nonce, wrong peerId, and legacy compatibility.

### P2P-Q — Signed Handshake + Protocol/Feature Negotiation

Extend direct connection setup beyond `LEDGER_STATE` so peers negotiate capabilities before trusting P2P payloads.

Acceptance:
- On WebRTC open and first Gun/direct exchange, send signed handshake `{ peerId, appName, appVersion, supportedProtocols, features, publicKey, timestamp }`.
- Negotiate the highest common protocol and fail cleanly when there is no overlap.
- Ignore unknown fields/features without crashing; expose local diagnostics for selected protocol and unsupported-feature fallback.
- Add unit/E2E coverage for compatible, downgraded, unsupported, and malformed handshakes.

### P2P-R — Local Trust Levels + Capability Gating

Make the SRS trust model explicit in runtime behavior.

Acceptance:
- Add `trustLevel: 'unknown' | 'friend' | 'verified' | 'blocked'` to the local known-peer/trust model while preserving current labels.
- Gate capabilities by trust level: Unknown has limited broadcast/contact privileges; Friend has normal exchange; Verified enables higher-trust affordances; Blocked receives no communication.
- Ensure reputation can recommend or prioritize but never overrides explicit Blocked or user-set trust.
- Add tests for Unknown defaults, promotion/demotion, Verified behavior, block precedence, and trust surviving reload/export.

### P2P-S — Schema Versions + Deterministic Migration Registry

Unify stored object versioning before more P2P wire changes accumulate.

Acceptance:
- Define schema versions for presence, peer offers, catalog records, pair responses, pair conversations, known people, neighbor cache, ledger events, and local IN/OUT indexes.
- Add deterministic migration functions and a startup/read migrator with idempotency guarantees.
- Add storage inspector diagnostics for current schema versions and pending migrations.
- Add unit tests for v1→current migration and no-op re-run behavior.

### P2P-T — Signed Upgrade Verification

Add release integrity checks for official clients.

Acceptance:
- Define a release manifest format containing version, package hash, signature, signer key id, and supported protocol/schema range.
- Add verification helpers and trust-store configuration for PWA/desktop/mobile packaging.
- Reject unsigned or hash-mismatched releases before install/update.
- Add tests around valid manifest, bad signature, unknown signer, downgrade, and protocol incompatibility warning.

### P2P-U — Fake-Client Defense + Replay/Rate Controls

Harden relay and client receive paths against malformed traffic and abuse.

Acceptance:
- Add bounded nonce replay caches on server relay routes and client peer receive paths.
- Rate-limit malformed signaling/relay/presence traffic by peer/pub/IP where available.
- Track suspicious-peer counters locally and downgrade neighbor priority without trusting `appName`.
- Expose non-secret diagnostics for rejected envelopes and suspicious-peer state.
- Add tests for duplicate nonce, malformed payload floods, stale timestamps, blocked peer attempts, and priority downgrade.

## Shipped (foundation)

| Track | Status | Notes |
|-------|--------|-------|
| P0 Phase B — pair-direct talk delivery | Shipped foundation | Server connects users; `peerTalkOffers`, `peerTalkCatalog`, local IN, `npm run dev:p0-talks`. P1 encrypts/scopes it. |
| P2P-H–O — relay stack | Shipped | See `docs/completed.md` |
| P1 Phase E — pair-private ownership graph | Shipped | See `docs/completed.md` |
| Hub Phase C — relay-only hub | Partial | Ephemeral flags and pair-private app data are in place; production `radata/` removal remains a deployment hardening task. |

## Hub migration track (§19.12)

| Phase | Status | Relation to P1 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | |
| B Client-authoritative talks | Shipped (P0) | P1 moves answers off shared talk node |
| C Relay-only hub (no app `radata/`) | Partial | P1 removes pairwise hub RAM |
| D DHT bootstrap | Not started | Optional |
| **E Pair-private ownership graph** | **Shipped (P1)** | §19.14, §19.14.9–10 |

## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Ephemeral hub profile
```

## Closed Phases (see `docs/completed.md`)

- **P0-1–P0-6** — Direct browser talk exchange over Gun mesh
- **D2–D6**, **E, F, G**, **Direct P2P transport slice**
- **P1 / §19.14 / REQ-P2P-21–29** — Pair-private ownership graph

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
