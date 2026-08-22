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

**Landed exactly as originally proposed, no veto:** `type: 'tag'` talks carry NO `selfTag`/
`preferenceSet` at all — `processTalkForm`'s tag branch (`ui-manager.ts`) only ever produces one
ordinary `Talk.questions` entry: `text = keyword` (the tag word/title), one match answer whose
`text` is a new `#talk-answer` field's value (talk-editor-dialog.ts), defaulting to the same word
as the keyword when left untouched (self-match), and one "Ignore." answer. That question/answer
pair IS the whole declaration; `checkIfMatch`'s `preferenceSet` veto (talk-engine.ts) is untouched
code-wise but structurally a permanent no-op for tags now, since they never set the field. Matching
— manual checkbox or chatbot auto-reply — is the exact same plain text-based mechanism every other
question already uses (`exact-chatbot-memory.ts`'s exact-question-text memory): "buy"→"buy"
self-match and "buy"→"sell" opposite-pair both just fall out of whatever question/answer text the
two independent authors happened to choose — per Bernard: "for chatbot matching, there is no
concept of opposite, just answer matching," and "opposite meaning is defined by user in
question/answer format, they can be anything." `#talk-tag`/`#talk-preference-set` (spec §30.2
Phase 5) are UNCHANGED and stay flow/route-only (now single-value, no comma-split), hidden from the
tag form entirely. `?`-notation (ui-manager.ts's `tagAnswerSuffix`) renders by reading the answer
text straight off `Talk.questions[0].answers` for tag-type, or `selfTag`/`preferenceSet` (unchanged)
for flow/route. One accepted, deliberate consequence: two independently-created tag talks with the
literal same question AND answer text (e.g. both "sell" with both defaulting their accepted answer
to "buy") can wrongly auto-match via the chatbot's exact-text memory — no protection, by design,
since tag talks are meant to be simple/low-stakes and any real veto would just be re-adding the
special-case machinery this whole design pass exists to remove. A second, separate consequence:
`isDealEligibleTalk` (app.ts) requires both `selfTag` and a non-empty `preferenceSet`, so a
tag-talk match is never deal-eligible — no "Confirm Deal" step, the talk simply never auto-disables
on a tag match (same as any other plain talk; unaffected feature, not touched by this pass). The
seeded opposite-tag registry (`tag-opposite-pairs.ts`) is confirmed editor-autofill only — a
convenience default in `wireTagAnswerAutoFill`, never read by any matching/runtime path.

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
  migration; its answer TEXT (via the new `#talk-answer` field) became meaningful directly, no
  talk-level metadata involved.
- [x] `checkIfMatch`'s veto code was left in place (untouched) but is now a permanent no-op for
  `type: 'tag'`, since tags never set `preferenceSet`. Every existing caller
  (`exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, `myEffectiveTagContext`) still applies to
  flow/route talks exactly as before, unaffected; `myEffectiveTagContext` also got the self-match
  responder-side fix described above, relevant to flow/route buddy-tag talks now (not tag-type,
  which no longer uses that code path at all).
- [x] No migration/rewrite for existing stored talks — old flow/route talks with no
  `preferenceSet` keep today's "matches anyone" read behavior; old tag talks with hardcoded
  "Match."/"Ignore." answer text are untouched too; only the editor's output for newly-saved
  tag talks changed.
- [x] Confirmed the seeded opposite-tag registry (`tag-opposite-pairs.ts`) is editor-autofill only
  (`talk-editor-dialog.ts`'s `wireTagAnswerAutoFill`), never read by any matching/runtime path.

### LL.1 Per-question `reciprocalTagContext` — generalizes the root-only tag fields (Bernard, 2026-08-20; landed same day)

The root-only `#talk-tag`/`#talk-preference-set` fields (spec §30.2 Phase 5, unchanged by this
item) can only declare ONE buy/sell-style context for a whole talk. This adds a checkbox next to
every question in the flow/route editor (`Question.reciprocalTagContext`, types.ts): when checked,
that question's own (text, its one non-`ignore` answer's text) pair defines the tag context for
every question after it in the same branch — usable anywhere in a tree, not just the root. A
nearer-scoped override: `myEffectiveTagContext` (ui-manager.ts) now tries
`findReciprocalTagAncestor` first (branch-aware via `Question.contextPath` for route, linear array
position for flow), falling back to the unchanged talk-level `selfTag`/`preferenceSet` fields when
no qualifying ancestor exists.

