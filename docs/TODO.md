# IinPublic TODO

Last reconciled: 2026-08-14

This file contains active work only. Completed implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`.

## Priority 1 — storage correctness

### S1. Finish real-browser verification of ledger and message pruning

- [ ] Diagnose the ledger prerequisite failure in
  `stage2-two-user/30-ledger-message-pruning-e2e.spec.ts`: sequence 1 remained present in the
  durable Gun graph on 2026-08-14, so the combined scenario stopped before its message assertion.
- [ ] Re-run the scenario and prove both ledger deletion and the restored oldest-message deletion
  assertion are green repeatedly.

Message-pruning implementation status: fixed and unit-verified 2026-08-14. The pass is now
serialized/coalesced, Gun mutations are acknowledged before counters advance, and absolute
checkpoint/prune offsets remain correct after the retained wire list loses its pruned prefix.

### S2. Derive retention caps from a shared storage budget

- [ ] Extend `graph-size-report.ts` to measure average serialized bytes per ledger event,
  conversation message, and incoming-talk cluster.
- [ ] Add one adjustable `TOTAL_LOCAL_RETENTION_BUDGET_BYTES` default (start with 8 MiB).
- [ ] Divide the budget evenly by category and derive each slot cap as
  `floor(categoryShare / measuredAverageBytes)`.
- [ ] Replace flat ledger/message/incoming-talk retention constants with derived caps and add
  boundary/unit tests.

## Priority 2 — identity linking and public-device handoff

### I. Multi-device identity linking

- [ ] Wire `WebIdentityLinkService` into `app.ts` with real signed attestations.
- [ ] Merge linked identities in Contacts and show the identity-cluster line in peer detail.
- [ ] Add a cluster-wide block option while preserving per-device SEA identities.
- [ ] Wire URL-fragment, loopback, and clipboard same-device linking shortcuts.
- [ ] Enable and pass X3 website↔app and X8 same-device linking E2E scenarios.

### J. Sync-then-erase

- [ ] Wire encrypted P2P handoff transfer and receiver import.
- [ ] Enable and pass X7, including verification that erase cannot precede confirmed import.

## Priority 3 — native and cross-platform verification

- [ ] Connect the Mac mini, Windows, and Linux native-app jobs to real CI runners.
- [ ] Enable and pass X4 mobile↔desktop matching and threads.
- [ ] Enable and pass X5 three-platform thread isolation.
- [ ] Enable and pass X6 bidirectional offline/mailbox delivery.
- [ ] Add iPhone native-shell coverage when an iOS shell is available. Android is already shipped
  and physically exercised; do not describe it as a browser-profile stand-in.

## Priority 4 — matching and profile follow-ups

### BB. Typed opposite-tag matching follow-ups

`Talk.role` ('offer'/'request') has been fully replaced by `Talk.selfTag`/`preferenceSet` (spec
§30.2) — `checkIfMatch`, `exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, and the talk editor
all read the new fields; `role`/`TalkRole` no longer exist anywhere in the codebase. Price-overlap
matching (`intervalsOverlap` + `builtIn.priceRange`) is E2E-covered end to end with
non-identical, genuinely overlapping ranges (`stage2-two-user/87-price-overlap-buy-sell-
match.spec.ts`) — a `type: 'route'` talk turned out unnecessary for that case; a single-question
`type: 'flow'` talk with one `builtIn` question already covers it.

- [ ] Design a privacy-safe source for the responder's blurred location/radius, then wire location
  auto-resolution using the existing mutual-containment comparison.
- [ ] Persist user-created opposite-tag pairs; seeded pairs already work.
- [ ] Support talk-level shared time/location questions before route item branches.
- [ ] Add E2E cases for location outside either radius, missing preference falling to the human
  inbox, and real cross-browser route (not flow) matching.

### DD. Generalized dating matching

Design is specified in technical specification §30.6; implementation has not started.

- [ ] Implement mutual preference-set membership and the age point-in-range primitive.
- [ ] Force and lock `isAdult` for dating-category talks.
- [ ] Add optional author-selected talk photo delivery after a successful match and safety notice.
- [ ] Add unit and E2E coverage, including unverified-recipient intake blocking.

### EE. Me/profile completion

- [ ] Store typed built-in declarations as `AnswerRecord` values rather than profile fields.
- [ ] Add typed-value round-trip and section-isolation E2E coverage.
- [ ] Update the technical-specification implementation matrix.

### II. User-defined tag compatibility, generalized beyond symmetric opposites

