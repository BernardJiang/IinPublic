# IinPublic TODO

Last updated: 2026-05-30

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.2, §19.12 Phase B–C)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus (P0)

**Direct browser talk exchange (spec §19.2, §19.12 Phase B)** — Two browsers must deliver talks peer-to-peer and persist on each device’s local Gun DB. The server is **relay-only**: ephemeral presence, peer ack, and WebRTC signaling so peers find each other; **not** authoritative for talk bodies or incoming inbox.

**Exit criteria (P0 done when):**

- Alice broadcasts → Bob’s IN list and `talks/<id>` populate from **mesh/local Gun** without `POST register-receivers` / `incomingTalksMap` being required.
- Bob can open the talk after **server restart with no application talk/inbox in `radata/`** (hub still serves presence/signaling).
- E2E proves two-browser delivery under `npm run dev:relay-only` (or equivalent flags).

## Next Action Items (Ordered) — P0 Direct Talk Exchange

1. **P0-1 Local-first OUT write** — Sender always `put`s full talk to local Gun (`talks/<id>`) before any hub write; treat hub `radata/` as optional cache/fallback read only (`STAR_SERVER_PERSISTENCE=ephemeral` / `RELAY_ONLY_HUB` on talk paths).
2. **P0-2 Mesh delivery path** — After presence + ack, push talk to neighbors over Gun mesh / WebRTC (announcement + full talk payload or pull-by-id from peer), not bulk `POST /register-receivers-for-broadcast`.
3. **P0-3 Local-first IN index** — Receiver builds IN from `incomingTalksByUser/<userId>/<identityKey>` on **local Gun** (subscribe + P2P-L mirror as source of truth); demote `GET /api/users/:id/incoming-talks` to bootstrap/fallback only.
4. **P0-4 Retire server inbox authority** — Gate or remove `incomingTalksMap` writes on broadcast/delivery; keep filters/match logic on server only where unavoidable until client-side parity exists.
5. **P0-5 Chatroom announce → peer pull** — `chatrooms/<room>/talks/<key>` triggers fetch from announcer’s mesh endpoint (or signed talk envelope), not dependency on server holding the full talk.
6. **P0-6 E2E: relay-only two-browser talks** — New or extended staged spec: Alice + Bob, hub relay-only, talk in Bob’s local Gun + IN after hub wipe/restart (no server `radata/` talk copy required).

## Deferred (after P0)

Identity/trust/versioning (§19.13, P2P-P–U), optional D4 creator-edit checks, and full `npm run test:e2e:parallel` release gate — resume once P0 exit criteria pass.

| Phase | Status | Notes |
|-------|--------|-------|
| P2P-P PeerID + wire envelope | Deferred | REQ-P2P-09, 10, 19 |
| P2P-Q Handshake + protocol negotiation | Deferred | Partial today |
| P2P-R Trust levels + gating | Deferred | Partial today |
| P2P-S Schema migrations | Deferred | |
| P2P-T Signed upgrades | Deferred | |
| P2P-U Fake-client defense | Deferred | Partial today |

## P2P Stack — Persistence & Relay (§19.9) — Shipped (foundation for P0)

| Phase | Status |
|-------|--------|
| P2P-H Gun write-through transport | Shipped |
| P2P-I Presence + peer ack | Shipped — **keep** for “find each other” |
| P2P-J Browser durable Gun (worker IndexedDB) | Shipped |
| P2P-K No server convo radata (ephemeral/relay flags) | Shipped — **extend** to talk paths in P0-1 |
| P2P-L Client incoming/talk Gun mirror | Shipped — **promote** to primary IN path in P0-3 |
| P2P-M Relay-only deploy profile (`npm run dev:relay-only`) | Shipped — **use** for P0 E2E |
| P2P-N TechSupport server store | Shipped — exception only |
| P2P-O Local node bridge probe | Shipped |

## Hub migration track (§19.12)

| Phase | Status | Relation to P0 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | P0-2 builds on this |
| **B Client-authoritative talks** | **In progress (P0)** | Top priority |
| C Relay-only hub (no app `radata/`) | Not started | P0 exit criteria ⊆ Phase C |
| D DHT bootstrap | Not started | Optional |

## Closed Phases (see `docs/completed.md`)

- **D2–D6** — UI localization, filters, lifecycle, triage, tab sweep
- **E, F, G** — Interaction ledger, delta sync, CIDv1 sole truth
- **Direct P2P transport slice** — signaling, WebRTC, fallback, E2E (persistence superseded by §19.4)

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Do not start P2P-P–U until P0 exit criteria are met unless a P0 item explicitly depends on one of them.
