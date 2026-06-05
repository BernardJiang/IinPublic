# IinPublic TODO

Last updated: 2026-06-04

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus — Wire-up P2P-Q/R/U into runtime paths

P2P-Q, P2P-R, P2P-S, P2P-T, and P2P-U are shipped (shared domain + unit tests).  The next step is to wire the new modules into the live server relay routes and client receive paths so that runtime traffic actually benefits from the new defenses.

## SRS Audit Snapshot (2026-06-04, post P2P-Q/R/S/T/U)

Checked current implementation against `docs/specs/iinpublic-technical-specification.md` §19.13 and §19.14.

- **§19.14 / REQ-P2P-21–29:** Shipped. See `docs/completed.md`.
- **REQ-P2P-09:** Shipped. See `docs/completed.md`.
- **REQ-P2P-10 / 19:** Shipped. See `docs/completed.md`.
- **REQ-P2P-14 / 15:** Shipped (domain). `p2p-handshake.ts` + WebRTC integration sends/receives signed handshake on DataChannel open and negotiates protocol. Runtime E2E coverage for the new handshake frame is not yet written.
- **REQ-P2P-11 / 12 / 18:** Shipped (domain). `p2p-trust.ts` defines `TrustLevel`, capability gates, and export/import. Not yet wired into the live neighbor cache or delivery filter paths.
- **REQ-P2P-13 / 16:** Shipped (domain). `p2p-schema-migrations.ts` covers all stored object kinds with deterministic v0→v1 migration and startup runner. Startup call not yet inserted in server/web boot paths.
- **REQ-P2P-17:** Shipped (domain). `p2p-release-verification.ts` with manifest format, trust store, and verification. Not yet integrated into PWA/desktop update flow.
- **REQ-P2P-20:** Shipped (domain). `p2p-abuse-defense.ts` — `BoundedNonceCache`, `P2PRateLimiter`, `SuspiciousPeerTracker`, `P2PAbuseDefenseContext`. Not yet instantiated on server relay routes or client receive paths.

## Next Action Items (Ordered)

### P2P-V — Wire P2P-U abuse defense into relay routes + client receive paths

Connect `P2PAbuseDefenseContext` to live traffic.

Acceptance:
- Instantiate a server-side `P2PAbuseDefenseContext` in the relay-route middleware; call `checkInbound` before processing each signaling/relay/presence envelope.
- Instantiate a per-session `BoundedNonceCache` on the client `P2PConversationSession` (replace the current unbounded `Set`).
- Surface `getDiagnostics()` output on `GET /api/debug/p2p-abuse` (test/debug only, behind `E2E_GUN_MEMORY_ONLY` flag).
- Add integration tests for rate-limit rejection and nonce-replay rejection on server relay routes.

### P2P-W — Wire P2P-R trust levels into neighbor cache + delivery filter

Connect `p2p-trust.ts` to live peer interaction.

Acceptance:
- Map `PeerTrustRecord.trustLevel` to `P2PNeighborRecord.trustStatus` via `toLegacyTrustStatus` on every upsert.
- Enforce `isTrustCapable` before accepting incoming talks and before routing direct messages.
- Persist `PeerTrustRecord` map under the user's SEA-encrypted Gun path.
- Add integration/E2E test that a blocked peer's delivery attempt is rejected.

### P2P-X — Wire P2P-S schema migrator into boot paths

Run `runStartupMigrations` at server and web startup.

Acceptance:
- Server: call migrator on Gun-loaded records before serving them; log pending-migration counts.
- Web: call migrator on read from localStorage / Gun before handing records to services.
- Add E2E smoke test that a v0 stored record is transparently upgraded on read.

## Shipped (foundation)

| Track | Status | Notes |
|-------|--------|-------|
| P0 Phase B — pair-direct talk delivery | Shipped foundation | Server connects users; `peerTalkOffers`, `peerTalkCatalog`, local IN, `npm run dev:p0-talks`. P1 encrypts/scopes it. |
| P2P-H–O — relay stack | Shipped | See `docs/completed.md` |
| P1 Phase E — pair-private ownership graph | Shipped | See `docs/completed.md` |
| Hub Phase C — relay-only hub | Partial | Ephemeral flags and pair-private app data are in place; production `radata/` removal remains a deployment hardening task. |
| P2P-Q — Signed handshake + protocol/feature negotiation | Shipped (domain + WebRTC integration) | `src/shared/p2p-handshake.ts`; DataChannel sends `handshake` frame on open, negotiates protocol. See `docs/completed.md`. |
| P2P-R — Local trust levels + capability gating | Shipped (domain) | `src/shared/p2p-trust.ts`; `TrustLevel`, `isTrustCapable`, promotion/demotion rules, export/import. See `docs/completed.md`. |
| P2P-S — Schema versions + deterministic migration registry | Shipped (domain) | `src/shared/p2p-schema-migrations.ts`; all stored-object kinds, v0→v1 steps, idempotent migrator. See `docs/completed.md`. |
| P2P-T — Signed upgrade verification | Shipped (domain) | `src/shared/p2p-release-verification.ts`; release manifest, trust-store, verifier. See `docs/completed.md`. |
| P2P-U — Fake-client defense + replay/rate controls | Shipped (domain) | `src/shared/p2p-abuse-defense.ts`; `BoundedNonceCache`, `P2PRateLimiter`, `SuspiciousPeerTracker`, `P2PAbuseDefenseContext`. See `docs/completed.md`. |

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
