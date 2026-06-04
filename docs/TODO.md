# IinPublic TODO

Last updated: 2026-06-04

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.14, §19.14.9–10, §19.12 Phase E, REQ-P2P-21–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Current Focus (P1)

**Server-as-connector, pair-direct talk exchange (spec §19.14, hub Phase E)** — The server may help users discover rooms, register presence, and connect pairs. After connection, talks, answers, match threads, and non-TechSupport conversations must exchange directly between the pair and persist only on participant-controlled graphs/devices. Chatrooms are public discovery only; user data stays on the owner’s device (SEA zone B); pairwise answers and conversations are visible only to the two participants (zone C). Hub must not accumulate O(users²) pairwise state.

**Why:** Star mode stores answers on shared `talks/<talkId>/responses` and server `talkResponsesMap`, which replicates to every talk subscriber and does not scale (e.g. 100 users × 100 talks).

**Design reference (captured 2026-05-28):**

- **SEA + zone B:** `putPrivate` under `gun.user().get('private')` gives **content confidentiality** from other users and the server (no private key). Does **not** hide metadata, stop hub **relay** of ciphertext, or fix data still on **public** paths. Clients must not subscribe to others’ soul trees (§19.14.9).
- **Zone C dedup (Bob → Alice + Tom, same talk):** One talk body in Bob’s **outbox/catalog**; small **announcements** per room; **per-receiver offers** (P1: ref + ciphertext, not N× full JSON); **per-pair** `pair(bob,alice)` vs `pair(bob,tom)` for answers — not global `talks/<id>/responses` (§19.14.10, REQ-P2P-29).
- **P1 closure:** the ordered P1 ownership-graph implementation list below is complete, and the full direct-mode `npm run test:e2e:parallel` gate passed on 2026-06-04.

**Exit criteria (P1 done when):**

- Alice’s manual answer to Bob’s talk is stored under **pair-private** paths (SEA), not global `talks/<id>/responses`.
- Tom (same chatroom, received same announcement) cannot read Alice↔Bob response or DM data via Gun or hub APIs.
- Chatroom Gun paths hold **announcements + membership** only (no full talk bodies or responses on room nodes).
- Hub does not grow unbounded `talkResponsesMap` / authoritative `incomingTalksMap` for application history.
- Same `talkId` to N receivers: **one** canonical body in author outbox/catalog; offers use catalog ref where possible (REQ-P2P-29).
- E2E proves third-party isolation (extend or add spec beside `00i-p0-direct-talk-delivery`).

## Audit Snapshot (2026-06-04)

Direct-mode E2E now exercises client pair writes instead of `POST /api/talks/:id/response`. The server response endpoint rejects direct-mode answer submission, `test:e2e:parallel` defaults to direct mode, offers are catalog-ref metadata without full `talkData`, and direct-mode local IN writes use `ownerIncomingTalkIndex` instead of public `incomingTalksByUser`.

Phase E/P1 status against `docs/specs/iinpublic-technical-specification.md` §19.14:

- Pair response payloads under `pairTalkResponses/<pairId>/...` are pair-scoped SEA ciphertext with routing metadata only.
- Non-TechSupport conversation bodies write to pair-scoped encrypted paths in direct mode.
- Direct-mode Creator Replies, relationship stats, and talk-history server APIs no longer expose hub-derived pair history; clients should use local owner/pair graph state.
- Chatroom delivery writes metadata announcements to `chatrooms/<room>/announcements/*`; legacy `talks` read fallback remains for migration.
- Third-party isolation E2E proves Bob/Alice/Tom response and DM ciphertext isolation plus one canonical talk body.
- Full direct-mode verification passed: `npm run test:e2e:parallel` — 96 passed, 2 skipped.

## Next Action Items (Ordered) — P1 Ownership Graph

No open P1 ownership-graph action items remain in this file. New work should be added here only after checking `docs/completed.md` and the spec audit above.

## Shipped (foundation)

| Track | Status | Notes |
|-------|--------|-------|
| P0 Phase B — pair-direct talk delivery | Shipped foundation | Server connects users; `peerTalkOffers`, `peerTalkCatalog`, local IN, `npm run dev:p0-talks`. P1 encrypts/scopes it. |
| P2P-H–O — relay stack | Shipped | See `docs/completed.md` |
| Hub Phase C — relay-only hub | Partial | Ephemeral flags; P1 completes ownership |

## Hub migration track (§19.12)

| Phase | Status | Relation to P1 |
|-------|--------|----------------|
| A Dual-mode mesh + signaling | Partial | |
| B Client-authoritative talks | Shipped (P0) | P1 moves answers off shared talk node |
| C Relay-only hub (no app `radata/`) | Partial | P1 removes pairwise hub RAM |
| D DHT bootstrap | Not started | Optional |
| **E Pair-private ownership graph** | **Shipped (P1)** | §19.14, §19.14.9–10 |

## Deferred (after P1)

Identity/trust/versioning (§19.13, P2P-P–U) and optional D4 creator-edit checks.

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
