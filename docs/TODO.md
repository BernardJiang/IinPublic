# IinPublic TODO

Last updated: 2026-06-04

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## SRS Audit Snapshot (2026-06-04, all P2P-Q–Z shipped)

- **REQ-P2P-09:** Shipped. Canonical `peerId = SHA-256(pub)` on all relay/direct/discovery paths.
- **REQ-P2P-10 / 19:** Shipped. SEA signing/verification on all relay routes; stale/tampered/duplicate envelopes rejected.
- **REQ-P2P-11 / 12 / 18:** Shipped. `TrustLevel` model + capability gates + delivery filter gate + SEA-encrypted trust store.
- **REQ-P2P-13 / 16:** Shipped. Schema version registry for all stored kinds; server boot logging; web `migrateOnRead`.
- **REQ-P2P-14 / 15:** Shipped. Signed handshake frame on DataChannel open; protocol negotiation; E2E coverage.
- **REQ-P2P-17:** Shipped (domain). `p2p-release-verification.ts` — deployment integration is a separate task.
- **REQ-P2P-20:** Shipped. `BoundedNonceCache` + `P2PRateLimiter` + `SuspiciousPeerTracker` on all relay POST routes and client WebRTC session.
- **REQ-P2P-21–29:** Shipped. Pair-private ownership graph. See `docs/completed.md`.
- **Hub Phase C:** Shipped. `RELAY_ONLY_HUB=1` sets `radisk:false`; startup guard warns on stale radata/; `/api/debug/relay-only-status` endpoint; integration tests pass.

## No open action items

All SRS §19.13 and §19.14 items are complete. See `docs/TODO-backlog-inventory.md` for optional future tracks (DHT bootstrap, P2P-T deployment integration, Hub Phase D).

## Shipped

| Track | Status | Notes |
|-------|--------|-------|
| P0 Phase B — pair-direct talk delivery | Shipped | See `docs/completed.md` |
| P2P-H–O — relay stack | Shipped | See `docs/completed.md` |
| P1 Phase E — pair-private ownership graph | Shipped | See `docs/completed.md` |
| P2P-Q — Signed handshake + protocol negotiation | Shipped | Domain + WebRTC + E2E. |
| P2P-R — Local trust levels + capability gating | Shipped | Domain + delivery filter + trust store. |
| P2P-S — Schema versions + migration registry | Shipped | Domain + server boot + web `migrateOnRead`. |
| P2P-T — Signed upgrade verification | Shipped | Domain. Deployment integration is optional. |
| P2P-U — Fake-client defense domain | Shipped | `p2p-abuse-defense.ts`. |
| P2P-V — Abuse defense wired into relay routes | Shipped | `BoundedNonceCache` + `P2PAbuseDefenseContext` on all relay POST routes. |
| P2P-W — Trust levels wired into neighbor cache | Shipped | Delivery filter gate + `getPeerTrustStore`/`putPeerTrustStore`. |
| P2P-X — Schema migrator wired into boot paths | Shipped | Server startup log + web `migrateOnRead`. |
| P2P-Y — Handshake E2E coverage | Shipped | Two-peer ok + incompatible-protocol failed tests. |
| P2P-Z — Hub Phase C relay-only hub | Shipped | `radisk:false` + startup guard + `/api/debug/relay-only-status` + integration tests. |

## Hub migration track (§19.12)

| Phase | Status | Relation to P1 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | |
| B Client-authoritative talks | Shipped (P0) | |
| C Relay-only hub (no app `radata/`) | **Shipped (P2P-Z)** | `RELAY_ONLY_HUB=1` enforced |
| D DHT bootstrap | Not started | Optional |
| **E Pair-private ownership graph** | **Shipped (P1)** | §19.14, §19.14.9–10 |

## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Relay-only hub (RELAY_ONLY_HUB=1)
npm run test:e2e:parallel     # Full E2E suite in direct mode
npm run test:e2e:star         # Star-gun relay regression
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