**Landed:** the core data model — `Talk.selfTag: string` + `Talk.preferenceSet: string[]` (spec
§30.2), replacing `Talk.role` entirely. `checkIfMatch`'s veto is now
`preferenceSet.includes(responderSelfTag)` — a real membership check against a list, so "buy"
satisfied by several counterparts ("sell" AND "offer" AND "free") is already structurally
supported, not just a future idea. `exact-chatbot-memory.ts`'s auto-reply veto and
`resolveBuiltInQuestion`'s scope-key derivation were updated to match.

Still open:
- [ ] No persistence for user-created pairs — the seeded registry (`tag-opposite-pairs.ts`:
  buy/sell, hiring/jobseeking, male/female) still only auto-fills a **single** `preferenceSet`
  value from those 3 hard-coded pairs; typing any other tag gets no auto-derived compatibility.
- [ ] No multi-value **editing** UI — the talk editor can only auto-fill one counterpart tag per
  talk today (via the seeded registry); authoring a talk that explicitly accepts several named
  counterparts (typing "sell, offer, free" for a "buy" talk) has no UI yet, even though the
  underlying `preferenceSet: string[]` field already supports it once populated.
- [ ] The question/answer-shaped generalization ("need a plumber" satisfied by "does plumbing")
  discussed alongside this is still just discussion — nothing beyond the buy/sell-style
  self-tag/preference-set pattern has been built.

### JJ. Bidirectional deal confirmation (spec §30.2, replaces the old auto-exclusivity guard)

Landed this session: a talk declaring `selfTag`/`preferenceSet` is no longer exclusive on its own
— several compatible candidates can each hold an open conversation (the earlier
`isExclusiveMarketplaceTalk`/closest-match auto-pick-and-reject machinery in `app.ts`, built for
taxi/dealmaker, was removed entirely). Instead, each conversation gets a "Confirm Deal" affordance
(`#conversation-confirm-deal-btn`, `showConversationDetail` in `ui-manager.ts`); once BOTH
participants confirm (`WebConversationService.confirmDeal`, `Conversation.dealConfirmedBy`), each
side's own device independently disables its own outstanding created deal-eligible talk(s)
(`maybeFinalizeConfirmedDeal`, `app.ts`) — detected reactively on whichever device confirms
second, and via Gun-sync on the other, since "both confirmed" can become true on either side.

- [ ] **Known gap:** confirming a deal does NOT mark a *different* candidate's conversation (e.g.
  a losing driver with their own separate talkId, matched against the same passenger's request)
  as "no longer available" — grouping "other candidates for the same underlying need" across
  different authors' own talkIds needs a mapping that doesn't exist yet.
  `05-taxi-local-chatroom-match.spec.ts`'s rewritten two-driver test documents this gap directly
  rather than asserting it works.
