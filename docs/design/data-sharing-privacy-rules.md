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
- **A peerless instance is local-only.** The earlier worker used this layout; the current shared worker
  peers with the hub and requires the policy.
- **Policy must run before storage merge.** Gun registers its `in` universe handler before
  `create` hooks, so adding an ordinary `root.on('in')` listener there is too late. The input guard
  uses the parsed `mesh.hear.one` boundary, including batched frames. Output is guarded in `out`
  and `mesh.say` (which also handles reconnect reads outside the `out` chain).

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

Audit updated 2026-10-29:

- **Fixed in P2 (2026-10-25):** the sender's copy of each Talk response and the delivery journal
  were written through the page's hub-connected Gun (`pairs/…`, `deliveryJournal/…`). The answer was
  ciphertext, but the souls and fields (Talk id, author id, responder id, response id, timestamps)
  showed the hub who answered whom and when. They now live in the device core under
  `local/sentResponses` and `local/deliveryJournal` (`src/core/delivery.ts`), and the page's Gun
  runs the policy's `out` filter (`src/core/sharing-policy.ts`), which drops any write or read of a
  private namespace whatever code path issues it. Spec 09 asserts both.
- **Unknown namespaces now default to local.** The shared roots are `public`, `pair`, `room`,
  signed `~pub` graphs (excluding private/answer-memory subtrees), and the explicit compatibility
  inventory `LEGACY_SHARED_NAMESPACES` in `src/core/sharing-policy.ts`. Arbitrary old roots such as
  `talks` and new, unreviewed roots cannot replicate. Exact private-field reads and wildcard soul
  queries are blocked too. Private links are removed with their HAM timestamps, including SEA's
  signed/packed link formats. Changed messages discard stale wire serialization/hash while
  retaining routing metadata.
- **Input requires local read permission as well as namespace/content checks.** Local `.on` reads
  admit their record until cancelled; `.once` reads admit replies for 30 seconds, including after
  an early cache miss. Maps admit their subtree; ancestor nodes admit only the fields leading to
  requested paths. Unsolicited records and siblings are dropped before storage. A remote GET never
  creates permission. RPC cancellation revokes a listener even before its first event. This uses
  subscriptions for rule 4; merely claiming a recipient in an incoming payload grants no access.
  Local storage reads/writes do not traverse this gate.
- **Pair/room content requires SEA ciphertext envelopes.** Non-null scalar fields must have SEA's
  encrypted `{ct,iv,s}` envelope; signed plaintext is not encryption. Index links may only point
  beneath the same audience/path. Null tombstones are allowed. This validates the wire format;
  only the recipient can authenticate/decrypt it. Policy violations increment counters containing
  no identities, souls or payloads.
- **Pair/room peer audience is restricted to configured relays.** The core labels its own hub URLs
  at startup; pair/room writes and reads, including cached reply routing, are dropped for every
  other Gun peer. A discovered LAN peer or incoming GET does not grant permission. Public nodes
  sent to those peers also lose links into pair/room paths. Direct peer links require a future
  authenticated audience binding; the existing encrypted mesh/mailbox response transport is
  separate from this Gun rule. The relay still carries encrypted pair/room data and can forward it
  to other connected clients; ciphertext and opaque path IDs protect its contents.
- **Compatibility migration remains open.** Existing profiles/rosters/reputation, conversation and
  signaling envelopes, identity links/handoff, and TechSupport records retain their listed old
  roots. This preserves interoperability but does not yet conceal legacy metadata or enforce the
  new encrypted pair/room schema on those roots. Move each writer/reader together, then remove its
  compatibility entry. These old roots are not yet covered by pair/room peer audiences. Sharing
  settings at the network boundary also remain open.
- **Legacy user mirror hardened 2026-10-29.** Server create/upsert writes only public profile
  rows and an empty contact list under `users/<id>`. Profile-foundation updates tombstone the
  former `fullProfileJson` plaintext field in Gun. The compatibility HTTP endpoint still receives
  a full profile to serve contact-filtered views; existing `knownPeople` graph writes and copies
  already replicated before an update remain part of the migration.
- **User records, rosters, presence** go through the hub-connected Gun by design; they belong in
  `public/` with the user's settings deciding what is included.
- **Talk content** no longer crosses the hub: owner Talk repositories and incoming clusters live in
  the policy-protected device Gun, and `tests/e2e/talks-matching/09-talk-content-not-on-hub-wire.spec.ts`
  asserts it.

## Tests

- Unit tests of the policy: namespaces, exact/wildcard reads, encrypted versus signed/plaintext
  content, packed links, cached-wire invalidation, and a real Gun mesh receiving batched private
  injection attempts. Read-capability tests cover unsolicited siblings, remote-GET injection,
  one-shot expiry, and cancellation of one RPC session while another remains subscribed.
- Spec 09 captures SharedWorker sockets and requires public probes from both peers. It also writes
  deliberate unknown-namespace, plaintext pair/room and signed private-answer probes, proves the
  unknown write is available locally, and checks that none escapes while the Talk exchange works.
- A wire audit per category (extending spec 09): run journeys, record every message on the hub
  boundary, and fail on any `local/` soul, any plaintext in `pair/` or `room/`, or any readable
  identity in a shared soul name.
