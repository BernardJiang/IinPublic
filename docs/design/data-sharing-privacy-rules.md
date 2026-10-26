# Data sharing and privacy rules for the device's Gun

Status: **adopted 2026-10-25** (owner decision). Architecture: `docs/design/device-core-architecture.md`.
TODO: OPEN-91 (P2 enforces these rules).

## Principle

**Nothing leaves the device unless a rule allows it.** The user's own data — what they answered,
whom they exchanged with, where, their contacts and chatbot memory — stays in the device's one Gun
instance and its storage, with no copy anywhere else. What is shared is shared on purpose, with the
narrowest audience, and encrypted unless it is meant to be public.

## What Gun does and does not do

- **A Gun instance sends every write to every peer it is connected to, and asks its peers when it
  reads.** There is no per-node "keep this local" switch in Gun's core. A relay passes what it
  receives to other connected clients (and stores it if configured to).
- **SEA signs, it does not hide.** Data under a user (`~pubkey/…`) is signed: nobody else can
  forge or overwrite it. Anyone who receives it can read it. Encryption is a separate, explicit step
  (`SEA.encrypt`, or a secret shared with another user).
- **A peerless instance is local-only.** Today's worker Gun (`peers: []`) already works this way.
- **Every message passes Gun's wire hooks** (`root.on('out', …)`, `root.on('in', …)`;
  `src/server/services/runtime-profiler.ts` already uses them). With one instance per device, those
  hooks are where the rules below are enforced.

## Namespaces

Every node the core writes lives in exactly one namespace; its first path segment says which.

| Namespace | Example | Leaves the device? | Readable by |
|---|---|---|---|
| `local/` | `local/exchanges/<peer>/<talk>/<dir>`, `local/answers/…`, `local/contacts/…`, `local/chatbot/…` | **Never** | me |
| `pair/<pairId>/` | `pair/<pairId>/talkResponses/<talk>/<response>`, DMs | To the hub relay and that one person | that person and me (content encrypted for the pair) |
| `room/<roomId>/` | a Place's shared chat | To the hub relay and that room's members | room members |
| `public/` and `~<pub>` | profile card, presence, signed Nearby card | To the hub relay and anyone | anyone |

- `pairId` is the CID of the two sorted identities (as `GunDeliveryRepository.putPairResponse`
  already does), so the name itself does not reveal who the two people are.
- Names in shared namespaces carry no readable identities, Talk text or answers — only ids, CIDs
  and ciphertext.

## Rules the core enforces

1. **Default deny on the way out.** The `out` hook drops any `put` or `get` whose soul is not in a
   shared namespace. Reads are filtered too: asking peers for a node reveals interest in it.
2. **Encrypted unless public.** A `put` into `pair/` or `room/` must carry SEA ciphertext in its
   content fields; the hook drops one that does not and records a policy violation.
3. **Narrow audience.** `pair/` writes go only over links to the hub relay or to that pair's other
   person; `room/` writes only to the hub relay or the room's members.
4. **Accept only what is addressed to me.** The `in` hook accepts nodes in namespaces I subscribed
   to or that are addressed to me (my pairs, my rooms, public cards I asked for); everything else is
   dropped before it reaches storage.
5. **User control.** Shared categories follow the user's settings — e.g. publish a public profile
   card or not, show presence or not, take part in Nearby or not. Turning one off stops future
   sharing; what was already sent cannot be recalled from peers (said plainly in the UI).
6. **Deletion.** Deleting local data blanks and purges it from the device's storage. Shared data
   already received by peers cannot be deleted from them; retraction is a signed tombstone peers
   honour.

## What leaves the device today

Audit of the current code, 2026-10-25:

- **Fixed in P2 (2026-10-25):** the sender's copy of each Talk response and the delivery journal
  were written through the page's hub-connected Gun (`pairs/…`, `deliveryJournal/…`). The answer was
  ciphertext, but the souls and fields (Talk id, author id, responder id, response id, timestamps)
  showed the hub who answered whom and when. They now live in the device core under
  `local/sentResponses` and `local/deliveryJournal` (`src/core/delivery.ts`), and the page's Gun
  runs the policy's `out` filter (`src/core/sharing-policy.ts`), which drops any write or read of a
  private namespace whatever code path issues it. Spec 09 asserts both.
- **The rule is still a list, not default deny:** `local`, `pairs`, `deliveryJournal` are private;
  everything else may leave. Default deny needs every shared node moved under `pair/`, `room/` or
  `public/` first (P3–P6).
- **User records, rosters, presence** go through the hub-connected Gun by design; they belong in
  `public/` with the user's settings deciding what is included.
- **Talk content** no longer crosses the hub: owner Talk repositories and incoming clusters live in
  the peerless worker Gun, and `tests/e2e/talks-matching/09-talk-content-not-on-hub-wire.spec.ts`
  asserts it.

## Tests

- Unit tests of the policy: each namespace, puts and gets, encrypted and not.
- A wire audit per category (extending spec 09): run journeys, record every message on the hub
  boundary, and fail on any `local/` soul, any plaintext in `pair/` or `room/`, or any readable
  identity in a shared soul name.
