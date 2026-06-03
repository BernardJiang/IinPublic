# IinPublic TODO

Last updated: 2026-06-03

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
- **P0 gap:** `PeerTalkOfferWire` may still duplicate full `talkData` per receiver until P1 offer encryption + catalog pull.

**Exit criteria (P1 done when):**

- Alice’s manual answer to Bob’s talk is stored under **pair-private** paths (SEA), not global `talks/<id>/responses`.
- Tom (same chatroom, received same announcement) cannot read Alice↔Bob response or DM data via Gun or hub APIs.
- Chatroom Gun paths hold **announcements + membership** only (no full talk bodies or responses on room nodes).
- Hub does not grow unbounded `talkResponsesMap` / authoritative `incomingTalksMap` for application history.
- Same `talkId` to N receivers: **one** canonical body in author outbox/catalog; offers use catalog ref where possible (REQ-P2P-29).
- E2E proves third-party isolation (extend or add spec beside `00i-p0-direct-talk-delivery`).

## Audit Snapshot (2026-06-03)

`npm run test:e2e:parallel` passed before this audit, but the suite still contains helpers and compatibility paths from the server-authoritative model. The target model is: server connects every pair; all talk exchange after that is direct pair traffic. The current implementation is still not Phase E/P1-compliant with `docs/specs/iinpublic-technical-specification.md` §19.14:

- `src/server/index.ts` still keeps `incomingTalksMap`, `talkResponsesMap`, writes `talks/<talkId>/responses/*`, and writes server-visible `conversations/*` / `users/<id>/conversations/*`.
- `src/web/services/web-talk-service.ts` still submits answers through `POST /api/talks/:id/response`.
- `src/server/routes/peer-routes.ts` still builds creator Replies, relationship stats, and talk history from server `incomingTalksMap` + `talkResponsesMap`.
- `src/shared/peer-talk-delivery.ts` / `src/web/services/client-peer-talk-delivery.ts` still put full plaintext `talkData` on each `peerTalkOffers/<receiver>/<sender::talkId>` entry.
- `src/web/services/client-incoming-talk-mirror.ts` still mirrors incoming clusters to public `incomingTalksByUser/<userId>` and talk bodies to public `talks/<talkId>` when client mirroring is enabled.
- SEA helpers exist (`WebGunService.putPrivate` / `getPrivate`) and are used for private user data, but IN/outbox, pair responses, and non-TechSupport conversation bodies are not yet migrated to the target zone B/C graph.

## Next Action Items (Ordered) — P1 Ownership Graph

1. **P1-0 E2E model switch** — Treat pair-direct delivery as the default E2E model. Keep star/server-authoritative tests only behind explicit legacy commands. Update helpers/spec docs so incoming talk assertions use receiver local Gun/UI, not `/api/users/:id/incoming-talks`; answer submission flows should exercise client pair writes, not `POST /api/talks/:id/response`.
2. **P1-1 Server connector contract** — Define the allowed server role: room membership, presence, peer lookup, signed handshake/signaling, relay TTL metadata, and TechSupport exception only. Add tests that fail if normal talks, answers, pair histories, or DM bodies are accepted as durable server authority.
3. **P1-2 Write envelope + path audit** — Introduce a typed ownership envelope for application graph writes (`visibility: 'room' | 'user' | 'pair'`, plus `roomId` / `ownerPub` / `pairId`) and route new writes through it. Add tests that fail on unenveloped writes to public `talks/*`, `incomingTalksByUser/*`, `peerTalkOffers/*`, `peerTalkCatalog/*`, `conversations/*`, and `users/*/conversations/*` when the data is not zone A.
4. **P1-3 Zone A announcements only** — Replace full talk-body broadcast on room/discovery paths with `chatrooms/<room>/announcements/*` pointers (`talkId`, `authorId`, title, type, timestamps, targeting metadata). Keep room membership/presence public; stop writing full talk JSON, responses, or inbox clusters to room/public discovery nodes.
5. **P1-4 Zone B owner outbox + IN index** — Move authored talk bodies, outbox/catalog state, and received IN clusters to `~<ownerPub>/private/...` via `putPrivate` (or device-local Gun only). Keep `peerTalkCatalog` as compatibility during migration, but make the owner-private outbox/catalog the source of truth.
6. **P1-5 Offer encryption + catalog refs** — Change `PeerTalkOfferWire` from full plaintext `talkData` per receiver to a directed envelope with `catalogRef` / `talkId`, receiver identity, nonce/timestamp, and SEA ciphertext. Preserve the current full-body offer only behind an explicit migration/test fallback until catalog pull is reliable.
7. **P1-6 Pair-private responses** — Replace `POST /api/talks/:id/response` as the authoritative response path with client-side pair writes under deterministic `pairId = sort(pubA, pubB)` paths. Store manual/auto answer payloads as SEA ciphertext readable only by the two participants; stop writing production answers to `talks/<talkId>/responses/*`.
8. **P1-7 Pair-private conversations** — Move non-TechSupport conversation bodies and per-user conversation lists off server/public Gun paths into pair-private encrypted graph entries. Keep server relay/diagnostics metadata only; TechSupport remains the allowed server-stored exception.
9. **P1-8 Server/API scope reduction** — Retire `talkResponsesMap` and authoritative `incomingTalksMap` for application history. Rework creator Replies, relationship stats, talk history, and stats views to read owner outbox plus pair edges the viewer is allowed to decrypt. Hub memory must scale with presence/signaling/TTL metadata, not O(users²) talk history.
10. **P1-9 Third-party isolation E2E** — Add Bob/Alice/Tom tests: Bob sends one `talkId` to Alice and Tom; Alice answers; Tom can see only the room announcement/directed offer intended for Tom and cannot read Alice↔Bob response, match thread, or DM content via Gun or hub APIs. Include a regression check that only one canonical talk body exists for the shared `talkId`.
11. **P1-10 Migration gates** — Add a production/P1 runtime guard that rejects new public writes to deprecated paths (`talks/<id>/responses`, full-body `peerTalkOffers`, public `incomingTalksByUser`, non-TechSupport `conversations`) unless an explicit legacy compatibility flag is enabled.

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
