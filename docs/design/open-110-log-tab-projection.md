# OPEN-110 — one log, four tab projections

Implemented 2026-11-10. This note records the ownership boundary; the product requirements remain
authoritative in spec §31.13 REQ-GRAPH-49.

## Data ownership

- A Talk edit writes a new immutable version event. The Talk's first event id remains its stable
  identity, `mine/talk/<talkId>.latest` selects the replacement, and each replacement links to the
  retired version through `re`. `graph.tabSnapshot.talks` returns both the current body and the
  complete newest-first version lineage. Contacts, answers, conversations, map links and statistics
  continue to point to the stable Talk root, so no cross-link is left on an obsolete version.
- A DM plaintext is an immutable `conv`/`text` event indexed by conversation and person. The screen
  reads `graph.conversationMessages`; live transport copies only add transient delivery state.
- A Nearby encounter and Place visit are immutable events. The current ordered roster is deliberately
  mutable projection state under `mine/nearby/<scope>` and is enumerated by `ix/nearby-scopes`.
  Scope kind distinguishes home/travel/Nearby/Place without changing the privacy-preserving roster
  rank calculated by Nearby v3.
- Contacts membership is the union of graph exchange peers and graph conversation participants.
  Editable names, relationship labels, unread/presence state and other local UI state may remain
  mutable records; they do not decide whether an event/history edge exists.
- Conversation projection nodes link directly to their participant Person and to every graph Talk
  that created or scopes the conversation. Partial metadata refreshes preserve those Talk links;
  they are replaced only when the caller supplies a new complete Talk-id set.

## Read model and traversal

`graph.tabSnapshot` is bounded and rebuildable. It returns authored Talks, conversation heads,
people plus their newest person-index events, and saved Nearby scopes. The web process caches this
snapshot only in memory so synchronous tab renderers do not create another durable source of truth.

The projection supplies these traversals in both directions:

- Person/Contact → Talk events and conversations, including the Talk(s) that originated a match;
- Talk → people through the same person-event rows (with `graph.talkPeople` as the bounded direct
  query);
- Person ↔ Place through saved Place scopes, plus event cell/place fields in person history;
- Conversation → immutable messages through `ix/conv`;
- Me → answers/Talks/people/places through the existing graph answer indexes and shared focus code.

`myTalks` and `myConversations` remain transitional compatibility overlays. On graph-backed writes,
their authoritative Talk body/version and conversation membership/message-summary fields are
stripped; only device-local display/edit state remains.

## Closure

Closed 2026-11-11. Ordinary Direct P2P now records plaintext graph events as its durable write,
reads `graph.conversationMessages` for the screen and previews, and builds reconnect digests and
encrypted backfill wires from those graph rows. WebRTC and encrypted mailbox envelopes are delivery
mechanisms only; delivery status is session UI state.

On upgrade, each old ordinary-DM encrypted history is decrypted and imported idempotently before
its manifest and segments are cleared. Any undecryptable row aborts deletion and leaves the cache
for a later retry. `GunMessageStore` remains only as a wire-crypto/key helper, the guarded cutover
reader, and storage for separate TechSupport synthetic records; it is not an ordinary-DM history
source or reconciliation source.