"Exactly one answer" turned out to mean exactly one NON-`ignore` answer, not `answers.length===1`
— `TalkValidator.validateQuestion` requires every question to carry an Ignore option regardless, so
an ordinary single-`match`/`next` + one `ignore` question (the editor's normal 2-answer default)
already qualifies; no special answer-count authoring step needed. `findReciprocalTagAncestor` and a
matching early-exit in `resolveAnswerPreferenceForTalkQuestion` both share one helper,
`singleNonIgnoreAnswer`.

That early-exit was itself a necessary addition, not just wiring: a reciprocal question whose own
text differs from anything the responder has ever answered before (e.g. a "buy" root vs. a "sell"
root — the whole point of an opposite pair) can never win the ordinary flattened-store/exact-text
memory lookup, since that lookup is inherently keyed on having seen this exact text before. Checking
the box already IS the full declaration, so a reciprocal question with exactly one real answer now
auto-proceeds unconditionally (`mode:'auto'`, `autoAnswerReason:'RECIPROCAL_TAG_CONTEXT'`) — the
same "no real decision to make" pattern `type:'tag'` already established for its own single
match-answer (§LL).

Explicitly out of scope, confirmed unaffected: `checkIfMatch`'s `preferenceSet` veto and
`resolveResponderSelfTagForAnswers` (talk-level only); `resolveBuiltInQuestion`/
`typed-preference-store.ts` (separate typed quantity/price mechanism); `talk-response-dialog.ts`
(responder UI unchanged — this is purely editor-authoring + matching-engine); survey and tag types
(survey has no branching; tag's single Q&A is already fully expressed via title/`#talk-answer`).

New coverage: `90-reciprocal-tag-context-non-root-question.spec.ts` — a "buy" flow talk and a
"sell" flow talk, each declaring their tag via an ordinary Q1 (not talk-level metadata), zero-click
auto-match on a shared downstream "Is it an iPhone?" question.

### LL.2 Explicit `Question.tagKind: 'simple'` + ancestor-aware match veto (Bernard, 2026-08-21; landed same day)

§LL/§LL.1 left two tags conflated under one boolean: a `type:'tag'` talk's own answer could still
diverge from its keyword with no explicit marker for *why*, and `reciprocalTagContext` (the
asymmetric "Pair tag" — question text = my declared tag, its one real answer = the accepted
counterpart) never actually gated a match anywhere but the talk root — it only ever fed chatbot
auto-fill context for downstream questions.

This adds `Question.tagKind?: 'simple'` (types.ts) as the explicit, mutually-exclusive counterpart
to `reciprocalTagContext`: a "simple tag" is self-match by definition — its one non-`ignore` answer
MUST equal the question's own text — usable on any question in any talk type (tag/flow/survey/route),
the same atomic building block `reciprocalTagContext` already was. `TalkValidator` enforces both
shapes now: a literal `type:'tag'` talk defaults to simple-tag text-equality unless
`reciprocalTagContext` is set (scoped to `talk.type === 'tag'` only — `validateTalk`'s "tag by
structure" heuristic also routes non-tag-type single-question/two-answer talks, e.g. a flow talk
with one `builtIn` comparison question, through the same validator and must stay permissive); a
`reciprocalTagContext` question's "exactly one non-ignore answer" rule — previously only gracefully
skipped at read time by `findReciprocalTagAncestor`, never actually enforced at save time — is now a
hard validation error too, via a shared `validateTagKindFields` helper (`validateQuestion` for
flow/survey, and route's own inline per-question loop, since route never routed through
`validateQuestion`). `TalkAutofix.fix` silently force-corrects a `tagKind:'simple'` question's
answer text to match its question, one shared step ahead of every type-specific branch.

The real generalization: `findReciprocalTagAncestor`'s ancestor-walk logic moved from
`ui-manager.ts` (web-only) into `talk-engine.ts` as an exported `findTagPairAncestor`, so
`checkIfMatch`'s own preference veto can consult it directly — a mid-tree `reciprocalTagContext`
ancestor now wins over the talk-root `preferenceSet` and actually vetoes a mismatched
`responderSelfTag`, the same precedence the chatbot-context derivation already used. `ui-manager.ts`
now delegates to the shared function instead of keeping its own copy.
`exact-chatbot-memory.ts`'s independent `PREFERENCE_CONFLICT` gate (`findAutoAnswer`/
`findAutoAnswerMultiple`, fed by a flat `incomingTalkPreferenceSet`) got the same treatment at its
caller (`resolveAnswerPreferenceForTalkQuestion`) — otherwise the chatbot could auto-answer past a
mid-tree conflict manual answering would now correctly refuse.

Editor UI: the tag-talk form gets an explicit "Pair tag" checkbox (`#tag-pair-checkbox`,
unchecked/simple by default, hides `#talk-answer` entirely until checked — no more silent
divergence). The flow/survey shared question template (`addQuestionToForm`) gets a sibling "Simple
tag" checkbox next to the existing "Pair tag" one, mutually exclusive; the route editor gets the
identical pair. Product-facing term for what internal code still calls `reciprocalTagContext`:
**"Pair tag."**

Explicitly out of scope, deferred to a separate design pass: an actual drag-and-drop node/graph
canvas editor for route (the generic per-question form is extended everywhere in this pass, not
replaced); decoupling "seeds context for later questions" from the pair-tag match itself (kept
coupled, as before).

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
