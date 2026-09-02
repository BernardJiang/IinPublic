# Design option: alternatives to Gun.js for the data layer

Status: exploratory — not scheduled, not started. Captured 2026-09-02 after a live investigation
found a reproducible correctness bug in Gun's server-side write path (see "Why this came up"
below). The team decided to keep the current Gun-based design for now and revisit later; this
doc exists so that decision doesn't have to be re-derived from scratch next time.

## Why this came up

While debugging "boot slowness" and a related TechSupport-messaging issue, a minimal,
project-independent reproduction showed that `gun@^0.2020.1241` (the pinned version, and still
the latest release on npm — there is no newer version to upgrade to) silently fails to complete
multi-level chained writes (`gun.get(a).get(b).get(c).get(d).put(data)`) when running with no
peers / AXE disabled — which is this project's **permanent** server configuration
(`src/shared/p2p-runtime.ts`'s hardcoded `starServerPersistence: 'ephemeral'`, and
`render.yaml`'s `RELAY_ONLY_HUB=1` / `STAR_SERVER_PERSISTENCE=ephemeral` in production). The
`.put()` ack callback never fires, the data never lands in `gun._.graph`, and any `.once()` read
on that path burns its full timeout every time. A single-level `gun.get('flatKey').put()` was
confirmed to work fine — only the nested-chain form is affected.

This is not confirmed to be Node-version-related (an earlier hypothesis, since retracted after
further testing) — the reproducing variable was the isolated/no-peer Gun configuration, not the
Node major version. It is not confirmed to be harmless in production either — that requires
testing against a real deployment with actual connected peers, which wasn't done.

Immediate, narrow mitigation already applied: `chatroom-manager.ts`'s `touchMemberFast` now uses
a short `getPath` wait/timeout (`(path, 300, 500)`, matching an existing convention already used
in `user-service.ts`) instead of the 2000ms/3000ms defaults, bounding the wasted time per call
regardless of root cause. This is a workaround, not a fix for the underlying Gun behavior.

## The property that actually matters

Gun was chosen for one specific reason: **no fixed schema, no migrations** — every node is an
open-ended key/value bag, so a new field on `Talk` or `User` ships without an ALTER TABLE or a
data migration. Any replacement candidate is evaluated primarily against that property, not
against "is it P2P" in isolation (though P2P/decentralization is also a real product goal here).

| | Schemaless (add fields freely) | P2P / decentralized | Maturity |
|---|---|---|---|
| **Yjs** | yes | yes (brings own transport, or reuse ours) | high — widely deployed (e.g. real-time collaborative editors), active maintenance |
| **Automerge** | yes | yes (same) | high — CRDT semantics are formally reasoned (Ink & Switch), not ad hoc like Gun's HAM |
| **Firestore** | yes | no — Google-hosted, centralized | very high, but abandons decentralization as a product property |
| **SQLite / Postgres** (PowerSync, ElectricSQL) | no — fixed columns; a JSON column is the usual workaround | partial | very high |

Yjs and Automerge are the two that preserve both properties this project currently has.

## Concrete mapping: current Gun paths → Yjs

| App structure | Current Gun path | Yjs equivalent |
|---|---|---|
| **Me** (`User`) | `users/<id>`, `user-public-profile/<id>` | One `Y.Doc` per user, top-level `Y.Map('profile')` — `stageName`, `headshot`, `languages`, `interests`, `reputation` as keys. Adding `User.newField` later is just `.set('newField', …)` — no migration. |
| **Contacts** (`KnownPerson[]`, blocks) | `user-blocks/<blockerId>/<targetId>`, `knownPeople` on the user | `Y.Map('contacts')` keyed by `userId`, each value a nested `Y.Map` (relationship label, notes, …) — same shape as `KnownPerson` today. Blocks: `Y.Map('blocks')` keyed by target id. |
| **Talks** (`Talk`, `Question[]`, `Answer[]`) | `talks/<id>` (definition + responses + stats) | `Y.Map` per talk inside a shared `Y.Map('talks')` keyed by talk id; `questions`/`responses` as `Y.Array` of `Y.Map`. This is the one place real CRDT semantics beat Gun outright — concurrent answers merge deterministically instead of relying on Gun's last-write-wins-ish HAM. |
| **Chatrooms** (membership, presence) | `chatrooms/<id>/users/<userId>`, `chatroomMembers/<id>/<userId>` | `Y.Map('members')` keyed by userId inside a per-room `Y.Doc`. This is exactly the nested-chain shape found broken in Gun's isolated mode; Yjs has no equivalent ack-timeout failure mode — updates apply locally and broadcast, no wait-then-give-up mechanism involved. |
| **Conversations / Messages** | `conversations/<id>`, `users/<id>/conversations/<convId>` | `Y.Array('messages')` inside a per-conversation `Y.Doc` — appends are naturally conflict-free, a better fit than Gun's per-key merge for an ordered log. |

Automerge maps almost identically, except the document *looks like* a plain JS object/array
(`doc.talks[id].responses.push(...)`) rather than explicit `Y.Map`/`Y.Array` constructors —
arguably even closer to "just add a field," at the cost of a different mental model (one document
per unit vs. Gun's single sprawling graph either way).

## What a migration would actually trade away

- **Gun's single unified graph** (`gun.get('chatrooms').get(id)...`, one traversable space) would
  become **separate documents** per chatroom/talk/user, each syncing independently. Usually more
  reliable in practice (smaller merge surface, no cross-document ambiguity), but a real structural
  change — "which things are one doc" has to be designed, not just inherited from Gun's graph.
- **Transport**: Gun bundles graph + mesh + ack together (and that bundling is exactly what's
  broken). Yjs/Automerge only handle the CRDT merge — the existing
  `DirectP2PConversationTransport`/WebRTC plumbing would carry Yjs's binary update messages
  instead of Gun puts. Less new work than it sounds, since the transport already exists and Gun is
  already kept out of the actual message-delivery path per spec §19.4 (Gun is local storage +
  notify/sync only there).
- **No more Gun-specific SEA/auth glue** — a separate signing/identity layer would be needed for
  message authenticity. The existing SEA keypair + TechSupport trust-anchor pattern is reusable
  logic, it just wouldn't be Gun's built-in user/auth system anymore.

## Candidates considered and set aside

- **Ditto** — commercial, purpose-built for mobile P2P mesh (BLE + WiFi + internet), literally
  designed for this use case. Not open source; worth a look if budget allows and the team wants
  this problem solved rather than built.
- **Jazz** (jazz.tools) — newer (2024-2025), TypeScript-native, CRDT-based, optional sync server.
  Smaller ecosystem, higher risk of rough edges given how young it is.
- **PowerSync / ElectricSQL** — Postgres-backed sync to on-device SQLite. Mature, well-documented,
  but walks away from decentralization as a property, not just an implementation detail.
- **SQLite + hand-rolled merge logic over the existing WebRTC transport** — most control, most
  work. Generic graph-sync engines (Gun included) tend to handle app-specific conflict semantics
  (a talk match, a block, a reputation update) worse than domain-specific logic written once and
  fully understood. Worth remembering as the fallback if Yjs/Automerge ever prove insufficient.

## Recommendation (non-binding)

If/when this is revisited: **SQLite on-device (natural fit for `nodejs-mobile` — no
Worker/IndexedDB layer needed at all) for storage, Yjs or Automerge for the schemaless/CRDT layer,
keeping the existing WebRTC transport.** Reasoning: Gun's own last release is `0.2020.1241` with
no newer version to move to, and there is now a reproducible correctness bug in its core write
path with no known fix. This direction is less "magic," more debuggable, and doesn't leave the
project stuck on an effectively unmaintained dependency — but it is a genuinely large
architectural undertaking, not a quick swap, and was not started.

## Status

Parked. The team chose to keep investing in the current Gun-based design for now (see
`docs/design/techsupport-*-design-note.md` for the active TechSupport work this decision affects)
rather than pursue this migration.
