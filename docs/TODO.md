# IinPublic TODO

Last updated: 2026-06-04

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus — Next SRS gaps after P2P-V/W/X

P2P-Q/R/S/T/U (domain layer) and P2P-V/W/X (runtime wiring) are shipped. The remaining open items are runtime E2E coverage for the handshake frame, and the deployment-hardening Hub Phase C.

## SRS Audit Snapshot (2026-06-04, post P2P-V/W/X)

- **REQ-P2P-14 / 15:** Shipped (domain + WebRTC integration + E2E coverage still pending).
- **REQ-P2P-11 / 12 / 18:** Shipped (domain + delivery filter + trust store persistence).
- **REQ-P2P-13 / 16:** Shipped (domain + server boot logging + web `migrateOnRead`).
- **REQ-P2P-17:** Shipped (domain). Integration into PWA/desktop update flow is a deployment task.
- **REQ-P2P-20:** Shipped (domain + relay routes + client WebRTC session).
- **Hub Phase C:** Partial — ephemeral flags in place; production `radata/` removal remains a deployment task.

## Next Action Items (Ordered)

### P2P-Y — E2E coverage for P2P-Q handshake frame

Add Playwright tests that exercise the handshake frame over a live WebRTC session.

Acceptance:
- Test that `getHandshakeDiagnostics()` returns `handshakeState: 'ok'` and `selectedProtocol: 'iinpublic-p2p-v1'` after two peers connect.
- Test that a client advertising an incompatible protocol list produces `handshakeState: 'failed'` on the remote.
- Reuse existing two-user E2E helpers (`tests/e2e/helpers/talks-matching-flow.ts`).

### P2P-Z — Hub Phase C: remove production radata/

Harden the production relay hub to run with no application-layer Gun persistence.

Acceptance:
- `RELAY_ONLY_HUB=true` in production env.
- Confirm `radata/` directory is absent or empty in the deployed container.
- All signaling, relay, and presence traffic uses in-memory TTL stores only.
- Existing `npm run test:e2e:parallel` continues to pass.

## Shipped

| Track | Status | Notes |
|-------|--------|-------|
| P0 Phase B — pair-direct talk delivery | Shipped | See `docs/completed.md` |
| P2P-H–O — relay stack | Shipped | See `docs/completed.md` |
| P1 Phase E — pair-private ownership graph | Shipped | See `docs/completed.md` |
| P2P-Q — Signed handshake + protocol negotiation | Shipped | `src/shared/p2p-handshake.ts`; WebRTC DataChannel integration. |
| P2P-R — Local trust levels + capability gating | Shipped | `src/shared/p2p-trust.ts`; delivery filter + trust store persistence. |
| P2P-S — Schema versions + migration registry | Shipped | `src/shared/p2p-schema-migrations.ts`; server boot + web `migrateOnRead`. |
| P2P-T — Signed upgrade verification | Shipped | `src/shared/p2p-release-verification.ts`. |
| P2P-U — Fake-client defense domain | Shipped | `src/shared/p2p-abuse-defense.ts`. |
| P2P-V — Abuse defense wired into relay routes | Shipped | `BoundedNonceCache` on all relay POST routes; `P2PAbuseDefenseContext`. |
| P2P-W — Trust levels wired into neighbor cache | Shipped | Delivery filter gate; `getPeerTrustStore`/`putPeerTrustStore`. |
| P2P-X — Schema migrator wired into boot paths | Shipped | Server startup log; web `migrateOnRead`. |
| Hub Phase C — relay-only hub | Partial | Ephemeral flags in place; production `radata/` removal pending. |

## Hub migration track (§19.12)

| Phase | Status | Relation to P1 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | |
| B Client-authoritative talks | Shipped (P0) | |
| C Relay-only hub (no app `radata/`) | Partial | Deployment task |
| D DHT bootstrap | Not started | Optional |
| **E Pair-private ownership graph** | **Shipped (P1)** | §19.14, §19.14.9–10 |

## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Ephemeral hub profile
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
