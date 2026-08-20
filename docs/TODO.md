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

**Landed, 2026-08-19:** `#talk-preference-set` (talk-editor-dialog.ts) — an explicit, editable
counterpart-tag field next to `#talk-tag`. Auto-tracks the seeded single opposite live until the
author types their own value there (or opens an existing talk that already has one), at which
point that value wins outright, including declaring the SAME tag as `selfTag` itself ("match
fellow buy people" buddy-style talks — previously impossible, since auto-fill only ever produced
the opposite). `processTalkForm` reads whichever of the two fields has content, falling back to
the old single-opposite auto-fill when empty. Closed the last script-injected talk creation in
`89-buy-sell-chatbot-cross-talk-match.spec.ts`.

Still open — **superseded by §LL below, not to be built as originally scoped here:**
- [ ] No persistence for user-created pairs — the seeded registry (`tag-opposite-pairs.ts`:
  buy/sell, hiring/jobseeking, male/female) still only auto-fills a **single** `preferenceSet`
  value from those 3 hard-coded pairs; typing any other tag gets no auto-derived compatibility.
  Still real under §LL too (the registry becomes an editor-autofill-only convenience there), but
  persistence itself is unscoped either way.
- [ ] ~~No multi-value editing UI~~ — built as a comma-separated `#talk-preference-set` field
  above, but §LL rejects multi-value on a tag outright (a bare second word like "free" is
  ambiguous without its own question — give or receive?) and routes that need instead through
  §LL's single-answer rule: a second accepted tag becomes a second ANSWER ROW on an ordinary
  question, not a second comma-separated string entry. `#talk-preference-set` is expected to be
  retired once §LL lands, not extended.
- [ ] The question/answer-shaped generalization ("need a plumber" satisfied by "does plumbing")
  discussed alongside this is now the substance of §LL, not separate discussion.

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
- [ ] **Tag position is not fixed to "root" or "talk-level singular metadata."** The design pass
  this bullet used to call for is now written up in §LL below — a tag is really just a simplified
  single-question talk, and the fix is to model it as an ordinary node in the question chain
  rather than special-cased talk-level metadata, so `checkIfMatch`'s veto and the context-hash
  path both fall out for free instead of needing position-awareness bolted on.

### LL. Unify `type: 'tag'` and `selfTag`/`preferenceSet` into one mechanism (design, 2026-08-19; landed, 2026-08-19)

Design settled (Bernard, 2026-08-19), then implemented same day. Supersedes §II's now-struck-through
"multi-value editing UI" item and §KK's "tag position is not fixed to root" item above; both were
pointing at the same underlying redundancy.

**Landed, lower-risk than the original proposal:** rather than removing `checkIfMatch`'s
`preferenceSet.includes(responderSelfTag)` veto and re-routing tag matching through the ordinary
flattened-answer store, the implementation keeps that veto exactly as-is and instead makes
`processTalkForm`'s tag branch (`ui-manager.ts`) populate `selfTag`/`preferenceSet` for the first
time — `selfTag = keyword` (the tag word/title), `preferenceSet = [answerWord]` where `answerWord`
comes from a new `#talk-answer` field (talk-editor-dialog.ts), defaulting to the same word as the
keyword when left untouched (self-match). The existing generic veto — already applied uniformly to
every talk type via `handleTalkCompleted`/`resolveResponderSelfTagForAnswers` (app.ts) — simply
stops being a no-op for tags once those fields are non-empty; zero new matching plumbing. Also
fixed a latent bug in `myEffectiveTagContext` (ui-manager.ts): the responder's own self-tag for
"answering someone else's talk" now prefers `talk.preferenceSet?.[0]` over the registry-opposite
lookup, which was wrong for self-match/buddy talks (no registered opposite of "buy" equals "buy").
`#talk-tag`/`#talk-preference-set` (spec §30.2 Phase 5) are NOT retired — they remain the
flow/route-only self-tag/preference fields (now single-value, no comma-split), hidden from the tag
form entirely (a tag's own keyword/`#talk-answer` pair replaces them there, per the single-answer
rule below). `?`-notation renders at the tag-chip and OUT-row title (ui-manager.ts). Old stored
talks with no `preferenceSet` are untouched (still "matches anyone" on read) — only newly-saved
tag talks get the self-match default. The seeded opposite-tag registry is confirmed editor-autofill
only, never a runtime matching dependency.

