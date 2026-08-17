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

- [ ] Design a privacy-safe source for the responder's blurred location/radius, then wire location
  auto-resolution using the existing mutual-containment comparison.
- [ ] Persist user-created opposite-tag pairs; seeded pairs already work.
- [ ] Support talk-level shared time/location questions before route item branches.
- [ ] Add E2E cases for price overlap, location outside either radius, missing preference falling
  to the human inbox, and real cross-browser route matching.

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

Follow-up to §BB's opposite-tag registry (`tag-opposite-pairs.ts`) — design discussion only, not
started, no engine changes made yet.

Today's registry (`registerOppositeTagPair`) is UI-convenience only: it auto-fills `Talk.role`
and a question template for exactly 3 app-predefined, hard-symmetric pairs (buy/sell,
hiring/jobseeking, male/female — the latter reserved for §DD). `checkIfMatch` never reads tags
directly; it still vetoes purely on `Talk.role`'s binary offer/request, per §BB's original
"zero engine changes" decision. Two gaps surfaced in discussion:

- [ ] No persistence for user-created pairs — typing any tag outside the 3 seeded ones has zero
  compatibility effect today.
- [ ] The registry is strictly 1:1 symmetric (`registerOppositeTagPair(A, B)` always writes both
  directions). Real usage wants one tag to accept SEVERAL counterparts asymmetrically — e.g. "buy"
  satisfied by any of "sell"/"offer"/"free" — without "sell" needing to reciprocally declare it
  matches "buy". This also generalizes past transactional opposites to question/answer-shaped
  relationships (a "need a plumber" tag satisfied by a "does plumbing" tag), which were never
  representable as a symmetric pair at all.

Design direction from discussion (not committed): don't invent a new parallel data structure for
"list of acceptable counterpart tags" — a `type: 'tag'` talk already carries exactly that shape in
`questions[0].answers`. Treat the tag's own title as the declaration and its existing answer list
as the "satisfied by" set; a chatbot receiving an incoming talk checks whether that talk's own
tag/title is present in the receiver's own compatibility set — one-directional, no requirement
that the other side reciprocate. Where this would plug in, if built:

- [ ] `checkIfMatch`'s role veto would need a tag-compatibility path alongside (or instead of) the
  `Talk.role` check for talks that declare a compatibility set.
- [ ] The marketplace "busy, reject new inquiry" exclusivity guard (`isExclusiveMarketplaceTalk`
  in `app.ts`, added for taxi/dealmaker closest-match work) currently keys off
  `role === 'offer'/'request'` — would need to also recognize tag-compatibility-declared talks as
  exclusive.
- [ ] Interacts with §DD (generalized dating): `male`/`female` is currently a reserved, inert seed
  pair with no role mapping — this generalization is a plausible real mechanism for dating
  preference matching (each side declares "satisfied by: [...]" attributes) without needing
  `Talk.role` at all; address as its own decision, not folded silently into §DD's existing mutual
  preference-set design.

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
