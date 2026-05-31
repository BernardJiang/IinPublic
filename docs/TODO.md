# IinPublic TODO

Last updated: 2026-05-30

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.2, §19.12 Phase B–C)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus

**P0 direct talk exchange — shipped** (see `docs/completed.md` 2026-05-30). Next: optional hardening (hub restart E2E, default `dev` flag), then deferred P2P-P–U.

**Run P0 locally / E2E:**
- `npm run dev:p0-talks`
- `npm run test:e2e:p0-talks`

## Deferred (after P0)

Identity/trust/versioning (§19.13, P2P-P–U), optional D4 creator-edit checks, and full `npm run test:e2e:parallel` release gate.

| Phase | Status | Notes |
|-------|--------|-------|
| P2P-P PeerID + wire envelope | Deferred | REQ-P2P-09, 10, 19 |
| P2P-Q Handshake + protocol negotiation | Deferred | Partial today |
| P2P-R Trust levels + gating | Deferred | Partial today |
| P2P-S Schema migrations | Deferred | |
| P2P-T Signed upgrades | Deferred | |
| P2P-U Fake-client defense | Deferred | Partial today |

## P2P Stack — Persistence & Relay (§19.9) — Shipped

| Phase | Status |
|-------|--------|
| P2P-H Gun write-through transport | Shipped |
| P2P-I Presence + peer ack | Shipped |
| P2P-J Browser durable Gun (worker IndexedDB) | Shipped |
| P2P-K No server convo radata (ephemeral/relay flags) | Shipped |
| P2P-L Client incoming/talk Gun mirror | Shipped |
| P2P-M Relay-only deploy profile (`npm run dev:relay-only`) | Shipped |
| P2P-N TechSupport server store | Shipped |
| P2P-O Local node bridge probe | Shipped |
| **P0 Phase B — client-authoritative talks** | **Shipped** |

## Hub migration track (§19.12)

| Phase | Status | Relation to P0 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | P0 builds on this |
| **B Client-authoritative talks** | **Shipped (P0)** | `peerTalkOffers`, local IN, mesh catalog |
| C Relay-only hub (no app `radata/`) | Partial | P0 E2E uses ephemeral hub; full hub-wipe spec optional |
| D DHT bootstrap | Not started | Optional |

## Closed Phases (see `docs/completed.md`)

- **P0-1–P0-6** — Direct browser talk exchange over Gun mesh
- **D2–D6** — UI localization, filters, lifecycle, triage, tab sweep
- **E, F, G** — Interaction ledger, delta sync, CIDv1 sole truth
- **Direct P2P transport slice** — signaling, WebRTC, fallback, E2E (persistence superseded by §19.4)

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Do not start P2P-P–U until explicitly prioritized.