**The core idea:** `type: 'tag'` (the one-checkbox talk — hardcoded "Match."/"Ignore." answer
text) and `selfTag`/`preferenceSet` (talk-level metadata on flow/route talks, checked once as a
special veto in `checkIfMatch`) are the same concept expressed two different ways. A tag is
really just a single-question talk: title = question text (already true for `type: 'tag'`,
`processTalkForm`'s tag branch), and the single answer's TEXT is the accepted counterpart —
defaulting to the SAME word as the question (self-referential: "I'm tagged buy; match anyone else
tagged buy" — the classic "Tennis" interest-tag case), overridden by typing a different word when
the author wants an opposite-pair match ("buy" the question, "sell" the answer). Matching then
needs no special veto at all — it's the ordinary flattened-answer-store (§KK) lookup already used
for every other question, keyed on question text + answer text, exactly like any other
single-question flow talk.

**Real behavior change, not just a refactor:** today, a `#talk-tag`/`selfTag` with no known
seeded opposite falls back to "no `preferenceSet`, matches anyone" — inconsistent with what a
plain interest tag ("Tennis") has always actually meant (self-match, not "matches anyone"). Under
this design self-match becomes the one universal default; "matches anyone" is no longer a
distinct fallback state.

**Single answer only — draw the line there, not at multi-value.** Considered and rejected: an
author typing several accepted counterparts on one tag question ("buy" accepting "sell" OR
"free"). Rejected because a bare word like "free" is ambiguous outside its own dedicated
question — "free" could mean giving away or wanting to receive, and a single tag chip has no room
to disambiguate that. If an author genuinely needs multiple accepted answers, it's not a tag
anymore — it's an ordinary multi-answer question (the editor's existing "+ Add Answer" /
`answerSelectionMode` machinery already handles this for flow/route questions), not a
comma-separated list bolted onto the tag's own single-answer shape. This retires the shipped
`#talk-preference-set` free-text field (talk-editor-dialog.ts, §II) once implemented — that field
correctly closed the immediate gap, but a comma-separated string is the wrong shape once the
single-answer rule is settled; a second accepted tag should be a second answer ROW using the same
UI every other question already has, not a parsed string.

**Display notation:** when the answer differs from the question, render the tag as
`{question}?{answer}` — e.g. "buy?sell" for an opposite-pair tag, plain "buyer" (no `?`) for the
self-match/buddy case where question and answer are the same word. Distinguishes "Buy iPhone"
(seeking a seller) from "Buy Buddies iPhone" (seeking fellow buyers) at the chip/row level instead
of relying on the talk's title alone to carry that meaning — the exact ambiguity
`stage2-two-user/89-buy-sell-chatbot-cross-talk-match.spec.ts`'s two Adam talks exist to catch.

**Route placement (on hold): drag-and-drop, not typed metadata.** The longer-term vision for "tag
position is not fixed to root" is a graphical route editor where an author drags an existing tag
onto any node of a route DAG and it drops in as an ordinary question/answer pair at that
position — no separate label-and-type-out-a-question step, since the tag already carries its own
question/answer text. Depends on a drag-and-drop route editor that doesn't exist yet (today's
route editor is the custom DOM tree in talk-editor-dialog.ts, no graphical canvas) — explicitly
parked until that exists, not part of this design pass.

**Net effect: simplifies rather than adds.** One matching mechanism (ordinary question/answer via
the flattened-answer store) instead of two (checkbox-tag booleans + `selfTag`/`preferenceSet`
veto); one UI answer-editing surface (the existing question/answer rows) instead of two (that
surface plus a separate free-text preference field); one default rule (self-match) instead of an
inconsistent "matches anyone" fallback for the unrecognized-tag case.

Resolved during implementation:
- [x] `type: 'tag'` stayed a distinct wire type — still renders as a one-line chip, no Gun data
  migration; only its answer TEXT (via the new `#talk-answer` field) became meaningful.
- [x] `checkIfMatch`'s veto was NOT removed anywhere — kept exactly as-is; every existing caller
  (`exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, `myEffectiveTagContext`) is unaffected
  except `myEffectiveTagContext`, which got the self-match responder-side fix described above.
- [x] No migration/rewrite for existing stored talks — old talks with no `preferenceSet` keep
  today's "matches anyone" read behavior; only the editor's output for newly-saved talks changed.
- [x] Confirmed the seeded opposite-tag registry (`tag-opposite-pairs.ts`) is editor-autofill only
  (`talk-editor-dialog.ts`'s `wireTagAnswerAutoFill`), never read by any matching/runtime path.

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
