# IinPublic TODO

Last updated: 2026-05-28

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus

**P2P production model (spec §19)** — stack phases P2P-H–O are shipped. Next: optional D4 creator-edit checks; run `npm run test:e2e:parallel` before release.

## Next Action Items (Ordered)

1. **D4 (optional)** — creator edit/state-preservation checks after OUT/IN rebroadcast.
2. **Release gate** — `npm run test:e2e:parallel` (PW_WORKERS=20).

## P2P Stack Phases (spec §19.9)

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

## Closed Phases (see `docs/completed.md`)

- **D2–D6** — UI localization, filters, lifecycle, triage, tab sweep
- **E, F, G** — Interaction ledger, delta sync, CIDv1 sole truth
- **Direct P2P transport slice** — signaling, WebRTC, fallback, E2E (persistence superseded by §19.4)

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md`.