- [ ] `maybeFinalizeConfirmedDeal` currently disables **all** of the confirming user's outstanding
  created deal-eligible talks, not just the one specific to the confirmed conversation (bidirectional
  exchange means the conversation's own `talkId` field isn't a reliable way to find "my side" of a
  specific deal — see the function's doc comment). Fine for the "one active listing" scenarios
  this session's tests use; a user running several simultaneous listings and expecting confirming
  one deal to leave the others open is unhandled.

### KK. Context-aware chatbot answer matching, generalized beyond talk-title scoping

The target model: an incoming talk's question is never matched against a specific counterpart
talk directly — every question a user answers flattens into that user's own Me-tab Q&A store,
keyed by context, and a NEW incoming talk's question is resolved by looking itself up in that
flattened store. This is largely how the codebase already behaved for ordinary flow/tag
questions via two existing pieces, not a new mechanism that had to be built:
`saveAnswerPreference` (`ui-manager.ts`) writes every answered question into 3 stores at once
(exact-chatbot-memory, a context-aware flattened store, and a legacy per-talk-instance store);
`buildAnswerPreferenceLookupKey` (`shared/flattened-answer-keys.ts`) keys the flattened store by
the normalized chain of prior `{questionText, answerText}` pairs leading to the current question
— talk-identity-independent, which is exactly the per-context matching this design wants (except
for the first question in a chain, deliberately talk-independent for cross-talk reuse, and
tag/single-question talks, which are content-hash-scoped instead).

**Landed:**
- Lookup order fixed: `resolveAnswerPreferenceForTalkQuestion` now tries the context-aware
  flattened lookup FIRST (single-select only — the flattened store has no concept of a checked
  set), translating the stored answer back to the current talk's own answer id by TEXT (not by
  the stored id, which may belong to a different, independently-authored talk's id scheme).
  Falls back to context-free `exact-chatbot-memory` only when the flattened lookup has nothing.
- `selfTag`/`preferenceSet` now enter the context key via `myEffectiveTagContext` (`ui-manager.ts`)
  and `buildAnswerPreferenceLookupKey`'s new `tagContext` param. Correction from the original
  proposal in this section: hashing `preferenceSet` as ONE sorted+joined string (mirroring
  `cid.ts`'s talk-content-hash) turned out to be wrong, not just suboptimal — a single incoming
  talk only ever declares one `selfTag`, so a joined multi-member string can never be reconstructed
  from the read side, breaking the cross-talk lookup entirely for any talk whose `preferenceSet`
  has more than one member. The actual fix: fan out per `preferenceSet` member on SAVE (one
  bucket per member of the CURRENT talk being saved — bounded by that one talk's own tag count,
  not combinatorial across the question chain), single lookup per READ (an incoming talk has
  exactly one `selfTag`). E2E-verified end to end for the ordinary buy⇄sell case and for the
  collision this section was written to fix (a user's two same-item talks with different
  `preferenceSet` no longer bleed into each other) —
  `stage2-two-user/89-buy-sell-chatbot-cross-talk-match.spec.ts`. Still open: the "answering
  someone else's talk ad hoc, with no talk of my own in play" case has no `preferenceSet` to fan
  out at all (falls through to `mySelfTag`-only scoping, which is correct but coarser).

Still open:
- [ ] **Tag position is not fixed to "root" or "talk-level singular metadata."** The current
  model treats `selfTag`/`preferenceSet` as a single property of the whole `Talk`, checked once
  as a global veto in `checkIfMatch`, independent of tree position. The working assumption so far
  (mirrored in the route-editor UI and this session's route/`matchThreshold` work) has been that
  a tag-like veto sits at the root of a route talk, evaluated first. That's not a necessary rule —
  a tag is really just a simplified question, and there's no reason it can't appear in the middle
  of a route tree, more than once, or in any order relative to other questions. Needs a real
  design pass before implementation: can a talk carry more than one tag-check node? Does
  `checkIfMatch`'s single global veto generalize to a position-aware check per node? Does the
  context hash need to include tag-node position in the `previousQAPairs` path the same way
  ordinary questions already do (this may fall out for free if a tag node is modeled as an
  ordinary node in the chain rather than special-cased talk-level metadata)?

## Priority 5 — TechSupport productionization

### K7. Delegated TechSupport answers

- [ ] Write the design note first: co-operator discovery, signed redirect, relayed answer,
  `answeredByDelegate` audit trail, timeouts, abuse controls, and privacy boundaries.
- [ ] Implement only after that design is approved.

- [ ] Define production TechSupport key custody and rotation tooling.
- [ ] Package the headless/off-server TechSupport agent.

## Smaller independent work

- [ ] R4: apply progressive rendering to large chatroom member lists.
- [ ] R5: apply progressive rendering to conversations/support inbox only when measurements show a
  first-render problem.
- [ ] Z: review and normalize the six applicable long-press popup variants.
- [ ] CC: add E2E coverage for the once-per-day financial safety toast.
- [ ] FF: replace very large flat checkbox lists with searchable chips when option counts warrant it.
- [ ] Decide whether dead `sendBulkTalk`/`BulkSendJob` surfaces should be implemented or removed.
- [ ] Resolve metadata-only talk-edit authorship semantics.
- [ ] Refresh stale architecture prose concerning routing and incoming-talk delivery.

## Deferred product decisions

- Multiple identities/profile switching on one device.
- Whether linked-device clusters receive a durable person identifier.
- Whether contacts, blocks, conversations, Q&A, credit, and reputation aggregate across linked
  identities; v1 remains mutual-link/display merge only.
- Precise-location sharing as an explicit opt-in feature.
- Talk bridging through a middle person remains version 2; discovery gossip and configurable mesh
  forwarding remain version 1.

## Verification rules

1. Put E2E specs in the lowest stage with enough users and add a companion `.md` explanation.
2. Assert durable state or stable UI signals, not transient toasts.
3. If a test exposes a product bug, fix the product rather than weakening the assertion.
4. Move completed work to `docs/completed.md` immediately.

## Nightly jobs

- `npm run health`
- `npm run test:e2e:parallel`
- `npm run test:e2e:heavy`
- `npm run test:e2e:mesh`
