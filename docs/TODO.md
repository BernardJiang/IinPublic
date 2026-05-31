# IinPublic TODO

Last updated: 2026-05-28

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.14, §19.14.9–10, §19.12 Phase E, REQ-P2P-21–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus (P1)

**Data ownership & visibility zones (spec §19.14, hub Phase E)** — Chatrooms are public discovery only; user data stays on the owner’s device (SEA zone B); pairwise answers and conversations are visible only to the two participants (zone C). Hub must not accumulate O(users²) pairwise state.

**Why:** Star mode stores answers on shared `talks/<talkId>/responses` and server `talkResponsesMap`, which replicates to every talk subscriber and does not scale (e.g. 100 users × 100 talks).

**Design reference (captured 2026-05-28):**

- **SEA + zone B:** `putPrivate` under `gun.user().get('private')` gives **content confidentiality** from other users and the server (no private key). Does **not** hide metadata, stop hub **relay** of ciphertext, or fix data still on **public** paths. Clients must not subscribe to others’ soul trees (§19.14.9).
- **Zone C dedup (Bob → Alice + Tom, same talk):** One talk body in Bob’s **outbox/catalog**; small **announcements** per room; **per-receiver offers** (P1: ref + ciphertext, not N× full JSON); **per-pair** `pair(bob,alice)` vs `pair(bob,tom)` for answers — not global `talks/<id>/responses` (§19.14.10, REQ-P2P-29).
- **P0 gap:** `PeerTalkOfferWire` may still duplicate full `talkData` per receiver until P1 offer encryption + catalog pull.

**Exit criteria (P1 done when):**

- Alice’s manual answer to Bob’s talk is stored under **pair-private** paths (SEA), not global `talks/<id>/responses`.
- Tom (same chatroom, received same announcement) cannot read Alice↔Bob response or DM data via Gun or hub APIs.
- Chatroom Gun paths hold **announcements + membership** only (no full talk bodies or responses on room nodes).
- Hub does not grow unbounded `talkResponsesMap` / authoritative `incomingTalksMap` for application history.
- Same `talkId` to N receivers: **one** canonical body in author outbox/catalog; offers use catalog ref where possible (REQ-P2P-29).
- E2E proves third-party isolation (extend or add spec beside `00i-p0-direct-talk-delivery`).

## Next Action Items (Ordered) — P1 Ownership Graph

1. **P1-1 Graph envelope** — Add `visibility` + `roomId` / `ownerPub` / `pairId` on writes; clients subscribe only to allowed paths (REQ-P2P-21).
2. **P1-2 Zone A chatroom** — `chatrooms/<room>/announcements/*` only; stop putting full talk JSON on `chatrooms/.../talks` for production path (REQ-P2P-22).
3. **P1-3 Zone B user-private (SEA)** — Move IN index + outbox to `~<pub>/private/…` via `putPrivate`; document non-goals (metadata, public-path migration); hub skip via relay-only (REQ-P2P-23, §19.14.9).
4. **P1-4 Zone C pair-private + offer dedup** — `pair/{pairId}/responses`, `pair/.../conversation/...`; SEA encrypt offers; prefer `peerTalkCatalog` + `catalogRef` over N× full `talkData` on offers (REQ-P2P-24, REQ-P2P-28, REQ-P2P-29, §19.14.10).
5. **P1-5 Server/API scope** — Remove long-lived `talkResponsesMap` authority; creator Replies reads outbox + `pair(bob,*)` edges (REQ-P2P-27, REQ-P2P-26).
6. **P1-6 E2E isolation** — Bob + Alice + Tom: Alice answers Bob; Tom sees announcement only, not answer; optional assert single catalog body for shared `talkId` (REQ-P2P-24 acceptance).

## Shipped (foundation)

| Track | Status | Notes |
|-------|--------|-------|
| P0 Phase B — mesh talk delivery | Shipped | `peerTalkOffers`, `peerTalkCatalog`, local IN, `npm run dev:p0-talks` |
| P2P-H–O — relay stack | Shipped | See `docs/completed.md` |
| Hub Phase C — relay-only hub | Partial | Ephemeral flags; P1 completes ownership |

## Hub migration track (§19.12)

| Phase | Status | Relation to P1 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | |
| B Client-authoritative talks | Shipped (P0) | P1 moves answers off shared talk node |
| C Relay-only hub (no app `radata/`) | Partial | P1 removes pairwise hub RAM |
| D DHT bootstrap | Not started | Optional |
| **E Pair-private ownership graph** | **In progress (P1)** | §19.14, §19.14.9–10 |

## Deferred (after P1)

Identity/trust/versioning (§19.13, P2P-P–U), optional D4 creator-edit checks, full `npm run test:e2e:parallel` gate.

| Phase | Status | Notes |
|-------|--------|-------|
| P2P-P PeerID + wire envelope | Deferred | REQ-P2P-09, 10, 19 |
| P2P-Q Handshake + protocol negotiation | Deferred | Partial today |
| P2P-R Trust levels + gating | Deferred | Partial today |
| P2P-S Schema migrations | Deferred | |
| P2P-T Signed upgrades | Deferred | |
| P2P-U Fake-client defense | Deferred | Partial today |

## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Ephemeral hub profile
```

## Closed Phases (see `docs/completed.md`)

- **P0-1–P0-6** — Direct browser talk exchange over Gun mesh
- **D2–D6**, **E, F, G**, **Direct P2P transport slice**

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Do not start P2P-P–U until P1 exit criteria pass unless a task explicitly depends on them.
