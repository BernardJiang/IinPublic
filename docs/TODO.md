# IinPublic TODO

Last updated: 2026-05-30

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19, §19.13)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus

**P2P identity, trust, versioning, and upgrades (spec §19.13)** — phases P2P-P–U. Persistence/relay stack P2P-H–O is shipped.

## Next Action Items (Ordered)

1. **P2P-P** — `PeerID = HASH(pub)` on wire; signed envelope (`peerId`, `timestamp`, `nonce`, `signature`) for discovery, signaling, DM notify.
2. **P2P-Q** — Connection handshake + `supportedProtocols` / `features` negotiation; fail closed when no overlap (extend `LEDGER_STATE` path).
3. **P2P-R** — Trust levels Unknown / Friend / Verified / Blocked + capability gating (align `KnownPerson` with §19.13.3).
4. **P2P-S** — `schemaVersion` on stored objects + deterministic migration registry (local Gun).
5. **P2P-T** — Signed release verification (hash + signature + trust store) for client upgrades.
6. **P2P-U** — Fake-client defense: replay nonce cache, behavioral counters, relay rate limits.
7. **D4 (optional)** — creator edit/state-preservation checks after OUT/IN rebroadcast.
8. **Release gate** — `npm run test:e2e:parallel` (PW_WORKERS=20); fix `00-broadcast-boundary-match` flake.

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

## P2P Stack — Identity, Trust, Versioning (§19.13) — Next

| Phase | Status | Spec |
|-------|--------|------|
| P2P-P PeerID + wire message envelope | Not started | REQ-P2P-09, 10, 19 |
| P2P-Q Handshake + protocol negotiation | Partial (`LEDGER_STATE`, discovery v1) | REQ-P2P-14, 15 |
| P2P-R Trust levels + capability gating | Partial (friend labels, blocks) | REQ-P2P-11 |
| P2P-S Schema version + migrations | Not started | REQ-P2P-16 |
| P2P-T Signed upgrade verification | Not started | REQ-P2P-17 |
| P2P-U Fake-client defense + rate limits | Partial (ack, signaling TTL) | REQ-P2P-18, 20 |

Requirements **REQ-P2P-09** through **REQ-P2P-20** are defined in spec §3.12 and §19.13.

## Closed Phases (see `docs/completed.md`)

- **D2–D6** — UI localization, filters, lifecycle, triage, tab sweep
- **E, F, G** — Interaction ledger, delta sync, CIDv1 sole truth
- **Direct P2P transport slice** — signaling, WebRTC, fallback, E2E (persistence superseded by §19.4)

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md` and acceptance tables in spec §19.13.13.
