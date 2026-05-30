# IinPublic TODO

Last updated: 2026-05-28

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus

**P2P production model (spec §19)** — WebRTC as **communication channel**; **Gun local DB** as durable store; relay-only `www.iinpublic.com`. **Stack-only — no UI changes.**

Deprecated persistence policy: `docs/TODO-direct-p2p.md` (RAM-only DMs). Transport code is reused under **P2P-H**.

## Next Action Items (Ordered)

1. **P2P-H** — Gun write-through on direct P2P transport: `sendMessage` / receive → `gun.put` at `conversations/{id}/messages/`; WebRTC carries sync only.
2. **P2P-I** — Ephemeral presence API (`POST /api/presence/register`, `GET /api/presence/nearby`) + signed peer-ack handshake.
3. **P2P-J** — Durable browser Gun storage (enable radisk in worker bridge / `GunBridge`).
4. **P2P-K** — Feature-flagged stop of server `radata/` persistence for peer conversations (`STAR_SERVER_PERSISTENCE=ephemeral` migration step).
5. **P2P-L** — Client-side talk delivery fanout over Gun mesh; reduce server `incomingTalksMap` authority.
6. **P2P-M** — Relay-only production deploy profile (static SPA + relay service; no application `radata/` on hub).
7. **P2P-N** — TechSupport server-side message store (only server-durable chat exception per §19.7).
8. **P2P-O** — Local node localhost bridge / supervisor API (stack; packaging later).
9. **D4 (optional)** — creator edit/state-preservation checks after OUT/IN rebroadcast.

## P2P Stack Phases (spec §19.9)

| Phase | Status |
|-------|--------|
| P2P-H Gun write-through transport | Not started |
| P2P-I Presence + peer ack | Not started |
| P2P-J Browser durable Gun | Not started |
| P2P-K No server convo radata | Not started |
| P2P-L Client talk mesh fanout | Not started |
| P2P-M Relay-only deploy profile | Not started |
| P2P-N TechSupport server store | Not started |
| P2P-O Local node bridge | Not started |

## Closed Phases (see `docs/completed.md`)

- **D2–D6** — UI localization, filters, lifecycle, triage, tab sweep
- **E, F, G** — Interaction ledger, delta sync, CIDv1 sole truth
- **Direct P2P transport slice** — signaling, WebRTC, fallback, E2E (persistence model superseded by §19.4)

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md`.
- Do not add UI tasks for P2P-H–O unless spec §19.6 constraints change.
