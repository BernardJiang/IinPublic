# IinPublic Completed Work

Last updated: 2026-08-24

## 2026-08-24 — Talk editor: progressive disclosure + live responder preview

Two more talk-editor usability follow-ups, same theme as the templates work below.

**Progressive disclosure.** Per-question "advanced" fields (answer-selection-mode, Simple tag,
Pair tag, "Compare using" builtIn kind + its typed inputs — plus the route/DAG editor's per-node
equivalents) now live inside a collapsed `<details class="question-advanced">` /
`<details class="route-node-advanced" data-qid>`, default closed for a brand-new question and
default open whenever the question already has a non-default value in any of them (rehydrating
an existing talk or a picked template) — set in `talk-editor-dialog.ts`'s existing rehydration
code and directly in `renderRouteEditor` (ui-manager.ts), which already has the node's live state
in hand. The route editor's parallel-match-threshold input was deliberately left outside the
collapse — it's already only shown for a real 2+-child fan-out, not part of the "wall of
checkboxes" the collapse targets.

Checked the blast radius against the e2e suite before touching anything: the Simple/Pair tag
checkboxes were already exclusively driven via `{force: true}`, but ~33 other call sites (6 spec
files + 2 shared helper functions) used plain, visibility-requiring Playwright actions against
the now-collapsed fields. **`{force: true}` alone was not sufficient** — a closed native
`<details>`'s children have no rendered box at all, so even a forced click/fill silently fails to
land (`locator.setChecked: Clicking the checkbox did not change its state`), discovered the hard
way on the first real test run. Fixed by having each call site (or the shared helper it goes
through) explicitly open the relevant `<details>` via `.evaluate(el => el.open = true)` before
touching anything inside — same as a real user clicking the "Advanced options" summary first.

**Live "what the responder sees" preview.** A second collapsed section, above the editor's
Cancel/Create buttons, reads the CURRENT in-progress form state (not the saved talk) on open and
on every subsequent `input`/`change` event elsewhere in the form (delegated listener, ~200ms
debounce), runs it through the same `TalkAutofix.fix` the real save path uses, and renders the
current question + answer choices as clickable buttons — walking to a real match/ignore/survey-
complete outcome via the actual `checkIfMatch` (talk-engine.ts), not a reimplementation.
Deliberately does not reuse `talk-response-dialog.ts`'s renderer (a stateful closure wired to
localStorage drafts, chatbot lookups, and real submission calls — confirmed unsafe to call from
the editor). New file `src/web/ui/talk-editor-preview.ts`; the flow/survey editor's DOM-read
(previously inlined in `processTalkForm`) was extracted into `collectFlowSurveyEditorQuestions`
so both the real save path and the preview share one read, not two; the route editor's equivalent,
`collectRouteEditorQuestions`, was already a pure function and needed no changes.

E2E: extended `83-talk-template-picker.spec.ts` with progressive-disclosure default-state
assertions; new `84-talk-editor-preview.spec.ts` (flow talk walking to both a match and an
ignore, plus a live re-derive-on-edit check; a route talk's parallel-spec fan-out walking to a
match). All ~33 previously-identified call sites (85, 86, 87, 92, 82, `stage4/06`, plus
`fillPairTagQuestion`/`createFlowOrSurveyTalkViaEditor`/`createRouteTalkViaEditor` in
`tests/e2e/helpers/talk-demo-ui.ts`) re-verified passing after the `<details>`-open fix.

## 2026-08-24 — Talk templates (Buy/Sell, Taxi, Job Seeker/Hiring, Dating) + §DD `ageRange` wiring

Talk editor usability follow-up: a new "🎨 Start from a template" button at the top of a
genuinely-fresh "Create a Talk" form opens a picker (`src/web/ui/talk-templates.ts`,
`UIManager.showTalkTemplatePicker`) offering four built-in starting points — 🤝 Buy/Sell,
🚕 Taxi Ride, 💼 Job Seeker/Hiring, ❤️ Dating — all Pair-tag (`reciprocalTagContext`) talks,
sharing one `buildTwoSidedOfferTemplate` generator. Picking a template opens the ordinary editor
pre-filled (a plain prefill object with no `id` — the same shape the existing copy-talk/survey-
follow-up call sites already pass to `showTalkEditorDialog`), fully editable, created fresh on
save. Deliberately did **not** intercept `#create-talk-btn` itself — ~60 other e2e specs click it
expecting the blank editor to open directly, so that was rejected as too large a blast radius;
the button's behavior is unchanged.

Dating needed real product work first, not just a template — §DD's `ageRange` comparator
(`ageRangeMutuallyAcceptable`, landed 2026-08-23 as a pure function with zero callers) is now a
fully wired `BuiltInQuestionKind`, mirroring how `priceRange`/`quantity` already work:
- `types.ts`: `BuiltInQuestionKind` gains `'ageRange'`; `BuiltInQuestionSpec.ageRange: { age,
  acceptableRange: { min, max } }`.
- `built-in-question-resolution.ts`: new resolution branch calling `ageRangeMutuallyAcceptable`,
  same missing-data → `ASK_USER` pattern as every other kind.
- `typed-preference-store.ts`: `TypedPreferenceValue.ageRange` alongside the existing fields.
- `talk-editor-form-helpers.ts`: new `ageRange` option + 3 typed-input fields (my age, acceptable
  min/max) + read/validate branch, EN+ZH translations.
- `talk-engine.ts` (`TalkAutofix.fix`): a talk with any `builtIn.kind === 'ageRange'` question
  gets `isAdult` force-set to `true` if not already — the authoritative half of the "force and
  lock isAdult for dating-category talks" TODO item, inferred from question shape the same way
  `isDealEligibleTalk` (app.ts) already infers deal-eligibility from `reciprocalTagContext`
  presence, no new schema field. `ui-manager.ts`'s `syncAdultLockFromBuiltInKinds` gives the
  matching live UI feedback (checks + disables `#talk-is-adult` the moment an `ageRange` question
  is selected).
- `mutualPreferenceSetMembership` (multi-value gender/race preference sets) intentionally left
  unwired — the shipped Dating template uses an ordinary Pair-tag question for the gender-
  preference side instead (one accepted counterpart, not a set); see `docs/TODO.md` §DD.

E2E: `83-talk-template-picker.spec.ts` (single browser — picker renders all 5 rows, each
template's prefill is structurally correct, Dating's `ageRange` fields + adult lock included);
`94-dating-agerange-match.spec.ts` (real two-browser match — two independently-authored Dating
talks with mutually-acceptable, non-identical ages match via the existing chatbot exact-text
cross-talk mechanism already proven for `priceRange`, `87-price-overlap-buy-sell-match.spec.ts`;
a second, differently-worded pair with an out-of-range age does not). Buy/Sell, Taxi, and Job
Seeker deliberately don't get their own match spec — they reuse the already-proven Pair-tag +
chatbot mechanism (`89-buy-sell-chatbot-cross-talk-match.spec.ts`, the taxi spec), so only their
template prefill needed checking. 3 new unit tests for the `ageRange` resolution branch
(`built-in-question-resolution.test.ts`).

Two real bugs found and fixed while building this, both worth remembering:
- The Dating e2e match test initially failed silently (`[BODY-RECV] accepted=false`) because
  Eve wasn't age-verified — an adult-flagged talk delivered to a non-age-verified receiver is
  correctly rejected by the existing intake gate (`talk-intake-filters.ts`). Not a bug; just a
  reminder that `serverVouchAgeVerified(page, userId, 3)` (`AGE_VERIFICATION_THRESHOLD`) is
  required before any adult-content e2e scenario can deliver at all.
- The match/mismatch pair in that same test initially collapsed to ONE talk in Adam's own store
  because non-tag talk ids are content-hashed from questions alone (title is not part of the
  identity, `src/shared/cid.ts`) — both pairs originally reused identical question wording across
  different titles, so the second silently deduped into the first. Fixed by giving each pair
  distinct question text, not just a distinct title.

## 2026-08-23 — §EE (partial) + §DD (primitives only)

Moved from `docs/TODO.md` §EE and §DD.

- **§EE: technical-specification implementation matrix updated.** Appendix 18's cross-reference
  row for §30.1–§30.7 was stale (claimed "not yet implemented" for the whole opposite-attribute/
  typed-built-in/dating area even though §BB has substantially shipped since — preference sets,
  seeded + persisted tag pairs, quantity/priceRange/timeFrame comparisons, route DAG branching
  past a shared builtIn root). Split into an accurate "shipped" row plus a clearly-scoped
  "not yet implemented" remainder (location auto-resolution's privacy-safe source, §DD's dating
  profile).
- **§EE: "store typed built-ins as `AnswerRecord` values" — researched, not implemented.**
  `docs/TODO.md`'s own note has the details: no profile field was ever actually written (headed
  off before implementation on 2026-08-11), but a typed builtIn value the author declares on
  their own talk today lives ONLY in `typedPreferenceState` (chatbot-only) — the ordinary
  self-answer UI is deliberately hidden for a builtIn question in both the flow and route
  editors, and `answers-view.ts`'s Me-tab "Answers" list is scoped to `role === 'answered' |
  'copied'` talks (things I responded to), not self-authored declarations. Fixing this needs a
  real decision about where a self-authored declaration should surface, not a display tweak —
  left open rather than guessing.
- **§DD: the two pure comparison primitives implemented, nothing else.** Spec §30.6 (dating)
  needs `mutualPreferenceSetMembership` (two-sided preference-set check — today's `checkIfMatch`
  veto is one-directional, talk-author-vs-responder only) and `ageRangeMutuallyAcceptable` (the
  "point-in-mutual-range" primitive §30.3 explicitly calls out as distinct from interval-overlap:
  one side of the comparison is a single declared age, not a range). Both added to
  `built-in-comparisons.ts` alongside the existing `intervalsOverlap`/`quantitySufficient`/
  `locationsMutuallyContained`, same style, 9 new unit tests (26/26 in the file). Deliberately
  NOT wired anywhere — `ageRange` isn't a recognized `BuiltInQuestionKind` yet, and nothing
  supplies a responder's own (selfTag, preferenceSet) as match-engine input — since doing so
  requires the dating-category detection/enforcement and safety-copy decisions this section's
  remaining bullets are about.

## 2026-08-23 — §BB: persisted user tag pairs + shared builtIn route root branching

Moved from `docs/TODO.md` §BB.

- **Persist user-created opposite-tag pairs.** `tag-opposite-pairs.ts` already had the full
  registry machinery (`TagOppositePairRegistryState`, `registerOppositeTagPair`,
  `getOppositeTagName`) — only persistence and a save-trigger were missing, so a custom pair an
  author typed once (e.g. "borrow"/"lend", not one of the 3 hardcoded seed pairs) had to be
  retyped on every new talk. Added `getTagOppositePairRegistryState`/
  `setTagOppositePairRegistryState` (`answer-preferences-storage.ts`, mirroring the existing
  `getTypedPreferenceState` pattern) storing only the author's own confirmed deltas, never the
  seed pairs themselves. `wireTagAnswerAutoFill` (`talk-editor-dialog.ts`) gained an
  `onCustomPairConfirmed` callback fired on the answer field's `blur` (not every keystroke) when
  the author's typed answer genuinely diverges from the tag (a real opposite pair, not a
  self-match); both call sites (`#talk-tag`/`#talk-preference-set` and `#talk-title`/
  `#talk-answer`) build one merged seeded+persisted registry per editor session and persist
  through the same callback. New E2E case in `stage1-single-user/83-tag-pair-picker.spec.ts`:
  a custom pair typed in one talk auto-fills in a brand-new, separate talk-editor instance.
- **Support talk-level shared time/location questions before route item branches (spec
  §30.5).** Real gap, not just missing UI: a route talk's builtIn (typed-comparison) node —
  quantity/priceRange/timeFrame/location — could only ever be a branch's own terminal leaf,
  since the route editor had no affordance to attach a child to a builtIn node's single
  implicit "Compatible" outcome, and `collectRouteEditorQuestions` unconditionally emitted
  `answers: []` for any builtIn node regardless of whether a child existed. Fixed in
  `ui-manager.ts`: `renderRouteEditor` now renders a "+Add Child"/"+Add Parallel" button (reusing
  the existing `.route-add-child-btn` handler verbatim — it keys off `data-qid`/`data-aid` alone)
  on a builtIn node's fixed synthetic answer id (`${q.id}_compatible`, matching TalkAutofix's own
  naming) and renders that answer's children; `collectRouteEditorQuestions` now emits the real
  compatible/incompatible answer pair for a builtIn node with a proper `nextQuestionId`/
  `nextQuestionIds` when a child was attached (previously always `[]`, silently dropping any
  such link); `buildRouteSelfAnswers`'s self-answer walk now continues past a builtIn node into
  its children instead of stopping dead (a builtIn node itself still gets no self-answer — its
  typed-preference save covers that separately). No changes needed to the actual matching
  engine, `talk-response-dialog.ts`, or the chatbot auto-resolution path — all three already
  treat a builtIn question's resolved answer as an ordinary `Answer` object and follow
  `nextQuestionId` generically, confirming spec §30.5's own claim ("reuses route's existing
  DAG/contextHash machinery unchanged; the branch point is an ordinary route fork, not a new
  construct"). New `stage2-two-user/92-route-shared-builtin-root-branches.spec.ts`: a route talk
  with a shared `timeFrame` root branching into an ordinary "Which item?" choice, each item
  ending in its own `quantity` builtIn leaf — verifies the editor round-trip (child link
  survives save/reopen) and a real second-browser responder manually walking the whole DAG
  (root → item choice → leaf) to a real match. Regression-verified against
  `82-route-editor-multi-item-builtin.spec.ts`, `88-asymmetric-exact-match-with-attachment.spec.ts`,
  `89-buy-sell-chatbot-cross-talk-match.spec.ts`, `90-reciprocal-tag-context-non-root-
  question.spec.ts`, and `stage3-three-user/80-route-multi-spec-match-percent.spec.ts` (all
  pass unmodified) plus the full unit suite (152/152 suites).

## 2026-08-23 — Smaller independent work batch (R4, R5, Z, CC, FF, sendBulkTalk, authorship, docs)

Moved from `docs/TODO.md` "Smaller independent work". Each item measured or reviewed before
acting, per the file's own conditional wording and the repo's anti-overengineering convention.

- **R4 (chatroom member-list progressive rendering) — measured, no action needed.** Every
  chatroom (including Global) is FIFO-capacity-capped at `CONFIG.CHATROOM_CAPACITY`
  (`src/shared/config.ts`; production default 3, e2e/local-loopback default 50) — overflow
  moves the oldest member DOWN the hierarchy to a child chatroom
  (`enforceCapacityLimitAfterJoin`, `web-chatroom-service.ts`), so no single room instance can
  ever hold more members than the cap. "Large chatroom member lists" cannot occur in
  production; the existing non-blocking-enrich pattern (`renderMemberList` renders
  synchronously, `loadMemberStats` fills in stats afterward) is already sufficient. No code
  change — chunked rendering here would be pure speculative engineering.
- **R5 (conversations/support-inbox progressive rendering) — measured, no action needed.**
  `displayConversationsList` (`conversations-view.ts`) has no async enrichment chain (unlike
  the Contacts case R1 fixed) — it's a single synchronous string-join. Measured directly
  (throwaway jsdom timing test, not committed): 500 conversations render in ~81ms, 2000 in
  ~277ms — both comfortably under the 500ms first-row bound this repo already uses elsewhere
  (R1). No first-render problem exists at any realistic or even generous scale.
- **FF (searchable chips for large flat checkbox lists) — measured, no action needed.**
  Surveyed every checkbox-list rendering site in `src/web/ui/*.ts`: language filters (7
  options, `LANGUAGE_OPTIONS`), relationship labels (6), talk-type filters (4), tag-kind
  toggles (2-3). All already render as compact pill/chip-styled checkboxes. None come close to
  a count that would benefit from search-to-filter. No current instance of the "very large
  flat list" this item anticipates.
- **Z (long-press popup-variant review) — reviewed, one real inconsistency found and fixed.**
  The popup shell itself (`showDetailsPopupFor`, ui-manager.ts) was already fully unified by
  the earlier M2/M3 work; the review here covered its two live content variants (OUT-row
  `.talk-item-details` and IN-row `.talk-item-details`, both reparented into the one shared
  popup) plus the Answers-tab `.answer-item-details` variant. Found: the IN-row popup renders
  its expiry as a tone-colored chip (`formatTalkExpiryTone` → `talk-expiry-{green,amber,red}`,
  giving at-a-glance urgency), while the OUT-row popup rendered the identical
  `formatTalkExpiration` value as plain uncolored text — an unjustified asymmetry, since my own
  sent talks expire on the same clock and deserve the same cue. Fixed: OUT-row's combined
  expiration+location text line converted into the same two-chip structure (`.talk-info-chips`)
  IN already uses, with the same tone class. Verified via
  `stage1-single-user/37-compact-talk-rows-out.spec.ts`,
  `stage1-single-user/05-talks-edit.spec.ts`, `stage2-two-user/80-talk-co-exchangers.spec.ts`
  (all pass unmodified).
- **CC (once-per-day financial-safety-toast E2E coverage) — landed.** No E2E coverage existed
  for FR-FIN-1's T1 (pre-send)/T2 (post-match) cooldown toasts at all (only an unrelated unit
  test for the content-filter guard). Added `data-safety-toast="pre-send"|"post-match"` markers
  to `showNotification` (ui-manager.ts), matching the existing `data-content-filter-notification`
  convention. New `stage2-two-user/91-safety-toast-once-per-day.spec.ts`: drives the real
  `#broadcast-talk-btn` click and a real match, proves each toast fires once, is suppressed on
  an immediate repeat within the 24h cooldown, and returns once the cooldown's own `localStorage`
  timestamp is time-travelled forward a day. **Found and worked around a real test-infra trap**:
  the shared `clickBroadcastUntilBulkAck` helper's direct-talk-delivery-e2e branch calls
  `deliverBroadcastViaAppPath` (an E2E-only shortcut into `app.deliverPendingBroadcastTalksForE2e`)
  *without* ever clicking `#broadcast-talk-btn` — exactly the click that fires the T1 toast — so
  this spec clicks the button directly instead. T1's three-cycle cooldown proof runs fully
  through real repeated broadcasts; T2's cooldown arithmetic (after its wiring into one real
  match is proven) is exercised through the same production method
  (`maybeShowMatchSafetyToast`) a second real match would call, to avoid re-proving mesh
  delivery reliability already covered elsewhere. Stable across repeated runs.
- **`sendBulkTalk`/`BulkSendJob` — decided: remove.** Confirmed genuinely dead: no UI ever
  emitted the `'sendTalk'` event that reached it, and both the server (`TalkService.sendBulkTalk`)
  and client (`WebTalkService.sendBulkTalk`) implementations were no-op stubs that only wrote a
  job record to `bulkJobs/<id>` and never actually delivered anything — a vestige of a
  server-authoritative bulk-send design superseded by real mesh/broadcast delivery
  (`PeerMeshService`, §U's contact-group broadcast). Removed both service methods, the
  `'sendTalk'` app.ts handler, the now-orphaned `formatTalkSendSuccess`/`formatTalkSendFailed`
  (ui-manager.ts) and their translation strings, and the `BulkSendJob`/`TargetScope` types
  (only ever referenced by this dead path). `TalkService`'s reputation side-effect
  (`updateUserReputation(senderId, 'talk_sent')`) had no other caller either and was removed
  with it. Full unit suite green (151/151 suites) after removal.
- **Metadata-only talk-edit authorship semantics — resolved.** `WebTalkService.updateTalk`
  already unconditionally preserves `authorId`/`createdAt`/`authorLocation` from the existing
  talk regardless of whether the edit is metadata-only (tags/expiry/locationRadiusMiles) or also
  touches content fields (questions/type/language) — this was undocumented, untested behavior
  rather than a decided design. Resolution: this is correct by construction, not just
  incidentally — the only mechanism anywhere in this codebase that reassigns authorship is
  minting a new talk id (`buildRevisedTalkDraft`, used only when editing a copied-but-not-yet-
  owned talk), and `updateTalk` never changes the id. Consistent with the separately-settled
  "title edits don't count as authorship" precedent, generalized: no in-place edit of an
  already-owned talk reassigns authorship, whatever fields it touches. Documented via a doc
  comment on `updateTalk` itself and locked in with 2 new unit tests
  (`web-talk-service-update-authorship.test.ts`) covering both the metadata-only and the
  content-touching case.
- **Stale architecture prose (routing / incoming-talk delivery) — refreshed.**
  `docs/testing/testplan.md`'s own "Invariants" section still asserted "Server `incomingTalksMap`
  authoritative; browser uses `GET /api/incoming-talks`" as current fact — both were removed
  with the star-delivery model (per `CLAUDE.md` and the technical specification's own
  "Deprecated for production" framing of the same mechanism). Corrected to describe the actual
  current model: client-side-only incoming-talk clusters mesh-delivered into the receiver's own
  local Gun graph, no server map, no such endpoint.

## 2026-08-22 — S2: retention caps derived from a shared storage budget

Moved from `docs/TODO.md` §S2 (Priority 1). `graph-size-report.ts` measures serialized byte
size per Gun-graph category and derives ledger/message/incoming-talk-cluster retention caps
from an adjustable total local-storage budget, replacing three previously-independent flat
guesses (500/200/500).

- Added `serializedByteSize(value)` (UTF-8 byte count of the JSON the value actually writes to
  Gun as) and `totalBytes`/`avgBytes` fields on every `GraphSizeReport` category — always
  computed, not just for the 3 categories this item cares about, since the report's own stated
  purpose ("argue a retention policy from real numbers") applies equally to any category.
- Added two matchers `buildGraphSizeReport` was missing entirely (both silently fell into
  `unclassifiedCount` before): `ledger-events` (`ledger/<userId>/events/<seq>`) and
  `pair-conversation-messages` (`pairConversations/<pairId>/<convId>/messages/<messageId>` —
  the *actual* path direct-p2p DM bodies live at per CLAUDE.md's "Direct P2P conversation
  transport" section; the pre-existing `conversation-messages` matcher only covers the
  legacy/star-relay path, effectively empty in the ordinary case). Measuring
  `conversation-messages` alone would have derived a cap from the wrong, near-empty category.
- `deriveRetentionCap(avgBytes, fallbackCap, totalBudgetBytes?, categoryCount?)`: the
  `floor(categoryShare / measuredAverageBytes)` formula for one category, with
  `TOTAL_LOCAL_RETENTION_BUDGET_BYTES` (8 MiB) and `RETENTION_BUDGET_CATEGORY_COUNT` (3,
  evenly split — a usage-weighted split is a future refinement, not this item) as the
  adjustable defaults. Falls back to the caller's own previous flat constant on a bad
  measurement (zero/negative avgBytes, or a cap that floors to 0) rather than producing
  `maxSlots: 0`.
- Per the user's own choice among three proposed approaches (representative sample vs.
  live-measured async init vs. measurement-only-no-wiring): each of the 3 categories gets a
  synchronous, deterministic representative sample built from its real wire shape
  (`WebLedgerService.writeEventToGun`'s `contentJson` shape, `GunMessageStore.putMessageRecord`'s
  record shape, `IncomingTalkClusterWire`'s shape) with realistic-*length* placeholder
  CID/pubkey/signature/ciphertext strings — genuinely measured via `serializedByteSize`, not
  guessed, but not live per-user data either. Chosen specifically because the 3 target
  constants are synchronous module-load exports read by many call sites; an async
  live-measurement architecture would have required converting all of them to a
  refreshable/gettable value and touching every call site, a materially bigger change than
  this item scoped.
- Wired into the 3 real constants: `LEDGER_RETENTION_WINDOW` (web-ledger-service.ts,
  `deriveRetentionCap(representativeLedgerEventBytes(), 500)`), `MESSAGE_RETENTION_WINDOW`
  (gun-message-store.ts, fallback 200), `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS`
  (peer-talk-delivery.ts, fallback 500) — each only as the *unset* fallback, so the ledger/
  message E2E spec's own `IINPUBLIC_E2E_*` overrides (§S1) still take priority untouched.
  Measured real derived caps (~354–889 bytes/record against the 8 MiB/3 budget): ledger
  events → ~4017 slots, pair-conversation messages → ~7898, incoming-talk clusters → ~3145 —
  all substantially larger than the old flat defaults, meaning local storage now keeps more
  history within a fixed byte ceiling rather than a conservative round-number guess.
- `web-ledger-service.test.ts`/`gun-message-store.test.ts` intentionally drive a small,
  specific number of events/messages past the retention boundary to prove pruning fires;
  scaling that up ~15-40x to match the new derived caps would have made them dramatically
  slower for no added coverage. Pinned back to the suites' own long-established flat values
  (500/200) via `src/test/setup.ts` setting `IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW`/
  `IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW` globally for the Jest environment only — the exact
  same override mechanism the real-browser E2E spec already uses, just pinned at the test
  suite level instead of per-spec. Production (unset) is unaffected.
- Real bug found and fixed along the way, unrelated to any of the above: referencing an
  *imported* TS enum's member (`InteractionKind.TALK_ANSWERED`) at a shared module's own top
  level (outside any function) breaks under Playwright's Node-side esbuild-based test-file
  transform — the imported binding reads as `undefined` at that module's own evaluation time,
  reproduced in total isolation (a two-line probe spec, zero other imports, zero cycles).
  `graph-size-report.ts` is reached directly by `30-ledger-message-pruning-e2e.spec.ts`'s own
  top-level import of `web-ledger-service.ts`, so it has to survive Playwright's transform, not
  just webpack's and ts-jest's. Fixed by using the literal string `'TALK_ANSWERED'` (the enum
  member's own string value) instead of importing `InteractionKind` as a value at all.

**Verification:** new `graph-size-report.test.ts` coverage (32/32, including boundary cases:
zero/negative/NaN avgBytes, an avgBytes that would floor the cap to 0, non-positive
budget/categoryCount, UTF-8 multi-byte byte counting); `peer-talk-delivery.test.ts` (still
4/4, scale-invariant since it references the constant by name rather than a hardcoded
literal); `web-ledger-service.test.ts`/`gun-message-store.test.ts` unaffected in count or
timing after the `src/test/setup.ts` pin; full `npx jest src/test` (135/140 suites — the other
5 fail for the same pre-existing, unrelated `qrcode` module-resolution gap noted in §S1, not
touched by this work); `npm run test:type`, `npx eslint` on every changed file;
`30-ledger-message-pruning-e2e.spec.ts` green on a real-browser run with the new wiring in
place; a real-browser `09-messaging.spec.ts` smoke run (unrelated ordinary two-user
messaging, no env overrides) green, confirming normal app boot with the new module-load
computations in place.

## 2026-08-22 — S1: real-browser ledger + message pruning spec fixed and green

Moved from `docs/TODO.md` §S1. `stage2-two-user/30-ledger-message-pruning-e2e.spec.ts` was
stuck at its very first assertion (ledger seq 1 never actually pruned) since 2026-08-14. Root
cause was NOT the ledger/message pruning logic itself (already unit-verified) — it was that the
E2E-only `IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL`/`_RETENTION_WINDOW`/`IINPUBLIC_E2E_MESSAGE_*`
env overrides never actually reached the browser bundle, so both services silently ran at their
production scale (100/500 and 50/200) no matter what the spec set — the fill counts the spec
computed for the small env-overridden scale were never enough to cross a checkpoint/retention
boundary at production scale.

Two compounding bugs in the env-read helpers (`web-ledger-service.ts`, `gun-message-store.ts`):
1. Both used one generic `readE2eEnvInt(key)` helper doing `process.env[key]` — a *dynamic*
   bracket-notation lookup. Webpack's `DefinePlugin`/`EnvironmentPlugin` only replace literal
   *static* member expressions (`process.env.SOME_KEY`); neither can see through a variable key,
   so the expression reached the browser completely unrewritten.
2. Giving each constant its own reader with the key written out as a literal still wasn't
   enough: the reader also wrapped the access in a `typeof process !== 'undefined' &&
   process.env` runtime guard (copied from `config.ts`'s `getEnv`, which needs it because it
   *does* take a dynamic key). Webpack never defines a bare `process` global in either build
   branch (no `ProvidePlugin` here) — only specific literal `process.env.KEY` expressions get
   replaced, which removes the `process` identifier from that call site entirely. The guard's
   own bare `process` reference has no literal to be replaced with, so it stayed a real runtime
   lookup against a global that's never defined — always `'undefined'`, always false, discarding
   the correctly-substituted literal on the other side of the `&&`.

Fixed by giving each constant a dedicated reader with a literal static `process.env.KEY` access
and no runtime guard (`web-ledger-service.ts`, `gun-message-store.ts`), and by adding the same
four keys (`IINPUBLIC_E2E_ENABLE_LEDGER`/`_LEDGER_CHECKPOINT_INTERVAL`/`_LEDGER_RETENTION_WINDOW`/
`_MESSAGE_CHECKPOINT_INTERVAL`/`_MESSAGE_RETENTION_WINDOW`) to webpack.config.js's
`EnvironmentPlugin` block (ordinary `npm run dev`, not just the DISABLE_HMR=true `DefinePlugin`
branch) — the same reasoning `app.ts`'s `isLedgerDisabledForRun` already relied on for
`process.env.DISABLE_HMR`, which is why that one check happened to already work.

With the ledger portion fixed, the spec advanced into genuinely new territory (the message-side
half of the scenario had never run to completion in a real browser before) and surfaced a second,
unrelated real bug: `deleteMessageRecord` called `.get(wireId).put(null)` on the message's own
nested Gun edge, which only nulls the *parent* (`messages`) node's pointer to the child — it does
not touch the child soul's own content. Gun's graph is append-only (confirmed against the
server's raw `gun._.graph`, which `/api/test/export-snapshot` dumps unfiltered): a soul, once
materialized, is a permanent key forever; no write can make it vanish, only clear its fields.
Unlinking the parent edge was enough to make the record invisible to ordinary app traversal, but
left the full plaintext/ciphertext of every "pruned" message sitting in the durable graph
forever — which would have made §S2's storage-budget derivation meaningless, since deletion
wouldn't actually free any bytes. Fixed by nulling the child node's own fields directly
(mirroring the ledger's own `putRawGunFieldsNulled` fix for the identical class of bug), and
updated both the E2E spec's assertion and the unit test's analogous check to verify content
absence (`.text` falsy) rather than raw graph-key absence, matching how the ledger's own
`isLedgerRawEventPresentForE2e`/`getEventBySeq` already check content, not key presence.

**Verification:** `stage2-two-user/30-ledger-message-pruning-e2e.spec.ts` green on two
consecutive real-browser runs; `gun-message-store.test.ts` (13/13, including the two tests
updated for the new content-nulling semantics) and `web-ledger-service.test.ts` (9/9); full
`npx jest src/test` (135/140 suites passing — the other 5 fail for a pre-existing, unrelated
`qrcode` module-resolution gap, confirmed via `git stash`/baseline diff, not touched by this
work); `npm run test:type`, `npx eslint` on every changed file; a plain `npx webpack` dev-mode
build (the non-E2E `EnvironmentPlugin` branch touched by this fix) still compiles clean with no
unresolved `process` reference in the bundle.

## 2026-08-12 — BB Phase 5 follow-up: tag-pair picker wired into the talk editor

Moved from `docs/TODO.md` §BB Phase 5's "NOT shipped" note — built on request after the taxi/
handyman e2e work (§GG/§HH) surfaced the question of why `Talk.role` is still the only live
mechanism when Phase 1's opposite-tag registry (`tag-opposite-pairs.ts`) already existed.

- New `#talk-tag-group` in the talk editor (`talk-editor-dialog.ts`), a "leading section" text
  input placed before the existing role dropdown: typing one of the 3 app-predefined deal tags
  (`buy`/`sell`/`hiring`/`jobseeking`) shows a live opposite-tag preview, auto-sets `#talk-role`
  via new `dealRoleForTag` (`tag-opposite-pairs.ts`), and — only when the first question's text
  is still empty, so a real edit is never clobbered — pre-fills it from new
  `questionTemplateForTag`'s "addressed to the opposite side" wording (e.g. a `buy`-tagged talk
  suggests "Do you sell {title}?", the "self-describing tags, decoupled question wording" idea
  from §BB's original design).
- `checkIfMatch` still reads `Talk.role` completely unchanged, per the original "zero engine
  changes" decision recorded when §BB was designed — this picker is a friendlier way to SET that
  same field, not a replacement for it.
- `Talk.tags` is now real persisted data via `processTalkForm` (was hardcoded to `[]`
  everywhere in the editor). Verified the full create/update pipeline (`app.ts` →
  `WebTalkService`) forwards it correctly — checked specifically because a near-identical bug
  (a field silently dropped by a whitelist) bit §Y1 earlier this project.
- An unrecognized tag (including `male`/`female`, reserved for §DD) falls back to manual role
  selection exactly like before this control existed. Deliberately still no persistence for
  user-created (non-seeded) tag pairs — only the 3 app-predefined ones are live.

**Verification:** `npm run test:type`, `npx eslint`, `npm run test:unit` (1365 passing, +14 new
tests for `dealRoleForTag`/`questionTemplateForTag`), new
`tests/e2e/staged/stage1-single-user/83-tag-pair-picker.spec.ts` (live preview, auto-role-set,
non-clobbering auto-fill, unrecognized-tag fallback, full round-trip through save + reopen —
passed on the first real run), plus a 15/15 combined e2e regression run (dealmaker, taxi,
handyman, talks-edit, ui-navigation-settings).

## 2026-08-11 — GG/HH: taxi and handyman local-chatroom matching e2e scenarios

Moved from `docs/TODO.md` §GG/§HH. Two new 4-user e2e scenarios implemented from Bernard's
plain-English descriptions, both reusing the proven Adam/Eve/Bob/Alice "one match, one no-match"
pattern (`04-dealmaker-chatbot-match.spec.ts`) and joining a real city-level chatroom
(`san-diego`) instead of Global for the first time in any matching-focused e2e spec.

- **§GG (taxi)** — `tests/e2e/staged/stage4-four-user/05-taxi-local-chatroom-match.spec.ts`.
  Driver/passenger matching via reworded-question-text differentiation (no new engine work
  needed). Two scenario elements that don't exist as real features were deliberately simulated
  rather than built: "precise location for pickup" (no such feature exists, already flagged
  unscoped elsewhere) as a plain post-match DM message; "licensed and experienced driver" as a
  self-declared criterion baked into the shared matching chain. Passed on the first real run.
- **§HH (handyman)** — `tests/e2e/staged/stage4-four-user/06-handyman-local-chatroom-match.spec.ts`.
  A showcase for §FF (multi-select) + §BB (`priceRange`/`timeFrame` builtIn) composing in one
  3-question chained flow talk — real interval-overlap and set-intersection math, not exact-text
  luck. This is the first talk in the whole test suite with MORE THAN ONE `builtIn` question,
  which surfaced two real, previously-latent §BB engine bugs:
  1. `typed-preference-store`'s scope key was `(role, title)` only — two `builtIn` questions in
     the same talk collided on an identical key, the second save silently overwriting the first.
     Fixed by adding the question's own text as a third scope-key component
     (`makeTypedPreferenceScopeKey(role, title, questionText)`), on both the save side
     (`processTalkForm`) and read side (`resolveBuiltInQuestion`).
  2. The builtIn answer-lookup picked the "compatible" synthetic answer by its `isMatch` flag —
     which only survives when the `builtIn` question is the LAST one in its chain.
     `TalkAutofix.fix`'s flow-normalization step strips `isMatch` and substitutes `nextQuestionId`
     for any `builtIn` question that links to a next question (both price range and time frame
     here do, since a service-category question follows). Fixed by extracting a new
     `pickBuiltInAnswer` helper (`built-in-question-resolution.ts`) that looks answers up by their
     fixed, deterministic id (`${questionId}_compatible`/`${questionId}_incompatible`) instead of
     a flag TalkAutofix may or may not have preserved.

  Both bugs were diagnosed by adding temporary instrumentation directly to the real resolution
  call chain (confirmed the typed-preference save was correct, confirmed correct delivery
  content, then traced exactly where the per-question auto-resolution loop silently stopped) —
  not guessed or worked around in the test. Neither `86-builtin-quantity-match.spec.ts` nor
  `82-route-editor-multi-item-builtin.spec.ts` caught either bug, since both only ever used a
  single `builtIn` question per talk.

  Also documented (not a bug, a real constraint): a `'multiple'`-mode question is always
  chain-terminal, so the service-category question must be LAST in the flow, with the builtIn
  questions chained earlier — putting it first would fail `TalkValidator` outright.

**Verification:** `npm run test:type`, `npx eslint`, `npm run test:unit` (1225 passing, +8 new
tests across both fixes), and a combined 10/10 e2e regression run (taxi, handyman, dealmaker,
multi-value-checkbox, builtin-quantity, route-editor specs).

## 2026-08-11 — BB: opposite-tag deal matching, typed built-in comparison questions

Moved from `docs/TODO.md` §BB. All 6 planned implementation phases shipped in 6 separate
commits, each independently verified (type-check, lint, unit suite, targeted + regression e2e)
before the next started. Full rationale, decisions, and explicit deferrals are in `docs/TODO.md`
§BB and `docs/specs/iinpublic-technical-specifications.md` §30.2 — this entry is a pointer/summary.

- **Phase 1** — `src/shared/tag-opposite-pairs.ts`: opposite-tag registry generalizing the
  hardcoded `Talk.role` 'offer'/'request' pair (canonical tag identity, predefined seed pairs,
  user-created pairs). Pure module, no persistence wiring yet.
- **Phase 2** — `Question.builtIn` on `types.ts` (`quantity`/`priceRange`/`timeFrame`/`location`);
  `TalkAutofix.fix` auto-generates the 2 synthetic answers (Compatible/Not compatible) for a
  builtIn question with no author-typed answers. `location` reuses the talk's own existing
  `authorLocation`/`locationRadiusMiles` rather than duplicating coordinates onto the question.
- **Phase 3** — `src/shared/built-in-comparisons.ts` (interval-overlap, quantity sufficiency,
  location mutual-containment) and `src/shared/typed-preference-store.ts` (tag-scoped local
  storage for a user's own typed preference), both pure and unit-tested including boundary cases.
- **Phase 4** — `src/shared/built-in-question-resolution.ts`'s `resolveBuiltInQuestion`, wired
  into `resolveAnswerPreferenceForTalkQuestion` (ui-manager.ts) ahead of the exact-text chatbot
  paths. `quantity`/`priceRange`/`timeFrame` wired now (scoped by role, an interim substitute for
  a real deal tag); `location` deliberately deferred (always asks a human, needs a geo/privacy
  source not yet designed).
- **Phase 5** — Flow talk-editor UI: a per-question "Compare using:" kind selector + typed input
  widgets replacing "+ Add Answer," wired into `processTalkForm` (reads the value, forces
  `answers: []`, saves the value as the author's own typed preference as a side effect). Found
  and fixed a real scope-key bug (the read side used the incoming talk's own role instead of its
  complement) before shipping. Verified end-to-end via a new e2e spec, zero manual clicks.
- **Phase 6** — Route-branch integration for multi-item listings. Found and fixed a real
  pre-existing bug unrelated to §BB: the route editor never wrote `answer.nextQuestionId`, so any
  route talk saved through the live editor could never navigate past its first question (no
  existing test caught it — route coverage seeds via the API, never drives the live branch UI).
  Fixed alongside adding per-item builtIn leaf questions to the route editor. First test to
  exercise the interactive route editor's branch-authoring flow end to end.

**Not shipped, tracked as deliberate deferrals in `docs/TODO.md` §BB**: the tag-pair picker and
auto-generated first-question template (Phase 5 — building it wouldn't change live behavior since
Phase 4 doesn't consume tags yet); `location` auto-resolution (Phase 4 — no geo/privacy source
designed); route's talk-level shared time-frame/location across branches (Phase 6 — blocked on
the same "add child to a builtIn node" gap as the tag picker); cross-browser auto-match proof for
route builtIn questions.

**Verification:** `npm run test:type`, `npx eslint`, `npm run test:unit` (1219 passing throughout),
and e2e regression runs after each phase — final combined run: `08-route-job-seeking`,
`00-ui-navigation-settings`, `05-talks-edit`, `82-route-editor-multi-item-builtin` (11/11),
`04-dealmaker-chatbot-match`, `85-multi-value-checkbox-match`, `86-builtin-quantity-match` (7/7).

## 2026-07-14 — S3 embedded-node mobile shells: Android/iOS native builds verified

Moved from `docs/TODO.md` (S3 "Remaining" items).

- **Android:** `android/app/src/main/cpp/native-lib.cpp` implements the real
  JNI shim — `Java_com_iinpublic_app_NodeBridge_nativeStartNode` sets the
  `IINPUBLIC_*` env vars, `chdir`s into the app's writable data dir, and calls
  `node::Start()` on a detached pthread. `NodeBridge.kt#startProject` calls
  this native entry point directly (no stub). `CMakeLists.txt` links the
  prebuilt `libnode.so` (real ELF binaries, all three ABIs) from
  `android/app/libnode/`.
  **Verified:** `npm run build:android` → `BUILD SUCCESSFUL`, including live
  `configureCMakeDebug`/`buildCMakeDebug` runs for `arm64-v8a`,
  `armeabi-v7a`, and `x86_64`; `app-debug.apk` produced.
- **iOS:** `platforms/ios/Frameworks/NodeMobile.xcframework` vendored with
  device, simulator, and Mac Catalyst slices. `platforms/ios/IinPublic.xcodeproj`
  (real `.xcodeproj`, not scaffolding) embeds the framework and includes a
  "Run Script" build phase that copies `nodejs-project/{main.js,package.json}`
  and the compiled `dist/{server,web}` into the app bundle. `NodeRunner.swift`
  imports `NodeMobile` and calls `node_start()` with real argv, after copying
  the bundled node project into `Application Support`.
  **Verified:** an existing on-disk `Release-iphoneos` build product
  (`platforms/ios/build/Build/Products/Release-iphoneos/IinPublic.app`)
  contains the linked `NodeMobile.framework` plus populated `dist/web` and
  `dist/server` directories, confirming the copy phase and framework linkage
  work end-to-end. `xcodebuild` could not be re-invoked directly in this
  session (sandbox permission gate on `xcodebuild`/no npm wrapper exists for
  it), so this run relied on the existing build artifact rather than a fresh
  invocation — recommend an interactive `xcodebuild` run to reconfirm after
  any further iOS changes.

## 2026-07-06 — Pairwise conversation hardening complete

Moved from `docs/TODO.md`.

- The canonical pair thread model (`conv_pair_<sorted users>`) is implemented
  and reused by direct peer-detail sends, matched-talk continuations, and
  reopened conversation views.
- Direct peer-detail delivery without a matched talk is covered by
  `tests/e2e/staged/stage2-two-user/00e-chatroom-peer-detail.spec.ts`.
- Concurrent sends converge to one deterministic rendered order on both sides in
  `tests/e2e/staged/stage2-two-user/29-messaging-concurrent-order.spec.ts`.
- Unread/read cursor behavior is covered by
  `tests/e2e/staged/stage2-two-user/30-messaging-read-state.spec.ts`.
- Large ordered history, reload recovery, support-channel vs non-support pair
  classification, and explicit unsupported edit/delete state are covered by
  `tests/e2e/staged/stage2-two-user/31-messaging-history-order.spec.ts`.
- Hard-crash mailbox recovery can continue the same canonical pair thread, as
  covered by `tests/e2e/staged/stage2-two-user/37-hard-crash-recovery.spec.ts`.
- Multi-partner conversation recency sorting is covered by
  `tests/e2e/staged/stage3-three-user/29-conversation-list-sorting.spec.ts`.

**Verification:** `npm run test:type && E2E_PORT_OFFSET=452 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/31-messaging-history-order.spec.ts`.

## 2026-07-06 — Desktop native app boot E2E harness

Partial native-app E2E milestone from `docs/TODO.md`.

- `platforms/desktop/main.js` now honors `IINPUBLIC_USER_DATA_DIR` before
  Electron reads `app.getPath('userData')`, so multiple local app instances can
  run with isolated browser/native profile state.
- Added `tests/e2e/native-app/` with a dedicated Playwright config and
  `npm run test:e2e:native-app`.
- `01-desktop-app-boots.spec.ts` launches the real Electron desktop shell from
  `platforms/desktop`, points it at the test hub, verifies the app-owned
  loopback node serves `/health`, `/worker.js`, and `/node_modules/gun/gun.js`,
  verifies the SPA replaces the static loading placeholder, and checks that
  node data lands under the per-test user data directory.
- `02-browser-and-desktop-app-presence.spec.ts` launches one ordinary browser
  user and one real Electron desktop app user against the same test hub and
  verifies both ordinary users appear in Global on both clients and through the
  hub `/members` endpoint.
- `03-two-desktop-apps-presence.spec.ts` launches two real Electron desktop app
  users on one Mac with distinct `IINPUBLIC_LOCAL_PORT` values and distinct
  `IINPUBLIC_USER_DATA_DIR` directories, then verifies both users appear
  together in Global through the shared hub and in each app UI.
- Fixed the native test harness so the Electron process does not inherit
  `E2E_GUN_MEMORY_ONLY=1`; the hub server remains memory-only, but the embedded
  app node must still dial that hub.

**Verification:** `npm run test:type`; `npm run test:e2e:native-app` (3 passed).

## 2026-07-06 — LAN dev-host URL derivation

Partial LAN-browser prerequisite from `docs/TODO.md`.

- `deriveBackendApiBaseFromLocation()` and `deriveGunHubUrlFromLocation()` now
  apply the dev/e2e web-port-to-Gun-port mapping for any hostname, not only
  `localhost`/`127.0.0.1`.
- A browser on another LAN machine loading `http://<dev-host>:3001` now derives
  the backend API as `http://<dev-host>:8080` and Gun as
  `http://<dev-host>:8080/gun`, matching the development topology.
- Same-origin production (`https://www.iinpublic.com/gun`) and embedded-node
  loopback ports (`127.0.0.1:<appPort>/gun`) remain covered.

**Verification:** `npx jest src/test/unit/web-gun-service-hub-url.test.ts --runInBand`;
`npm run test:type`.

## 2026-07-06 — Hub hardening design note

Partial S3 Hub hardening milestone from `docs/TODO.md`.

- Added `docs/design/hub-hardening-explicit-relay-channel.md`.
- The note anchors the privacy issue in current code:
  `src/node-app/embedded-node.ts`, `src/server/bootstrap/http-bootstrap.ts`,
  `scripts/relay-only-verification/run.js`, and Gun's `mesh.say` fanout.
- It recommends replacing the embedded-node generic Gun peer link to the public
  hub with an explicit relay-only HTTP channel for discovery, signaling,
  presence, and room membership.
- It defines acceptance tests for the implementation: no generic upstream Gun
  peer in embedded explicit-relay mode, relay client rejection of app/private
  graph classes, membership mirroring to the hub, native app E2E remaining
  green, and relay-only verification proving `talks/*` does not leak to the
  hub.

## 2026-07-06 — `dev:multi` presence reset and E2E coverage housekeeping

Moved from `docs/TODO.md`.

- **Peer-detail direct-message receive bug fixed.** The direct-message compose box
  on a peer detail already created a synthetic `talkId: "direct"` conversation,
  but message load/send paths did not pass the known peer id as a hint, forcing
  pair-private reads/writes through a slower global-conversation lookup. The
  conversation load path, normal message send path, and peer-detail direct-message
  send path now pass `otherUserId` when it is already known. Added a regression
  to `tests/e2e/staged/stage2-two-user/00e-chatroom-peer-detail.spec.ts` proving
  Tom can open Jerry from Global, send a direct message without a matched talk,
  and Jerry can open the created pair conversation and see it.
- **`npm run dev:multi` stale Global headcount fix.** `dev:multi` now runs
  `scripts/reset-dev-data.js`, starts the app with `IINPUBLIC_STAGE_SEED=stage-zero`
  and `DEV_GUN_FRESH=1`, wipes the persistent `user_data/` browser profiles via
  `DEV_MULTI_RESET_PROFILES=1`, and sets
  `IINPUBLIC_STAGE_ZERO_MAX_GLOBAL=4` so the stage-zero watchdog permits the
  expected TechSupport bootstrap plus three browser users while still scrubbing
  larger ghost rosters. Added `getDevStageZeroMaxGlobalMembers()` and a focused
  unit test for default/override/invalid values.
- **`dev:multi` topology smoke added.** `scripts/dev-techsupport-bootstrap.js`
  seeds TechSupport as bootstrap before ordinary dev users navigate, using the
  existing non-production snapshot import path only when the clean reset flow
  explicitly allows it. `launch-browsers.js` now performs that bootstrap during
  `npm run dev:multi`, and `scripts/smoke-dev-multi.js` starts an isolated hub,
  starts the E2E web dev server, launches three persistent browser profiles, and
  asserts Global contains exactly TechSupport plus those three users. The smoke
  keeps child server logs quiet by default and prints the observed member IDs so
  ghost memberships are easy to diagnose.
- **First-user support flow now treats TechSupport as bootstrap.** On an empty
  network, the app no longer turns the first unseeded browser user into the
  TechSupport root. Startup silently ensures the canonical TechSupport root
  exists first, then creates the human as an ordinary user. The support welcome
  now uses deterministic `support_welcome_<userId>` message IDs, making "exactly
  one greeting" enforceable after reloads. Extended
  `tests/e2e/staged/stage1-single-user/01-login-single-user-headcount.spec.ts`
  to assert the first user's id is not `iinpublic-root-techsupport`, the Global
  headcount is TechSupport + one user, the support conversation appears exactly
  once, and the Gun graph contains one welcome message after reload.
- **E2E helper semantics now guard TechSupport root vs ordinary users.** Added
  `tests/e2e/helpers/techsupport-contract.ts` with executable assertions for
  "current user is the canonical TechSupport root" and "current user is an
  ordinary non-root user." Wired those assertions into the canonical bootstrap,
  talks-matching bootstrap, mobile bootstrap, and super-user bootstrap helpers.
  The existing database/stage helpers already seed and validate the canonical
  root baseline (`clear-database.ts`, `e2e-stage-pipeline.ts`), and the staged
  docs now distinguish stage0 TechSupport bootstrap from ordinary-user stage1+
  flows.
- **Multilingual TechSupport bot path covered for supported UI languages.**
  Added a localized `supportReply` translation and a TechSupport auto-reply for
  support-channel user messages. Replies use the user's current UI/profile
  language preference through the existing UI translation resolver; unsupported
  profile languages still fall back to English. The existing conversation
  renderer already localizes stored English support welcomes, and
  `tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts` now
  switches Tom to Chinese, sends `你好，TechSupport`, and verifies the Chinese
  support reply appears without corrupting the support conversation history.
- **TechSupport root/bootstrap contract defined and enforced.**
  `docs/design/techsupport-bootstrap-contract.md` now records the root identity,
  first-login, greeting, support-channel, and count/list-labeling invariants.
  Chatroom member rows now mark TechSupport with `data-support-contact="true"`
  and built-in support copy, matching the existing Contacts support row. The
  ordinary status-bar count already excludes TechSupport via
  `countOrdinaryRoomMembers()`, while total room presence can still include the
  bootstrap root when explicitly shown as total members.
- **Search/filter interactivity coverage already exists.** Evidence:
  `tests/e2e/staged/stage1-single-user/29-me-answers-search.spec.ts`,
  `tests/e2e/staged/stage2-two-user/34-contacts-filter-name.spec.ts`,
  `tests/e2e/staged/stage1-single-user/30-talks-filter-query.spec.ts`, and
  `tests/e2e/staged/stage2-two-user/35-reply-filter-query.spec.ts`.
- **Retired talk-delivery route proof already exists.** Evidence:
  `tests/e2e/staged/stage1-single-user/34-deleted-talk-routes-404.spec.ts`
  checks removed endpoints return 404, and
  `tests/e2e/staged/stage2-two-user/33-mesh-only-delivery-no-server.spec.ts`
  verifies mesh-only delivery/conversation creation with zero removed server
  talk-delivery traffic.
- **Mobile multi-user flow coverage already exists.** Evidence:
  `tests/e2e/staged/stage2-two-user/38-mobile-talk-answer-flow.spec.ts`
  covers phone-width talk answering, `39-mobile-conversation-messages.spec.ts`
  covers mobile DM overlay and message exchange, and
  `tests/e2e/staged/stage1-single-user/33-mobile-chatroom-hierarchy.spec.ts`
  covers phone-width chatroom hierarchy navigation with the bottom nav visible.
- **Offline mailbox TTL and hard-crash recovery coverage already exists.**
  Evidence: `tests/e2e/staged/stage2-two-user/36-offline-beyond-mailbox-ttl.spec.ts`
  proves expired encrypted mailbox envelopes are pruned and never delivered
  while a fresh control envelope still drains after reconnect;
  `tests/e2e/staged/stage2-two-user/37-hard-crash-recovery.spec.ts` launches a
  persistent browser profile, SIGKILLs the browser process, relaunches the same
  profile, and verifies the same identity, same conversation id, clean shell,
  and two offline messages recovered through Gun/mailbox state. Presence TTL
  pruning itself is covered by `src/test/unit/p2p-presence.test.ts`; only the
  user-visible stale-count cleanup proof remains open.
- **Language settings, localization, and incoming-language filter coverage
  already exists.** Evidence:
  `tests/e2e/staged/stage1-single-user/00y-chinese-ui-traversal.spec.ts`,
  `tests/e2e/staged/stage1-single-user/00z-chinese-edge-notifications.spec.ts`,
  `tests/e2e/staged/stage1-single-user/31-intake-filters-persist.spec.ts`,
  `tests/e2e/staged/stage1-single-user/32-language-setting-persist.spec.ts`,
  and `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`
  cover UI-language switching, default-talk language behavior, persisted
  profile/filter language settings, and incoming English/Chinese/Spanish intake
  behavior. The remaining TechSupport gap is actual multilingual bot
  greeting/reply behavior, not the generic language-filter stack.
- **Room-membership TTL pruning and visible stale-count cleanup.** The shared
  TTL constants now support env overrides while preserving production defaults.
  `ChatroomManager` prunes active room members whose `lastSeen`/`joinedAt` is
  older than `ROOM_MEMBERSHIP_TTL_SECONDS`, marks both `chatrooms/<room>/users`
  and `chatroomMembers/<room>` inactive, and republishes
  `public/room-member-counts/<room>`. The browser keeps live room membership
  fresh with a room-membership heartbeat and server-visible touch route
  (`PATCH /api/chatrooms/:id/members/:userId`). Added
  `tests/e2e/staged/stage2-two-user/42-stale-room-membership-prune.spec.ts`:
  two browser users enter Global, Bob disappears without app-level cleanup, his
  server-visible membership is aged past TTL, `/members` prunes it, and Alice's
  visible Global headcount drops back to TechSupport + Alice.
- **OS-level crash room-count proof.**
  `tests/e2e/staged/stage2-two-user/43-crash-room-membership-prune.spec.ts`
  reuses the same hard-crash helper style as spec 37: Bob runs in a persistent
  Chromium profile and is killed with `pkill -9` against that profile directory.
  After Bob's server-visible room-membership timestamp is expired, `/members`
  prunes the killed browser from Global and Alice's visible headcount drops back
  to TechSupport + Alice.

**Verification:** `npx jest src/test/unit/dev-stage-env.test.ts --runInBand`;
`npx jest src/test/unit/chatroom-manager.test.ts src/test/integration/chatroom-routes.test.ts --runInBand`;
`npm run test:type`;
`npx jest src/test/unit/techsupport.test.ts --runInBand`;
`DEV_MULTI_SMOKE_WEB_PORT=3361 npm run smoke:dev:multi`;
`E2E_PORT_OFFSET=320 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage1-single-user/01-login-single-user-headcount.spec.ts`;
`E2E_PORT_OFFSET=340 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/34-contacts-filter-name.spec.ts`;
`npx jest src/test/unit/ui-translations.test.ts --runInBand`;
`E2E_PORT_OFFSET=360 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts`;
`npx jest src/test/unit/techsupport.test.ts --runInBand`;
`E2E_PORT_OFFSET=100 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/00e-chatroom-peer-detail.spec.ts --grep "peer detail direct message"`;
`E2E_PORT_OFFSET=200 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/42-stale-room-membership-prune.spec.ts`;
`E2E_PORT_OFFSET=240 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/43-crash-room-membership-prune.spec.ts`.

## 2026-06-30 — S3 embedded-node: remaining items closed out (+ a real hub-dial bug found and fixed)

Moved from `docs/TODO.md`. Worked through the S3 "Remaining" checklist end to end.

- **Hub hardening — verified, and a real bug found + fixed.** Set out to confirm
  no app-private Gun subgraphs (`talks/*`, `conversations/*`, `pairConversations/*`,
  etc.) sync upstream from an embedded local node to the public hub. Runtime
  verification in this environment was unreliable at first (short-lived Gun
  client test processes didn't reliably complete the WS handshake), so the
  investigation moved to reading Gun's wire-fanout code directly
  (`node_modules/gun/gun.js` `mesh.say`, ~line 1502): every local `.put()`
  triggers an unconditional broadcast to **all** connected peers — there is no
  subscription/interest filtering. That confirms the risk `docs/TODO.md`
  already flagged with ⚠ is real, not hypothetical, once an embedded node is
  actually peered to the hub.
  But checking whether the embedded node was *actually* peered to the hub at
  all surfaced a separate, more fundamental bug: `attachGun()` in
  `src/server/bootstrap/http-bootstrap.ts` gated the embedded node's upstream
  hub dial (`upstreamHubPeers`) on `!isolatedGun`, where `isolatedGun` folds in
  `ephemeralStarServer` (`resolveP2PRuntimeFlags().starServerPersistence ===
  'ephemeral'`) — which is **hardcoded `true` for every boot** since mesh talk
  delivery shipped (star delivery was removed). That made `isolatedGun`
  unconditionally `true`, so `upstreamHubPeers` always resolved to `[]` —
  **embedded nodes never actually dialed the hub**, despite logging "embedded
  local node" and the configured hub URL. Fixed by extracting
  `resolveUpstreamHubPeers()` (pure, unit-tested in
  `src/test/unit/embedded-node-hub-dial.test.ts`) that only gates on the
  explicit test/dev isolation flags (`E2E_GUN_MEMORY_ONLY`, `DEV_GUN_FRESH`),
  not the always-on mesh-delivery flag. Verified via real separate-process
  hub + embedded-node boots that `upstreamHubPeers` is now populated
  correctly.
  The original ⚠ risk (Gun blindly gossiping app data to the hub once peered)
  remains real and is **not** fixed in this change — filtering it safely
  needs either a soul-classification-tracking outbound filter (nested Gun
  `.get().get()` chains use auto-generated souls for child nodes, so a
  single-message content filter can't classify them without tracking the
  relational graph as observed) or a narrower REST-only discovery channel,
  both nontrivial. Left as a new, precisely-scoped follow-up in
  `docs/TODO.md` rather than attempted blind.
- **Android: `unpackIfNeeded` + POST_NOTIFICATIONS runtime request.**
  `NodeBridge.kt` now recursively copies `assets/nodejs-project/**` into
  `filesDir/nodejs-project` (idempotent, resumable). `MainActivity.kt` now
  requests `POST_NOTIFICATIONS` at runtime on API 33+ before starting the
  foreground service (falls through to starting the node either way — the
  permission only affects whether the "peer running" notification shows).
- **Desktop autoupdate (electron-updater).** `platforms/desktop/main.js`
  wires `electron-updater`: checks on launch + every 4h, downloads, prompts
  to restart via `dialog.showMessageBox`. `nsis.differentialPackage: false`
  forces full-package updates (not delta patches) so `dist/web` and
  `dist/server` always come from the exact same release artifact. Added a
  runtime safety net for the "never let dist/web and dist/server drift"
  requirement: `scripts/stamp-build-id.js` (wired into `npm run
  build:embedded`) stamps the same build-id into both `dist/web/build-id.json`
  and `dist/server/server/build-id.json`; `warnIfBuildIdsDrifted()` in
  `http-bootstrap.ts` compares them at embedded-node boot and logs a loud
  error (non-fatal) on mismatch. Verified end-to-end (real process boot) for
  both the matching and intentionally-mismatched cases.
- **E2E spec: browser peer + embedded-node desktop peer.**
  `tests/e2e/embedded-node/01-browser-and-embedded-node-peer.spec.ts` boots a
  real `dist/server/node-app/embedded-node.js` process peered to the worker's
  Gun server, drives one browser against the normal dev server and a second
  against the embedded node's own served origin, and asserts they match on a
  talk and open a direct-P2P WebRTC DataChannel (reusing
  `tests/e2e/helpers/p2p-transport-e2e.ts`). Runs under its own
  `tests/e2e/embedded-node/playwright.config.ts` (excluded from the root
  config's `chromium` project via `testIgnore` so it can't perturb the
  existing light/heavy/mesh sharding) — `npm run test:e2e:embedded-node`.
  Writing this spec is what surfaced the hub-dial bug above: a same-origin Gun
  URL derivation bug (`WebGunService.deriveGunHubUrl`) was fixed alongside it
  — see below. The spec itself parses/lists correctly under Playwright and
  was unit/type-checked, but could not be run end-to-end in this environment
  (no working Chromium — missing system libraries, no root to install them);
  it needs a real CI run for the actual pass/fail signal.
- **Bug fix: `WebGunService.deriveGunHubUrl()` broke same-origin Gun for any
  localhost port ≥3001 that wasn't a dev/e2e worker port** (including every
  embedded-node default port: 8080, 8088, or any custom port). The offset
  heuristic (`webPort - 3001 + 8080`) only checked `webPort >= 3001` with no
  upper bound, so an embedded node serving its SPA on, say, 8088 computed Gun
  URL `ws://127.0.0.1:13167/gun` instead of same-origin `:8088`. Fixed by
  bounding the dev/e2e offset to a generous port range (3001–3100, far beyond
  any observed worker count) and falling back to same-origin for any other
  localhost port. Extracted to a pure, exported `deriveGunHubUrlFromLocation()`
  for direct unit testing (`src/test/unit/web-gun-service-hub-url.test.ts`, 8
  cases covering dev/e2e, embedded-node, and prod paths).
- **CI: headless smoke job for `embedded-node.js`.** `scripts/smoke-embedded-node.js`
  boots the real compiled entry and asserts `GET /health` and `GET /` (SPA)
  both serve correctly; wired into `.github/workflows/ci-cd.yml` as the
  `embedded-node-smoke` job and `npm run smoke:embedded-node`. Verified
  passing locally against a real boot.
- **Mobile toolchain pinning — assessed, corrected, not implemented.** The
  existing `NodeBridge.kt`/`Podfile`/build.gradle comments referenced a
  nonexistent Maven coordinate (`com.janeasystems:nodejs-mobile`) and a
  nonexistent npm/CocoaPods package (`nodejs-mobile-cocoapods`) — verified
  against the real upstream docs
  ([Android](https://nodejs-mobile.github.io/docs/guide/guide-android/getting-started/),
  [iOS](https://nodejs-mobile.github.io/docs/guide/guide-ios/getting-started/)):
  nodejs-mobile ships libnode as a release ZIP wired in via CMake+JNI
  (Android) or a framework embedded directly / its own in-repo podspec (iOS),
  not a simple dependency coordinate. Corrected the comments in
  `android/app/build.gradle`, `NodeBridge.kt`, `platforms/ios/Podfile`, and
  `platforms/mobile/README.md` to document the real integration path with
  citations, rather than leave subtly-wrong instructions in place. Did not
  attempt the actual JNI/CMake glue or Xcode project (needs a real Android
  Studio/Xcode toolchain to write and verify correctly) — left as a precisely
  re-scoped remaining item.

**Verification:** `npx tsc --noEmit` clean (root + `src/server/tsconfig.json`);
`npm run lint` clean on touched files; full unit+integration Jest suite green
(64 suites / 828 passed, 1 pre-existing skip) including the two new
regression suites; `npx eslint` clean; real separate-process boots verified
for the hub-dial fix, build-id drift check (both match and mismatch), and the
CI smoke script. E2E spec itself not run live here (no working Chromium in
this environment) — needs a CI/real-machine run for final sign-off.

## 2026-06-23 — M1–M4 Massive Talks E2E assertions fleshed out

Moved from `docs/TODO.md`. Four mass-E2E specs under `tests/e2e/mass/` received missing assertion blocks
(total ~143 lines added, TypeScript compiles clean). Delegated to Claude Code (Sonnet) via print mode for each file:

- **M1** (`01-flow-mash-exchange.spec.ts`, +23 lines): Added match/ignore split poll (only `flowa41` golden
  path is a match), matched/notMatched counts from `localTalkExchanges`, and stats `matchRate = matchedCount / totalResponses` via `toBeCloseTo`.
- **M2** (`02-survey-mass-exchange.spec.ts`, +63 lines): Added `byQuestion` aggregate verification
  (total + skipCount === 14, completionRate formula per question for all 5 questions), co-occurrence table
  symmetry between `surveyq1 ↔ surveyq2`, and 7-day time-range filter returning all 14 responses. CSV export skipped — no E2E hook exists.
- **M3** (`03-route-mash-exchange.spec.ts`, +14 lines): Added content-hash dedup across all 8 browsers
  (creator's `talkId` and each responder's `myTalks[cid]` key match the Node.js-computed `cid`), distinct terminal node verification (each of 7 responders traversed exactly depth-3 DAG, landed on unique leaf, no cycle guard via entry-existence check).
- **M4** (`04-mixed-saturation.spec.ts`, +43 lines): Added cross-talk contamination check (every cluster holds only created talkIds, no id bleeds across clusters, ≤1 talkId per cluster), PeerMeshService neighbor count ≥12 per node via `getDiagnostics().neighborCount`, and Gun memory sanity (talks key count bounded, returns -1 if inaccessible).

These are heavyweight specs (30–60 min each) — run individually with `npm run test:e2e:heavy` which includes them, or individually via `npx playwright test tests/e2e/mass/<file> --retries=0`.

**Verification:** `npx tsc --noEmit` clean across all 4 files. Actual E2E verification pending (mass specs require full browser launch).

## 2026-06-22 — P2 TechSupport root identity bootstrap completed

Moved from `docs/TODO.md`.

- The server publishes a signed `{ userId, pub, epub, role }` identity record at
  `public/techsupport-identity`; normal browser startup verifies it against the compiled public-key pin
  and displays a warning on a mismatch.
- Added `readVerifiedTechSupportIdentity()` and
  `IinPublicApp.discoverTechSupportIdentityFromGun()` for discovery from the public Gun path. This
  validates the record's self-signature but deliberately does not replace the normal pinned-key trust
  check.
- E2E snapshot imports now re-publish server-owned public bootstrap records after replacing the graph.
  This prevents the test baseline reset from erasing the signed identity.
- Added a fresh-context, empty-IndexedDB Playwright test proving that a browser discovers the valid
  identity from local Gun without supplying the compiled public key to the discovery API.
- Verification: `npm run test:type -- --pretty false`; `npm run lint`; focused Jest system-announcement
  suite; focused Chromium bootstrap E2E.

## 2026-06-18 — S2 Gun pub/sub signaling completed; HTTP signaling route removed

Moved from `docs/TODO.md` 2026-06-18.

- Replaced HTTP-poll signaling with Gun pub/sub for WebRTC SDP/ICE frames. `GunPubSubSignaler` writes one flat object node per nonce under `p2p-signal/<sharedKey>/<nonce>` and receives frames through `.map().on()` push.
- Derived signaling channel keys from the sorted peer `pub` values plus the session `conversationId`, preventing mesh and DM sessions for the same user pair from cross-feeding offer/answer frames.
- Extended Gun signaling to both conversation DMs and mesh talk delivery; all session construction sites now pass `gun: this.gunService.getGun()`.
- Kept `SignalingTransport` plus `encodeSignalingPayload`/`decodeSignalingPayload` in `src/web/services/signaling-transport.ts`; deleted the HTTP `P2PSignalingClient`.
- Removed `GET`/`POST /api/p2p/signaling/:conversationId` from `system-routes.ts`; tests now assert the retired route returns 404. Conversation relay remains live for offline DM mailbox delivery.
- Removed the obsolete server signaling cache/pruning unit test. Abuse-defense coverage now targets the still-live relay route.
- User-reported browser E2E green before route removal; follow-up implementation adds route-deletion unit/integration/E2E coverage.
- Verification: `npm run test:type -- --pretty false`; focused Jest for signaling/runtime/system/relay tests; `npm run build:server && E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage1-single-user/00-p2p-conversation-transport.spec.ts --project=chromium`; `npm run health`.

## 2026-06-13 — P0 P2P messaging (spec §19.4 Phase C), Phases 1–4 + T2 sort core

Moved from `docs/TODO.md` 2026-06-14.

- **Phase 1 — direct-p2p is the only ordinary-peer transport.** `WebConversationService` builds
  `DirectP2PConversationTransport` by default (`createOrdinaryTransport`), TechSupport branch untouched;
  transport-helper methods (`setLedgerHandshakeHooks`, `getDirectP2PConnectionState`,
  `getHandshakeDiagnostics`, fallback/fail-mode hooks) duck-typed via a `DirectCapableTransport` shape
  instead of `instanceof ResilientConversationTransport`; `createConversationTransportDiagnostics` →
  `availableModes:['direct-p2p']`, `fallback:null`. Resilient/relay/star classes retained in-tree
  (unit-tested, reserved for the optional flag). Updated diagnostics tests (`p2p-runtime`, `system-routes`
  integration, `00-p2p-conversation-transport` E2E) + reconciled CLAUDE.md. Verify: `tsc` clean, eslint
  clean, **768 unit/integration green**. (`build:web` has 2 pre-existing `multicast-dns`/libp2p-mdns
  bundling errors, unrelated.)
- **Phase 2 — split the Gun store from the star transport.** Extracted all Gun persistence (build/persist,
  `putMessageRecord`, subscribe, decrypt, pair-secret helpers) into `src/web/services/gun-message-store.ts`
  (`GunMessageStore`, with `ConversationMessageWire` moved here + re-exported). `StarGunConversationTransport`
  is now a thin `extends GunMessageStore` subclass adding only `mode:'star-gun'` + the `sendMessage` facade
  (kept for the off-by-default resilient star leg + TechSupport base + unit coverage).
  `DirectP2PConversationTransport` composes `GunMessageStore` directly. Updated DirectP2P unit test spies to
  `GunMessageStore.prototype`. Behavior preserved. Verify: `tsc` clean, eslint clean, **768 green**.
- **Phase 3 — no message archive on the hub.** `starServerPersistence` hardcoded `'ephemeral'`, so the
  server's `GunService.put`/`putPath` always skip device-owned bodies via `shouldSkipServerGunPersist`
  (`conversations/*/messages`, `talks`, `incomingTalksByUser`, …) in every mode; hub radisk gated
  `radisk: !isolatedGun` (includes `relayOnlyHub` + `e2eMemoryOnly`). **Gap closed:** skip list missed
  `pairConversations/*/messages` (the direct-p2p ordinary-DM path) — added it + integration tests. Verify:
  `tsc`/eslint clean, **772 green**. Standalone `npm run dev` hub keeps radisk for local convenience.
  CI follow-up: explicit relay-only spec asserting `conversations|pairConversations/*` bodies never appear
  in a `radata/` snapshot.
- **Phase 4 — offline mailbox for DMs.** Reused `WebMailboxClient` (encrypt-for-recipient / post /
  drain-then-delete). `DirectP2PConversationTransport` gained an `onUndeliverable` hook firing when a message
  is persisted to local Gun but WebRTC `sendDm` throws; the service forwards it
  (`setMessageUndeliverableHandler`) and the app wires it to `postConversationMessageToMailbox` (new
  `kind:'conversation-message-v1'` envelope). Drain loop dispatches to `ingestConversationMessageFromMailbox`
  → `upsertMessageRecord` (idempotent, keyed by message id). Respects `mailboxFallbackDisabledForE2e`.
  Verify: `tsc`/eslint clean; **770 green** incl. 2 new trigger tests. Browser round-trip pending CI.
- **T2 (core) — distance sort strategy (spec §22.7).** `rankPeople` `distance` branch sorts by
  `blurredDistanceMiles` (snaps both coords to the privacy grid before Haversine — exact GPS never used);
  added optional `distance` to `RankedPerson` + a `filters.distanceMiles` resolver; unknown-distance
  candidates sort last. Unit tests: ascending-by-blurred-distance + grid-snap. `find-similar.test.ts` 16
  green; `tsc`/eslint clean. (UI resolver wiring tracked as remaining T2 in TODO.md.)

## 2026-06-13 — Appendix B: Statistics expansion (all `[Sonnet]` items)

## 2026-06-13 — Appendix B: Statistics expansion (all `[Sonnet]` items)

All five statistics expansion areas from Appendix B shipped and verified. Stats are local-only since P0 Step 7 (server per-talk endpoints removed); all aggregation runs from `localTalkExchanges` in the browser.

### Survey analytics
- **Skip/completion rates per question**: `StatsSummary.byQuestion` gained `skipCount` and `completionRate` fields computed in `summarize()`. Displayed in survey stats dialog below each question title.
- **Cross-question correlation**: `aggregateCrossQuestion()` integrated into survey stats dialog. Shows top-2 eligible questions' co-occurrence table with masking for small cohorts.
- **Time-range segment filters**: `renderSurveyStatsDashboard` gained an All/7d/30d/90d filter dropdown. All cards, by-question breakdown, cross-question, day/region tables, follow-up candidates, and CSV exports re-aggregate from filtered responses.
- **Original vs follow-up survey comparison**: follow-up button and gap-detection logic preserved and verified working with filtered data.

### Talk analytics — unified creator dashboard
- `displayStatisticsDashboard` rewritten to build a full local `StatsDashboard` from `buildAllLocalTalkResponses(readLocalTalkExchanges())` + `buildStatsDashboard()`. Covers all four talk types (tag/flow/survey/route) with by-type breakdown, top-talks table, and time-series trend.
- Best-effort server augmentation: broadcast-tag popularity + trends fetched from `/api/stats/broadcast-tags` and `/api/stats/broadcast-tags/trends` if server is reachable; merged into the local dashboard.

### Broadcast & tag analytics
- Dashboard renders tag popularity table + day-by-day tag trend sub-table (up to last 7 days, up to 5 tags).
- Local/traveller split shown as an aggregate header in the chatroom panel.

### Chatroom & location analytics
- Chatroom panel shows `localCount`/`travellerCount` aggregate totals.
- Region rows include response count, match rate, local/travel split — all from `aggregateChatroomLocationStats`.

### Peer & reputation analytics
- Peer table expanded to show `ignores` column alongside matches and match rate.
- Response trend (day-level, last 14 buckets) added as a dedicated panel.
- Privacy note updated to reflect local-only source of truth.

### Contextual stats strip (cross-tab)
- `displayContextualStatistics` on Talks/Contacts/Me tabs rewritten as sync; reads local exchanges via `buildAllLocalTalkResponses` + `buildStatsDashboard`. No longer requires a server connection.

### Shared helpers added
- `src/web/services/local-peer-derivation.ts`: `buildTalkResponsesFromExchanges`, `buildAllLocalTalkResponses`, `exchangeToTalkResponse`
- E2E helpers: `seedTalkLedgerOutcome`, `seedLocalTalkExchange` (both in `tests/e2e/helpers/talk-demo-ui.ts`)

### E2E tests fixed
- `10-stats-four-types.spec.ts`: rewritten to use local ledger seeding via `seedTalkLedgerOutcome`; no longer calls deleted server endpoints.
- `00-statistics-dashboard.spec.ts`: rewritten to seed `localTalkExchanges` via `seedLocalTalkExchange`.
- `00i-survey-analytics-dashboard.spec.ts`: replaced deleted server poll with `localStorage` poll.
- `creator-reply-matrix.ts`: `submitMatrixResponse` made a no-op (dead code, superseded by snapshot import).
- `recordTalkStatsByAnswerIds`: deprecated; now delegates to `seedTalkLedgerOutcome`.

**Verification:** `npx tsc --noEmit` clean; all 763 unit/integration tests pass.

## 2026-06-12 - P1 libp2p transport + IPFS, P2 Find Similar, P2.5 sort pipeline (REQ-LIBP2P, REQ-SIM, REQ-SIM-07)

### P1 — libp2p transport + IPFS content layer (L1–L4 complete)

All four layers of P1 implemented and verified per SRS §25:
- **L1** Helia/libp2p node bootstrap: lazy-init, bundle measured (214.5 KB base + 371 KB async chunk), E2E verified
- **L2** Mesh stream handler: `/iinpublic/mesh/1.0.0` protocol, SEA-signed bindings, libp2p→WebRTC fallback, 4 spec invariants tested
- **L3** Hub-independent discovery: Kademlia DHT + mDNS, bootstrap-peer override, mesh-ping/pong E2E after hub API loss and hub process stop
- **L4** IPFS talk attachments: descriptor round-trip, SEA-encrypt-before-add, private/public opt-in

**Verification:** Type-clean; mesh transport invariants, attachment descriptor, and hub-loss scenarios all passing in unit + E2E.

### P2 — Scalable "Find Similar People" by matched tags (§1–4 complete)

All four steps of P2 implemented and verified per SRS §22:
- **§1** Generalize correctness: `matchScore(viewer, other, combine)`, weighted tag maps with version/hash, parametrized E2E for N×Mᵢ
- **§2** Dropout-tolerant exchange: `FindSimilarIndex`, publish/read decoupled, peer dropout never blocks pairwise scores
- **§3** Incremental mutation: delta transport O(|delta|), cached pairwise patch, combine policies (count / viewer-standard / mutual-importance / conservative)
- **§4** Scale to ~100k: inverted tag index, bounded top-K heap, hot-tag capping, min-shared-tags threshold, locality scoping; 100k unit test: combineCalls < N, query < 1s

**Verification:** 100k-population correctness test (candidates < N/10, work < N², query < 1s); delta idempotency; asymmetric ranking.

### P2.5 — Generic retrieve→sort→display pipeline (REQ-SIM-07)

Implemented the sort strategy registry and ranking pipeline for contacts view:
- `SortStrategy` type and `SORT_STRATEGIES` registry covering matched-tags (score desc), distance (asc, placeholder), their-standard (reciprocal score desc)
- `rankPeople(candidates, viewerId, index, sortId, filters)` for in-memory re-sorting without additional index reads
- Extended `ContactsViewDeps` with `sortStrategies`, `activeSortId`, `onSortChange` handler
- Wired through UIManager in 3 call sites: `showContactsList()`, `displayContactsList()`, `showContactDetail()`
- 5 unit tests: matched-tags re-sort, their-standard asymmetry, in-memory re-materialization, registry structure, fallback behavior

**Verification:** `npm test` (762 unit passed); `npm run test:type` (no errors).

### Appendix C audit — Residual P2P transport & spec-gap follow-ups (2026-06-12)

Audited the 5 items in Appendix C (consolidated from archived TODO-direct-p2p.md, spec-gap-matrix.md, PROJECT_STATUS.md):

**1. Reputation/credit section visibility allowlists (FR-UM-7) + profile-surface audit**
   - Status: **Deferred** — Not yet scoped. Requires new feature gate (visibility allowlists) and profile section audit across Me/Settings/Peer Detail.
   - Impact: Medium — affects user privacy controls but not core functionality.

**2. Broader moderation UX and centralized reporting/appeal model (FR-BF / FR-SP)**
   - Status: **Deferred** — Out of scope for current iteration. Requires design review on moderation flow.
   - Impact: High — safety-critical but not blocking initial release.

**3. Production-durability review: in-memory stats indices, quota counters, rate-limit counters**
   - Status: **AUDITED** ✓ Findings:
     - **Stats indices** (`src/shared/talk-stats.ts`): By design, `StatsSourceOfTruth` declares indices as **"derived-cache"** — recomputable from Gun append-only response events. Per P0 step 7, all talk-delivery-derived stats are local-only; server keeps only broadcast-tag popularity (server-cache-with-trend-buckets) and survey results (Gun-stored).
     - **Quota counters** (`src/shared/talk-ledger.ts`): Edge counters track daily/weekly sent counts in `TalkLedgerDoc` (localStorage). Per design, these are ephemeral derivations reset on day/week boundaries; loss during restart is acceptable (quota resets anyway).
     - **Rate-limit counters**: No central server-side rate-limit implementation found. Client-side quota gates via talk-ledger edge counters only.
     - **Durability verdict**: Current design is correct by spec — indices and quotas are intentionally ephemeral derived state. If persistence tightens (e.g., tamper-proof quota in multi-tab scenario), will require Gun-backed EdgeCounter writes.
     - All 763 unit tests pass; no durability regressions detected.

**4. Statistics/visualization product polish (shipped dashboard/endpoints)**
   - Status: **Complete** — Baseline stats shipped (see completed.md prior entries). Dashboard covers broadcast-tag analytics. Per-talk aggregates moved to client-local in P0 step 7.
   - Polish backlog: Per-survey aggregates (cross-question correlation, completion rates, segment filters under privacy thresholds) deferred to Appendix B forward work.

**5. Android: maintenance-only until web/server loop stable**
   - Status: **Acknowledged** — Android deferred post web/server stabilization. Not blocking.

**Known runtime risks (checked)**:
   - ✓ Gun replication timing on incoming-talk auto-reply path: Mitigated by `POST /api/talks/:id/received` server-side path (doesn't rely on client Gun replication for talk stats).
   - ✓ `talkCompleted` handler Gun fallback: Verified in `src/web/app/app.ts` and `ui-manager.ts` — fallback preserves ledger entries; matches/conversations created on success path only.

**Verification:** Type-clean; full test suite passing (763 unit); no new durability issues surfaced.

### Appendix A audit — Detailed backlog inventory (2026-06-12)

Ran acceptance closure audit on Appendix A items; findings:

**Contacts — Relationship Management** ✓ **VERIFIED SHIPPED**
- ✓ Ordinary answerers start as `Stranger`/undefined until explicit relationship selection: Verified in contacts-view.ts line 82 (`if (!label) return deps.text('contactNoRelationship')`); translation key `stranger: 'Stranger'` present.
- ✓ All relationship labels (friend/relative/coworker/acquaintance/partner/custom) filter/search/sort/save/reload correctly: 8 passing tests in src/test/unit/contacts-view.test.ts covering filtering by partner, custom label rendering, nickname preservation, filter+sort combinations.
- ✓ Custom relationship label text persists: Test "renders, searches, filters, and sorts custom relationship labels by their saved text" verifies round-trip save/load/display.
- Responder ranking (matched-talk count, match rate, relationship, recency, weighted relevance) deferred; covered by P2.5 sort-pipeline work (matched-tags, their-standard strategies implemented; responder ranking enhancement left for future).
- Profile presentation parity: headshot/languages/interests/talk-history/block-status all rendered; public credit/privacy inherited from user profile.

**Talks — Creation & Validation** ✓ **VERIFIED SHIPPED**
- ✓ D4 exhaustive creation/branch/response matrix for tag/flow/survey/route: src/test/unit/talk-types.test.ts (1108 lines) covers:
  - **Tag** (22 tests): valid single Q with match+ignore answers, short phrase tags, rejection of multi-question, missing answers
  - **Flow** (21 tests): sequential context-dependent chains, first-answer linking, implicit ignore answers, branching paths
  - **Survey** (18 tests): independent Q/A, no shared context, multi-question validation
  - **Route** (40+ tests): hierarchical DAG, context-aware branching, terminal nodes, tennis/badminton example from spec §3.6.1
- ✓ Language edit preservation: verified in talk-editor UI; language field editable across all types.
- Creator/recipient state transitions: tracked via talk-ledger (outcomes, exchanges, retractions) with 22 passing tests in talk-ledger.test.ts.
- Filtered-count diagnostics by rejection reason: server-side via intake-filter-reasons (7 passing tests); receipt diagnostics in talk-delivery-routes.

**Me Tab** ✓ **VERIFIED SHIPPED**
- Profile editing parity with Settings: headshot/languages/interests/privacy all editable in Me tab and Settings; synced via Gun user-public-profile + private-profile paths.
- Preferences modes (temporary/permanent/suppressed/manual/auto/conditional): Stored in answer-preferences-storage.ts with branch/context explanations in UI.
- Per-answer ownership controls: answer-preferences-storage tracks export/delete/sync semantics; support-message exclusion via tag in UI.
- Reply review mode: creator-reply-filter-state in ui-manager.ts; durable sort/group (outcome/relationship/date filters with stable tie-breaking).

**Settings** ✓ **VERIFIED SHIPPED**
- D2-D3 localization/filter behavior: talk-intake-filters with validation/persistence/reset; hidden-count preview in UI.
- Storage/transport diagnostics: Expanded to cover TechSupport state, room visit counts (chatroomVisitCounts Map), talk language defaults (getDefaultTalkLanguagePreference), SEA custody (WebGunService key mgmt), P2P flags (diagnostic output in mesh room sync).

**Conversation/Peer Detail** ✓ **VERIFIED SHIPPED**
- Support-channel vs normal-channel transport status: Direct P2P conversation transport with fallback chain; status reported in conversation metadata.
- Privacy verification: SEA-pair encryption for private conversations; Gun path writes only to own keypair zone.
- History/search controls: conversation-list-view supports date/peer filtering.

**TechSupport Root Network Role** ✓ **VERIFIED SHIPPED**
- Canonical singleton root identity (TECHSUPPORT_ROOT_USER_ID): enforced in techsupport.ts; bootstrap checks in app initialization.
- Reserved-name anti-impersonation: stageName validation in user-service.ts.
- Global-room non-empty anchor: TechSupport always pinned in contacts-view (test: "pins an established TechSupport channel").
- Support-channel establishment: idempotent greeting via /api/support/connect endpoint.
- Privacy constraints: no private key/message leakage via diagnostics (storage keys sanitized, relay health reported without secrets).

**E2E Stage Pipeline** ✓ **VERIFIED SHIPPED**
- Single-user coverage consolidated into TechSupport Stage 0: E2E seeds via IINPUBLIC_STAGE_SEED env.
- TechSupport baseline seeded before ordinary users in multi-user stages (user2-match, user3-network).
- Parallel worker isolation preserved (per-worker Gun/webpack servers on 8080+N, 3001+N).

**Summary:** All major Appendix A acceptance items verified shipped and working correctly. No gaps or regressions detected. All 763 unit tests passing; type checking clean.

---

## 2026-06-13 - L6 Signaling deletion, P2/P3 answer context & plugin config

### L6 — Test-only discovery endpoint deletion (REQ-LIBP2P-06)

- Deleted test-only `/api/p2p/discovery` GET/POST routes from `system-routes.ts`
- Preserved production `/api/p2p/signaling` and `/api/p2p/conversation-relay` routes (still active in fallback chain)
- Added L6 verification tests proving discovery returns 404
- All tests pass: 668 unit + 81 integration + 104 E2E
- E2E test updated: `00-p2p-cross-platform-protocol.spec.ts` now verifies discovery endpoint deletion

### P2 — Context-aware "Me" tab answer list (FR-QA-14, UI-8, §13.7)

- Added display-only `contextLabel` (`"Q→A · Q→A"`) to `AnswerRecord` with answer-save-time derivation
- Implemented context-keyed rendering for flow/route answers using `(questionId, contextHash)` tuple
- Group rows by question with collapsible per-context sub-entries for scannable route-question display
- Backfill/derive `contextLabel` from retained talk definitions; tolerate missing source talks
- All acceptance tests pass: flow context display, distinct-context answer separation, post-retraction durability

### P3 — Challenge Plugin Framework: zone-B config storage (FR-CPF-04)

- Implemented per-chatroom plugin config storage in zone-B (`~{ownerPub}/private/chatroom-config/<chatroomId>/challengePlugins`)
- Added `WebChatroomService.setChallengeConfig(chatroomId, pluginIds)` with zone-B read/write
- Integrated with existing `resolveChallengeGate` hook for owner-controlled plugin enable/disable
- Unit tests pass: config round-trip serialize/deserialize from Gun zone-B paths

---

## 2026-06-13 - L5 matched-talk IPFS auto-share acceptance

Completed REQ-IPFS-04/05/06 acceptance coverage for attachment-bearing matched talks:

- Added a three-user E2E proving Tom's deterministic `ipfs://<cid>` share appears exactly once for Tom and matched Jerry, decrypts private attachment bytes for Jerry, never reaches ignored Bob, and is idempotently recreated from Jerry's encrypted mailbox envelope after reconnect.
- Fixed browser content-node startup by excluding Node-only mDNS loading in Chromium and using ESM-compatible `multiformats` CID imports.
- Normalized Helia blockstore byte results before plaintext/SEA decoding.
- Made mailbox attachment fetch best-effort after link materialization so unavailable providers cannot block envelope acknowledgment.
- Preserved known peer IDs through resilient/direct conversation subscriptions to avoid resumed pair-root lookup races.

**Verification:** `npm run test:type`; content-node unit tests (9/9); L5 Playwright spec (1/1); `PW_WORKERS=20 npm run test:e2e:parallel` (106 passed, 2 skipped in 4.3m).

## 2026-06-08 - Docs consolidation into four canonical files + archive

Reorganized the `docs/` tree so all content lives in four canonical buckets, moving the redundant
source documents to `docs/archive/`.

**Feature/design detail → spec (`docs/specs/iinpublic-technical-specifications.md`, renamed from singular):**
- Folded in `similar-people-scalable-srs.md` (new §22), `p2p-mesh-talk-delivery-plan.md` design (new §23), and `phase-d-dht-bootstrap.md` design (new §24).
- `specs.md` (v1.0 SRS + P2P + blockchain survey) confirmed fully subsumed by the canonical spec's §19/§20/§21 — archived without re-merge.

**Test detail → `docs/testing/testplan.md`:** added Appendix C (flake investigations & historical benchmarks, from `testing-benchmarks.md`, `P2P_nodes.md`, and root `test-12-flake-root-cause.md`), Appendix D (mesh test impact), Appendix E (statistics verification requirements).

**Future tasks → `docs/TODO.md`:** added Appendix A (detailed backlog inventory, from `TODO-backlog-inventory.md`), Appendix B (statistics expansion backlog, from `roadmap/statistics-expansion.md`), Appendix C (residual P2P transport + spec-gap follow-ups, from `TODO-direct-p2p.md`, `roadmap/spec-gap-matrix.md`, `reports/PROJECT_STATUS.md`).

**Retired status/audit facts captured here (sources archived):**
- Gun authority audit complete (`roadmap/talk-loop-authority.md`): stats, match counts, and conversation creation all go through the server; `getTalkWithRetry()` prefers the server (Gun cache-first check only, then authoritative server, then alternating retry — replacing the old 20× Gun-retry that cost up to 5s); client-side Gun conversation-creation fallback removed.
- Spec-gap matrix (`roadmap/spec-gap-matrix.md`) marked Implemented: profile foundation + viewer-filtered Q&A visibility; intake filters & moderation; reputation & abuse prevention; chatroom model expansion; tags & bulk-targeting; survey & statistics endpoints; rate limiting & cooldowns; exact chatbot memory.
- Project status (`reports/PROJECT_STATUS.md`): server `index.ts` and `ui-manager.ts` de-monolithed; talk loop HTTP-integration tested; statistics baseline live; P0 UI correction pass live.
- Direct-P2P transport stack (`TODO-direct-p2p.md`) shipped: `DirectP2PConversationTransport`, signaling client, WebRTC session, `ResilientConversationTransport` fallback chain (direct-p2p → server-relay → star-gun), LEDGER_STATE handshake, transport diagnostics, and Batch A–C E2E migration — only the full parallel-suite release gate remains (now in TODO Appendix C).

Removed/archived source files: `specs.md`, `TODO-backlog-inventory.md`, `TODO-direct-p2p.md`, `p2p-mesh-talk-delivery-plan.md`, `P2P_nodes.md`, `testing-benchmarks.md`, `roadmap/p2p-node-network.md`, `roadmap/phase-d-dht-bootstrap.md`, `roadmap/spec-gap-matrix.md`, `roadmap/statistics-expansion.md`, `roadmap/talk-loop-authority.md`, `reports/PROJECT_STATUS.md`, and root `test-12-flake-root-cause.md`.

## 2026-06-07 - P2P mesh talk delivery foundation behind `P2P_MESH_TALKS`

Converted `docs/p2p-mesh-talk-delivery-plan.md` into the active `docs/TODO.md` mesh checklist and landed the first implementation slice behind `P2P_MESH_TALKS=1`.

**Mesh transport + protocol:**
- Added `src/shared/p2p-mesh-protocol.ts` with signed origin-frame payloads for `mesh-ping`, `mesh-pong`, `talk-announce`, `talk-body-request`, `talk-body`, `talk-response`, and `ack`.
- Added `p2pMeshTalks` / `usesMeshTalkDelivery` runtime flag plumbing and webpack exposure for `P2P_MESH_TALKS`.
- Extended `P2PConversationSession` DataChannel frames with a `mesh` frame type and `sendMeshFrame`.
- Added `src/web/services/peer-mesh-service.ts`: room join/leave, bounded neighbor selection, signed origin verification, seen-set dedupe, TTL forwarding, diagnostics, ping, talk body cache, body pull, and mesh response routing.

**App integration:**
- Room member updates now refresh mesh neighbor sessions when the flag is enabled.
- Broadcast and directed talk sends use mesh `talk-announce` instead of `peerTalkOffers/*` when `P2P_MESH_TALKS=1`.
- Receivers request `talk-body`, run the existing receiver-side intake path, and populate the local incoming index from mesh bodies.
- Pair-private responses use mesh `talk-response` with `sea-ecdh-v1` ciphertext when the flag is enabled; author-side processing creates local matches/conversations from the single mesh response callback.
- Mesh mode skips `broadcast-receiver-preview`, `peerTalkOffers` subscription, pair Gun response writes, and server talk stats writes for the mesh response path.

**Verification:**
- `npm run test:type -- --pretty false`
- `npx jest src/test/unit/peer-mesh-service.test.ts src/test/unit/p2p-runtime.test.ts --runInBand`
- `npm run test:unit -- --runInBand` — 40 suites, 480 passed
- `npm run test:integration -- --runInBand` — 7 suites, 127 passed, 1 skipped
- `npm run lint`
- `npm run build:server`
- `npm run build:web` — clean with existing bundle-size warnings
- `npm run test:e2e:p0-talks` — 1 passed (legacy direct-Gun regression)
- In-app browser smoke loaded `http://localhost:3001` with `P2P_MESH_TALKS=1` into the main UI

## 2026-06-07 - TODO cleanup: moved shipped hub migration phases out of active queue

Moved the completed rows from the `docs/TODO.md` hub migration track into completed work so the active TODO only carries unfinished implementation.

| Phase | Completed status |
|-------|------------------|
| B Client-authoritative talks | Shipped |
| C Relay-only hub (no app `radata/`) | Shipped |
| E Pair-private ownership graph | Shipped |

Phase A remains partial and Phase D remains implementation-pending, so they were not recorded as completed items.

## 2026-06-06 - SRS v4.5 implementation: community ownership, challenge plugins, ICE audit, Phase D design

### FR-CR-11/12 — Community Ownership Model (Tasks #1 + #2)

**Shared domain (`src/shared/`):**
- `types.ts`: added `CommunityRole` (`owner | moderator | member | guest`) and `CommunityRoleRecord` interface.
- `chatroom-hierarchy.ts`: added `deriveCommunityId(ownerPub, label)` (content-addressed room IDs via `computeCIDv1Sync`), `getRoleCapabilities(role)`, `canAssignRole(actor, target)`, `chatroomRolePath(chatroomId, userId)`, `RoleCapabilities` interface.

**Server (`src/server/`):**
- `services/chatroom-manager.ts`: `createChatroom` now derives a content-addressed ID via `deriveCommunityId` and auto-assigns owner role; added `getRole`, `setRole`, `canUserBroadcast` methods.
- `routes/chatroom-routes.ts`: added `GET /api/chatrooms/:id/roles/:userId` and `PUT /api/chatrooms/:id/roles/:userId`; optional `resolveChallengeGate` hook wired into join route.
- `routes/talk-delivery-routes.ts`: added optional `chatroomManager` dep; broadcast route accepts `sourceChatroomId` and enforces guest-broadcast gate (FR-CR-12).
- `index.ts`: passes `chatroomManager` to `registerTalkDeliveryRoutes`.

**Tests:** `src/test/unit/community-ownership.test.ts` — 15 tests covering all new helpers.

### FR-CPF-01–05 — Challenge Plugin Framework (Task #3)

**New file:** `src/shared/challenge-plugins.ts`
- `ChallengePlugin` interface: `evaluate(action, context) → ChallengeResult`
- `runChallengeGate(action, context, config)`: AND/OR composable gate executor
- Built-in plugins: `RequireVerifiedIdentity`, `RequireTrustScore(threshold)`, `RequireInvitation`, `RequirePreviousInteraction`
- Plugin registry: `registerChallengePlugin`, `getChallengePlugin`, `listChallengePluginIds`

**Server wiring:** `chatroom-routes.ts` `join-community` gate via optional `resolveChallengeGate` dep; broadcast gate already in `talk-delivery-routes.ts` via `chatroomManager`.

**Tests:** `src/test/unit/challenge-plugins.test.ts` — 29 tests covering all plugins, AND/OR semantics, async plugins, registry, and FR-CPF-05 denial reason surface.

### §4.4 ICE candidate priority audit (Task #4)

- `p2p-webrtc-session.ts`: `defaultIceServers()` made `export`; added §4.4 reference comment documenting priority order (host > srflx > relay) and TURN opt-in via `E2E_WEBRTC_ICE_SERVERS`.
- **Tests:** `src/test/unit/p2p-ice-priority.test.ts` — 8 tests verifying STUN-only default, TURN opt-in, fallback on invalid JSON, and RTCIceServer shape.

### Phase D DHT Bootstrap design doc (Task #5)

- **New:** `docs/roadmap/phase-d-dht-bootstrap.md` — full design document: bootstrap service API (`GET /bootstrap/peers`, `POST /bootstrap/announce`, `GET /bootstrap/lookup/:userId`), TypeScript interface sketch, libp2p vs. Kademlia evaluation table with recommendation, `UserAddressLookup` interface, migration steps D-1–D-7, security considerations, and file list for Phase D implementation.

**Total new tests this session:** 52 (15 community-ownership + 29 challenge-plugins + 8 ICE-priority). All 478 unit tests pass.

---

## 2026-06-06 - SRS v4.5 + TODO cleanup: merged decentralized architecture additions

All items previously listed in `TODO.md` under "Shipped" are recorded below. New open items (FR-CR-11/12, FR-CPF, Phase D, connection priority) are tracked in `TODO.md`.

**SRS changes (v4.5):** Long-term decentralization vision (§2.1), explicit non-goals (§2.5), content-addressed community IDs FR-CR-11, community ownership FR-CR-12, context-aware answers clarification (§3.6.1), Challenge Plugin Framework §3.13, connection establishment priority (§4.4), future architecture diagram (§6.6), profile/identity separation (§19.13.2), Phase D peer discovery detail (§19.12), local node diagram (§19.5), protocol/UI separation (§17), future tech candidates (§16).

---

## 2026-06-04 - P2P-Y/Z: Handshake E2E coverage + relay-only hub hardening

### P2P-Y — E2E coverage for P2P-Q handshake frame (REQ-P2P-14/15)

**New E2E spec:** `tests/e2e/staged/stage2-two-user/00k-p2p-handshake.spec.ts`
- Two-peer test: after `prepareDirectP2PConversation`, both pages call `waitForHandshakeOk`; asserts `handshakeState: 'ok'`, `selectedProtocol: 'iinpublic-p2p-v1'`, and `failureReason: null`.
- In-browser negotiation test: `page.evaluate` runs `negotiateProtocol` with an incompatible remote protocol list; asserts `handshakeState: 'failed'` and `failureReason` matching `/no common protocol/`.

**New helper:** `getHandshakeDiagnosticsFromPage` and `waitForHandshakeOk` added to `tests/e2e/helpers/p2p-transport-e2e.ts`.

**Service plumbing:** `getHandshakeDiagnostics(conversationId, localUserId)` threaded through `DirectP2PConversationTransport` → `ResilientConversationTransport` → `WebConversationService` so E2E tests can read diagnostics from `app.conversationService`.

### P2P-Z — Hub Phase C: relay-only hub hardening (REQ-P2P-Hub-C)

**Modified:** `src/server/bootstrap/http-bootstrap.ts`
- Added `warnIfStaleRadataExists(cwd)`: logs a warning at startup if a `radata/` directory exists when `relayOnlyHub=true`; harmless no-op when the directory is absent.
- `attachGun` calls `warnIfStaleRadataExists()` automatically when `RELAY_ONLY_HUB=1`.
- Gun boot already sets `radisk: false` in relay-only mode; this change adds the operational guard.

**Modified:** `src/server/routes/system-routes.ts`
- Added `GET /api/debug/relay-only-status`: reports `relayOnlyHub`, `radiskEnabled`, `inMemorySignaling/relay/presence` flags.

**New integration test:** `src/test/integration/p2p-relay-only-hub.test.ts`
- Flag resolution, `shouldSkipServerGunPersist` for all app paths, `/api/debug/relay-only-status` responses, presence routes still work in relay-only mode, `warnIfStaleRadataExists` with/without radata/.

**Evidence:**
- `npx tsc --noEmit` — clean
- `npx jest --no-coverage` — 43 suites, 553 passed, 0 failures

## 2026-06-04 - P2P-V/W/X: Wire abuse defense, trust levels, and schema migrator into runtime paths

### P2P-V — Abuse defense wired into relay routes + client receive paths (REQ-P2P-20)

**Modified:** `src/server/routes/system-routes.ts`
- Replaced bare `Set<string>` nonce caches (`signalingNonces`, `relayNonces`, `discoveryNonces`, `peerAckNonces`) with `BoundedNonceCache` instances (LRU-evicting, 10k cap).
- Added a single `P2PAbuseDefenseContext` for the relay route scope.
- `POST /api/p2p/signaling`, `POST /api/p2p/conversation-relay`, `POST /api/p2p/discovery`, and `POST /api/presence/ack` all call `abuseCtx.checkInbound(peerId, pub)` before verification; demoted or rate-limited peers receive `429`.
- Added `GET /api/debug/p2p-abuse` endpoint (non-production) that returns `abuseCtx.getDiagnostics()`.

**Modified:** `src/web/services/p2p-webrtc-session.ts`
- Replaced unbounded `Set<string>` `dataChannelNonces` with `BoundedNonceCache`.

**New tests:** `src/test/integration/p2p-abuse-relay.test.ts` — rate-limit rejection (429) and nonce-replay rejection (400) on signaling and relay POST routes.

### P2P-W — Trust levels wired into neighbor cache + delivery filter (REQ-P2P-11/12/18)

**Modified:** `src/web/services/client-peer-talk-delivery.ts`
- `subscribePeerTalkOffers` and `reconcilePeerTalkOffersFromGun` now call the optional `checkTrust` hook (injected via `TrustGate`) before accepting an offer; callers that supply a gate that returns `false` for blocked senders silently drop the offer.

**Modified:** `src/web/services/web-user-service.ts`
- Added `getPeerTrustStore(): Promise<Map<string, PeerTrustRecord>>` and `putPeerTrustStore(store): Promise<void>` that read/write the SEA-encrypted `peerTrustStore` key under the user's private Gun path.

**New helper:** `src/shared/p2p-trust-neighbor-bridge.ts`
- `trustLevelFromNeighborRecord` — derives a `TrustLevel` from a `P2PNeighborRecord`.
- `neighborRecordWithTrust` — applies a `PeerTrustRecord.trustLevel` to a neighbor record via `toLegacyTrustStatus`.

**New tests:** `src/test/unit/p2p-trust-neighbor-bridge.test.ts` — blocked/friend/verified mapping, capability gate enforcement.

### P2P-X — Schema migrator wired into boot paths (REQ-P2P-13/16)

**Modified:** `src/server/index.ts`
- `initializeServices()` calls `runStartupMigrations` on Gun-loaded neighbor cache, presence, and conversation records; logs pending-migration counts via `logger.info`.

**Modified:** `src/web/services/web-gun-service.ts`
- Added `migrateOnRead<T>(kind, record)` helper that calls `migrateRecord` before returning a Gun-loaded record to callers.

**New tests:** `src/test/unit/p2p-schema-boot.test.ts` — verifies v0 records are transparently upgraded when read through `migrateOnRead`; startup migrator logs correct pending counts.

**Evidence:**
- `npx tsc --noEmit` — clean
- `npx jest --no-coverage` — 42 suites, 541 passed, 0 failures

## 2026-06-04 - P2P-Q/R/S/T/U: Handshake, Trust, Schema Migrations, Upgrade Verification, Abuse Defense

Implemented the five SRS §19.13 / REQ-P2P-14–20 items identified in the SRS audit.

### P2P-Q — Signed Handshake + Protocol/Feature Negotiation (REQ-P2P-14/15)
**New file:** `src/shared/p2p-handshake.ts`
- `buildHandshakePayload` — constructs `{ appName, appVersion, supportedProtocols, features, peerId, publicKey, timestamp }`.
- `negotiateProtocol` — selects the highest common protocol; fails cleanly when lists are empty or have no overlap; ignores unknown remote features without crashing.
- `validateHandshakePayload` — validates required fields and timestamp skew; returns typed result.
- `buildHandshakeDiagnostics` — snapshot of selected protocol, unsupported features, and handshake state.

**Modified:** `src/web/services/p2p-webrtc-session.ts`
- On DataChannel `open`, sends a signed `handshake` frame before `ledger-state`.
- Incoming `handshake` frame triggers `negotiateProtocol`; result stored as `HandshakeDiagnostics` accessible via `getHandshakeDiagnostics()`.
- `HandshakeWirePayload` added to `ChannelFramePayload` union.

**Tests:** `src/test/unit/p2p-handshake.test.ts` — compatible, downgraded, unsupported, malformed, and diagnostics cases.

### P2P-R — Local Trust Levels + Capability Gating (REQ-P2P-11/12/18)
**New file:** `src/shared/p2p-trust.ts`
- `TrustLevel: 'unknown' | 'friend' | 'verified' | 'blocked'` — four-level model.
- `CAPABILITY_TRUST_REQUIREMENTS` — per-capability minimum trust level table.
- `isTrustCapable` / `capabilitiesForTrustLevel` — gate capabilities; blocked peers are always denied.
- `applyTrustLevelChange` — promotes/demotes with source (`'user'` | `'reputation'`); reputation cannot override user-set blocks or demote below a user-set friend/verified level.
- `toLegacyTrustStatus` — backwards-compatible bridge to `P2PNeighborTrustStatus`.
- Import/export helpers (`upsertPeerTrustRecord`, `exportTrustStore`, `importTrustStore`) with idempotency guarantee.

**Tests:** `src/test/unit/p2p-trust.test.ts` — unknown defaults, promotion/demotion, verified behavior, block precedence, reputation constraints, round-trip export.

### P2P-S — Schema Versions + Deterministic Migration Registry (REQ-P2P-13/16)
**New file:** `src/shared/p2p-schema-migrations.ts`
- `SCHEMA_VERSIONS` — version constants for presence, peerOffer, catalogRecord, pairResponse, pairConversation, knownPerson, neighborCache, ledgerEvent, localInIndex, localOutIndex, peerTrustRecord, handshakeRecord.
- `MIGRATION_REGISTRY` — v0→v1 migration steps for every kind.
- `migrateRecord` / `migrateRecords` — deterministic, idempotent per-record migration.
- `inspectSchemaVersions` — diagnostics showing stored versions and pending migration count.
- `runStartupMigrations` — applies all pending migrations across a full store and returns a diagnostic summary.

**Tests:** `src/test/unit/p2p-schema-migrations.test.ts` — v1→current migration, no-op re-run, preserves fields, all kinds covered, startup diagnostics.

### P2P-T — Signed Upgrade Verification (REQ-P2P-17)
**New file:** `src/shared/p2p-release-verification.ts`
- `ReleaseManifest` — `{ manifestVersion, version, packageHash, signature, signerKeyId, minSupportedProtocol, minSchemaVersion, builtAt }`.
- `TrustStoreEntry` — signer key record with validity window.
- `createReleaseManifest` — validated factory.
- `manifestSigningPayload` — deterministic canonical payload (excludes `signature`).
- `verifyReleaseManifest` — checks required fields, resolves signer from trust store, validates key validity window, verifies SEA signature, checks package hash, rejects downgrades.
- `isDowngrade` — numeric semver comparison.

**Tests:** `src/test/unit/p2p-release-verification.test.ts` — valid manifest, unknown signer, bad signature, hash mismatch, downgrade, expired key, not-yet-valid key, same-version (not downgrade).

### P2P-U — Fake-Client Defense + Replay/Rate Controls (REQ-P2P-20)
**New file:** `src/shared/p2p-abuse-defense.ts`
- `BoundedNonceCache` — LRU-evicting cache (default 10 000 entries) implementing `P2PReplayNonceCache`; usable on server relay routes and client receive paths.
- `P2PRateLimiter` — sliding-window rate limiter keyed by peer id, pub, or IP.
- `SuspiciousPeerTracker` — per-peer counters for duplicate nonce, malformed payload, stale timestamp, wrong peer id, rate-limit exceeded, blocked-peer attempt; auto-demotes at configurable threshold; exposes non-secret diagnostics.
- `classifyRejectionReason` — maps `verifySignedP2PEnvelopeProof` failure strings to `SuspiciousPeerReason`.
- `P2PAbuseDefenseContext` — bundles nonce cache + rate limiter + tracker; `checkInbound` is the single call-site for relay routes and peer receive paths.

**Tests:** `src/test/unit/p2p-abuse-defense.test.ts` — duplicate nonce, eviction, rate-limit flood, stale timestamp, blocked-peer attempts, priority downgrade, diagnostics exposure.

**Evidence:**
- `npx jest p2p-handshake p2p-trust p2p-schema-migrations p2p-release-verification p2p-abuse-defense` — 5 suites, 109 passed

## 2026-06-04 - P2P-P: Canonical PeerID + Signed P2P Envelopes

Implemented canonical signed envelope proofing for current direct P2P metadata and relay surfaces.

**Changes:**
- Added shared deterministic payload serialization, `peerId = SHA-256(pub)`, payload hashing, SEA signing, SEA verification, and replay nonce-cache helpers.
- Signaling, conversation relay, discovery, and presence ack server routes now reject missing, tampered, stale, wrong-peer, invalid-signature, and duplicate-nonce envelopes.
- Browser signaling and conversation-relay polling verifies fetched envelopes before decode/delivery.
- WebRTC DataChannel `ledger-state` and DM notify frames are wrapped in signed frames and verified before handling.
- WebRTC signaling POSTs and server-relay conversation messages now sign with the local SEA pair.
- Direct peer talk offers now carry signed sender metadata (`senderPub`, `senderPeerId`, timestamp, payload hash, signature, nonce), and incoming offer subscribe/reconcile paths verify before accepting.
- Updated E2E discovery/signaling fixtures to use real SEA signatures instead of placeholder `sig_*` strings.

**Evidence:**
- `npm run test:type` clean
- `npm run lint` clean
- `npm run test:unit` — 29 suites, 296 passed
- `npm run test:integration` — 5 suites, 110 passed, 1 skipped
- `npx jest src/test/unit/peer-talk-delivery.test.ts src/test/unit/p2p-runtime.test.ts src/test/unit/p2p-presence.test.ts src/test/unit/p2p-signaling-client.test.ts src/test/integration/system-routes.test.ts --runInBand` — 47 passed
- `npm run build:server` clean
- `npm run build:web` clean (existing bundle-size warnings)
- `P0_DIRECT_TALK_DELIVERY=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/00i-p0-direct-talk-delivery.spec.ts tests/e2e/staged/stage1-single-user/00-p2p-conversation-transport.spec.ts tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts` — 3 passed

## 2026-06-04 - TODO cleanup: P1 moved out of active queue

Moved the completed P1 ownership-graph focus, exit criteria, and audit evidence out of `docs/TODO.md`. The active TODO now starts from the next SRS gap: §19.13 / REQ-P2P-09–20 identity, trust, versioning, upgrades, and fake-client defense.

**P1 completion evidence preserved here:**
- Direct-mode E2E exercises client pair writes instead of `POST /api/talks/:id/response`.
- Server response endpoint rejects direct-mode answer submission.
- `test:e2e:parallel` defaults to direct mode.
- Direct-mode peer offers are catalog-ref metadata without duplicated full `talkData`.
- Direct-mode local IN writes use `ownerIncomingTalkIndex` instead of public `incomingTalksByUser`.
- Pair response payloads under `pairTalkResponses/<pairId>/...` are pair-scoped SEA ciphertext with routing metadata only.
- Non-TechSupport conversation bodies write to pair-scoped encrypted paths in direct mode.
- Direct-mode Creator Replies, relationship stats, and talk-history server APIs no longer expose hub-derived pair history.
- Chatroom delivery writes metadata announcements to `chatrooms/<room>/announcements/*`; legacy `talks` read fallback remains for migration.
- Third-party isolation E2E proves Bob/Alice/Tom response and DM ciphertext isolation plus one canonical talk body.

**Verification:**
- `npm run test:e2e:parallel` — 96 passed, 2 skipped

## 2026-06-04 - Pair-direct response encryption stabilization

Fixed a direct-mode race where responders could receive a talk offer before `users/<authorId>` had replicated, causing pair response encryption to fail while looking up the author's public encryption key.

**Changes:**
- Peer talk offers now carry the sender SEA `epub` as metadata.
- Chatroom announcements carry `authorEpub` when available.
- Hydrated incoming talk records preserve `authorEpub` for direct response completion.
- Pair response encryption first uses the delivery key hint, then falls back to bounded public-user retries for legacy records.

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit -- peer-talk-delivery` — 29 suites, 294 passed
- Focused P2P E2E batch — 11 passed
- `npm run test:e2e:parallel` — 96 passed, 2 skipped

## 2026-06-04 - P1-6b/P1-7: Encrypted pair-private direct graph

Direct-mode talk answers and non-TechSupport conversation bodies now use pair-scoped SEA ciphertext with raw Gun nodes limited to routing metadata.

| Item | Deliverable |
|------|-------------|
| P1-6b | `pairTalkResponses/<pairId>/<talkId>/<responseId>` stores encrypted answer payloads; sender subscriptions decrypt before match/contact processing. |
| P1-7 | Direct conversations write encrypted bodies to `pairConversations/<pairId>/<conversationId>/messages/*`; legacy public conversation message paths are avoided in direct mode. |
| E2E | P0 direct delivery asserts encrypted pair responses; messaging E2E asserts pair conversation ciphertext and no legacy `conversations/<id>/messages` storage. |

**Evidence:**
- `npm run test:type` clean
- `npm run test:e2e:p0-talks` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/09-messaging.spec.ts` — 1 passed

## 2026-06-04 - P1 Ownership Graph Closure

Completed the remaining P1 ownership-graph action items from `docs/TODO.md`.

| Item | Deliverable |
|------|-------------|
| P1-9 | Added Bob/Alice/Tom third-party isolation E2E. Bob broadcasts one canonical talk to Alice and Tom; Alice answers and DMs Bob; Tom cannot decrypt Alice/Bob pair payloads; raw response/DM nodes contain ciphertext only. |
| P1-3b | Direct-mode room delivery now writes metadata to `chatrooms/<room>/announcements/*`; subscribers keep a legacy `talks` fallback for migration. |
| P1-8 | Direct-mode Creator Replies, peer relationship, and talk-history APIs no longer expose hub-derived `talkResponsesMap` pair history; direct-mode snapshots omit/import no `talkResponses` application history. |
| P1-2b | Added `createOwnershipEnvelope` with `visibility: 'room' | 'user' | 'pair'`, required `roomId` / `ownerPub` / `pairId`, encrypted-payload enforcement, and deprecated-path rejection. |

**Evidence:**
- `npm run test:type` clean
- `npx jest src/test/unit/p2p-runtime.test.ts --runInBand` — 21 passed
- `npx jest src/test/integration/peer-routes.test.ts --runInBand` — 27 passed
- `npm run test:e2e:p0-talks` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage3-three-user/00j-pair-private-isolation.spec.ts` — 1 passed
- `npm run test:unit` — 29 suites, 294 passed
- `npm run test:integration` — 5 suites, 110 passed, 1 skipped
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/15a-blocking-unblock-resumes-talk-delivery.spec.ts` — 1 passed
- `P0_DIRECT_TALK_DELIVERY=1 P2P_DIRECT_CHAT_ENABLED=1 STAR_SERVER_PERSISTENCE=ephemeral E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts` — 1 passed
- `npm run test:e2e:parallel` — 96 passed, 2 skipped
- `npm run health` clean

## 2026-05-30 - P0: Direct browser talk exchange (spec §19.2 / §19.12 Phase B)

Two browsers deliver talks over Gun mesh; server skips authoritative inbox and talk-body persistence when `P0_DIRECT_TALK_DELIVERY=1` or `RELAY_ONLY_HUB=1`.

| Item | Deliverable |
|------|-------------|
| P0-1 | `shouldSkipServerGunPersist` for `talks/*`, `incomingTalksByUser/*`, `peerTalkOffers/*`, `peerTalkCatalog/*`, `chatrooms/*/talks/*` |
| P0-2 | `peerTalkOffers/<receiverId>/<sender::talkId>` fanout; `publishPeerTalkOffer` / `subscribePeerTalkOffers` |
| P0-3 | Local-first IN: `collectLocalIncomingTalkClusters`, `upsertLocalIncomingTalkCluster` |
| P0-4 | Server gates: empty `GET incoming-talks`, skip `register-receivers` / `POST received` inbox writes |
| P0-5 | `peerTalkCatalog/<authorId>/<talkId>` + `resolveTalkFromPeerMesh` for chatroom announce → pull |
| P0-6 | E2E `00i-p0-direct-talk-delivery.spec.ts`; `npm run test:e2e:p0-talks`, `npm run dev:p0-talks` |

**E2E reliability:** browser flag via `/?e2e_p0_talks=1` (`resolveP2PRuntimeFlags` + `webAppURLStableChatroom`) so P0 mode does not depend on webpack compile-time env alone.

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit` — peer-talk-delivery, p2p-runtime (incl. URL param)
- `npm run test:integration` — register-receivers skip when P0 env set
- `npm run test:e2e:p0-talks` — 1 passed

## 2026-05-28 - P2P stack phases I–O (production relay model)

Implemented remaining stack phases from spec §19.9 (no UI changes).

| Phase | Deliverable |
|-------|-------------|
| P2P-I | `POST/GET /api/presence/*`, signed peer ack, `P2PPresenceClient` heartbeat in `app.ts` |
| P2P-J | Worker Gun bridge IndexedDB persistence (existing `public/worker.js` idb adapter) |
| P2P-K | `shouldSkipServerGunPersist` + `GunService.putPath` skip for peer DM paths when ephemeral/`RELAY_ONLY_HUB` |
| P2P-L | `mirrorIncomingTalkClustersToLocalGun` + `mirrorTalkDefinitionToLocalGun` |
| P2P-M | `RELAY_ONLY_HUB` flag, `npm run dev:relay-only`, production presence/signaling routes |
| P2P-N | `TechSupportMessageStore`, `/api/support/messages/*`, `TechSupportConversationTransport` |
| P2P-O | `P2PLocalNodeBridgeClient` probes `/api/p2p/local-node` when `P2P_NODE_ENABLED=1` |

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit` — 280 tests pass (incl. `p2p-presence.test.ts`)
- `npm run test:integration` — presence + TechSupport routes in production mode

## 2026-05-28 - P2P-H: Gun write-through on direct P2P transport

Direct conversation transport now persists DM bodies to local Gun before/alongside WebRTC notify (spec §19.4, REQ-P2P-01).

**Key changes:**
- `StarGunConversationTransport`: `buildAndPersistMessage`, `putMessageRecord`
- `DirectP2PConversationTransport`: Gun store authoritative; subscribe via Gun; WebRTC `onRemoteDm` write-through
- `p2p-webrtc-session`: `onRemoteDm` hook; `sendDm` accepts pre-persisted wire
- Diagnostics: `messageBodyStorage: 'gun-local'` when `P2P_DIRECT_CHAT_ENABLED=1`
- E2E: `assertGunStoredMessageBodies` replaces hub-leak assertion in `09-messaging`

**Evidence:**
- `npm run test:type` clean
- `npm run test:unit` — `direct-p2p-conversation-transport.test.ts`, `p2p-runtime.test.ts`

This is the durable ledger for shipped feature work. Keep `TODO.md` focused on forward work:
when an item is finished, move it here with a short description and concrete evidence.

## Maintenance Rule

- Move completed TODO items from `docs/TODO.md` into this file.
- Include the date, feature/phase name, user-visible result, and verification evidence.
- Keep detailed design and future work in the relevant spec or roadmap doc.
- If a completed item later needs more work, add a new TODO entry instead of editing history.

## 2026-05-28 - Spec §19 production P2P model + TODO realignment

Documented authoritative architecture for `www.iinpublic.com` relay-only hub, Gun-local persistence, transport/persistence split, TechSupport server exception, and stack phases P2P-H–O (no UI changes).

**Evidence:**
- `docs/specs/iinpublic-technical-specifications.md` v4.1 — §19 rewritten
- `docs/TODO.md` — forward work is P2P-H–O per spec
- `docs/TODO-direct-p2p.md` — marked superseded for persistence policy

## 2026-05-30 - Direct P2P transport slice (persistence superseded by spec §19.4)

Shipped WebRTC conversation transport infrastructure. **Persistence policy superseded:** production target is Gun write-through on device (P2P-H), not RAM-only DataChannel storage.

**Shipped:**
- `DirectP2PConversationTransport`, `p2p-signaling-client`, `p2p-webrtc-session`
- `ResilientConversationTransport` fallback chain (direct → server-relay → star-gun)
- LEDGER_STATE handshake on DataChannel open (REQ-LEDGER-06)
- `/api/p2p/signaling/*`, `/api/p2p/conversation-relay/*`, `/api/p2p/transport-diagnostics`
- E2E helpers and migration for messaging/match specs (`docs/TODO-direct-p2p.md` Phases 0–5)

**Evidence:**
- `npm run test:type` clean
- E2E: `00-p2p-conversation-transport`, `09-messaging`, `12-two-responders-partial-match`
- Full checklist: `docs/TODO-direct-p2p.md` (optional `test:e2e:parallel` gate still open)

## 2026-05-30 - Direct P2P: fallback chain, LEDGER_STATE, relay API

Completed remaining `docs/TODO-direct-p2p.md` items except the full `test:e2e:parallel` gate.

**Transport fallback:** `ResilientConversationTransport` wraps direct WebRTC → encrypted `ServerRelayConversationTransport` (`/api/p2p/conversation-relay/*`) → `StarGunConversationTransport`. Fallback events POST to `/api/p2p/transport-diagnostics`; UI updates via `updateConversationTransportMode`.

**LEDGER_STATE (REQ-LEDGER-06):** `p2p-webrtc-session.ts` exchanges `{ type: 'ledger-state', feeds }` on DataChannel open before DMs; wired to `WebLedgerService.syncWithPeer` from `app.ts`.

**Evidence:**
- `npm run test:type` clean
- Unit + integration tests pass (including new signaling two-peer + conversation-relay tests in `system-routes.test.ts`)
- E2E: `00-p2p-conversation-transport`, `09-messaging`, `12-two-responders-partial-match` pass

## 2026-05-29 - Fix 7 Failing E2E Tests (Post-Phase-G Regressions)

After Phase G shipped CIDv1 talk IDs, 7 E2E tests regressed. Root causes and fixes:

**`src/shared/incoming-talk-ids.ts`** — `isValidTalkId` and `isTalkIdMapKey` only accepted UUID and `qa_` formats. Added `TALK_CIDv1_ID = /^b[a-z2-7]{50,}$/` and wired it into both functions. This fixed `pickLatestTalkIdFromIncomingCluster` silently returning `''` for CIDv1 IDs, which caused `loadFullTalkViaIncomingIdentity` to return `null` and the response modal to never open. Fixed: `00i` (survey analytics dashboard), `00aa` (survey multi-responder lifecycle), `00ab` (route multi-responder lifecycle).

**`src/web/app/app.ts`** — Removed `audiencePreviews.length > 0 &&` guard from broadcast preamble check. Single-user broadcasts (0 eligible receivers) were skipping `confirmBroadcastAudience`, so the preamble modal never appeared. Fixed: `00z` (Chinese edge notifications / broadcast preamble).

**`src/web/ui/contacts-view.ts`** — Changed `formatRelationshipLabel(known, deps)` (returned "No relationship set" when `known` is undefined) to `known?.label ? formatRelationshipLabel(known, deps) : deps.text('stranger')`. Fixed: `00ae` (contacts stranger relationship default label).

**`src/web/ui/ui-manager.ts`** — Added group-field pre-sort at the top of the comparator in `renderCreatorReplies`. Without it, rows sorted by date interleaved responders across date buckets, producing N×M duplicate group headers (16 instead of 4 in the failing test). Fixed: `00ad` (reply triage group-by date).

**`tests/e2e/staged/stage3-three-user/03-chatbot-bot-badge.spec.ts`** — Widened `talkId` assertion regex from `/^qa_[0-9a-f]{8}$/i` to `/^(qa_[0-9a-f]{8}|b[a-z2-7]{58,})$/i` to accept CIDv1 IDs. Fixed: `03` (chatbot bot badge).

Evidence:
- `npx tsc --noEmit` → no errors
- Commit `a6c8b77f84aabd8f931c13808ff749972eb2e798`

## 2026-05-28 - Phase G: Conversation sub-DAG with prevSeen field (REQ-LEDGER-08)

Added two-writer DAG link to the conversation message layer.

Key changes:
- `src/shared/types.ts`: `Message.prevSeen?: string` — the `id` of the last message from the *other* participant the sender had observed when composing this message. Creates a causal DAG edge per message enabling offline merge and ordering without a central sequencer.
- `src/web/services/web-conversation-service.ts`:
  - `StarGunConversationTransport.lastSeenFromOther` Map keyed by `${conversationId}:${myUserId}` tracks the latest incoming message id from the other party.
  - `sendMessage()` reads `lastSeenFromOther` and includes `prevSeen` in the Gun message payload.
  - `subscribeToMessages(conversationId, callback, myUserId?)` and `collectAndDecryptMessages(..., myUserId?)` accept optional `myUserId`; after each message batch, update `lastSeenFromOther` for every message whose `senderId !== myUserId`.
  - `prevSeen` field carried through `collectAndDecryptMessages` and returned in the `Message` array.
  - `ConversationTransport` interface updated to document the optional `myUserId` parameter.
- `src/web/app/app.ts`: `subscribeToMessages(data.conversationId, callback, this.currentUser?.id)` — seeds the tracker from the first batch.

Evidence:
- `npx tsc --noEmit` → no errors
- Commit `fd61f6d671b603272c15ce13fe4eab3b4c5492d7`

## 2026-05-28 - Phase G: Remove Legacy Gun Dual-Writes

Removed the last legacy `talkAnswerTemplateByUser/<userId>/<identityKey>` Gun write that was still firing on every talk answer.

Key changes:
- `src/server/index.ts` `saveUserAnswerTemplateByContent`: removed `gunService.putPath(['talkAnswerTemplateByUser', responderId, identityKey], ...)`. Instead, now sets `cluster.isAnswered = true` and `cluster.isAutoAnswered = isAuto` directly on the in-memory `incomingTalksMap` cluster for the responderId.
- `src/server/routes/talk-delivery-routes.ts` `/api/incoming-talks`: removed Gun `getPath` read per cluster entry. `isAnswered` and `isAutoAnswered` are now read from `cluster.isAnswered` / `cluster.isAutoAnswered` (populated above), eliminating one Gun read per incoming talk in the list response.
- `incomingTalksByUser` writes: already absent (server-side Map is sole authority; confirmed via comment at server/index.ts:599-601).
- Per-question cache (`byQuestion/<cidKey>`) continues to be written by talk-delivery-routes.ts after `fanoutResponseToSenders` (Phase E, unchanged).
- Exact chatbot memory path (primary auto-reply) unaffected.

Evidence:
- `npx tsc --noEmit` → no errors
- Commit `0f8d7f6ca72d30d651c83adc5c262389906c1ac3`

## 2026-05-28 - Phase G: CIDv1 for All Entity IDs — Consolidate talk-content-id.ts into cid.ts

All exports from `src/shared/talk-content-id.ts` moved into `src/shared/cid.ts`. New `computeTalkCIDv1` async function added using real SHA-256 CIDv1.

Key changes:
- `src/shared/cid.ts` now exports all talk-content-id.ts functions: `TalkContentIdOptions`, `normalizeIdentityText`, `hashIdentityPayload`, `buildIdentityPayloadFromTalk`, `computeTalkIdFromTalkData`, `buildTalkIdentityKey`, `canonicalIdentityKeyFromStoredCluster`
- `computeTalkCIDv1(talkData)` — new async function using `computeCIDv1`; produces real CIDv1 IDs for talk creation
- `web-talk-service.ts createTalk`: switched to `await computeTalkCIDv1` 
- `server/talk-service.ts createTalk`: switched to `await computeTalkCIDv1`
- All other call sites (ui-manager, app.ts, talk-engine, flattened-answer-keys, server/index) updated to import from `cid.ts`
- `talk-content-id.ts` replaced with a `@deprecated` re-export shim (filesystem mounted read-only, actual deletion deferred)
- Tests updated to import from `cid.ts`

Evidence:
- `src/shared/cid.ts` — full consolidation + computeTalkCIDv1
- `src/shared/talk-content-id.ts` — deprecated re-export shim
- All import sites updated
- Commit: 284d0b2

## 2026-05-28 - Phase F: Chatbot Differential Answering Review Screen (REQ-CHATBOT-02–04)

Review screen added to `talk-response-dialog.ts` to prevent silent auto-submit when all questions can be auto-answered.

Key changes:
- `tryCollectAllAutoAnswers()`: pre-scans the talk question chain using `resolveAnswerPreferenceForTalkQuestion`. Returns the full auto-answer set if every question resolves with `mode === 'auto'`, or null if any question is unanswered or the talk is a route (branching).
- Review screen triggered when all questions are auto-fillable OR when `isTalkSuperseded` flag is set.
- Pre-filled answers displayed grayed out with `(pre-filled)` label; user can override any choice via radio selection.
- `Confirm & Submit` validates all questions are answered before calling `completeTalk`.
- `Edit answers manually` closes review and reopens with `skipAutoAnswer: true` for the standard interactive flow.
- TALK_SUPERSEDED banner: "[Sender] updated this talk. Your previous answers are pre-filled — please review and answer any new questions."
- `isTalkSuperseded` and `senderName` added to `TalkResponseDialogOptions` and threaded through `ui-manager.showTalkResponseDialog`.

Evidence:
- `src/web/ui/talk-response-dialog.ts` — tryCollectAllAutoAnswers, review screen, TALK_SUPERSEDED banner
- `src/web/ui/ui-manager.ts` — isTalkSuperseded + senderName opts in showTalkResponseDialog
- Commit: c28114c

## 2026-05-28 - Phase F: TALK_SUPERSEDED + TALK_WITHDRAWN Events and Grace Window

TALK_SUPERSEDED and TALK_WITHDRAWN ledger events now fire from existing talk edit and delete/disable flows.

Key changes:
- `app.ts updateTalk` handler: emits `TALK_SUPERSEDED { oldTalkId, newTalkId }` after a successful edit. Since the current implementation updates in-place, both IDs are the same — the ledger captures the revision event for chatbot differential answering (REQ-CHATBOT-03).
- `ui-manager.ts deleteMyTalk`: emits `'withdrawTalk'` event to app.ts when a talk is removed from the local list.
- `ui-manager.ts setTalkDisabled(talkId, true)`: emits `'withdrawTalk'` — disabling broadcast is treated as withdrawal from active delivery.
- `app.ts withdrawTalk` handler: listens for the UI event and fires `TALK_WITHDRAWN { talkId, gracePeriodMs }` into the ledger. Grace period defaults to 24h; configurable via `TALK_WITHDRAWN_GRACE_MS` env var.
- `WebLedgerService.writeIndexes` (Phase E) already writes the `ledger/<userId>/index/withdrawn/<talkId>` path, so the withdrawal is immediately queryable via `isTalkWithdrawn()`.

Evidence:
- `src/web/app/app.ts` — TALK_SUPERSEDED hook in updateTalk; withdrawTalk handler
- `src/web/ui/ui-manager.ts` — withdrawTalk emit in deleteMyTalk + setTalkDisabled
- Commit: ad87ebb

## 2026-05-28 - Phase F: LEDGER_STATE Handshake + O(Δ) Delta Sync (REQ-LEDGER-06)

Gun-path-based delta sync layer added to `WebLedgerService` and wired into `app.ts`.

Key additions to `WebLedgerService`:
- `broadcastState()` — writes our LedgerState JSON to `ledger/<userId>/state` on Gun
- `getEventBySeq(feedUserId, seq)` — reads a single event from Gun by position
- `syncWithPeer(peerId, theirState)` — pushes missing events to `ledger/<peerId>/inbox/<eventId>`
- `syncWithPeerById(peerId)` — reads peer state from Gun then calls syncWithPeer
- `subscribeToInbox()` — watches `ledger/<userId>/inbox`, verifies + ingests each delta event
- `startDeltaSync(getPeerIds)` — orchestrates broadcast + inbox subscription + proactive peer sync

`app.ts` changes:
- `startLedgerDeltaSync()` called after own feed head loaded (post-keypair init)
- Gun `hi` event triggers `broadcastState()` so newly connected peers receive our state
- `getPeerIds()` lazily returns `currentUser.knownPeople` userIds

All delta sync operations are fire-and-forget; errors are non-fatal. Peers without ledger support silently fall back to Gun star sync.

Evidence:
- `src/web/services/web-ledger-service.ts` — broadcastState, syncWithPeer*, subscribeToInbox, startDeltaSync
- `src/web/app/app.ts` — startLedgerDeltaSync + Gun hi wiring
- Commit: ddfcaf2

## 2026-05-28 - Phase E: Ledger Event Hooks Wired Into All Interaction Flows

All interaction flows in `src/web/app/app.ts` now emit ledger events (fire-and-forget, non-blocking):

- `TALK_CREATED` — emitted after `createTalk()` succeeds
- `TALK_BROADCAST` — emitted after the Gun announce loop completes (per chatroom)
- `TALK_ANSWERED` — emitted after `submitTalkResponse()` with outcome: match/ignore/mismatch
- `MATCH_CREATED` — emitted once per match entry after a successful match
- `CONVERSATION_MSG` — emitted after `conversationService.sendMessage()` succeeds

Key design decisions:
- `initLedger()` is called lazily after the SEA keypair is ready, not at construction time
- `ledgerEmit()` wraps all calls in try/catch and only logs warnings — ledger failures never block the main flow
- `(serverResult as any).isIgnore` and `responseId` fallback used since the server response type doesn't expose these fields

Evidence:
- `src/web/app/app.ts` — initLedger, ledgerEmit, TALK_CREATED/BROADCAST/ANSWERED/MATCH_CREATED/CONVERSATION_MSG hooks
- Commit: f5efae3

## 2026-05-28 - Phase D5/D6 Acceptance Closure

Reply triage group-by + date range filter coverage and contacts stranger/relationship coverage added.

Key changes:
- `00ad-reply-triage-group-date.spec.ts` — verifies group-by responder/talk/day/none, date range filter (future-from → 0 results, past-to → 0 results), clear-filters restores all rows, sort-by-talk-replies, and sort order persists after tab switch.
- `00ae-contacts-stranger-relationship.spec.ts` — verifies new match appears as "Stranger" in contact list, edit-relationship modal saves "Friend" label correctly, contact meta line updates, sort by relationship and weighted both show contact, and label persists after navigating away and returning.
- `package.json` — phase-d5 and phase-d6 scripts updated to include new specs.

Evidence:
- `tests/e2e/staged/stage3-three-user/00ad-reply-triage-group-date.spec.ts`
- `tests/e2e/staged/stage2-two-user/00ae-contacts-stranger-relationship.spec.ts`
- Commit: b18ff61

## 2026-05-28 - Phase D3 Filter Diagnostics Hardening

CJK grammar detection, broadcast preamble localization, and location-pending warning shipped.

Key changes:
- `ContentFilter.isCjkContent()` — detects when ≥20% of non-whitespace chars are CJK ideographs; used by `assessGrammar()` to return 1.0 (pass) for Chinese/Japanese/Korean content without applying Latin sentence/punctuation heuristics that would incorrectly reject CJK messages.
- `assessGrammar()` CJK bypass — prevents false `intake_grammar` filter rejections for valid CJK talks, allowing the dirty-word check to run independently.
- Broadcast preamble chip — was hardcoded `'1 talk'`/`'N talks'`; now uses `talksCountOne`/`talksCount` translation keys so the chip reads correctly in Chinese.
- `filterLocationPending` — new EN + ZH translation key; shown as a warning in Settings filter diagnostics and the Talks IN tab empty state when `currentLocation` is null but incoming talks have a `locationRadiusMiles` constraint.
- Unit tests — `ContentFilter.isCjkContent` + `applyFilters` CJK grammar bypass + dirty-word detection added to `reputation.test.ts`.

Evidence:
- `src/shared/reputation.ts` — `isCjkContent()` static method + CJK bypass in `assessGrammar()`
- `src/web/ui/ui-translations.ts` — `filterLocationPending` EN + ZH keys
- `src/web/ui/ui-manager.ts` — preamble chip localization + location pending note
- `src/test/unit/reputation.test.ts` — `ContentFilter` describe block with 8 unit tests
- Commit: 6193e39

## 2026-05-28 - Phase D2 Localization Edge Surface Hardening

Status bar user/match count were rendering with hardcoded English strings (`'user'`, `'users'`, `'match'`, `'matches'`). Fixed by adding `statusBarUser/Users/Match/Matches` translation keys to both EN and ZH catalogs, updating `updateStatusBar()` to call `tf()`, and storing the base text in `data-status-bar-base` so `syncStatusBarMatchCount()` does not depend on an English-only regex.

Evidence:
- `src/web/ui/ui-translations.ts` — 4 new keys in EN + ZH
- `src/web/ui/ui-manager.ts` — `updateStatusBar` + `syncStatusBarMatchCount` now use `tf()`
- `tests/e2e/staged/stage1-single-user/00z-chinese-edge-notifications.spec.ts` — verifies status bar, broadcast preamble modal, and chatroom create modal in Chinese
- Commit: 3ffd31d

## 2026-05-28 - Phase D4 Talk Lifecycle Multi-Responder Matrix (E2E, complete)

Survey, route, and intake-filtered responder cases added to the D4 matrix:
- Survey talk: two responders, aggregate stats ≥2, no match badge, Me tab entry per responder.
- Route talk: engineer branch yields isMatch, no-job branch yields isIgnore; creator sees 1 match.
- Intake-filtered: Bob blocks flow type server-side; only Jerry's match reaches creator; Bob's IN list stays empty.

Evidence:
- `tests/e2e/staged/stage3-three-user/00aa-talk-lifecycle-survey-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00ab-talk-lifecycle-route-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00ac-talk-lifecycle-intake-filtered-responder.spec.ts`
- Commit: 287fe4e

## 2026-05-27 - Phase D4 Talk Lifecycle Multi-Responder Matrix (E2E, partial)

Flow and tag talks with two responders (match + mismatch) now assert isolated conversations,
Contacts stranger labeling, Me answer ownership per responder, and creator reply triage rows per
outcome. Builds on `talk-lifecycle-fixtures.ts` and `talk-lifecycle-e2e.ts`.

Evidence:

- `tests/e2e/staged/stage3-three-user/00w-talk-lifecycle-flow-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00z-talk-lifecycle-tag-multi-responder.spec.ts`
- `tests/e2e/staged/stage3-three-user/00u-talk-lifecycle-stranger-match.spec.ts`
- Script: `npm run test:e2e:phase-d4`

## 2026-05-27 - Phase D5 High-Volume Reply Triage Matrix (E2E)

Expanded creator reply triage browser proof to a deterministic 10×10 matrix (100 replies) with
query filters, outcome/relationship filters, match- and talk-based sorting, weighted score ordering,
clear-filter restoration, and sort persistence after tab navigation.

Evidence:

- `tests/e2e/staged/stage3-three-user/00v-creator-reply-triage-matrix.spec.ts`
- `tests/e2e/helpers/creator-reply-matrix.ts`
- Script: `npm run test:e2e:phase-d5`

## 2026-05-27 - Phase D6 Tab Sweep Bundle Script

Added a dedicated D6 script that runs the tab-sweep smoke, navigation/settings durability checks, and
Chinese traversal proof together as one sweep entrypoint.

Evidence:

- `tests/e2e/staged/stage1-single-user/00x-tab-sweep-smoke.spec.ts`
- `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`
- `tests/e2e/staged/stage1-single-user/00y-chinese-ui-traversal.spec.ts`
- Script: `npm run test:e2e:phase-d6`

## 2026-05-27 - Phase D2 Chinese UI Localization Proof (E2E)

App UI language (`zh`/`en`) re-renders navigation and main-tab chrome immediately, persists across
reload via `iinpublic_ui_language`, keeps profile/incoming language codes stable, and restores
English on switch. Dedicated traversal spec covers Chatrooms, Contacts, Talks (editor), Me, and
Settings; `00-ui-navigation-settings.spec.ts` adds deep modal/notification/storage checks.

Evidence:

- `tests/e2e/staged/stage1-single-user/00y-chinese-ui-traversal.spec.ts`
- `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`
- `src/web/ui/ui-translations.ts`
- Script: `npm run test:e2e:phase-d2`

## 2026-05-27 - Feature Backlog Audit (Tab and E2E Infrastructure)

Moved shipped tab features and E2E stage infrastructure from `docs/TODO.md` into this ledger:
localization controls, room visitor counters and metadata, TechSupport global anchor and support
contact, contact language/ranking/relationship filters, talk language and creator diagnostics,
answer-memory UI, storage inspector, contextual statistics, runtime diagnostics, Stage 0 TechSupport
bootstrap/snapshot integrity, and ordinary-user greeting bootstrap.

Evidence: see prior 2026-05-26 entries in this file plus `tests/e2e/staged/stage0-bootstrap/`,
`tests/e2e/helpers/e2e-stage-pipeline.ts`, and tab-specific E2E specs under `tests/e2e/staged/`.

## 2026-05-27 - Fix Flaky Staged Broadcast and Contacts E2E Specs

Stabilized hierarchy parent-room broadcast expectations (USA under North America), clear-all
mid-flight broadcast cancellation, and contacts summary assertions after mismatch flows.

Evidence:

- `tests/e2e/staged/stage2-two-user/00h-chatroom-hierarchy-broadcast.spec.ts`
- `tests/e2e/staged/stage2-two-user/00-broadcast-abort-clear-all.spec.ts`
- `tests/e2e/staged/stage3-three-user/00f-ux-contacts-talks-answers.spec.ts`

## 2026-05-27 - D3 Incoming Talk Filter Multi-User E2E Suite

Staged browser proofs now cover language, distance band, grammar/dirty-word moderation, custom
sent-after cutoff, talk-type gating, and related Settings persistence paths alongside broadcast
preview reasons.

Evidence:

- `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00n-distance-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00p-custom-cutoff-intake-filter.spec.ts`
- `tests/e2e/staged/stage3-three-user/00t-talk-type-intake-filter.spec.ts`
- Settings/intake: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-27 - Phase D3–D6 E2E Coverage (Intake, Lifecycle, Reply Triage, Tab Sweep)

Added staged Playwright specs and helpers for talk-type intake filtering, stranger-before-match
lifecycle, creator reply triage at scale (snapshot-seeded 6×6 UI matrix plus existing 10×10 API
integration test), and a single-user tab sweep smoke. New script: `npm run test:e2e:phase-d`.

Evidence:

- Helpers: `tests/e2e/helpers/talk-lifecycle-fixtures.ts`, `tests/e2e/helpers/creator-reply-matrix.ts`
- E2E: `00t-talk-type-intake-filter.spec.ts`, `00u-talk-lifecycle-stranger-match.spec.ts`,
  `00v-creator-reply-triage-matrix.spec.ts`, `00x-tab-sweep-smoke.spec.ts`
- Integration (100 replies): `src/test/integration/peer-routes.test.ts`

## 2026-05-26 - Live Broadcast Intake Rejection Preview (D3)

Broadcast pre-send preview now reliably calls `POST /api/talks/broadcast-receiver-preview` with a
longer timeout, UI-member fallback when Gun member sync lags, and faster server filter/location
reads via `getOptional`. Senders see localized reasons for `intake_language`, `intake_grammar`, and
`intake_dirty_words` before confirming a broadcast. Integration coverage adds distance rejection
counts for `intake_min_distance` / `intake_max_distance`.

Evidence:

- Client/server: `src/web/app/app.ts`, `src/server/services/user-service.ts`
- Tests: `src/test/integration/talk-loop.test.ts`, `src/test/integration/services.test.ts`,
  `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`,
  `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`

## 2026-05-26 - Prevent Expired Direct Talk Delivery

Expired talks can no longer enter a receiver inbox through direct peer send, direct delivery API
calls, or bulk-registration calls. Peer `Send My Talks` omits expired outgoing entries, and the
audience-preview endpoint returns a localized `talk_expired` reason for expired payloads. Omitted
expired/disabled entries are now listed explicitly as unavailable options in the peer-send picker
and broadcast pre-send preview.

Evidence:

- Delivery/UI: `src/server/routes/talk-delivery-routes.ts`, `src/web/ui/user-detail-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Tests: `src/test/integration/talk-loop.test.ts`, `src/test/unit/ui-extracted-modules.test.ts`,
  `tests/e2e/staged/stage2-two-user/00e-chatroom-peer-detail.spec.ts`

## 2026-05-26 - Clarify Shared Languages in Contact Detail

Contact public-profile detail now displays localized readable language names, marks languages
shared with the viewer, and shows a localized translation hint when the profiles have no declared
language in common.

Evidence:

- Contacts UI and translation copy: `src/web/ui/contacts-view.ts`, `src/web/ui/ui-translations.ts`,
  `src/web/ui/ui-manager.ts`
- Tests: `src/test/unit/contacts-view.test.ts`,
  `tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts`

## 2026-05-26 - Surface Contact Credit And Block Context

Ordinary Contact detail now shows saved relationship notes, public-credit privacy state, and
whether delivery is blocked in either direction without requiring the user to open the edit modal.
Recorded transport fallback/no-fallback state and confirmed-contact display are covered by the
subsequent conversation-transport work; live P2P health negotiation remains future work.

Evidence:

- Contact detail UI: `src/web/ui/contacts-view.ts`
- Tests: `src/test/unit/contacts-view.test.ts`,
  `tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts`

## 2026-05-26 - Surface Active Conversation Transport

Peer detail and conversation overlays now identify the active conversation transport mode with
localized labels, including the current star-compatible default. They also display any recorded
fallback reason, explicitly state that no fallback is active for the current star path, and report
the last delivered-message time as confirmed contact evidence.

Evidence:

- Peer and conversation UI: `src/web/ui/user-detail-view.ts`, `src/web/ui/ui-manager.ts`
- Tests: `src/test/unit/ui-extracted-modules.test.ts`, `src/test/unit/ui-translations.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Expose Runtime Feature Diagnostics

Settings Storage Inspector now explicitly displays the runtime state of star persistence, P2P-node
and direct-chat enablement, transport fallback availability, and built-in TechSupport bootstrap.

Evidence:

- Settings UI and translations: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Tests: `src/test/unit/ui-translations.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-p2p-star-baseline-storage.spec.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Reconcile Contextual Statistics Surface

The product decision already present in the application is now recorded in the active backlog:
statistics remain contextual inside work views and per-survey analytics instead of adding a sixth
bottom-navigation tab.

Evidence:

- Contextual summaries and survey analytics UI: `src/web/ui/ui-manager.ts`
- No-tab and aggregate summary proof:
  `tests/e2e/staged/stage1-single-user/00-statistics-dashboard.spec.ts`

## 2026-05-26 - Guard Staged Snapshot Integrity

Sequential E2E snapshot save/load boundaries now validate the canonical TechSupport root identity,
network marker, active Global membership, duplicate support-greeting absence, and the expected
canonical user population for stages 0 through 3.

Evidence:

- Pipeline assertion boundary: `tests/e2e/helpers/e2e-stage-pipeline.ts`
- Canonical seed and staged pipeline: `tests/e2e/helpers/clear-database.ts`,
  `tests/e2e/staged/README.md`

## 2026-05-26 - Reconcile Shipped Talk And Ranking Diagnostics

The active backlog now reflects existing shipped behavior for localized OUT/IN talk badges,
incoming hidden-reason diagnostics, OUT-talk response ranking, Contacts peer ranking, and Settings
filter preview. These capabilities were already implemented and verified but were still listed as
future work in the tab backlog.

Evidence:

- UI implementation: `src/web/ui/ui-manager.ts`, `src/web/ui/contacts-view.ts`
- Intake and broadcast reason tests: `src/test/unit/talk-intake-filters.test.ts`,
  `src/test/integration/talk-loop.test.ts`
- Localized UI proof: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Complete Contact Relationship Labels

Contacts now displays saved custom relationship text instead of reducing it to a generic `Custom`
label. Custom relationship text participates in search and alphabetical relationship sorting, while
the existing `partner` and `custom` filter categories remain available.

Evidence:

- Contacts list behavior and unit proof: `src/web/ui/contacts-view.ts`,
  `src/test/unit/contacts-view.test.ts`
- Relationship sort control and E2E persistence proof: `src/web/ui/ui-manager.ts`,
  `tests/e2e/staged/stage3-three-user/14-contacts-relationship-credit.spec.ts`

## 2026-05-25 - Transparent Room Broadcast Audience

The broadcast confirmation view now identifies eligible recipients and skipped members before any
send occurs, with per-member intake, moderation, age, block, capacity, and rate-limit reasons. It
also states when the built-in TechSupport support channel was intentionally excluded from an
ordinary room broadcast.

Evidence:

- Preview API and reason-bearing response: `src/server/routes/talk-delivery-routes.ts`,
  `src/test/integration/talk-loop.test.ts`
- Localized audience view and E2E proof: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`, `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Stable Concurrent Capacity Overflow

FIFO room overflow now lets only the newest active join resolve a capacity breach, preventing
delayed checks from evicting multiple occupants during concurrent room entry. The regional spread
proof now starts users in their declared parent rooms and verifies the intentional USA-to-region
overflow without an artificial all-Global relocation race.

Evidence:

- Capacity enforcement: `src/web/services/web-chatroom-service.ts`
- Browser proof: `tests/e2e/staged/stage5-multi-user/00k-capacity-regional-spread.spec.ts`

## 2026-05-25 - Complete Custom Room Detail Metadata

Custom and business room detail views now expose the metadata collected at creation: room type,
description, business headline, capacity, owner, creation date, active member count, lifetime
visits, and unique visitor count, using localized labels.

Evidence:

- Detail rendering and localized catalog: `src/web/ui/chatrooms-view.ts`,
  `src/web/ui/ui-translations.ts`, `src/web/ui/ui-manager.ts`
- Metadata propagation and UI proof: `src/web/app/app.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Idempotent Room Visits And Membership Audits

Duplicate joins from an already-active member no longer increment lifetime visit totals or reset
the member's FIFO entry time. Re-entering after leaving remains a new lifetime visit while leaving
unique-visitor totals stable, and soft-deleted rooms preserve their recorded visitor history.

Evidence:

- Server/web join accounting: `src/server/services/chatroom-manager.ts`,
  `src/web/services/web-chatroom-service.ts`
- Unit/E2E: `src/test/unit/chatroom-manager.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`,
  `tests/e2e/staged/stage4-four-user/03-capacity-eviction.spec.ts`

## 2026-05-25 - Complete Storage Inspector App State

Storage Inspector now reports application state alongside the existing storage and P2P
diagnostics: TechSupport root/support-channel status, visible room visit counters, incoming
language filtering, and the default language for newly created talks. Existing panels continue
to expose transport, SEA custody/relay scan, localStorage keys, and IndexedDB names.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Complete Localized Language Labels

Language names now stay localized across creator reply filtering and reply rows as well as the
existing Settings, editor, talk badge, peer/profile, and answer-history surfaces. Filter state
continues to store stable language codes while displaying human-readable English or Chinese
labels.

Evidence:

- UI: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Validated Profile Language Selector

The Me profile editor now uses selectable supported-language options rather than a
comma-separated free-text field. Users can retain multiple profile languages, and saved values
are limited to the same language catalog exposed in Settings.

Evidence:

- UI: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Independent Default Talk Language Setting

Settings now exposes a visible default language for newly created talks. Without an explicit
selection it follows App language; after selection it persists independently of App language,
profile language, and incoming-talk filter languages.

Evidence:

- UI and storage: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-settings-storage.ts`,
  `src/web/ui/ui-translations.ts`
- Unit and E2E: `src/test/unit/ui-extracted-modules.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Human-Readable Conditional Answer Context

The Me answer-history view now explains route branches with the earlier question and selected
answer text rather than exposing internal question/answer ids. This is applied to both current
flattened history records and the legacy answered-talk rendering path.

Evidence:

- UI and history serialization: `src/web/ui/answers-view.ts`, `src/web/ui/ui-manager.ts`
- Unit and E2E: `src/test/unit/answers-view.test.ts`,
  `tests/e2e/staged/stage0-bootstrap/caa-techsupport-four-talk-types.spec.ts`

## 2026-05-25 - Support Message Exclusion From Answer History

The Me answer-history list now rejects marked TechSupport welcome and support-channel message rows
from local or migrated data while continuing to render TechSupport-authored talks that the user
intentionally answered.

Evidence:

- UI and history record contract: `src/web/ui/answers-view.ts`,
  `src/web/ui/answer-history-storage.ts`
- Unit and E2E: `src/test/unit/answers-view.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Exact-Question Answer Memory Mode Controls

Preferences now exposes Manual, Temporary auto-answer, Permanent auto-answer, and Skip-this-question
choices for each saved answer. Mode changes, answer edits, and deletion update exact-question memory
instead of leaving hidden auto-answer behavior active.

Evidence:

- UI and storage bridge: `src/web/ui/preferences-dialog.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/answer-preferences-storage.ts`, `src/web/ui/ui-translations.ts`
- Unit and E2E: `src/test/unit/ui-extracted-modules.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Language-Aware Answer History Display

The Me answer-history list now shows a localized language badge on each answered talk and keeps
otherwise identical histories in different languages as separate rows, matching the isolated
auto-use metrics introduced for chatbot memory.

Evidence:

- UI: `src/web/ui/answers-view.ts`, `src/web/ui/ui-manager.ts`
- Unit and E2E: `src/test/unit/answers-view.test.ts`,
  `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - Language-Aware Chatbot Memory Isolation

Exact chatbot memory, content-template identity, and flattened answer-preference keys now include
talk language, preventing identical visible text in different languages from triggering automatic
answer reuse. Historical unscoped exact-memory records remain usable only for English talks.

Evidence:

- Identity and memory: `src/shared/exact-chatbot-memory.ts`, `src/shared/talk-content-id.ts`,
  `src/shared/flattened-answer-keys.ts`
- Server and UI wiring: `src/server/routes/talk-delivery-routes.ts`, `src/server/index.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/answers-view.ts`
- Tests: `src/test/unit/exact-chatbot-memory.test.ts`, `src/test/unit/talk-content-id.test.ts`,
  `src/test/unit/flattened-answer-keys.test.ts`, `src/test/unit/answers-view.test.ts`,
  `src/test/integration/talk-loop.test.ts`

## 2026-05-25 - Talks Language Editing Completion

Authored talks now keep their stored language when opened for editing, persist a changed language,
and refresh the visible OUT language badge immediately after save instead of leaving stale local
metadata until reload.

Evidence:

- UI persistence: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/05-talks-edit.spec.ts`

## 2026-05-25 - TechSupport Pinned Contact And Local Mute

Ordinary users with a durable TechSupport support channel now see a pinned built-in Contacts row
that remains outside ordinary contact counts and ranking. Its support control dialog, plus the
reachable TechSupport peer overlay, provides per-user local mute/unmute instead of normal block
actions; support-ready and welcome notifications respect that mute state without deleting the
support conversation.

Evidence:

- UI/app/catalog: `src/web/ui/contacts-view.ts`, `src/web/ui/user-detail-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`, `src/web/app/app.ts`
- Unit: `src/test/unit/contacts-view.test.ts`, `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts`,
  `tests/e2e/staged/stage3-three-user/06-contacts-tab.spec.ts`

## 2026-05-25 - D2 Independent App Language And Talk Default

Added an explicit persisted App language selector for completed English and Chinese catalogs,
separate from profile language and incoming-talk intake languages. Switching App language now
re-renders translated navigation and Settings without changing profile metadata, survives reload,
and supplies the default language of a newly created talk while retaining its per-talk selector.

Evidence:

- UI preference and renderer: `src/web/ui/ui-settings-storage.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Settings Feedback Localization Slice

Localized Settings feedback for invalid distance ranges, inline nickname validation failures,
and profile-photo file rejection while retaining the existing localized preview and camera
permission flow. The Chinese traversal now triggers each non-mutating validation path.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Contact Relationship Feedback Localization Slice

Localized age-verification vouch, block/unblock, and pre-match conversation guidance notices
issued by app relationship handlers. The Chinese traversal renders each notice through its
catalog formatter without writing relationship state.

Evidence:

- UI/app/catalog: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Chatrooms And Contacts Localization Slice

Moved the visible Chatrooms runtime/member states and Contacts list, detail, relationship,
block, and public-credit surfaces into the English/Chinese catalog. Chinese navigation coverage
now enters an active chatroom, and focused Contacts tests cover Chinese detail/modal rendering
while retaining English singular count grammar.

Evidence:

- Views and catalog: `src/web/ui/chatrooms-view.ts`, `src/web/ui/contacts-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/contacts-view.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Chatroom Actions And Travel Localization Slice

Localized custom-room create and rename dialogs, room-management results and delete confirmation,
broadcast controls/results, and travel/location state notices. The Chinese traversal now opens
the custom-room dialogs while retaining stable room payload values and avoiding server mutations.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`, `src/web/app/app.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Talks List And Linear Dialog Localization Slice

Localized the Talks main list and its incoming/outgoing row metadata, including counts, action
labels, language badges, relative dates, expiry/location text, and response status. Extended the
catalog into tag/flow editor controls and response outcomes while preserving localized persistent
match notifications.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`,
  `src/web/ui/talk-editor-dialog.ts`, `src/web/ui/talk-editor-form-helpers.ts`,
  `src/web/ui/talk-response-dialog.ts`
- Unit: `src/test/unit/ui-translations.test.ts`, `src/test/unit/ui-extracted-modules.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Talks Action Feedback Localization Slice

Localized Talks create/send/update/load/copy/remove/completion feedback and editor validation
banners. Also kept live chatroom visit and matched-member updates in the active language instead
of allowing asynchronous refreshes to restore English runtime labels.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`, `src/web/app/app.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Me History And Auxiliary Dialog Localization Slice

Localized Me answer-history metadata, filtering controls, stored-talk type badges, Preferences,
and My Talks dialogs while retaining stable stored talk type codes for filtering and persistence.
The Chinese traversal now exercises populated history and both dialogs.

Evidence:
- UI/catalog: `src/web/ui/answers-view.ts`, `src/web/ui/preferences-dialog.ts`,
  `src/web/ui/my-talks-dialog.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-extracted-modules.test.ts`, `src/test/unit/answers-view.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Route Editor Tree Localization Slice

Localized the rendered route branch tree, including outcome pills, prompts, child/remove actions,
new branch default answers, and route validation messaging. The Chinese traversal now opens the
route editor and adds a localized child branch.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Peer Detail Localization Slice

Localized peer-detail loading, public profile, relationship statistics, conversations, history,
direct-message controls, and the Send My Talks picker. Language and talk-type labels now respect
the active UI language, and the Chinese traversal opens a populated peer detail overlay.

Evidence:
- UI/catalog: `src/web/ui/user-detail-view.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-extracted-modules.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`,
  `tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts`

## 2026-05-25 - D2 Storage Inspector Localization Slice

Localized Settings Storage Inspector headings, standard status values, local-node permission
labels, policy explanations, and server persisted-path descriptions. Technical storage, transport,
and protocol identifiers remain unchanged for debugging and stable assertions; the Chinese
traversal now verifies the rendered diagnostics panel.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Conversations And Support Welcome Localization Slice

Localized conversation list and overlay copy, displayed message timestamps, incoming-talk and
response-submission notices, and new conversation notifications. TechSupport welcome messages
remain stored in their stable English synchronization form but are rendered and toasted through
the selected UI language; the Chinese traversal now opens the support channel and checks its
translated greeting and ready notice.

Evidence:
- UI/catalog: `src/web/app/app.ts`, `src/web/ui/conversations-view.ts`,
  `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-extracted-modules.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Messaging Feedback Localization Slice

Localized app-owned room-message, conversation-load/send, direct-message error, and
answer-processing feedback while preserving existing conversation rendering behavior. The Chinese
traversal renders each notice without sending messages or forcing network failures.

Evidence:

- UI/app/catalog: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Me Profile And Credit Localization Slice

Localized the always-visible Me profile summary, language labels, privacy annotations,
broadcast-tag trend states/table labels, and reputation/credit cards. The canonical TechSupport
profile role is translated only at render time, preserving stored seeded values.

Evidence:
- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D2 Me Profile Editor Localization Slice

Localized the Me nickname and profile editor dialogs, including privacy/category option labels,
input guidance, validation alerts, and successful save notifications. Stored privacy and interest
category values remain stable internal codes, and stage names are escaped when displayed in the
legacy nickname dialog.

Evidence:
- UI/catalog: `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-25 - D1 Single Settings Owner For Intake Preferences

Confirmed that Settings is the sole editing surface for Talk Behavior and incoming-intake
controls. Me remains an answer-history view with its Preferences shortcut and cannot overwrite
newer Settings values. Added browser coverage that edits Settings-owned values, visits Me, and
verifies the values remain unchanged when Settings is reopened.

Evidence:

- UI ownership and settings storage: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-settings-storage.ts`
- Persistence wiring: `src/web/app/app.ts`, `src/web/services/web-user-service.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-24 - D1 Confirmed Photo Capture And Reload

Added a confirmation preview before uploaded or captured photos become public, a centered
in-browser camera capture flow, and durable permission-denied/unsupported-device guidance.
Restored the visible Me profile card and reconciled reloads with the authoritative public
profile foundation so saved and removed photos do not reappear from stale private state.
Regression verification also aligned online block mutations with the server-owned reputation
counter and preserves ordered block/unblock results across delayed Gun visibility.

Evidence:

- UI and translations: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Public reload and online block reconciliation: `src/web/services/web-user-service.ts`, `src/server/services/user-service.ts`
- Unit: `src/test/unit/web-user-service.test.ts`
- Integration: `src/test/integration/services.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts`, `tests/e2e/staged/stage2-two-user/21a-reputation-block-count.spec.ts`

## 2026-05-24 - D1 Identity Guardrails And Profile Presentation

Implemented protected stage-name validation across ordinary creation and Settings rename flows,
with clear user feedback and preservation of the previous identity. The protected acceptance
matrix includes `TechSupport`, normalized TechSupport variants, `ROOT`, `admin`, `administrator`,
`system`, `support`, `api`, and `www`; only the canonical root flow may retain `TechSupport`.

Removed empty-interest filler from Settings and public peer/contact profile rendering, and added
image headshots with bounded rendering, choose/capture file actions, replacement/removal, file
validation, public-profile display, and initials/preset fallback.

Evidence:

- Shared validator and UI: `src/shared/techsupport.ts`, `src/web/ui/ui-manager.ts`
- Avatar/profile rendering: `src/web/ui/profile-avatar.ts`, `src/web/ui/contacts-view.ts`,
  `src/web/ui/user-detail-view.ts`
- Unit/integration: `src/test/unit/techsupport.test.ts`, `src/test/unit/profile-avatar.test.ts`,
  `src/test/unit/web-user-service.test.ts`, `src/test/integration/services.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/04-profile-edit-stage-name.spec.ts`,
  `tests/e2e/staged/stage0-bootstrap/aaa-stage0-techsupport.spec.ts`

## 2026-05-20 - P2P Node Network Roadmap P1-P7

Source roadmap: [P2P Node Network Roadmap](archive/consolidated-2026-06-08/roadmap-p2p-node-network.md) (archived 2026-06-08; design now in spec §19)

### P1 - Star Compatibility Baseline

Implemented runtime flags and explicit star-mode storage classification while keeping the
existing Gun star topology as the default compatibility baseline.

Evidence:

- Commit: `0a90432` - `Implement P2P star baseline`
- Runtime/debug surface: `GET /api/debug/storage`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-star-baseline-storage.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P2 - Permissioned Local Node Supervisor

Added the local-node supervisor model and APIs for explicit permission disclosures, lifecycle
state, signed session pairing, identity binding, health checks, local-only persistence controls,
and wipe/delete behavior.

Evidence:

- Commit: `ff3943c` - `Implement P2P local node supervisor`
- APIs: `/api/p2p/local-node`, `/start`, `/bind-identity`, `/health-check`, `/wipe`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-local-node-supervisor.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P3 - SEA Key Custody And Relay Privacy

Replaced plaintext browser SEA keypair storage with encrypted WebCrypto custody, formalized the
public-only SEA identity policy, added encrypted linked-device/recovery primitives, and added
relay/browser leak scanning for private SEA keys and plaintext direct-message bodies.

Evidence:

- Commit: `134ddf5` - `Implement P2P SEA key custody`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-sea-key-custody.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P4 - Conversation Transport Boundary

Introduced the conversation transport abstraction while preserving `star-gun` as the active
default, exposed `server-relay` and `direct-p2p` modes, added encrypted short-lived signaling
envelopes, and surfaced transport diagnostics in Settings/debug storage.

Evidence:

- Commit: `dd17f70` - `Implement P2P conversation transport`
- APIs: `/api/p2p/signaling/:conversationId`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-conversation-transport.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P5 - Cross-Platform P2P Protocol

Added the platform-neutral P2P protocol model using the selected
`gun-mesh-websocket-webrtc` substrate, with Web/Windows/Ubuntu/Android/iOS descriptors,
capability negotiation, signed discovery messages, encrypted signaling expectations, and
plaintext/private-key rejection rules.

Evidence:

- Commit: `17c71a8` - `Implement P2P cross-platform protocol`
- APIs: `/api/p2p/discovery`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P6 - Active Neighbor Memory

Added local-only active neighbor memory with scoring, expiry pruning, blocked/failed peer
exclusion, encrypted export, disable/clear controls, and bootstrap candidates before public
star fallback.

Evidence:

- Commit: `0265e3f` - `Implement P2P active neighbor memory`
- APIs: `/api/p2p/neighbors`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P7 - Data Ownership And Migration Boundaries

Added data ownership policy surfaces for device-local deletion, metadata-only server-held data
requests/deletes, migration planning for private and legacy data, relay-only TTL policy, and
telemetry-free user-visible transport diagnostics.

Evidence:

- Commit: `344558a` - `Implement P2P data ownership boundaries`
- APIs: `/api/p2p/data-ownership`, `/api/p2p/transport-diagnostics`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-data-ownership.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

Verification after P1-P7:

- `npm run health`
- `PW_WORKERS=20 npm run test:e2e`

## 2026-05-20 - P2P Test Stabilization

Stabilized date-sensitive P2P expiry tests so discovery and neighbor-memory checks use
future-relative timestamps instead of fixed dates.

Evidence:

- Commit: `84f330d` - `Stabilize P2P expiry tests`
- Files:
  - `src/test/integration/system-routes.test.ts`
  - `tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts`
  - `tests/e2e/staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts`

## 2026-05-20 - Health Check Warning Cleanup

Removed Jest open-handle warnings from Gun read helpers and silenced the expected Webpack
production bundle-size warning with an explicit project budget.

Evidence:

- Commit: `8edb241` - `Silence health check warnings`
- Files:
  - `src/server/services/gun-service.ts`
  - `webpack.config.js`
- Verification: `npm run health`

## 2026-05-20 - Exact Chatbot Memory E2E Stabilization

Stabilized the exact chatbot memory E2E by adding a normalized server-side test endpoint and
waiting on the same memory read path used by server auto-reply instead of grepping raw Gun
snapshots.

Evidence:

- Commit: `2d5db9a` - `Stabilize exact chatbot memory E2E`
- API: `/api/test/exact-chatbot-memory/:userId`
- E2E: `tests/e2e/staged/stage3-three-user/14-exact-chatbot-memory.spec.ts`
- Verification: `npm run health && PW_WORKERS=20 npm run test:e2e`

## Current Implemented Feature Baseline

These feature areas are already part of the current implementation and should not be re-added
to `TODO.md` as greenfield work:

- Profile editor and viewer-filtered public profile rendering.
- Intake filters, server-side moderation, blocking/unblock, age gating, reputation scoring,
  and bulk-capacity enforcement.
- Custom/business chatrooms, hierarchy navigation, single-room travel mode, and same-room
  broadcast delivery.
- Tag catalog, mandatory broadcast preamble, interest targeting, distance caps, tag popularity,
  and tag trend stats.
- Talk creation, matching, answer history, contacts, messaging, cancellation/deletion paths,
  and exact chatbot Q/A memory.
- Generic per-talk stats endpoints, cross-question/time-series/chatroom/peer/dashboard stats,
  dedicated Statistics tab, survey analytics dashboard, low-count masking, CSV exports,
  follow-up survey creation, and peer relationship stats.
## 2026-05-25 - D2 Survey Analytics Localization Slice

Localized the creator-facing survey analytics dashboard, including its metric labels, privacy and
CSV-export controls, load states, export notice, and follow-up survey launch. The dedicated
three-user dashboard scenario now reopens populated survey results in Chinese and verifies the
localized follow-up editor path.

Evidence:

- UI/catalog: `src/web/ui/ui-manager.ts`, `src/web/ui/ui-translations.ts`
- Unit: `src/test/unit/ui-translations.test.ts`
- E2E: `tests/e2e/staged/stage3-three-user/00i-survey-analytics-dashboard.spec.ts`

## 2026-05-26 - Independent App Language Reconciliation

Reconciled stale forward backlog entries with the shipped language controls. Settings already
separates persistent App language from profile language, default-talk language, and multi-language
incoming filters, and its E2E path proves an immediate Chinese re-render and reload persistence.
Full reachable-workflow Chinese traversal remains active work under Phase D2.

Evidence:

- UI: `src/web/ui/ui-manager.ts`
- E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Three-Language Intake Delivery Proof

Added a real multi-user browser scenario for incoming language filters: the receiver accepts
English and Chinese while Spanish delivery stays out of IN, then opts into Spanish and receives a
new Spanish talk. The remaining user-visible rejection-reason portion stays tracked in TODO because
live audience preview can fall back to final-send checking under synchronized browser load.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00m-language-intake-filter.spec.ts`

## 2026-05-26 - Distance-Band Intake Delivery Proof

Added a deterministic two-user browser scenario for distance intake filters: the receiver persists
a one-to-three mile acceptance band, then receives only the authored talk inside that band while
nearer and farther talks remain out of IN. Existing Settings coverage already rejects an invalid
minimum-greater-than-maximum range; user-visible live rejection details remain tracked in TODO.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00n-distance-intake-filter.spec.ts`
- Existing validation E2E: `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`

## 2026-05-26 - Content Intake Toggle Delivery Proof

Added a real two-user browser scenario for the documented grammar heuristic and content-moderation
toggle: clean content reaches IN, unreadable and moderated content stays out while filters are on,
and newly sent equivalent content reaches IN after each setting is disabled and persisted.
User-visible live rejection reasons and expanded multilingual policy remain tracked in TODO.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`

## 2026-06-04 - P1 Direct Talk Connector Guardrails

Moved the direct-talk test/runtime model further away from server-authoritative delivery. Direct
mode now rejects `POST /api/talks/:id/response`, does not retain server inbox entries during
direct broadcast registration, skips deprecated public server Gun writes unless
`IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY=1` is set, publishes metadata-only peer offers with
catalog refs, and mirrors direct IN clusters to `ownerIncomingTalkIndex`.

Evidence:

- Unit: `src/test/unit/p2p-runtime.test.ts`
- Unit: `src/test/unit/peer-talk-delivery.test.ts`
- Integration: `src/test/integration/talk-loop.test.ts`
- E2E: `tests/e2e/staged/stage2-two-user/00i-p0-direct-talk-delivery.spec.ts`
- Unit: `src/test/unit/intake-filter-reasons.test.ts`

## 2026-05-26 - Custom Phrase and Sent-After Delivery Proof

Added a real two-user browser scenario for custom blocked phrases and the sent-after cutoff:
matching or future-cutoff content stays out of IN while each persisted control is active, and newly
sent content reaches IN after the receiver clears that control. Fixed the `datetime-local`
round-trip so a stored ISO cutoff redisplays in the receiver's local wall-clock time after
navigation. Existing delivery tests already cover allowed talk types, adult gating, and
public-credit visibility behavior.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00p-custom-cutoff-intake-filter.spec.ts`
- Existing E2E: `tests/e2e/staged/stage3-three-user/13-me-filters-credit.spec.ts`
- Existing E2E: `tests/e2e/staged/stage3-three-user/00g-age-gating.spec.ts`

## 2026-05-26 - Expiration and Block Delivery Reconciliation

Added a deterministic two-user expiration scenario: a one-day talk reaches the receiver while
active, then a second one-day talk displays as expired and cannot be broadcast after advancing the
sender clock. Reconciled existing browser evidence that blocking prevents delivery and unblocking
allows newly sent talks again.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00q-expiration-broadcast.spec.ts`
- Existing E2E: `tests/e2e/staged/stage2-two-user/15a-blocking-unblock-resumes-talk-delivery.spec.ts`
- Existing E2E: `tests/e2e/staged/stage2-two-user/15b-blocking-stops-delivery-and-peer-visibility.spec.ts`

## 2026-05-26 - Delivered Auto-Copy Toggle Proof

Extended the real sender/receiver browser path with two delivered matching talks. With auto-copy
disabled, the receiver retains answer history without an OUT copy; after enabling the persisted
setting, the second delivered talk is saved as a copied OUT talk while both history records remain.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00l-chatroom-talks-ui-regressions.spec.ts`

## 2026-05-26 - Distance Boundary Equality Proof

Extended the real distance-band delivery scenario with a persisted equal minimum/maximum of zero
miles. A colocated sender's newly authored talk reaches the receiver, proving endpoint equality is
inclusive through the browser path.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00n-distance-intake-filter.spec.ts`

## 2026-05-26 - Dirty Answer Choice Delivery Proof

Extended content-intake delivery with clean-title talks whose answer choice alone contains
moderated content. The talk stays out of IN while dirty-word filtering is enabled and reaches the
receiver after that persisted toggle is disabled.

Evidence:

- E2E: `tests/e2e/staged/stage3-three-user/00o-content-intake-filter.spec.ts`

## 2026-06-09 - P0 Step 1: Mesh Transport Foundation (mesh-ping gossip)

Three browser peers gossip `mesh-ping` across a sparse room overlay with zero Gun writes to
`talks/*` or `peerTalkOffers/*`. Hardened `PeerMeshService`: bounded seen-set dedup, neighbor
re-pick on churn, `meshPingDiagnostics` for durable E2E assertions. Fixed origin attribution —
`onPing`/`onPong` now report `frame.originUserId` (the envelope's verified origin), not the
relay neighbor; msgId is stable across forward hops (dedup-safe, reused by P0 steps 2–4).
Design note: `docs/design/p0-step1-mesh-transport.md`.

Evidence:

- E2E: `tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts` (includes K=1 path-graph sparse forwarding + relay-side Gun emptiness assertion)
- Unit: `src/test/unit/peer-mesh-service.test.ts` (origin/msgId stability across relay hop)

## 2026-06-09 - P0 Step 2: Mesh Broadcast Announcements

Find-similar room broadcasts now travel as `talk-announce` + `talk-body` floods over the mesh
DataChannel overlay (primary path, zero delivery Gun writes). `publishRoomTalkBodyRendezvous`
(`p2pMeshTalkBodies/*`) remains only as a conditional fallback when the overlay cannot guarantee
coverage: below wanted degree, or named recipients exceed the degree bound K (sparse overlay may
be partitioned). Author-qualified identity (`talkId::authorId`) is preserved end-to-end —
content-addressed talkId collisions across authors no longer clobber cached bodies, the author's
own `talks/<id>` definition, or response routing. Contacts view no longer leaks self.
Interim fallback + author-side `talks/*` creation write tracked as step-6/7 debt
(`docs/design/p0-step1-mesh-transport.md` R-a/R-f).

Evidence:

- E2E: `tests/e2e/talks-matching/02-mesh-broadcast-announce.spec.ts` (3 browsers, K=1 relay hop, strict `peerTalkOffers/*` + `p2pMeshTalkBodies/*` emptiness)
- E2E: full suite green — 101 passed, 0 failed, 0 flaky (incl. stage2/08-super-user-copy-talk, stage5/find-similar-people 9/9 contacts)
- Unit: `src/test/unit/peer-mesh-service.test.ts` (announce guards, relay-hop flood, fallback decision, author-collision cache, coverage-gap condition)

## 2026-06-10 - P0 Step 3: Receiver-Side Intake Filtering

Intake decisions (language, distance, content/dirty-word, adult age-gate, expiry cutoff) are now
applied on the RECEIVER at the single mesh choke point, via the shared
`intakeFilterRejectReasons` (`src/shared/talk-intake-filters.ts`) extended with `expiresAt` and
a synchronous `ReceiverIntakeContext` (`ageVerified` resolved async by the caller, only for
adult-flagged talks). Rejected bodies are not cached/delivered and remain eligible for
re-delivery after the user relaxes filters (`onTalkBody` returns false). The server's star-path
`filterReasonsForTalk` is unchanged (deleted wholesale in step 7).

Evidence:

- E2E: full suite green in mesh mode incl. distance (stage3/00n), content (stage3/00o), and adult/language/cutoff intake specs with receiver-side filtering
- Unit: `src/test/unit/intake-filter-reasons.test.ts` (expiry, age-gate, per-dimension accept/reject), `src/test/unit/peer-mesh-service.test.ts` (mesh choke point honors rejection)

## 2026-06-10 - P0 Steps 4-6: Mesh Responses/Matches, Local-Only Contacts, Encrypted Mailbox

Step 4: talk responses unicast over mesh; both sides run shared `checkIfMatch` and create the
conversation locally with deterministic ids (idempotent, no ack frame, no server response
endpoints, no pair Gun subscriptions). `responseId = CIDv1`, `version`, `respondedAt` shipped
for steps 8-11. Step 5: contacts/peer-detail/match-%/replies/history derive from local stores
only (`local-peer-derivation.ts`); zero client calls to `/peers`, `/relationship`,
`/talk-history`, `/replies`. Step 6: hub-side encrypted TTL mailbox (ciphertext-only envelopes,
SEA ECDH, drain-then-delete on boot/roster change) replaces the step-4 interim localStorage
queue for offline recipients.

Evidence:

- E2E: `03-mesh-response-match.spec.ts`, `04-local-contacts.spec.ts`, `05-mailbox-offline-response.spec.ts`; full suite green locally
- Integration: `src/test/integration/mailbox-routes.test.ts` (25)
- Unit: `mesh-response-step4.test.ts` (18), `local-peer-derivation.test.ts` (40)

## 2026-06-10 - P0 Step 8: Sender-Side Ledger State

Unified local `talkLedger` (outcomes / exchanged / edges / retracted) with pure ordering module
`src/shared/talk-ledger.ts` (version-then-timestamp, retraction-wins, per-identity
`shouldSuppress`, `applyEdgeGate` mirroring the server day/week quotas). Author records each
responder's outcome with version + respondedAt; broadcast recipient selection skips
already-answered identities and enforces the local-outbound edge quota. Steps 9-11 fields
scaffolded (no migration needed). Design: `docs/design/p0-steps8-11-ledger.md`.

Evidence:

- E2E: `06-sender-suppression.spec.ts`; full suite green locally
- Unit: `src/test/unit/talk-ledger.test.ts` (49)

## 2026-06-12 - P0 Step 7: Star Talk Delivery Removed

Deleted the server-authoritative talk delivery path and its derived peer state. Talk bodies,
announcements, responses, matches, conversations, incoming indexes, and talk-derived contact data
now remain client-owned and travel over the mesh, with the server limited to rendezvous/presence,
signaling, STUN/TURN configuration, and ciphertext-only TTL mailbox fallback. Mesh delivery is the
default; the old direct/star feature flags and endpoint forks are gone.

Evidence:

- Integration: `src/test/integration/star-endpoints-removed.test.ts`
- Integration: `src/test/integration/mailbox-routes.test.ts`
- E2E: `tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts` through `05-mailbox-offline-response.spec.ts`

## 2026-06-12 - P0 Steps 9-11: Change of Mind, Retraction, Exchange Suppression

Completed the local ledger lifecycle. Responses use content-derived IDs, monotonic versions, and
timestamps; newer answer changes propagate to every original sender while stale updates are
rejected. Hard retraction gossips a tombstone, ends matching conversations, and prevents in-flight
or later answers from resurrecting them. Symmetric per-peer identity records suppress unchanged
tags already exchanged across a pair while allowing changed content through once.

Evidence:

- E2E: `tests/e2e/talks-matching/07-change-of-mind.spec.ts`
- E2E: `tests/e2e/talks-matching/08-retraction.spec.ts`
- E2E: `tests/e2e/talks-matching/09-exchange-suppression.spec.ts`
- Unit: `src/test/unit/talk-ledger.test.ts`

## 2026-06-12 - P0 Full-Suite Gate and Parallel Reliability Closeout

Hardened presence-key readiness, made unchanged-room mesh joins idempotent, bounded mailbox key
resolution concurrency, decoupled best-effort mailbox posting from live-send acknowledgement, and
stabilized high-load E2E broadcast/incoming-row helpers. The 10-user x 20-tag scenario now uses
known fixture recipients and an online mesh-flood mode so it tests matching/ranking throughput
without duplicating the dedicated ACK, suppression, quota, and offline-mailbox suites.

Verification:

- `npm run test:type`
- Focused Jest: 151 passed across ledger, mesh, mailbox, and removed-star endpoint suites
- Focused E2E: previously flaky broadcast paths pass with `--retries=0`
- Exact release gate: `PW_WORKERS=20 npm run test:e2e:parallel` - 102 passed, 2 skipped, 0 failed, 0 flaky (4.4 minutes)

## 2026-06-15 — Test determinism cleanup, dead code removal, T2/T4/T5 completion

### T2 — Distance sort UI wiring (spec §22.7) — DONE 2026-06-14

Full implementation of the `distance` sort strategy across both core logic and UI:
- **Core (DONE 2026-06-13):** `rankPeople` `distance` branch sorts by `blurredDistanceMiles` (snaps both coords to the privacy grid before Haversine — exact GPS never exposed); unknown-distance candidates sort last.
- **UI step (a) DONE 2026-06-14:** `distanceMiles` added to `ContactsViewDeps`; `distance` branch wired in the sort switch in `ui-manager.ts` (3 call sites).
- **UI step (b) DONE 2026-06-14:** Real distance resolver wired — `setPeerLocationReader` calls Gun via `gunService.getGun()`, `prefetchPeerLocations` populates cache before render, `distanceMilesFromCache` converts GPS to miles. Fix: corrected `this.gunService.gun` → `this.gunService.getGun()` (private property access). 713 unit tests green, `tsc` clean.

### T3 — Deterministic fallback E2E — SUPERSEDED 2026-06-15

T3 aimed to E2E-prove the `ResilientConversationTransport` fallback chain (`direct-p2p → server-relay → star-gun`) by forcing WebRTC failure and asserting the message still arrives via relay or star. This goal is superseded by the architectural decision (2026-06-15) to **delete the fallback chain entirely**:

- `src/web/services/resilient-conversation-transport.ts` — deleted
- `src/web/services/server-relay-conversation-transport.ts` — deleted
- `src/test/unit/resilient-conversation-transport-fallback.test.ts` — deleted
- `tests/e2e/staged/stage2-two-user/00m-transport-fallback.spec.ts` — deleted

The transport is now `DirectP2PConversationTransport` only; `createConversationTransportDiagnostics` returns `{ availableModes: ['direct-p2p'], fallback: null }`. No fallback to test.

### T4 — Replace masking retries with real waits — DONE 2026-06-14/15

Pinned `test.describe.configure({ retries: 0 })` across two waves:
- **Safe set (2026-06-14):** `talks-matching/07-change-of-mind`, `talks-matching/08-retraction`, `stage1/00-ui-navigation-settings`, `stage2/00k-techsupport-contact-mute`, `stage3/00q-expiration-broadcast`.
- **F-class messaging specs (2026-06-15):** `09-messaging`, `00j-messaging-edge-cases`, `10-message-unread-badge`, `12-two-responders-partial-match` — these were deterministic once `DirectP2PConversationTransport` became the sole transport (no fallback timing races).

### T5 — Lower global retry budget — DONE 2026-06-15

`playwright.config.ts` `retries` dropped from `1` to `0`. Two specs remain at `retries: 1` via inline allowlist: `00-p2p-neighbor-memory` and `00-p2p-cross-platform-protocol` — pending G-fix (connectedNeighborCount gate); tracked in `docs/testing/retry-dependence-inventory.md`.

### P0 Phase verify — VERIFIED 2026-06-14

`npm run health` clean after each phase. Phase 3 proven in `dev:relay-only`. No regression in messaging E2E (`09-messaging`, `10-message-unread-badge`, `12-two-responders-partial-match`). Full suite: EXIT_CODE 0; 796 unit tests pass; 87+18 E2E specs pass.

### Dead code removed — 2026-06-15

- `previewReceiversOnServerForTalk` private method (~100 lines) deleted from `src/web/app/app.ts` — called a non-existent `POST /api/talks/broadcast-receiver-preview` endpoint; replaced with `const previews: BroadcastAudiencePreview[] = []` at both call sites. Removed three unused variables (`supportExcludedCount`, `broadcastTargetTags`, `broadcastMaxDistanceMiles`) that were only passed to the deleted call.
- `ResilientConversationTransport`, `ServerRelayConversationTransport`, and their test/E2E files deleted (see T3 above).
- `WebConversationService.gunMessageStore` (formerly `starTransport`) clarified: renamed field, added JSDoc — it is a local Gun write store for offline mailbox ingestion, not a transport.

**Verification:** `tsc` + eslint clean; integration test `star-endpoints-removed.test.ts` confirms all 7 old star endpoints return 404.

## 2026-06-16 — Promoted from active TODO

### S1 — Signaling server memory: background pruning `[Haiku]` — DONE

`pruneSignaling()` in `src/server/routes/system-routes.ts` was lazy — it ran only when a request hit the same `conversationId`, so envelopes from disconnected users could accumulate indefinitely for keys that never get another request.

Pieces shipped: `pruneSignalingMap(map, now)` extracted as a pure, exported helper; `startSignalingPruning(map)` registers `setInterval(() => pruneSignalingMap(map), 60_000)` so expired envelopes are swept every minute regardless of traffic (the per-request `pruneSignaling()` lazy path is retained as a fast-path). Unit test `src/test/unit/signaling-pruning.test.ts` populates stale envelopes, advances the clock past TTL, and asserts the interval callback drains `signalingByConversation` to zero.

**Verification:** `tsc`/eslint clean; `signaling-pruning.test.ts` green.

### Phase 5 — peer↔peer Gun reconciliation — Core DONE, browser CI pending

Core implementation complete and tested 2026-06-13; local browser CI green 2026-06-14. On DataChannel connect, each peer advertises a message-id digest for the conversation; the other backfills whatever's missing as ordinary `dm` frames (reuses the proven, deduped `ingestWireMessage` path). Both local Gun graphs converge directly — hub not in the data path even as a relay.

Pieces shipped: `src/shared/conversation-reconcile.ts` (pure `buildConversationDigest` / `computeMissingForPeer` / `selectNewBackfill` — 9 unit tests incl. a symmetric two-peer convergence + idempotence proof); `GunMessageStore.listLocalWires` (one-shot local-history read); `P2PConversationSession` `sync-digest` frame + `sendSyncDigest`/`handleSyncDigest` (strictly additive + guarded: no-op without the hooks, every handler try/caught so reconciliation can never disturb DM delivery); `DirectP2PConversationTransport` provides the hooks.

Follow-ups verified DONE 2026-06-14: (a) re-digest on reconnect — already fires via `onclose`/`onerror` → state `'failed'` → next `ensureConnected()` → `resetTransport()` → `start()` → new `attachDataChannel()` → `onopen` → `sendSyncDigest()`; no code change needed. (b) `listLocalWires` bounding — already applied: `gun-message-store.ts:186` has `limit: number = DEFAULT_RECONCILE_WINDOW` default and passes it to `boundRecentWires` at line 211; call sites omit the arg and get the 500-message cap by default.

**Remaining (browser-capable CI required):** live WebRTC digest→backfill round-trip E2E and Gun `.map().once()` enumeration in `listLocalWires` (browser-only APIs, cannot run in Jest).

**Verification:** `tsc`/eslint clean; 781 unit/integration green.

### T1 — Retry-dependence inventory — Static analysis DONE, live confirmation pending

Static analysis complete 2026-06-13 → `docs/testing/retry-dependence-inventory.md` (107 specs scanned; F/G/L/V fix classes). Real risk confirmed: WebRTC timing in messaging specs — addressed by T4 pin + T5 global drop.

**Remaining open:**
- G-fix (connectedNeighborCount gate) still open for two allowlisted specs (`00-p2p-neighbor-memory`, `00-p2p-cross-platform-protocol`) that remain at `retries: 1`.
- Live `--retries=0` full-suite confirmation still requires browser-capable CI: run `PW_WORKERS=4 npm run test:e2e -- --retries=0` to fill the "observed" column in the inventory.
# 2026-06-20 — GUI Polish G0–G6

Moved from `docs/TODO.md`: Settings/Me information architecture, talk-card taxonomy and rich incoming metadata, response-flow UX, conversation and peer-detail improvements, and survey visualization work. These sections were already marked complete in the active TODO; this move restores the TODO as an actionable backlog.

## P1 — Public Gun chatroom hierarchy bootstrap

Already implemented and now verified: server startup publishes the hierarchy at `public/chatroom-hierarchy`; relay-only persistence explicitly preserves this public path; the browser subscribes on boot and safely merges valid remote additions with the bundled fallback. Unit coverage verifies persistence policy and merge/runtime behavior.

Verification: `npm test -- --runInBand src/test/unit/community-ownership.test.ts src/test/unit/p2p-runtime.test.ts` — 41 tests passed.

## 2026-06-20 — P3 Location hints and P4 system announcements

P3 is complete: blurred location selects the most specific hierarchy room, publishes only the
privacy-safe affinity, suggests that room once with a join action, and subscribes to public
server-maintained member counts.

P4 is complete: signed TechSupport announcements are append-only public Gun records, authenticated
admin posts create them, and browsers render only verified, unexpired records as dismissible banners.
Public bootstrap records are preserved by the relay-only persistence policy.

Evidence:

- Location/UI: `src/shared/location.ts`, `src/web/app/app.ts`, `src/web/ui/ui-manager.ts`
- Announcements: `src/server/services/techsupport-announcement-service.ts`, `src/shared/system-announcements.ts`
- Tests: `src/test/unit/system-announcements.test.ts`, `src/test/unit/p2p-runtime.test.ts`

## 2026-07-06 — Canonical pair conversations and matched-talk manual continuation

Implemented the first durable slice of the conversation-inbox repair:

- `WebConversationService.createConversation()` now uses one canonical ordinary-pair id,
  `conv_pair_<sorted user ids>`, instead of creating a separate conversation per `talkId`.
- Conversation records carry related talk provenance as `relatedTalkIdsJson` (string-only for
  Gun compatibility), while browser-local state exposes `relatedTalkIds` for lifecycle checks.
- Peer-detail direct messages reuse the existing pair conversation by localStorage key instead of
  looking for a `conversationId` property inside the stored value.
- Talk retraction/withdrawal paths now match either the primary `talkId` or related talk ids, so a
  canonical pair thread can still be associated with the matched talk that created it.
- E2E coverage now proves:
  - a peer-detail direct message creates the same `conv_pair_...` id for both sender and receiver;
  - after a matched talk, a manual peer-detail message reuses that same pair conversation and is
    visible from the receiver's conversation view.

Verification:

`npm run test:type && E2E_PORT_OFFSET=400 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/00e-chatroom-peer-detail.spec.ts --grep "peer detail direct message|peer detail shows talk history"` — 2 passed.

## 2026-07-06 — Canonical pair message history survives reload

Closed the reload-history gap for ordinary pair conversations. The message store now:

- mirrors direct-P2P encrypted wires into the legacy conversation message root as a reload-friendly
  index while keeping the canonical `pairConversations/<pairId>/...` path;
- retries collections when Gun reports a message id before the full node is readable;
- prevents older async collection batches from overwriting the UI with a shorter append-only history;
- falls back from a missing pair node to the legacy conversation root with a bounded read timeout;
- writes mailbox-drained DMs under the sender/receiver pair instead of a self-pair.

The E2E readiness helper now waits for `IinPublicApp.initialized === true`, so tests cannot open a
conversation overlay before the post-reload `loadConversation` handler is bound.

Verification:

`npm run test:type && E2E_PORT_OFFSET=417 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/31-messaging-history-order.spec.ts` — 1 passed.

## 2026-07-06 — Conversation history depth and unsupported edit/delete state

Extended `31-messaging-history-order.spec.ts` beyond delivery ordering and reload recovery:

- After the real Gun-backed 12-message ordered exchange, the test renders a 54-row conversation
  snapshot on both participants to cover the current non-paginated large-history scroll surface
  (>50 messages).
- The spec asserts the top and bottom of the conversation remain reachable.
- The spec pins the current product state for message editing/deletion: the conversation overlay
  exposes only Back and Send controls, and message rows expose no edit/delete buttons.
- The companion `.md` was updated to remove the stale reload-known-issue note.

Verification:

`npm run test:type && E2E_PORT_OFFSET=433 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/31-messaging-history-order.spec.ts` — 1 passed.

## 2026-07-06 — Hard-crash reconnect can continue the canonical pair conversation

Extended `37-hard-crash-recovery.spec.ts` so the recovered user B not only receives A's two
offline mailbox messages after SIGKILL/relaunch, but also sends a new reply back to A through the
same canonical `conv_pair_...` conversation.

This found and fixed a real reconnect bug: mailbox envelopes include the sender's epub as a
ciphertext-wrapper hint, and B could use that hint to decrypt A's offline messages, but the app did
not cache it against `payload.senderId`. B therefore could not always resolve A's epub when
encrypting a reply after recovery. `drainMailboxOnce()` now caches that sender epub for
`conversation-message-v1` payloads before ingesting the DM.

Verification:

`npm run test:type && E2E_PORT_OFFSET=442 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/staged/stage2-two-user/37-hard-crash-recovery.spec.ts` — 1 passed.

## 2026-06-20 — P0 test determinism live gate

The full browser suite passed with `PW_WORKERS=4 npm run test:e2e -- --retries=0` (110 specs).
`playwright.config.ts` has a global zero-retry budget, and the two remaining historical inline
retry allowlist entries (`00-p2p-neighbor-memory` and `00-p2p-cross-platform-protocol`) were
removed after the same strict run.

## 2026-06-20 — T6–T8 answer, talk, and auto-send lifecycle

T6: Me renders one durable row per answered question and supports type/tag state, selected-answer,
outcome, answer-date, and chatbot-use filters/sorts, including reset-to-default.

T7: Talks retains IN and OUT history with composable type/status/query/outcome/date controls;
unanswered incoming talks sort ahead of answered retained history by default.

T8: chatbot-enabled room entry automatically sends only pending OUT talk revisions. Delivery state is
keyed by room, peer, and talk revision, so re-entry does not replay unchanged talks while a changed
revision is delivered once. Manual broadcast remains available.

Verification: focused browser E2E in
`tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts` proves filters/order and
initial delivery → no replay → changed revision delivery; `npx tsc --noEmit` clean.

## 2026-07-06 — Embedded hub hardening: explicit HTTP relay replaces generic Gun peer

Closed the S3 hub-hardening privacy risk for native embedded nodes:

- Embedded config now defaults to `hubRelayMode=explicit-http`.
- `resolveUpstreamHubPeers()` returns `[]` in explicit relay mode, so native
  embedded nodes no longer connect to the public hub as generic Gun peers.
- `EmbeddedHubRelayClient` provides the narrow upstream channel and rejects
  private/app graph classes such as `talks/*`, `conversations/*`,
  `pairConversations/*`, `pairTalkResponses/*`, `incomingTalksByUser/*`, and
  `ownerIncomingTalkIndex/*`.
- Chatroom membership routes mirror only room-membership metadata to the
  upstream hub and import hub membership snapshots back into the local node.
- `ChatroomManager` now maintains a fast in-process active-member index for
  API joins/touches/leaves, avoiding slow or empty parent-node Gun reads in
  `/api/chatrooms/:id/members`.
- A legacy `IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer` escape hatch remains for one
  migration window, but the default shipped/native topology is explicit HTTP.

Verification:

`npx jest src/test/unit/embedded-node-config.test.ts src/test/unit/embedded-node-hub-dial.test.ts src/test/unit/embedded-hub-relay-client.test.ts src/test/integration/chatroom-routes.test.ts --runInBand` — 31 passed.

`npm run test:type` — clean.

`npm run test:e2e:native-app` — 3 passed.

`node scripts/relay-only-verification/run.js` — passed: a `talks/*` write on
embedded node A was not observable from the hub or independent embedded node B.

## 2026-07-06 — Native explicit relay public identity coverage

Extended the native app relay topology so browser and embedded-node users can
resolve each other's public SEA identity through the explicit HTTP relay path:

- `POST /api/users` now uses a fast public-user upsert instead of waiting on a
  Gun ack that can hang in memory-only E2E mode.
- Server `UserService` keeps a same-process public-user cache so
  `GET /api/users/:id` can immediately return relay-visible public identity
  records after an upsert.
- Web startup and stage-name changes republish the current public user record
  with `pub`/`epub`, and update current-room membership metadata.
- Native E2E coverage now proves browser + Electron and Electron + Electron
  shared-hub membership by stable user id, plus browser/native public identity
  lookup through the explicit relay path.

Verification:

`npm run test:type` — clean.

`npx jest src/test/integration/system-routes.test.ts src/test/integration/chatroom-routes.test.ts src/test/unit/web-gun-service-hub-url.test.ts --runInBand` — 33 passed.

`npm run test:e2e:native-app` — 4 passed.

## 2026-07-07 — Explicit relay native direct-message receive proof

Closed the S3 explicit-relay direct-message smoke item. The browser + Electron
native-app E2E now creates the same canonical direct pair conversation on both
peers, connects the direct P2P DataChannel through explicit HTTP signaling, sends
a browser direct/manual conversation message, and asserts that the native app UI
receives and renders it.

This found and fixed two relay-topology bugs:

- Direct P2P subscription setup now passes the known `otherUserId` into session
  creation instead of requiring the local Gun conversation root to be readable
  first. This matters for embedded nodes because local Gun is device-local and
  relay metadata arrives over HTTP, not generic Gun replication.
- Embedded `/api/users/:id` now falls through to the upstream hub when a local
  Gun stub lacks `id`, `pub`, or `epub`, so a partial `users/<id>/conversations`
  node cannot mask the public identity record required for signaling.

Verification:

`npm run test:type` — clean.

`npx jest src/test/integration/user-routes.test.ts src/test/integration/system-routes.test.ts src/test/integration/chatroom-routes.test.ts src/test/unit/web-gun-service-hub-url.test.ts src/test/unit/direct-p2p-conversation-transport.test.ts --runInBand` — 39 passed.

`npm run test:e2e:native-app` — 4 passed.

## 2026-07-07 — LAN browser participant topology smoke

Closed the LAN browser participant smoke item. Added
`tests/e2e/topology/lan-browser-participant.spec.ts`, which launches two local
browser users and one LAN-hostname browser user against the same dev server/hub,
proves the LAN page derives and reaches the host API, verifies Global contains
TechSupport plus all three ordinary users, then sends a direct/manual
conversation message from the LAN user to a local browser user.

The deterministic CI default uses `iinpublic-lan.localhost` so Chromium keeps
the page on HTTP while the app still sees a non-`localhost` hostname and follows
the LAN dev-port mapping. The spec also accepts `E2E_LAN_HOST=<host-or-ip>` for
manual runs against a real LAN-reachable address.

This found and fixed two LAN-dev blockers:

- webpack-dev-server now allows LAN host headers in development, so
  `http://<dev-host>:3001` is not rejected before the SPA loads.
- non-production API and Socket.IO CORS now allow HTTP origins on dev/LAN
  hostnames, while production remains restricted to `https://iinpublic.com`.

Verification:

`npm run test:type` — clean.

`npm run build:server && E2E_PORT_OFFSET=520 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 npx playwright test tests/e2e/topology/lan-browser-participant.spec.ts` — 1 passed.

## 2026-07-07 — Production compatibility topology contract

Closed the production compatibility smoke item. Added a unit topology contract
that locks down the URL/port rules shared by production, LAN development, and
native loopback clients:

- `https://www.iinpublic.com` resolves browser API and Gun traffic to the same
  production origin.
- LAN development pages such as `http://192.168.10.48:3001` derive the matching
  hub/API port instead of falling back to localhost-only assumptions.
- Native embedded nodes still default to the production hub for explicit HTTP
  relay metadata, while generic upstream Gun peering remains disabled.
- Production CORS remains restricted to `https://iinpublic.com`; test/dev CORS
  admits local and LAN HTTP origins.
- Source-owned app paths are scanned so hard-coded loopback URLs stay limited
  to explicit native-loopback and dev-local code.

Verification:

`npm run test:type` — clean.

`npx jest src/test/unit/production-topology-contract.test.ts src/test/unit/web-gun-service-hub-url.test.ts src/test/unit/embedded-node-config.test.ts src/test/unit/embedded-node-hub-dial.test.ts --runInBand` — 43 passed.

## 2026-07-14 — E2E Coverage Gap Tests (all gaps closed)

Source: `docs/e2e-test-analysis.md` § Coverage Gaps. Every user-choosable option now has a test. **All items below verified green.**

### Stage 1 — single user
- `[haiku]` Search/filter inputs interactive: `answers-search-input` and `talks-filter-query` filter, clear-restore, no-match empty state tested.
- `[haiku]` Settings persistence across reload: every intake filter option survives page refresh. Found+fixed real bug: `renderSettingsView` clobbered saved localStorage filters with unloaded defaults. Language setting persists through all selectable languages + translated UI. Mobile chatroom hierarchy at 390×844 with no clipping.
- `[haiku]` Step 7 deletion server-side: removed `talk-delivery-routes` endpoints return 404; `/health` still OK.

### Stage 2 — two users
- `[sonnet]` Messages concurrent order: found+fixed real bugs — message sort had no tie-break, and `pairConversations` subscription branch was dead (thenable trap). Read state tested. History order with 12 alternating messages. Delete/edit feature does not exist — logged under Feature gaps.
- `[opus]` Mesh-only delivery without server: broadcast + answer + match verified pure mesh, no fallback requests. Contacts filter by name. Reply filter query tested against injected local reply data.
- `[opus]` Offline beyond mailbox TTL (Adam offline > TTL, talk announced, defined behavior on reconnect). Hard crash recovery via SIGKILL then relaunch with same storage — Gun replication recovers.
- `[sonnet]` Mobile multi-user: TechSupport broadcasts, Adam on 390×844 completes answer dialog for each type; DM exchange at narrow width verified usable.
- `[haiku]` Blocklist persist across full restart. Found+fixed 2 real bugs: API-path block never persisted private `blockedUserIds`, and unserialized private-data read-modify-write lost concurrent updates.
- `[opus]` Stats aggregation per-type (flow/tag/survey/route) with distinct outcomes matching engine counts.

### Stage 3 — three users
- `[sonnet]` Conversation list sorting: hub + 2 spokes, Contacts-tab recency sort. Found+fixed real bug: opening Contacts before user record loads rendered permanent "Could not load contacts."

### Feature gaps found
- Message edit/delete: no feature exists anywhere in src/web. Skipped.

### Follow-ups discovered
- Post-reload DM history resync: `subscribeToMessages` rendered zero messages for >10s after reload in sandbox. Needs isolation on fast host. Read-cursor persistence covered by spec 30.
- 15a/15b blocking regression specs + 09-messaging exceed sandbox's 45s run window; re-run on host after changes.


## 2026-07-15 — A–F + H closed; 19 host-run E2E failures + jest failure fixed

### Sections closed (moved from TODO.md)

**A. Shared AppBar + responsive overflow (redesign §1–§3, §6)** — `src/web/ui/app-bar.ts`
(`renderAppBar` + collapse logic, unit-tested in `src/test/unit/app-bar.test.ts`); the live
`#top-header` AppBar in `ui-manager.ts` with `data-appbar-view` scoping +
`syncAppBarOverflow` priority overflow (➕ → 📣 → 🏠 → 🆕); Chatrooms/Contacts/Talks/Me/
Settings all migrated; filter bars collapse behind "Filters ▾" below 768px;
`.tab-action-bar` styles removed. Specs 50–53 + updates to `00-ui-navigation-settings`
and `stage5/13`.

**B. Notification auto-dismiss (redesign §4)** — every toast auto-dismisses (Match! 8s,
others 3s), `data-match-notification` kept, Match! click navigates to its conversation
(N6), all toasts click-to-dismiss. Spec 54.

**C. Conversation-first entry + matched-talk threads (redesign §5, §7 N2a)** —
`openUserConversationFirst` two-level push (member/contact click → DM Conversation with
User layout underneath; back pops Conv → User → opener); matched-talk thread list +
per-talk Thread pages (`showConversationDetail(conversationId, threadTalkId)`),
per-thread unread badges/read cursors. Specs 68/69 + stage3/71. The planned
`stage2/62-peer-messaging-merged` update was superseded (spec never existed; coverage
lives in 60/61/69).

**D. Unified peer/contact detail (redesign §5)** — one shared ⟨User⟩ layout renderer for
both entry points; 📤 inline in the bar, 🚫 under ⋯; old contact-detail page retired
(`showContactDetail` delegates). Specs 60/61 + 00e selector updates.

**E. Popup responsive behavior (redesign §8)** — `.modal-content.size-{s,m,l,xl}` +
`.modal-fullscreen`; spec 59 width-matrix sweep (en+zh).

**F. Option-matrix specs (catalog Part 5)** — all 16 specs landed; 8 needed fixes after
the first live host run (below).

**H. Message content filters (redesign §9)** — user-editable dirty-word list
(SEA-private `dirtyWords` on `TalkIntakeFilters`), shared
`src/shared/message-content-filter.ts` helpers wired into all three composers (send
block) and the receive/display path (hidden-by-filters placeholder + reveal);
grammar filter page. Specs stage1/70, stage2/70, stage2/71. Stage3 intake regression
confirmed green in the 2026-07-15 host `test:all` run.

### 2026-07-15 host `test:all` — 19 E2E failures + 1 jest failure, all fixed

Jest: `services.test.ts` talk-filters expectation updated for the new `dirtyWords`
defaults (product behavior from H, test was stale).

Product bugs fixed:
- **Stale/wrong `#peer-detail-name`** (00j, 21a, 21b, stage3/14): the shared User layout
  rendered the opener-provided name (possibly a `User<id>` placeholder captured before
  profile sync) and never healed. `openPeerDetailView` now resolves the live stage name
  via a new `resolvePeerStageName` dep and patches the header; nickname display aligned
  with the Contacts convention (`nickname (stage name)` instead of nickname-only).
- **Missing `data-testid="create-talk-btn"`** on the AppBar ➕ (59 at 320px).
- **Sync-before-erase progress dialog never opened** without the transfer hook (72):
  removed the early-return so the local default progress runs; also wired
  `setDeviceHandoffSync` in app.ts to build + stage the handoff archive from local
  sources with per-category progress (P2P transfer remains X7).

Spec fixes (assert intent, not stale UX):
- 50: count *visible* AppBars (the hidden User-layout overlay keeps an `.app-bar` node).
- 55: don't await `handleCreateCustomChatroomClick` from `page.evaluate` (its promise
  resolves only when the dialog closes → guaranteed timeout).
- 58: hidden-row assertion via `useInnerText` + item visibility (Playwright
  `toContainText` reads textContent, which includes display:none rows).
- 60: hierarchy toggle is state-aware (Global starts expanded; first click collapses).
- 67 (talk editor): tag type has no question editor — expect `#tag-like-group`.
- 34/64/65: open the "Filters ▾" disclosure at <768px; close the conversation overlay
  the fast-DM helper leaves open before using the bottom nav.
- 63/00e/67 (peer history): N2a auto-opens the DM conversation — dismiss it (and
  suppress toasts) before clicking User-layout AppBar controls.
- 66: no second Global click after already entering the room.
- stage3/70: seed `localTalkExchanges` directly (the replies panel is local pair-edge
  derived; the server-snapshot path feeds `talkResponsesMap`, which it no longer reads —
  same reason 00v/00ad are excluded from the default shard).

Verification (sandbox): `npm run test:type` clean · `npm run lint` clean · jest 72/72
suites, 903 passed · all touched specs enumerate under `playwright test --list`.
Host re-run pending (tracked in TODO.md).

## 2026-07-15 (round 2) — remaining 8 E2E failures fixed

Host `test:all` re-run after round 1: phase0 fully green (type/lint/jest), 154 passed,
11 of 19 previous failures fixed, 8 remained. All 8 fixed:

Product bugs:
- **Public-profile parity class missing in the shared User layout** (21a, 21b): the old
  contact-detail page rendered `.contact-public-profile-summary`; the User layout's
  profile card only carried `.peer-stat-card`. Added the parity class to the card
  (`renderProfileHtml` in `user-detail-view.ts`) — same block already carried
  `.contact-profile-languages` (stage3/14 relies on it).
- **Contacts filter/sort re-render race** (64): `displayContactsList` re-armed its
  control listeners with `{ once: true }` per render and unconditionally restored the
  saved tab state — a change event firing while a render was in flight was dropped and
  the finishing render reverted the select to the stale saved value. Fixed with a
  monotonic render token (later render wins), persistent bind-once listeners, and
  restore-saved-state only while a control still shows its markup default.

Spec fixes:
- 55: rename dialog selector — the input's id is `rename-custom-room-name`; use the
  `rename-custom-room-input` testid.
- 67: tag talks hide the options groups by design (minimal editor) — drive the
  send-to-chatroom/adult checkboxes on a flow talk.
- 00j: close the User layout (`#back-from-peer-detail`) before clicking the bottom nav
  (the overlay covers it).
- 63: the Send-My-Talks picker only opens in MANUAL mode — uncheck
  `#peer-auto-mode-checkbox` first (auto mode sends directly, per 00e test 5).
- 66: 180s budget (two boots + broadcast + 90s cluster-delivery wait exceed the 120s
  default under the 20-worker light shard).

Verification (sandbox): `tsc` clean · eslint clean · jest 72/72 suites, 903 passed ·
all six touched specs enumerate under `playwright test --list`. Host light-shard
re-run pending.

## 2026-07-16 (round 3) — last 2 E2E failures fixed

Host `test:all` after round 2: 160 passed, 2 remained.

- **55 (create + rename room)** — real server bug: `ChatroomManager.getAllChatrooms`
  read the `chatroomMeta` root node once; Gun returns children of a root `.once` as
  link stubs (`{'#': soul}`), so every room's `name` degraded to its id (`meta?.name
  || id`). The room list, status bar, and rename flow all displayed CIDs instead of
  names, and the renamed name never appeared. Fixed by hydrating each child with a
  per-id read whenever the entry looks like a stub or lacks a `name`.
- **21b (peer star rating)** — after saving the relationship rating the User layout
  still covered the bottom nav; the spec now closes it (`#back-from-peer-detail`)
  before re-opening Contacts (same pattern as the 00j round-2 fix; 21a is unaffected
  because its follow-up steps are API polls, not nav clicks).

Verification (sandbox): `tsc` clean · eslint clean · jest 72/72 suites (903 passed) ·
both specs enumerate under `playwright test --list`. Host light-shard re-run pending
to confirm 0 failed.

## 2026-07-16 (round 4) — spec 55 root cause: server room-metadata reads

Host run: 161 passed, 1 failed (55 — rename never appeared; room names now rendered
correctly after round 3's hydration fix, so the remaining failure was the rename
itself).

Reproduced outside Playwright with a plain HTTP sequence against a fresh
`E2E_GUN_MEMORY_ONLY=1` server: `POST /api/chatrooms` → 201 in 5ms, then
`PATCH /api/chatrooms/:id` → **400 after 18.8s**. `updateChatroom → getChatroom →
getPathWithRetry(['chatroomMeta', id], 6, 150)` timed out on all six attempts —
Gun `.once` reads of `chatroomMeta/<id>` can hang on the ephemeral in-memory hub
even for data the same process just wrote — so the rename died with "chatroom not
found" long after the spec's 10s assertion window.

Fix (matches the existing server invariant that in-process state is authoritative
and Gun paths are mirrors — incomingTalksMap, fastActiveMembers):
- `ChatroomManager.roomMetaCache` — in-process Map, written on create/update,
  cleared (with Gun tombstones) in `resetForTesting`.
- `getChatroom` reads the cache first; Gun remains the restart fallback (cache is
  hydrated on successful Gun reads).
- `getAllChatrooms` merges the Gun mirror scan (with round 3's stub hydration,
  now needed only for rooms not in the cache) and the cache, cache wins.
- `getChatroom` visit-count reads parallelized (two sequential 3s Gun timeouts
  → one).

Repro after fix: create → rename → list round-trips in ~3s with the renamed name
in both the PATCH response and the list.

Verification (sandbox): `tsc` clean · eslint clean · jest 72/72 suites (903
passed) · HTTP repro green. Host light-shard re-run pending to confirm 0 failed.

## 2026-07-19 — TODO archival: G/I/J shipped items + host re-run rounds

Moved from `docs/TODO.md`. Open remainders ([~] scaffolds, X3–X8 wiring, host
light-shard confirmation run) stay in TODO.

### Host E2E re-run rounds 1–4 (checklist archived; details in the 2026-07-15/16 sections above)

- Round 1 (2026-07-15): jest green, 11 of 19 E2E failures fixed; 8 remained.
- Round 2 (2026-07-15): all 8 fixed — profile-card parity class + contacts
  re-render race (product), 6 spec corrections.
- Round 3 (2026-07-16): 160 passed, 2 remained (55, 21b) — `getAllChatrooms`
  Gun link-stub hydration (product) + 21b nav-order spec fix.
- Round 4 (2026-07-16): 161 passed, 1 remained (55) — authoritative
  `roomMetaCache` on the server (see round-4 section above).

### G. Platform × screen-size × cross-platform (shipped subset)

- Platform smoke set as a tagged Playwright project — `@smoke` in
  `tests/e2e/platform-smoke/` (tab sweep, ⋯ overflow, full-screen dialog
  takeover, settings persistence).
- Device-profile projects `iphone-webkit` (390×844) / `android-chromium`
  (360×800), opt-in via `E2E_DEVICE_PROFILES=1`; real-device manual pass
  documented in `tests/e2e/cross-platform/README.md`.
- Screen-size sweep — spec 59 sweeps 320/390/768/1024.
- `tests/e2e/cross-platform/` harness (two clients on shared hub) + README +
  `test:e2e:cross-platform` script; excluded from the light shard (HEAVY pattern).
- **X1** website + webapp simultaneous presence/headcount (P0, merge gate).
- **X2** cross-platform talk lifecycle both directions + thread replies (P0, merge gate).

### I. Multi-device identity linking (shipped subset)

- Link protocol in `src/shared/identity-linking.ts` — pairing payload (pub +
  one-time secret + ~5 min expiry), mutual signed attestations, signed
  revocation; 12 unit tests (pluggable `LinkCrypto`).
- Linked-devices Settings page — `src/web/ui/linked-devices-dialog.ts` +
  Settings row (list, Link a device code+QR, Enter link code, Unlink confirm).
- `stage1/71-linked-devices-page.spec.ts` — page open/close, empty state, code
  lifecycle incl. expiry, error paths (T10).

### J. Public-device exit — sync-then-erase (shipped subset)

- Wipe engine `src/web/services/device-wipe.ts` — localStorage (SEA custody) +
  IndexedDB/Gun radata + caches + session state, best-effort link revocations,
  reload to fresh boot.
- "Erase this device" Settings row + type-`ERASE` confirm dialog
  (`src/web/ui/erase-device-dialog.ts`); disabled while sync in flight.
- Encrypted handoff archive — schema + build/merge in
  `src/shared/device-handoff.ts` (7 unit tests) + Sync-progress dialog;
  `setDeviceHandoffSync` wired in app.ts (per-category progress, staged
  archive). Encrypt-to-pub P2P transfer remains X7.
- Archive import per-category merge — `mergeHandoffArchive` (unit-tested);
  import UI ships with the X7 transfer.
- `stage1/72-erase-this-device.spec.ts` — typed-confirm gate, cancel intact,
  wipe verified, fresh identity, no prior data reachable.
- `stage2/72-sync-before-erase.spec.ts` — sync offer → progress → done enables
  erase; erase gated by typed confirm.

## 2026-07-20 — Cross-browser E2E: WebKit green; e2e https bug found and fixed

- Added desktop `webkit` (Desktop Safari engine) + `firefox` Playwright projects
  running the `@smoke` platform-smoke set. Opt-in `E2E_CROSS_BROWSER=1`; scripts
  `test:e2e:webkit` / `test:e2e:cross-browser`; opt-in `test:all` phase (port
  band 500, force-disabled for all other phases so the flag can't leak into the
  light shard). Non-Chromium projects (incl. the existing `iphone-webkit`) no
  longer inherit the Chromium-only launch args.
- **Real bug surfaced by the first WebKit run:** with `certs/dev-*.pem` present,
  webpack-dev-server auto-served self-signed **https** on 3001 while every e2e
  helper targets `http://127.0.0.1` — WebKit failed `page.goto` with "The network
  connection was lost". This silently threatened every non-static e2e script on
  any machine with a dev cert (test:all dodges it via `E2E_STATIC_WEB=1` http).
  Fix: `webpack.config.js` never enables TLS when `DISABLE_HMR=true` (e2e mode);
  LAN https dev is unchanged. This was also the answer to "works in Chrome, not
  Safari": Safari rejects the self-signed cert with no bypass.
- **Verified on host 2026-07-20:** `npm run test:e2e:webkit` → 1 passed (15.4s);
  `npm run test:e2e:cross-browser` → 2 passed, webkit + firefox (32.0s).
  (Playwright's browser-install extract step repeatedly hung on this machine;
  workaround: wait it out, or manual curl -fL + unzip + touch
  INSTALLATION_COMPLETE.)
- **test:all phase default:** AUTO — runs when both webkit+firefox binaries are
  installed, skips with a notice otherwise; `E2E_CROSS_BROWSER=1/0` forces.

## 2026-07-19/20 — test:all speed: prefix overlap + webpack filesystem cache

- `scripts/run-test-all.sh`: type-check/lint/jest no longer gate the e2e waves —
  only the two builds do; the checks overlap the waves (jest capped at
  `--maxWorkers=50%`) and are collected before the summary. Rollback:
  `TEST_ALL_PREFIX_OVERLAP=0`. Port preflight now also covers the heavy-staged
  band (400) and the opt-in cross-browser band (500).
- `webpack.config.js`: persistent filesystem cache keyed on every bundle-baked
  env var (`BUNDLED_ENV_KEYS`) + config file. Sandbox-measured: warm dev rebuild
  604ms vs ~5.8s cold (1527 modules cached). Rollback: delete
  `node_modules/.cache/webpack`. **Maintenance invariant:** any new env var read
  by DefinePlugin/EnvironmentPlugin must be added to `BUNDLED_ENV_KEYS`.
- Host timing verification still pending (tracked in TODO).

## 2026-07-25 — K1: TechSupport built-in identity + relay-light presence

Moved from `docs/TODO.md` K1. Design note (implementation guide, landing order, risks):
`docs/design/techsupport-k1-design-note.md`. Contract doc amended:
`docs/design/techsupport-bootstrap-contract.md`.

- **Unified graph builder** — `src/shared/techsupport-graph.ts` (`techSupportBaselineGraph`,
  `techSupportGlobalMemberFields`/`Row`) is the single authored source for the TechSupport baseline
  graph. `tests/e2e/helpers/clear-database.ts` imports it directly (TS); the plain-Node
  `scripts/dev-techsupport-bootstrap.js` requires the compiled `dist/server/shared` output,
  auto-building via `npm run build:server` on first use if missing. Removes ~150 lines of
  duplicated, drifting graph-construction code.
- **Relay boot/reset seed** — `ChatroomManager.seedTechSupportGlobalMembership()` writes exactly
  one Global member row (`chatrooms/global/users/<id>` + `chatroomMembers/global/<id>`, fresh
  `lastSeen` every call) and nothing else — no full user record, reputation, or filters ("bytes,
  not a database"). Called from `IinPublicServer.publishPublicBootstrap()` on boot and after every
  E2E reset, right after the signed identity republish.
- **Eviction-immunity gap found and fixed while implementing:** TechSupport's "never evicted"
  guarantee (K1-3) was only enforced in the Gun-persisted staleness path
  (`pruneStaleRoomMemberships`). The separate in-memory fast-path map
  (`ChatroomManager.getFastActiveMembers`) had its own independent TTL check with no such guard —
  a TechSupport device that seeded once and never heartbeat again would have silently aged out.
  Fixed by adding the same `isTechSupportId` skip there; covered by a unit test that backdates the
  fast-path `lastSeen` past the TTL and asserts TechSupport survives.
- **Client-side floor** — `src/shared/techsupport.ts` exports `techSupportRosterMember()`
  (userId/stageName from compiled constants). `WebChatroomService.rosterWithTechSupportFloor()`
  injects it into the Global roster only when no real `TECHSUPPORT_ROOT_USER_ID` entry is already
  present (both `subscribeToMembers` emit paths — the "reopen same room" fast path and the
  debounced live path). `getMemberCount()` and `subscribeToMemberCount()`'s `emitCount()` apply the
  same +1 floor. Dedup is by canonical id, so the relay seed and the client floor never
  double-count (headcount is always exactly 2 for one ordinary user + TechSupport, never 3).
- **Online/away indicator** — `UIManager.setTechSupportOnlineStatus()`/`isTechSupportOnline()`,
  wired from real `P2PPresenceClient.fetchNearby()` results in `app.ts`'s
  `initP2PPresenceAndBridge()` and `refreshConversationPresence()` (no separate poll loop — reuses
  the existing presence-refresh calls). Renders as a `.techsupport-presence-indicator` dot
  (`online`/`away` class + `data-techsupport-online` attribute) on both the Contacts support row
  and the Global roster row. Defaults to away; never confused with headcount (K1-2).
- **Deleted the browser root-minting write path** — `bootstrapTechSupportRootIfMissing()` and the
  browser-side `seedTechSupportGlobalMembership()` (`app.ts`), plus the now-dead
  `WebUserService.hasTechSupportRoot()` (no remaining callers). Browsers only render TechSupport
  locally now; `createTechSupportRoot()` stays for the unrelated dev stage-zero TechSupport-login
  path (K3's concern).
- **New unit tests:** `src/test/unit/chatroom-manager.test.ts` (+4: seed writes/publishes,
  eviction immunity on the fast path, headcount exactly 2 alongside a real join, re-seed refreshes
  `lastSeen`); `src/test/unit/web-chatroom-techsupport-floor.test.ts` (+4: roster floor dedup
  logic, pure/sync).
- **New E2E specs:**
  `tests/e2e/staged/stage0-bootstrap/000-relay-only-techsupport-presence.spec.ts` (fresh relay, no
  browser: identity + one member row present, no support DB — reads the member row through the
  real `/api/chatrooms/global/members` endpoint rather than the raw `export-snapshot` graph dump,
  since Gun's chain-based `.get().get()...put()` writes — same mechanism ordinary `addMemberFast`
  joins use — don't reliably surface as a literal joined-path soul in a shallow `_.graph` copy the
  way pre-built import-snapshot graphs do; the real read API is what every actual client uses, so
  it is the correct thing to assert against) and
  `tests/e2e/staged/stage1-single-user/02-techsupport-away-headcount.spec.ts` (headcount 2, contact
  + roster row listed, away indicator settled and never "online," with no TechSupport device
  process ever started). Both pass locally against the staged pipeline
  (`E2E_STAGE_PIPELINE=1 PW_WORKERS=1`); confirmed `baa-techsupport-single-user-tabs.spec.ts` and
  `caa-techsupport-four-talk-types.spec.ts` fail identically on the pre-K1 baseline (verified via
  `git stash`), i.e. pre-existing, unrelated flakiness, not a regression.
- **Full suite green:** 912/912 unit tests pass; `npm run build:server` / `build:web` both clean;
  full-project `tsc --noEmit` and `npm run lint` both clean.

## 2026-07-25 — K2: signed greeting without server storage

Moved from `docs/TODO.md` K2. Design note: `docs/design/techsupport-k2-design-note.md`. Contract
doc amended: `docs/design/techsupport-bootstrap-contract.md`. Builds on K1 (same day).

- **Signed-greeting module** — `src/shared/techsupport-greeting.ts` (`signGreeting`/
  `verifyTechSupportGreeting`/`renderGreeting`, mirroring `system-announcements.ts`'s sign/verify
  convention). The payload signed is the generic per-locale template **with the literal `{name}`
  placeholder still in it** — personalization happens client-side, only after signature
  verification succeeds, so nothing per-user is ever signed or transmitted.
- **Committed signed artifact** — `src/shared/techsupport-greeting.signed.json` (EN + 中文), produced
  by the one-off `scripts/sign-techsupport-greeting.js` (`npm run sign:techsupport-greeting`; reads
  `TECHSUPPORT_SEA_PAIR_JSON`, asserts the pair matches `currentTechSupportDmPub()` before signing,
  auto-builds `dist/server/shared` if missing so the script and the client verifier can never sign
  against a payload shape the other disagrees with).
- **Client render + persist** — `IinPublicApp.ensureSupportBootstrapForCurrentUser()` (`app.ts`) now
  verifies the compiled bundle against `TECHSUPPORT_DM_TRUST_ANCHORS` before rendering; on failure it
  returns with **no greeting at all** (K2-3: silent suppression, no toast, no fabricated message).
  On success it persists the rendered text as a real message via the new
  `WebConversationService.upsertMessageRecord` → `GunMessageStore.putMessageRecord` local-only write
  (never `sendMessage`'s peer-notify path) at the existing deterministic soul
  `support_welcome_<userId>`, with three new `ConversationMessageWire` fields
  (`greetingLocale`/`greetingSignature`/`greetingAuthorPub`) carried through for later re-verification.
- **Deleted the old compose path** — the `supportState` localStorage gate, the fabricated English
  string, and the network `sendMessage(...)` greeting send are gone. The contact-record writes stay
  (unconditional on verification — K6: the support channel is a stuck user's only recourse).
  `formatSupportWelcome`/`formatConversationMessage` (the old regex-based re-localizer) are deleted;
  `ui-translations.ts`'s duplicate `supportWelcome` EN/ZH strings are deleted in favor of the single
  compiled `TECHSUPPORT_GREETING_TEMPLATES` source of truth.
- **Render-time re-verification (new defense, not just write-time)** —
  `UIManager.filterVerifiedSupportMessages()` re-derives the template from the compiled constant
  (never trusts a stored template string) and additionally confirms the stored `text` is exactly
  what the verified template renders to *for the current user* — this is what catches a stored
  record whose `text` was altered after signing while `greetingSignature`/`greetingLocale` were left
  untouched, a gap a signature-only check would miss. `displayConversationMessages` became `async`
  to accommodate the one-message crypto check; the conversation-list preview formatter is now a
  pass-through (no more dynamic re-localization — the stored text is already in its write-time locale).
- **E2E integrity guard reworked** — `tests/e2e/helpers/techsupport-baseline.ts` gained
  `signedGreetingProblem()`: a stage snapshot may legitimately contain **zero** greeting souls
  (client-authored, not server-stored) — presence is never required, but any greeting that *is*
  present must verify. Wired into `assertStageSnapshotIntegrity` (now `async`).
- **New unit tests:** `src/test/unit/techsupport-greeting.test.ts` (11: sign/verify round-trip,
  committed-bundle verification, tamper/mismatch/untrusted-key/malformed-input rejection);
  `src/test/unit/techsupport-baseline.test.ts` (+5 for `signedGreetingProblem`).
- **New E2E specs:** `tests/e2e/staged/stage1-single-user/03-support-greeting-signed.spec.ts`
  (positive path — renders once, personalizes correctly, verifies, survives clear-storage +
  re-open) and `04-support-greeting-tamper-suppressed.spec.ts` (negative path — text altered after
  signing renders as nothing, no toast). `01-login-single-user-headcount.spec.ts` reworked to drop
  its server-snapshot greeting-content assertions (moved to spec 03); `00-ui-navigation-settings.spec.ts`'s
  fabricated Chinese-greeting fixture updated to supply already-localized text instead of relying on
  the now-deleted regex re-localizer.
- **Real UI-structure bug found while writing the E2E tests:** the Me tab has no conversation-list
  UI at all (`#conversations-list` is referenced by `getElementById` checks but never exists in the
  static shell — dead code path); a contact click lands on the DM conversation directly (redesign
  §5, rule N2a). Both new specs navigate via Contacts → the support contact row, not a nonexistent
  conversation-list item.
- **Full suite green:** 928/928 unit tests pass; `npm run build:server` / `build:web` both clean;
  full-project `tsc --noEmit` and `npm run lint` both clean; both new E2E specs pass, plus
  `01-login`, `00-ui-navigation-settings`, and the full `stage0-bootstrap` pipeline (same
  pre-existing, unrelated `baa`/`caa` failures as K1, confirmed via `git stash` against this
  session's earlier baseline check).

## 2026-07-26 — K3: developer login as TechSupport

Moved from `docs/TODO.md` K3. Design note: `docs/design/techsupport-k3-design-note.md`. Contract
doc amended: `docs/design/techsupport-bootstrap-contract.md`. Builds on K1/K2.

- **The gap found while implementing:** the *existing* dev "login as TechSupport"
  (`isDevStageTechSupportLoginResolved()`) adopted the correct user id but authenticated with a
  **freshly generated random SEA pair** — `getStoredPair().pub` never matched `TECHSUPPORT_PUB`.
  Any DM/greeting it authored was therefore silently suppressed by K2/K6 signature checks. K3's
  job was making the TechSupport-mode boot authenticate with the **canonical DM pair** instead.
- **Pure validator** — `assertTechSupportDmPair()` in `src/shared/techsupport.ts` validates shape
  and checks `pub` against the DM trust-anchor **list** (`isTrustedTechSupportDmPub`), not a
  hand-rolled `=== TECHSUPPORT_PUB`, so it survives key rotation (K3-2) without editing. Reworded
  the stale `TECHSUPPORT_PUB` doc-comment ("replace before production... together with the server
  secret") that no longer matched the split-key model.
- **Client TechSupport-mode boot** — `WebGunService.ensureKeypairAndAuth()` checks a new,
  *distinct* storage key (`TECHSUPPORT_KEYPAIR_STORAGE = 'iinpublic_techsupport_keypair_v1'`)
  before the ordinary custody/legacy/new-pair branch. If present, validates and authenticates with
  it, and **throws** rather than falling through to a random pair on validation failure ("no
  silent impersonation"); skips writing it into the ordinary encrypted key-custody record so the
  two identities can never merge. Added a permanent "TechSupport (root)" app-bar badge, gated on
  the user id (so it also shows for a real production operator device, not just dev mode).
- **`npm run dev:techsupport`** (`scripts/dev-techsupport-login.js`) — a Node launcher (modelled on
  `launch-browsers.js`) that reads the pair from `TECHSUPPORT_SEA_PAIR_JSON` (or
  `TECHSUPPORT_KEY_FILE`), asserts it matches `currentTechSupportDmPub()` before ever opening a
  browser, launches a headed Playwright context against the already-running dev server, and
  injects the root id + pair via `addInitScript` before navigation — disk → Node → browser
  `localStorage`, so the private key never touches the webpack bundle or the relay. `.gitignore`
  gained a `secrets/` entry for the optional key-file form; `.env.local`/`.env.example` reworded
  to describe the pair as the TechSupport device key, not a server secret.
- **Server de-gating** — the identity record is now a **committed, pre-signed artifact**
  (`src/shared/techsupport-identity.signed.json`, signed once by the new
  `scripts/sign-techsupport-identity.js` / `npm run sign:techsupport-identity` with the
  **announcement** key, mirroring K2's greeting-signing pattern exactly).
  `TechSupportAnnouncementService.publishIdentity()` just republishes the committed blob — no
  private key needed at boot. `IinPublicServer.publishPublicBootstrap()` no longer gates on
  `isConfigured()`, so a relay with **no** `TECHSUPPORT_SEA_PAIR_JSON` configured at all still
  produces a full, correct identity record + Global member row (that env var now only gates the
  on-demand admin announcement feature, which already guards itself with `if (!this.pair)`).
- **Retired `isDevStageTechSupportLoginResolved()`** — deleted outright (single consumer). Plain
  `npm run dev` / `dev:stage-zero` now boots an **ordinary** user (headcount 2: dev user +
  built-in TechSupport) instead of auto-logging in as root — safe because K1 already decoupled the
  headcount floor from the browser being TechSupport. `dev:multi`'s `?devRole=techsupport` driver
  window (`isDevTechSupportDriver()`) is untouched and still logs in as root without a real
  keypair (a documented, deliberate follow-up, not fixed here). Corrected three stale
  "browser boots as TechSupport (headcount 1)" descriptions in `CLAUDE.md`.
- **New unit tests:** `src/test/unit/techsupport-login.test.ts` (5: `assertTechSupportDmPair`
  accept/reject/rotation-list cases); `src/test/unit/techsupport-key-not-bundled.test.ts` (1,
  scans the built web bundle for the private key material and the env-var name — the design
  note's single biggest risk, guarded permanently); `src/test/unit/system-announcements.test.ts`
  (+2: `signTechSupportIdentity` round-trip, `publishIdentity()` with no pair configured at all).
- **New E2E spec:** `tests/e2e/staged/stage1-single-user/05-techsupport-mode-signed-dm.spec.ts` —
  boots a second browser in TechSupport mode, asserts `getStoredPair().pub === TECHSUPPORT_PUB`
  (not a random pair), asserts the TechSupport user record's published `pub` updates to the
  canonical key, sends a DM via the real `sendMessage` path, and confirms the receiver sees it
  with an author identity that verifies as a trusted DM anchor.
  - **Honest scope note recorded in the spec and the contract doc:** per-message cryptographic
    signing for ad hoc operator DMs (beyond the K2 greeting template) is not built — that is a
    K5/future concern. What K3 actually delivers and what this test actually proves is that the
    *operator's authenticated identity* is the canonical key, not a random device pair.
- **Full suite green:** 936/936 unit tests pass; `npm run build:server` / `build:web` both clean;
  full-project `tsc --noEmit` and `npm run lint` both clean; the new E2E spec passes, plus
  `01`–`04`, `00-techsupport-identity-bootstrap`, `00-ui-navigation-settings`, and the full
  `stage0-bootstrap` pipeline (same pre-existing, unrelated `baa`/`caa` failures as K1/K2).
- **Open questions carried forward (not settled by K3):** key rotation tooling/versioning, the
  K3-3 headless-agent run mode, and K3-4 production key custody (redundant across server/laptops/
  a dedicated machine) all remain future work.

## 2026-07-26 — K4: committed stage0 fixture as the one baseline definition

Moved from `docs/TODO.md` K4 (first landing). Commit `d1f8456d` (fixture),
`8cf04727` (shared guard). Contract doc amended:
`docs/design/techsupport-bootstrap-contract.md`.

- **Committed the stage0 fixture + regeneration command**; pointed `clearGunDatabases()` at it and
  deleted `seedTechSupportRootBaseline()`'s hand-built graph. Fixture at
  `tests/e2e/staged/fixtures/stage0.fixture.json` (gitignore carves out this path from the
  otherwise-ignored `snapshots/` tree), produced by a real browser traversal, never hand-authored.
  Regenerate with `npm run test:e2e:regen-stage0-fixture`. Fixing this exposed two real bugs along
  the way: `baa-techsupport-single-user-tabs.spec.ts` and `caa-techsupport-four-talk-types.spec.ts`
  were asserting against the mobile-collapsed "Filters ▾" disclosure without opening it first, and
  a route-talk answer-row locator matched 2 elements ambiguously — both fixed (test bugs, not
  product bugs; product behavior was correct). `seedTechSupportRootBaseline()` still takes the
  same `techSupportBaselineGraph()` shape (unchanged, still used by
  `scripts/dev-techsupport-bootstrap.js`) but the E2E seed path now loads the committed fixture
  instead of calling the factory in-process.
- **Shared guard so this cannot silently regress:** `tests/e2e/helpers/techsupport-baseline.ts`
  holds one definition of a valid built-in TechSupport; `clear-database.ts` verifies it after every
  seeded reset (`E2E_SKIP_BASELINE_GUARD=1` opts out) and `e2e-stage-pipeline.ts` imports the same
  checks instead of its own copy. 11 unit tests. Commit `8cf04727`.
- **`stage1/00x-tab-sweep-smoke.spec.ts`** already had a real `beforeAll: maybeClearGunDatabases()`
  reset; `stage1/75-p2p-rate-limit-429.spec.ts` spawns its own dedicated server process per run
  (unique port, fresh in-memory Gun), so there is no prior spec's state to inherit in the first
  place. This item was already satisfied — TODO.md was stale.
- **Amended `docs/design/techsupport-bootstrap-contract.md`:** new K4 invariant bullet + Verification
  + Honest-cost entries recording the fixture as the one baseline definition, the regeneration
  command, and the drift risk (fixture can go stale relative to the live factory/traversal until
  someone re-runs the regen command — not yet CI-enforced).
- **New unit tests:** `src/test/unit/no-inline-baseline-graph.test.ts` — no `.spec.ts` outside
  `stage0-bootstrap/` references the raw graph factory or calls `seedTechSupportRootBaseline`
  directly. `src/test/unit/stage0-fixture.test.ts` — the committed fixture exists and passes
  `assertStageSnapshotIntegrity` (exported from `e2e-stage-pipeline.ts` for this).
- **Remaining (still open in `docs/TODO.md`):** converting the ~210 `maybeClearGunDatabases()` call
  sites in stage2–5/`isolated`/`mass`/`talks-matching` to load progressive multi-user snapshots is
  a large, separately-scoped follow-up — TechSupport correctness at every one of those sites is
  already guaranteed today via the fixture-backed `seedTechSupportRootBaseline()` and
  `verifyTechSupportBaseline()`; this remaining item is purely a setup-speed/realism upgrade.

## 2026-07-25/26 — K5: TechSupport DM Q&A (Items 1–5 of 6)

Moved from `docs/TODO.md` K5. Depends on K2 (signed authorship) and K3 (TechSupport client).
Design note: `docs/design/techsupport-k5-design-note.md`. Commits `f492af3b`, `d1f8456d`,
`1c319419`, `ba4f9f63`.

- **Hard-exclude the TechSupport root from talk delivery:** `acceptsIncomingTalks()` in
  `src/shared/techsupport.ts`, checked at the top of `shouldAcceptIncomingTalkAsync`
  (`src/web/app/app.ts`) before any filter runs. Never receiving a talk means it can never produce
  a response, match, or ignore.
- **Question normalization + `questionKey` derivation + FAQ lookup:** `src/shared/techsupport-faq.ts`
  (`normalizeSupportQuestion`, `supportQuestionKey`, `lookupSupportAnswer`, `buildSupportFaqEntry`,
  `upsertSupportFaqEntry`, deterministic message ids). Reuses `hashIdentityPayload`/
  `normalizeIdentityText` from `cid.ts` rather than adding a second hashing scheme. 20 unit tests
  incl. Chinese full-width punctuation.
- **Design note** `docs/design/techsupport-k5-design-note.md` — Opus wrote the full implementation
  plan for Items 1-6 before Sonnet implemented; two decisions resolved there: **K5-A** (the
  user-visible support thread stays on the server-durable `TechSupportConversationTransport` per
  spec §19.7 — only inbox *delivery* rides the offline mailbox, since a full migration off the
  server store is a larger deferred follow-up) and **K5-B** (v1 distributes the signed FAQ bundle
  over a public Gun path `techsupport-faq/bundle`, not libp2p/IPFS — investigated and confirmed
  that distribution path doesn't exist yet, only a media-attachment blockstore does).
- **Item 1** — signed FAQ-bundle module (`src/shared/techsupport-faq-bundle.ts`: `signFaqBundle`/
  `verifyFaqBundle`, content-addressed via `bundleCid`), compiled pre-signed ack template
  (`techsupport-greeting.ts` extended with `TECHSUPPORT_SUPPORT_ACK_TEMPLATES`/`signSupportAck`/
  `verifySupportAck`, committed as `techsupport-support-ack.signed.json` via the new
  `npm run sign:techsupport-ack`), and the two `ui-translations.ts` strings
  (`supportAutoAnswerPrefix`, `supportNewQuestionAck`) — replacing the old blanket
  `supportReply`/`formatSupportReply`, now deleted. 28 unit tests.
- **Items 2+3 — wired the pure module into the live DM path.** `IinPublicApp.handleSupportQuestion()`
  (`app.ts`, replaces the deleted `sendTechSupportAutoReply`) runs the hit/miss branch on the
  *asker's own client*: a known question renders a signed auto-answer locally from the cached,
  verified FAQ bundle (`src/web/services/techsupport-faq-cache.ts` — `subscribeToFaqBundle` keeps
  the cache fresh from `techsupport-faq/bundle`, only ever caching a bundle `verifyFaqBundle`
  accepted); a new question renders the signed ack and is delivered to the TechSupport device as an
  encrypted `support-question-v1` mailbox envelope (`postSupportQuestionToMailbox`), ingested into
  **TechSupport-local** Gun (`techsupport-inbox/<questionKey>`, never a `public/` path) by
  `ingestSupportQuestionFromMailbox` — gated on the ingesting session's `currentUser.id ===
  TECHSUPPORT_ROOT_USER_ID` so an ordinary user can never materialize someone else's inbox.
  `UIManager.filterVerifiedSupportMessages()` extended to re-verify auto-answers and acks at render
  time (same K2-3 fail-closed discipline as the greeting). `ConversationMessageWire` gained
  `faqQuestionKey`/`faqAuthorPub`/`faqSignature` and `ackLocale`/`ackSignature`/`ackAuthorPub`
  fields. E2E: `stage1/06-support-new-question-ack.spec.ts` (miss-path ack renders, verifies, and
  the mailbox envelope posts — confirmed live in the test console); `stage2/00k-techsupport-contact-mute.spec.ts`
  updated to assert the new ack text instead of the retired blanket reply.
- **Items 4+5** — support-inbox view + answer/publish action. New `src/web/ui/support-inbox-view.ts`
  (`renderSupportInboxSection`, the `answers-view.ts`-style deps pattern) renders into a
  `#support-inbox-section` placeholder that `UIManager.renderSettingsView` only emits when
  `user.id === TECHSUPPORT_ROOT_USER_ID` — an operator tool, not a per-user surface, gated on the
  same `isTechSupportRoot` predicate as the K3 root badge. Fed by
  `IinPublicApp.subscribeToSupportInboxIfTechSupport()`, a live `techsupport-inbox/*` Gun
  subscription (TechSupport-root sessions only). The answer control exposes both an editable
  question and an answer field (privacy — publishing the operator-edited question, not the asker's
  raw text verbatim), submitting via the `answerSupportQuestion` event to
  `IinPublicApp.handleAnswerSupportQuestion()`, which signs the updated bundle with the live DM
  pair, writes `techsupport-faq/<key>` + `techsupport-faq/bundle`, delivers the answer as a real
  signed DM, and flips the inbox entry to `answered`.
  - **Real bug found and fixed during E2E verification:** `postSupportQuestionToMailbox`
    originally resolved TechSupport's mailbox-encryption `epub` via the generic `resolvePeerEpub`
    (presence/`users/<id>` lookup) — which reads whatever epub is currently on
    `users/TECHSUPPORT_ROOT_USER_ID`, poisonable by any session that has ever adopted that reserved
    id (including the K4 stage0 fixture's own `aaa`/`baa`/`caa` traversal, which boots as an
    *ordinary* session under the TechSupport id/name, not real K3 DM-key auth). Fixed to resolve
    the epub from the signed, trust-anchor-verified `public/techsupport-identity` record
    (`discoverTechSupportIdentityFromGun()`) instead — the same guarantee K1/K3 already rely on,
    and the only source immune to this class of pollution.
  - **Second real bug found and fixed:** Gun cannot store a nested array (documented elsewhere in
    this codebase) — `SignedFaqBundle.entries` is exactly that, and writing it directly silently
    produced a bundle no client could read back. Fixed with `faqBundleToGunWire`/
    `faqBundleFromGunWire` in `techsupport-faq-cache.ts` (JSON-encodes `entries` as `entriesJson`
    for Gun storage only; every other layer — the cache, `verifyFaqBundle`, localStorage — still
    works with the real typed array).
  - E2E: `stage1/07-support-inbox-answer-flow.spec.ts` is a real, passing, non-flaky (3/3)
    end-to-end confirmation of the full operator loop — question asked → mailbox delivery →
    TechSupport boots and drains → inbox row renders → operator answers → asker receives the answer
    → FAQ bundle independently readable and verifiable.
- **Remaining (still open in `docs/TODO.md`):** Item 6 (offline auto-answer while TechSupport is
  stopped, re-ask is a hit with no duplicate FAQ row, `stage2` cross-user auto-answer — narrower
  slices of the same flow spec 07 already exercises end-to-end), the full stage1/stage2 test list,
  and one open design question (record `answeredBy` internally vs. display-only "TechSupport").

## 2026-07-25 — K6: TechSupport is unblockable / unfilterable

Moved from `docs/TODO.md` K6. Commit `f492af3b`. Requirement: the support channel is the only
recourse a stuck user has, so TechSupport must never be blocked, muted, or filtered out.

- **Block path:** `WebUserService.blockUser` and server `UserService.blockUser` reject the
  TechSupport root id before writing any edge. The contacts/peer-detail UI already routed
  TechSupport to a mute-only dialog (`openSupportControlsDialog`, and `user-detail-view` swapping
  Block→Mute), so this added the missing service-layer backstop.
- **Content filters:** `filterIncomingMessage` takes an optional `senderId` and never suppresses a
  TechSupport-authored message; `ui-manager` threads `msg.senderId` through. The **outgoing** path
  is deliberately not exempt — a user writing to TechSupport still gets their own composer filters.
- **Reconciled with the existing mute affordance**
  (`stage2/00k-techsupport-contact-mute.spec.ts`, `isSupportNotificationsMuted()`): muting
  suppresses *notifications only*, never delivery or the contact row.
- **Enforced in `src/shared/techsupport.ts`** (`isTechSupportId`, `canBlockTarget`,
  `assertBlockTargetAllowed`) so sender, receiver, and the TechSupport client cannot drift. 10 unit
  tests.
- **Honest scope note carried forward:** in a P2P network this is a guarantee about the *shipped
  client*, not a cryptographic one. A user running patched code can always drop TechSupport's
  traffic locally. The contract doc records this as a design-for-the-shipped-client statement
  rather than implying enforcement.
- **Talk-intake carve-out: closed as not applicable, 2026-07-30.** Age-gate/language/distance
  rejection on the *talk* intake path (`talkPassesIntakeFilters`) has no TechSupport interaction to
  carve out — K5 makes TechSupport neither a talk sender nor a talk receiver
  (`acceptsIncomingTalks`/the sender-side receiver-resolution exclusion, both hard rules on the
  canonical root id, not `TalkIntakeFilters` entries). No code change without a reachable code path
  to guard would be validating a scenario that can't happen; revisit only if TechSupport ever gains
  a talk-sending/receiving capability.
- **Test 2026-07-30:** `stage1/78-techsupport-unblockable-every-route.spec.ts` — the Contacts-tab
  support row's only affordance is mute (`openSupportControlsDialog`, no block button rendered at
  all, confirmed live via DOM); a direct `WebUserService.blockUser` call and a raw
  `POST /api/users/:id/blocks` call (bypassing the client entirely) both throw/400 with
  `TECHSUPPORT_UNBLOCKABLE_ERROR`; the contact row and a real message round-trip survive every
  attempt. `stage1/79-techsupport-survives-restrictive-filters.spec.ts` — every `TalkIntakeFilters`
  dimension maxed out (0-mile radius, an unmatched language, grammar + dirty-word gates on, no
  allowed talk types) plus a never-age-verified receiver: the signed greeting still renders and a
  full new-question → FAQ-answer round trip still delivers, because the support channel is plain DM
  messaging and was never inside the talk-intake pipeline. Both specs confirmed 3/3 green.

K6 is now fully complete.

## 2026-07-25 — L1: room visit counters as a CRDT G-Counter

Moved from `docs/TODO.md` L1. Commit `1cfe1ee2`. Audit: the two lifetime badges on every chatroom
row (🚪 visits, ◎ unique visitors) were wrong in three independent, compounding ways — lost updates
from concurrent shared-scalar read-modify-write, double counting from both server and client
incrementing the same scalars, and a 700 ms timeout that clobbered a real count with `1`.

- **Fix shipped: each user owns a monotone slot; nobody writes anyone else's.** Total = sum of
  slots, unique = count of non-zero slots, so one structure yields both badges and the separate
  `uniqueVisitors/*` node and both legacy scalars become unnecessary. Merge is per-slot max, making
  it commutative, associative, and idempotent, so concurrent writers and replays cannot lose or
  double-count.
- Pure shared module + CRDT-property tests — `src/shared/visit-counter.ts`.
- Server `recordVisit` writes only its own slot and publishes the aggregate.
- Client `recordRoomVisit` writes only its own slot; no more shared-scalar RMW.
- Migrate existing rooms: `migrateLegacyVisitScalar` seeds one synthetic slot from the old scalar
  on first visit, idempotently. Rooms that predate the CRDT therefore report `unique = 1` until real
  visitors arrive — a documented, deliberate fidelity loss, preferred over resetting old rooms to
  zero.
- **Read cost, stated honestly:** summing slots is O(members-ever) per room, versus O(1) for the
  old scalar. Mitigated by publishing an aggregate the same way `publishRoomMemberCount` already
  does (`public/room-member-counts/<id>`): the CRDT is the source of truth, the published aggregate
  is what the room list renders. Clients only sum slots when no aggregate is available.
- **E2E:** `stage2/35-concurrent-visit-counter.spec.ts` (+ companion `.md`) — two browsers bootstrap
  under one `Promise.all`; asserts both visits counted and unique = +2, plus a repeat visit (page
  reload while still active) raising visits but not unique visitors. Confirmed green 2026-07-27
  (both subtests pass). That reload-repeat-visit fix (`joinChatroom`'s `alreadyActive` fast path
  now calls `recordRoomVisit`) initially over-fired on a different call path — a same-room
  `switchChatroom()` no-op also re-recorded a visit, breaking
  `00-ui-navigation-settings.spec.ts`'s duplicate-switch idempotency check. Fixed same day
  (commit `05cf99ae`) by short-circuiting `switchChatroom()` when the target room already matches
  `currentChatroomId`, leaving the reload path (which has no `currentChatroomId` to compare
  against on a fresh service instance) untouched. Both specs are green together.
- **Remaining (still open in `docs/TODO.md`):** removing the legacy `visitCount`/
  `uniqueVisitorCount` scalars and the `visits/<eventId>` nodes, blocked on the `max(new, legacy)`
  fallback in `getChatroom` being retired, which needs one full staged run to confirm nothing else
  reads the scalars.

## 2026-07-25 — L2: room-data retention instrumentation (read-only)

Moved from `docs/TODO.md` L2. Commit `1cfe1ee2`. Storage grows without bound today; this lands the
measurement tooling a retention policy decision needs, without reaping anything yet.

- Stopped *writing* `visits/<visitEventId>` — the client no longer creates one node per visit (the
  L1 G-Counter slot supersedes it). Existing nodes remain until a reaper exists.
- Size instrumentation: `src/shared/graph-size-report.ts` classifies every soul into a growth
  category (`bounded` / `per-user` / `per-event`) and reports node counts + share, sorted
  biggest-first. Exposed at `GET /api/test/graph-size` (`?growth=per-event` narrows to the
  unbounded paths). Read-only by design — it measures, it never reaps. 11 unit tests.
- **Remaining (still open in `docs/TODO.md`, policy not code):** run the instrumentation against a
  real deployment and record the numbers; decide a retention policy per path; work out tombstone
  semantics for a P2P graph where an offline peer can resurrect a deleted node on next sync; and
  decide whether trimming runs relay-side, device-side, or both.

## 2026-07-29 — Docs consolidation: remaining design documents merged into the spec + archive

Second consolidation pass (first was 2026-06-08). Reviewed every file under `docs/` for design
requirements not yet reflected in the canonical spec, merged the genuinely new/current ones in
full, and archived everything superseded — without eliminating any detail (archive, not delete).
Full mapping and rationale: `docs/archive/consolidated-2026-07-29/README.md`.

**Merged in full into `docs/specs/iinpublic-technical-specifications.md` (new Part VI, §26–28,
plus a §19.7 expansion) — bumped to v4.6:**
- **§26 GUI Navigation Shell Redesign & Layout Catalog** ← `docs/gui-redesign-plan.md` (§26.1) +
  `docs/gui-layout-catalog-and-e2e-plan.md` (§26.2). This is the normative navigation/layout
  contract behind `docs/TODO.md` A–D, H, I, J, and the new M–Q cluster; A–D/H and parts of I/J
  have since shipped, but the full-page transition tables, popup-size-class rules, and the
  per-control option matrix were never previously in the spec itself.
- **§27 Cross-Platform Native Clients — Embedded Node Shell (S3)** ← `docs/design/S3-embedded-node-shell.md`.
  Real, current architecture (desktop/Android builds already verified per the 2026-07-14 and
  2026-06-30 entries above) that had no spec section of its own at all.
- **§28 Gun Database Architecture, Scalability & Retention** ← `docs/Gun-Database-Architecture.md`.
  Genuinely new material not covered by the existing §11/§12/§20 — storage-sizing formulas
  (§28.7), a tiered data-ownership/retention policy (§28.8), and a merkle-checkpoint pruning
  design for both the ledger and conversation messages (§28.9). This is the most complete existing
  answer to `docs/TODO.md` L2's open retention-policy questions — a TODO cross-reference was added
  there pointing back at this section.
- **§19.7 expanded** with the current TechSupport K1–K6 built-in-identity/presence/Q&A/
  unblockability contract ← `docs/design/techsupport-bootstrap-contract.md` (now §19.7.1). The
  pre-existing §19.7 content (server message-storage transport exception) is kept as §19.7.0 and
  remains true — K5-A's decision keeps the user-visible support thread on that transport; K1's
  revision is about identity/presence, not message storage, so the two subsections coexist rather
  than one replacing the other.

**Archived without re-merge** (implementation-handoff plans for now-shipped work, already-superseded
analysis, or stale duplicates — conclusions already live in the entries above or elsewhere in this
file): `docs/design/hub-hardening-explicit-relay-channel.md`, `p0-step1-mesh-transport.md`,
`p0-step4-mesh-responses.md`, `p0-steps8-11-ledger.md`, `S3-native-libp2p-shell.md` (superseded by
S3-embedded-node-shell.md per its own header), `techsupport-k1/k2/k3/k5-design-note.md` (conclusions
already in §19.7.1 + this file's K1/K2/K3/K5 entries above), `docs/architecture/p2p-mesh-libp2p-analysis.md`
(already merged into spec §25 on 2026-06-10, confirmed by that file's own "Review notes" section),
`docs/current/README.md` (stale duplicate of `docs/README.md` — `docs/current/` removed), and
`docs/zh/projectplan_zh.md` + `testplan_zh.md` (stale translations of a pre-2026-06-08 superseded
draft SRS/test plan — `docs/zh/` removed).

**Out of scope** (not design requirements): `docs/LAN-HTTPS.md` (dev-ops guide),
`docs/e2e-test-analysis.md` (test-coverage analysis, likely itself superseded by the
auto-generated `docs/testing/coverage-matrix.md` — a separate cleanup), `docs/design/port-usage-scenarios.md`
(already its own canonical doc).

**Pointers updated:** `CLAUDE.md`'s TechSupport-headcount invariant note and `docs/TODO.md`'s four
`Source:` lines (G/I/J/K) now point at the new spec sections instead of the archived file paths.
Historical mentions inside this file and scattered code-comment doc-pointers (e.g. `app.ts`,
`talk-ledger.ts`) were deliberately left as-is — they still resolve to real content at the archived
paths, and rewriting historical ledger entries was judged out of proportion with the value, same
as the 2026-06-08 consolidation's own approach.

**Verification:** code-fence balance checked (238 markers, even) and heading counts reconciled
(150 source headings + 6 new wrapper headings ≈ 155 in the merged range) across all four merged
files after the heading-level-demotion transform, confirming no content was silently dropped.


## 2026-07-30 — Q/M: GUI graph-traversal model (navigateToGraphNode dispatcher, all 17 build-order items) + Talks/Me/Contacts/Settings compaction

Moved from `docs/TODO.md` Q and M (Q defines the model + build order; M is the Talks/Me/Contacts/Settings compaction work Q's build order sequences several items against). All 17 build-order items complete; every M1–M6 subsection complete. Commits `cad8164e` through `29d1c09a`.

### Q. GUI as a graph-traversal model — read this first, before M–P `[Opus]`

**Placed first, out of alphabetical position — same convention as the top-of-file "Land order"
line** (which already lists `H` before `E`/`F`: letter labels in this file track *initiative*, not
required reading/build order). Bernard confirmed `navigateToGraphNode(target)` as the right idea
2026-07-29 and asked for the rest of this cluster (M–P) rearranged around it, easiest first — that
build order is the new subsection right after "Recommended approach" below.

Requirement 2026-07-29 (Bernard). The underlying idea across the last several TODO items: the GUI
is a **graph**, not a set of disconnected tabs. Node types are **Chatroom**, **Person**, **Talk**,
and **Me-tab Q&A** — and from any one of them you should be able to reach any directly-related
other one:

- Chatroom → switch to another chatroom, or pick a person present in it to talk to.
- Person → a talk the two of you exchanged (O).
- Talk → the person(s) it was exchanged with (N3) — **and** other people who separately exchanged
  the *same* talk content (new, see audit below).
- Talk ↔ Me-tab Q&A, in both directions (P covers Q&A → Talk; Talk → "which of my answers came
  from this" is the missing reverse edge).
- **Settings is the one deliberate exception** — a per-device configuration surface, not a graph
  node. You should never need to "arrive at" a person/talk/chatroom by navigating through Settings,
  and Settings shouldn't itself be a stop on the way between two graph nodes.

#### Audit: what's already planned, what's genuinely new, what's already broken

- **Already planned as part of M/N/O/P** (this section adds no new work item for these, just names
  the pattern they're all instances of): Person→Talk (O), Talk→Person (N3), Q&A→Talk (P),
  cross-tab DM reachability (N1/N2).
- **Missing edge, not yet in any TODO item: Talk → Me-tab Q&A (forward direction).** P only wires
  Q&A → Talk; there's no reverse "from this talk, show me my answer to it" link yet, even though
  the same `talkId` join already used by P would answer it.
  **Built 2026-07-30 — see build-order item 12** for the full implementation.
- **Missing edge, not yet in any TODO item, and genuinely new — not a refactor of something
  existing: Talk → other people who separately exchanged the *same* talk content.** Audited
  thoroughly (2026-07-29): **no code path supports this today, in either direction.**
  - The creator-side "matched names" (N3, `ui-manager.ts:2451-2453`) only surfaces people with
    whom *I* (the creator) have a conversation record for that talk — direct sender→responder
    pairs I personally created, not co-recipients who got the identical content via a chatroom
    broadcast/relay from someone else.
  - Every identityKey-keyed structure found (`client-incoming-talk-mirror.ts:58,91,118`;
    `web-talk-ledger-store.ts:175,186` `getResponderSendersForIdentity`/
    `getResponderTargetsForIdentity`) is scoped to **my own** local history only — there is no
    identityKey→`[all users who have this]` index anywhere, client or server.
  - The server's old `incomingTalksMap`/`GET /api/incoming-talks` (CLAUDE.md's description of it)
    is stale documentation — that endpoint now 404s (`src/test/integration/star-endpoints-removed.test.ts:68-69`);
    star/server-authoritative talk state was already removed in favor of P2P mesh delivery, so
    this can't be built as a simple server query even if we wanted to — it has to be a
    P2P/mesh-native answer.
  - **Privacy implication, not just an engineering gap:** a network-wide "who else has this talk"
    query would leak other people's private exchange history to a stranger — almost certainly not
    what's wanted. The only privacy-safe framing is "people **I** have separately exchanged this
    same content with" (a join over my own local records I already have a relationship-based right
    to see), not "everyone in the mesh with this identityKey."
- **Chatroom → Person verified working 2026-07-30** (build-order item 3): `.chatroom-member-item`
  click → `openUserConversationFirst`, confirmed passing via `00e-chatroom-peer-detail.spec.ts` and
  `68-conversation-first-entry.spec.ts`.
- **Settings is not fully isolated today, but the coupling found is a read, not a graph edge.**
  The Talks tab's IN-list render reads `talkFilters`/`allowedTalkTypes` etc.
  (Settings-owned, `ui-manager.ts:2322-2326`) to decide what's visible — Settings values
  *influencing* what Talks shows is normal preference application, not a navigable edge (you can't
  click from a Settings control and land on a specific talk/person). The isolation principle this
  requirement actually needs is: **no click path starts in Settings and ends on a graph node**, not
  "Settings must have zero data dependencies from other views." Worth stating explicitly so this
  distinction isn't lost when M4 (Settings cleanup) is implemented.

#### Recommended approach

**No centralized navigation concept exists in this codebase today — this is genuinely new
structure, not an extension of an existing pattern.** Audited: no `router`/`navigate()`/dispatch
table anywhere (`grep` for these across `src/web/` only matches UI copy strings and browser
`navigator.*`). Instead there are **~20 bespoke `show*`/`open*` functions** across `ui-manager.ts`/
`user-detail-view.ts`/`app.ts` (`showTalkDetail`, `showConversationDetail`, `showChatroomDetail`,
`showContactDetail`, `openPeerDetailForUser`, `openDirectConversationWithPeer`, etc. — full list
gathered during this audit), each with its own ad hoc signature (some take `id` only, some
`(id, name)`, some `(id, fallbackId)`), called directly from wherever needed. `app.ts`'s
`setupEventHandlers()` (`app.ts:4438`) is one large method with 37 sequential `uiManager.on(...)`
calls and inline closures — no registry, no command pattern, so a nav layer wouldn't be fighting
an existing convention; there simply isn't one yet.

- **Recommendation: introduce one thin `navigateToGraphNode(target)` dispatcher that every new
  click-to-traverse handler (M2/M3/N3/O/P, plus the new Talk↔Q&A and Talk→co-exchangers edges)
  calls through, rather than each surface inventing its own bespoke jump logic.** Keep it minimal
  and in the codebase's existing style (a plain function + a small discriminated-union `target`
  type — e.g. `{type:'chatroom',id}|{type:'person',id}|{type:'talk',id,questionContext?}|
  {type:'answer',...}`), not a framework. Concretely:
  - Reuse the existing `show*` functions as the actual per-type implementations — most already
    take a single target-id-ish param and slot in as-is (`showConversationDetail`,
    `showChatroomDetail`, `showContactDetail`); a few need small generalization work already
    tracked in P (`showTalkDetail`'s dead-end + missing question-anchor).
  - This buys one place to reason about "is X→Y actually reachable," one place to add a
    back-button/breadcrumb later if wanted, and stops each of M/N/O/P/this-item's new edges from
    growing its own one-off wiring — worth doing *once*, before landing several of M–P's items
    that each add a new click-to-navigate surface.
  - Do **not** attempt to retrofit the ~20 existing entry points into this dispatcher in one pass —
    fold them in gradually, starting with whichever M/N/O/P item lands first, so this stays a
    lightweight shared layer rather than a big-bang refactor.
- **For "talk → other people who exchanged this," design it as "people I've separately exchanged
  this with" (a join over data the current user already has a right to see), not a mesh-wide
  identityKey query** — the latter doesn't fit the P2P/no-server-authority architecture (per the
  removed `incomingTalksMap` endpoint) and would be a privacy regression even if it did.

**Build order (easiest → hardest) — the concrete answer to "rearrange around this idea"**

Every item below already has its full detail in M/N/O/P (or in this section's own "Work" list) —
this is a sequencing index, not new content. Land top-to-bottom.

1. [x] **Foundational, kept deliberately small.** Land the `navigateToGraphNode(target)` skeleton — the
   dispatcher + discriminated-union type, with just 2-3 existing functions wired through as its
   first targets (`showConversationDetail`, `showChatroomDetail`, `showContactDetail` — already
   take a single target-id-ish param, no generalization needed). No new click handlers yet; this
   step only creates the shape everything below plugs into.
   **Done 2026-07-30:** `GraphNodeTarget` union (`chatroom` / `conversation` / `person`) in new
   `src/web/ui/graph-navigation.ts`; `UIManager.navigateToGraphNode(target)` switches on it and
   delegates to the existing `showChatroomDetail`/`showConversationDetail`/`showContactDetail`.
   No new call sites yet, per scope — `tsc`/`lint`/Jest (1048 tests) all clean.
2. [x] **Trivial.** M1 — disable the "Replies To My Talks" panel. Already confirmed a single
   contiguous, self-contained edit.
   **Done 2026-07-30:** `#creator-replies-panel` set to `display:none`; the 3 external
   `renderCreatorReplies()` call sites (two filter-control listeners + `refreshCreatorReplies()`)
   removed so it's never invoked (the data derivation `deriveLocalCreatorReplies` stays, since
   `creatorReplyRows` still feeds the OUT-row matched-names line). Turned out to be wider than
   "self-contained": 5 E2E specs dedicated to this panel now `test.describe.skip` with a dated
   comment (`35-reply-filter-query`, `65-reply-triage-option-matrix`,
   `00ad-reply-triage-group-date`, `00v-creator-reply-triage-matrix`,
   `70-reply-triage-grouping-multi`), and 4 more specs that asserted panel visibility/interaction
   alongside otherwise-unrelated checks were surgically trimmed (`00-ui-navigation-settings`,
   `00x-tab-sweep-smoke`, `00y-chinese-ui-traversal` needed no fix — text-content assertions don't
   require visibility, `baa-techsupport-single-user-tabs`). Full light E2E shard (177 passed, 5
   skipped, 0 failed), `tsc`/`lint`/Jest (1048 tests) all clean.
3. [x] **Trivial.** Verify Chatroom → Person (clicking a chatroom roster row reaches that person's
   contact/DM) actually works today — a check, not new work, unless it turns out broken.
   **Verified 2026-07-30, no fix needed.** `.chatroom-member-item` click →
   `chatroomsDeps().openPeerDetail` → `openUserConversationFirst(userId, stageName)`
   (`ui-manager.ts:1949`, N2a rule) — same function `showContactDetail` uses. Confirmed passing
   today: `00e-chatroom-peer-detail.spec.ts` ("Clicking a member opens the peer detail overlay")
   and `68-conversation-first-entry.spec.ts` ("member click lands on ⟨Conv⟩") — 7/7 passed.
4. [x] **Trivial.** P's `'created'`-vs-`'answered'` destination asymmetry for self-answered own talks —
   decide and document (or a one-line routing tweak if the decision is "fix it now").
   **Done 2026-07-30 — fixed it now.** Decision: Me-tab Q&A traceback always means "show my
   answer," regardless of `myTalks[tid].role`. Added `showTalkDetail`'s `preferAnswerView` option
   (routes to the response dialog when `fullTalk` is present, even for `role:'created'`) and a
   `showTalkDetailAsAnswer` wrapper bound only to `displayAnswersList`'s deps — the Talks-tab OUT
   row and "My Talks" dialog call sites are untouched and still open the editor for `'created'`
   talks, since editing intent is correct there. New regression test in `05-talks-edit.spec.ts`
   ("Self-answered own talk: Me-tab entry opens the response view, not the editor") — confirmed it
   fails without the fix, passes with it. `tsc`/`lint`/Jest (1048 tests) all clean.
5. [x] **Easy.** N1 — make the DM-arrival toast clickable, routed through the new dispatcher. Settle
   the shared "which overlay does a DM click open" destination decision here, since N3 and O both
   reuse it.
   **Done 2026-07-30.** Destination decision: route through `navigateToGraphNode({type:'person',
   id, name})` — the same N2a "land on ⟨Conv⟩ with ⟨User⟩ underneath" convention every other
   click-to-a-person surface already uses (Contacts, Chatroom roster) — rather than the bare
   `showConversationDetail` the existing Match!-toast click uses. `showNotification` gained
   `peerId`/`peerName` options; the DM-arrival call site in `syncConversationMessageSummary` passes
   them. Existing Match!-toast behavior (rule N6, `showConversationDetail`) is untouched. New test
   `73-dm-arrival-toast-navigation.spec.ts`, confirmed it fails without the fix (toast dismisses,
   doesn't navigate) and passes 3/3 with it. `tsc`/`lint`/Jest (1048 tests) all clean.
6. [x] **Easy.** N3, single-exchange-partner case — thread the already-available `otherUserId`/
   `senderId` onto the matched-name/sender-name elements, wire via the dispatcher using N1's
   destination decision.
   **Done 2026-07-30.** OUT row's matched-names line now carries `data-matched-people` (JSON
   `{id,name}[]`); IN row's sender-avatar/name line and "from …" line both carry
   `data-sender-people`. One delegated click handler (`.talk-matched-people, .talk-sender-people`)
   parses it, `stopPropagation()`s (added to the row-click exclusion list alongside the existing
   actions), and for exactly one person calls `navigateToGraphNode({type:'person', id, name})` —
   the multi-partner picker is build-order item 8, not wired here yet, so multi-person clicks are
   currently a no-op. New test `74-talk-row-person-traceback.spec.ts`, confirmed it fails without
   the fix and passes 3/3 with it; regression pass on `05-talks-edit`, `00i-p0-direct-talk-delivery`,
   `69-matched-talk-threads`, `00f-ux-contacts-talks-answers` (5/5). `tsc`/`lint`/Jest all clean.
7. [x] **Easy–medium.** M5 — compact the TechSupport contact row (well-scoped, one file, no new modal).
   **Done 2026-07-30.** Row is now a single content line (down from 3): dropped the dedicated
   "Built-in support contact" line entirely (redundant — the "Built-in" pinned badge already says
   this), and replaced the full-sentence mute-status line with a small inline 🔕/🔔 icon
   (`aria-label` keeps the full text for screen readers; `openSupportControlsDialog`, already
   reachable, still shows the full explanation). `contactsViewDeps()` untouched, per scope.
   4 pre-existing E2E specs asserted the removed full-sentence lines directly on the row
   (`00k-techsupport-contact-mute`, `00-ui-navigation-settings`) — updated to check the badge text
   + `data-support-muted` attribute instead; added a `.contact-item-meta` count(0) assertion for
   the line-count requirement. Regression: 12/12 passed across all 5 affected specs. Confirmed the
   new assertions fail without the fix. `tsc`/`lint`/Jest all clean.
8. [x] **Medium.** N3, multi-partner case — the "choose who to DM" picker, modeled on the existing
   `#peer-send-picker-modal` pattern.
   **Done 2026-07-30.** New `showChooseWhoToDmPicker(people)` in `ui-manager.ts` (modal-overlay +
   one row per person, no checkboxes/confirm needed since a row click IS the pick), wired into the
   existing `.talk-matched-people`/`.talk-sender-people` delegate from item 6: exactly one person
   navigates directly (unchanged), more than one opens this picker; picking a row navigates via
   the same `navigateToGraphNode` destination. New test in `74-talk-row-person-traceback.spec.ts`
   ("OUT row: two matched responders opens…") using a real 3-user broadcast+match setup (Tom
   creates/broadcasts, Jerry and Bob both match). Confirmed it fails without the fix and passes
   3/3 with it. `tsc`/`lint`/Jest all clean.
9. [x] **Medium.** P — the actual dead-end fix: a real retry when `demandFullTalk` fails, instead of
   the current one-shot error toast whose copy already claims a retry it doesn't perform.
   **Done 2026-07-30.** `showNotification` gained a `retry?: () => void` option (extending the
   existing click-to-navigate pattern) — a retryable toast is marked `data-retryable="true"`,
   lingers 8s (was 3s, giving a fair window to act), and clicking it re-runs the callback instead
   of just dismissing. `showTalkDetail`'s dead-end branch now passes
   `retry: () => this.showTalkDetail(talkId, identityKeyFallback, options)` — clicking re-attempts
   the exact same lookup, which can succeed later if the mesh cache catches up. New test
   `35-me-answer-dead-end-retry.spec.ts`: a purged talk fails once, then a successful retry
   (after seeding the mesh cache) opens the response dialog normally. Confirmed it fails without
   the fix and passes 3/3 with it; regression on `54-notification-autodismiss` +
   `00-ui-navigation-settings` (13/13). `tsc`/`lint`/Jest all clean.
10. [x] **Medium.** M6 — contact headshots: new `Map`-based prefetch cache modeled on the existing
    `peerLocationCache` pattern, then render via the already-existing `avatarInnerHtml` helper.
    **Done 2026-07-30.** `peerHeadshotCache` + `resolvePeerHeadshot` in `ui-manager.ts` mirror
    `peerLocationCache`/`getPeerLocation` exactly, but deliberately *not* awaited in `beforeRender`
    (per R's caution against compounding Contacts' existing blocking pre-render chain) — instead
    fired per-peer, non-blocking, from a new self-heal loop in `contacts-view.ts` (mirroring the
    existing peer-name self-heal loop right above it), patching just the `.contact-item-avatar`
    element in place rather than re-rendering the whole list. New test
    `75-contact-headshots.spec.ts`: no-headshot → "?" fallback, a set headshot renders correctly
    on the next session, and re-sort triggers zero additional Gun reads for a peer whose headshot
    already resolved. Confirmed it fails without the fix and passes 3/3 with it; regression on
    `64-contacts-filter-sort-options`, `00k-techsupport-contact-mute`, `00f-ux-contacts-talks-
    answers`, `06-contacts-tab` (4/4). `tsc`/`lint`/Jest all clean.
11. [x] **Medium.** O — make the peer-detail exchanged-talks history list clickable, with on-demand
    `threadSummaries[talkId]` creation for talks that don't have one yet.
    **Done 2026-07-30.** `.peer-history-item` rows are now clickable: if a conversation already
    exists with the peer, calls `showConversationDetail(convId, talkId)` directly (works for any
    talkId, `threadSummaries[talkId]` doesn't need to pre-exist — it's created naturally once a
    message is sent under that scope); if no conversation exists yet, calls the (now
    talkId-aware) `openDirectConversation(peerId, peerName, talkId)`, which creates one and opens
    it already scoped to that talk. `openDirectConversationWithPeer` gained the same optional
    `talkId` param, threading through to `showConversationDetail`. New test
    `76-peer-history-clickable.spec.ts` (2 tests: brand-new conversation from a mismatch talk;
    existing conversation re-scoping across two distinct exchanged talks, including a regression
    check on the already-matched talk). Confirmed both fail without the fix and pass 3/3 with it;
    regression on `67-peer-history-controls`, `68-conversation-first-entry`,
    `69-matched-talk-threads`, `00e-chatroom-peer-detail` (9/9). `tsc`/`lint`/Jest all clean.
12. [x] **Medium.** This section's own Talk → Me-tab Q&A reverse edge — reuses P's `talkId` join,
    just the other direction.
    **Done 2026-07-30.** New `hasMeTabAnswerForTalk`/`navigateToMyAnswerForTalk` in `ui-manager.ts`;
    `showTalkResponseDialog` passes a `viewInMyAnswers` callback only when this talk actually has
    a Me-tab entry (i.e. I've answered it) — a "View in My Answers" link/button injected into the
    response-dialog modal (all 3 render branches: tag, TALK_SUPERSEDED review, per-question flow),
    switching to the Me tab and scrolling/highlighting the matching `.answer-talk-item` row(s) on
    click. New test `77-talk-to-me-tab-reverse-edge.spec.ts`: no link before answering, link
    appears and correctly navigates after. Confirmed it fails without the fix and passes 3/3 with
    it; regression on `05-talks-edit`, `35-me-answer-dead-end-retry`, `00i-p0-direct-talk-delivery`,
    `00w-talk-lifecycle-flow-multi-responder` (5/5). `tsc`/`lint`/Jest all clean.
13. [x] **Medium.** P — wire the already-computed `contextHash`/`contextPath` into a per-question deep
    link, so a multi-question entry can scroll/highlight the specific question, not just open the
    talk.
    **Done 2026-07-30 — used `questionId` rather than `contextHash` as the wire format** (already
    unique per question, no serialization/parsing needed, and `.review-question-block` — the
    screen this deep-links into — is naturally keyed by `q.id` already). Each `.answer-outcome-item`
    now carries `data-question-id`; the Me-tab row click handler reads whichever sub-item was
    actually clicked and threads it through `showTalkDetailAsAnswer` → `showTalkDetail` →
    `showTalkResponseDialog({targetQuestionId})` → new `scrollToTargetQuestion` helper in
    `talk-response-dialog.ts`, which scrolls/highlights the matching `.review-question-block`
    (reusing the `.answer-item-highlighted` CSS class from item 12). New test
    `36-per-question-deep-link.spec.ts` — verifies both halves of the fix in isolation (the
    row's `data-question-id`, and `targetQuestionId`'s scroll/highlight) rather than depending on
    the real exact-chatbot-memory auto-resolution subsystem's timing to reach the review screen
    naturally, which proved too flaky to drive reliably in a test. Confirmed it fails without the
    fix and passes 3/3 with it; regression on 4 Me-tab/answers specs (11/11). `tsc`/`lint`/Jest
    all clean.
14. [x] **Medium–hard.** N2 — the cross-tab "pick a conversation" affordance: a new global UI element
    plus a design decision (small dropdown vs. finally reviving `#conversations-list`).
    **Done 2026-07-30.** Decided small modal-overlay dropdown (modeled on item 8's
    `showChooseWhoToDmPicker`), not reviving `#conversations-list` — smaller diff, and this
    codebase already leans on the `.modal-overlay` pattern for exactly this kind of ephemeral
    picker. New `#dm-inbox-btn` in `#header-actions`, deliberately placed *without* a
    `data-appbar-view` attribute so `syncAppBarActionsForView`'s per-view hide/show never touches
    it — visible on every tab by construction, not by special-casing. `updateMatchBadge()` now
    badges it too (same aggregate unread count as the existing Me-tab badge). Clicking opens
    `showDmInboxPicker()`: unread senders sorted most-recent-first, picking one navigates via the
    same `navigateToGraphNode` destination N1/item 6/8 already settled on. New test
    `78-dm-inbox-affordance.spec.ts`: badge visible while on Settings (not Me, not Contacts),
    picker lists the sender, picking navigates to the right conversation. Confirmed it fails
    without the fix and passes 3/3 with it; regression on 4 other app-bar/notification specs
    (9/9). `tsc`/`lint`/Jest all clean.
15. [x] **Medium–hard.** M2/M3 — compress talk/answer rows to title+status (2 lines) with inline icon
    actions and a shared details-popup modal; touches four talk-type variants plus the answer-entry
    template. **Done 2026-07-30.** See M2/M3 sections above for full detail.
16. [x] **Medium–hard.** M4 — Settings tab cleanup: shared section-wrapper extraction, splitting
    content-filters into its sub-concerns, and the grouping/accordion design decision.
    **Done 2026-07-30.** See M4 section above for full detail.
17. [x] **Hardest — do last.** This section's own Talk → "people I've separately exchanged this
    content with" edge. Genuinely new data-layer design (no existing pattern to extend), and
    privacy-sensitive (see the audit above) — deliberately sequenced after everything else so the
    dispatcher, the easier edges, and the destination conventions they settle are all already in
    place before tackling the one item with no precedent to lean on.
    **Done 2026-07-30.**

**Work**

- Design + land the thin `navigateToGraphNode(target)` dispatcher described above, with
      `show*`/`open*` functions as its per-type implementations. Land this *before or alongside*
      the first of M2/M3/N3/O/P's new click-to-navigate handlers, so those items build on it
      rather than duplicating one-off logic that gets retrofitted later.
      **Done 2026-07-30 — build-order item 1.**
- Build the missing Talk → Me-tab Q&A reverse edge (from a talk, show my answer to it, if any)
      — same `talkId` join P already established, just the other direction.
      **Done 2026-07-30 — build-order item 12.**
- Design (privacy-first, per the framing above) and build Talk → "people I've separately
  exchanged this same content with" — scoped to the current user's own local records, never a
  cross-user/mesh-wide query.
      **Done 2026-07-30 — build-order item 17.** See item 17's own writeup below for full detail.
- Verify Chatroom → Person (clicking a chatroom roster row reaches that person's contact/DM)
      actually works today; if it doesn't, it's the same shape of gap as the others in this
      section and should get its own click-to-navigate treatment through the new dispatcher.
      **Done 2026-07-30 — build-order item 3, verified already working, no fix needed.**
- Document the Settings-isolation principle precisely (read-dependency from other views is
      fine; a click path starting in Settings and landing on a graph node is not) so M4's Settings
      cleanup doesn't accidentally wire Settings into the navigable graph.
      **Already done** — see "Settings is not fully isolated today..." in the Audit section above
      (this doc, pre-dating M4). M4's implementation (build-order item 16) confirmed compliant on
      review: `renderSettingsSection()`'s refactor only changes wrapping markup/collapse behavior,
      adds no new click handler that navigates to a chatroom/person/talk/Q&A node.
- Test: `stage2` — from a chatroom, pick a person present in it, then pick a talk the two
      exchanged, then from that talk reach the Me-tab Q&A it produced (if any) — one continuous
      traversal through all four node types without a dead end.
      **Done 2026-07-30.** New `81-graph-traversal-no-dead-end.spec.ts` — walks Chatroom
      (member-row click) → Person (conversation + peer-detail) → Talk (peer-history row reopens
      the conversation scoped to that talk) → Q&A (the talk's own response view's "View in My
      Answers" link jumps to the Me-tab entry), all in one continuous session, reusing build-order
      items 3/11/12's already-shipped edges. No new product code needed — this test exists purely
      to prove the chain has no dead end end-to-end, per this bullet's own framing.
- Test: `stage3` — a talk I exchanged separately with two different people: from that talk,
      both people are reachable; a third person who has the same talk content only via a
      chatroom broadcast I wasn't part of is correctly *not* surfaced (privacy boundary holds).
      **Done 2026-07-30.** New `80-talk-co-exchangers.spec.ts` (3 real browsers — written in
      `stage2-two-user/` rather than the `stage3-three-user/` pipeline directory, since 3 ordinary
      `bootstrapUser` sessions already exercise this without needing the sequential stage-pipeline
      machinery). See item 17's writeup below for why this needed *explicit-id* talks to actually
      exercise the new code path, and how the "third person" exclusion is proven.

**Item 17 implementation notes — a key finding revised the original test plan:**

- **Investigation finding, discovered while building this item's own test:** for talks created
  through the real editor, `talk.id` is *itself* a content hash (`WebTalkService.createTalk`:
  `talk.id = talkData.id || await computeTalkCIDv1(talk)`) built from the **exact same payload**
  (`buildIdentityPayloadFromTalk` — type + language + question/answer text, sorted) as the ledger's
  `identityKey` (`buildTalkIdentityKey`, same payload, different hash encoding). Two organically-
  created talks with identical Q&A content therefore don't just share an identityKey — they
  collapse to the literal same `talk.id`, and the *existing* matched-names computation (filtered
  by `conversation.talkId`) already aggregates every exchange partner across that content
  automatically. Confirmed empirically: two same-content, different-title talks from two different
  authors produced byte-identical CIDv1 ids. This means identityKey and talk.id only genuinely
  diverge when a talk carries an **explicit** id rather than a computed one — which is exactly how
  this repo's own test fixtures (`talks-matching/lib/four-types-talks.ts`,
  `techSupportFourTalks`) and (by the same code path) any real explicit-id talk already work. The
  ledger-join design below targets precisely that divergence case, which is real but narrower than
  the original "any two separately-broadcast copies" framing assumed.
- `getCoExchangedPeople(identityKey, excludePeerIds)` (`ui-manager.ts`, near
  `showTalkItemDetailsPopup`) reads `web-talk-ledger-store.ts`'s local `talkLedger.exchanged` map —
  **this device's own record only**, combining both ledger roles for the given identityKey:
  `role:'author'` entries (responders who answered a talk *I created* with this content, across
  any talkId) and `role:'responder'` entries (authors whose talk *I answered* with this same
  content, excluding `outcome:'no-reply'` seed rows — only real exchanges). `excludePeerIds` drops
  whoever the row's own N3 matched-names/sender-name line already shows, so this surfaces only
  *additional* co-exchangers.
- Wired into both OUT-row and IN-row `.talk-item-details` popups (M2's shared popup mechanism) as
  `.talk-item-co-exchanged` (reuses the `.talk-matched-people` class for click delegation — single
  person navigates directly, multiple opens item 8's picker — no new click wiring needed). New
  translation key `talksAlsoExchangedWith` (EN+ZH).
- Privacy scoping is structural, not a runtime check: `getCoExchangedPeople` only ever reads local
  `localStorage`, so it is architecturally incapable of a mesh-wide "who else has this identityKey"
  leak — there is no code path by which a peer Tom never personally exchanged with could appear.
- Test `80-talk-co-exchangers.spec.ts` had to move to `createTalkFromCompanyPage` with explicit
  distinct ids (`coex-x-*` / `coex-y-*`) after the investigation above — an organic two-talk
  same-content setup collapsed to one row (the pre-existing behavior working correctly, not a
  test bug) and would have tested nothing new. Confirmed it fails without the fix (popup's
  `.talk-item-co-exchanged` absent) and passes with it. Full stage2 regression swept.
  `tsc`/`lint`/Jest (1048/1048, one confirmed-flaky unrelated retry) all clean.

---

### M. Talks/Me/Contacts tab layout simplification, Settings tab cleanup `[Sonnet]`

Requirement 2026-07-29 (Bernard). Talks/Me tabs currently render far more per-item detail inline
than needed; compress each item to **title + status** (2 visible lines), with actions folded in as
compact inline icons (not a dedicated row — see M2/M3's actions requirement below) and everything
else moved into a details popup. Settings tab needs a general cleanup pass (M4). Contacts tab's
special TechSupport row needs its footprint shrunk to roughly ordinary-row size (M5), and ordinary
contact rows need a headshot added (M6, currently text-only).

#### M1. Disable "Replies To My Talks" section on the Talks tab

- **What it is:** `#creator-replies-panel` (`src/web/ui/ui-manager.ts:1000-1060`) — a self-contained
  block sitting above `#talks-list`, with its own header (`repliesTitle` — "Replies To My Talks",
  `ui-translations.ts:94`), a live summary span, 10 filter/sort/group controls, an active-filter-chip
  row, and `#creator-replies-list`. Populated by `renderCreatorReplies()`
  (`ui-manager.ts:2803-2943`) from `deriveLocalCreatorReplies(this.currentUserId)`
  (`ui-manager.ts:2798-2799`), called on every Talks-tab activation/filter change
  (`ui-manager.ts:1529`, `1543`) with no existing visibility flag gating it.
- Hide the section (wrap `#creator-replies-panel` in `style="display:none"` or remove the
      block outright) and short-circuit `renderCreatorReplies()`'s call sites to a no-op. The
      section is self-contained (own DOM ids, own filter state, doesn't feed `#talks-list`), so
      this is one contiguous edit, not a scattered one — confirmed safe to disable without
      touching the OUT/IN list below it.
      **Done 2026-07-30.** `deriveLocalCreatorReplies`'s output (`creatorReplyRows`) still feeds
      the OUT-row matched-names line (`ui-manager.ts` ~2313), so `refreshCreatorReplies()` keeps
      that derivation and only drops its own `renderCreatorReplies()` call.
- Test: `stage1` — Talks tab renders with `#creator-replies-panel` absent/hidden; `#talks-list`
      and its existing OUT/IN rows are unaffected.
      **Done 2026-07-30:** covered by the existing `00x-tab-sweep-smoke` (stage1) and
      `baa-techsupport-single-user-tabs` (stage0) specs, both updated with a `toBeHidden()`
      assertion right alongside their existing `#talks-list`/OUT-sort checks. Also had to
      `test.describe.skip` 5 specs dedicated to this panel's now-dead functionality
      (`35-reply-filter-query`, `65-reply-triage-option-matrix`, `00ad-reply-triage-group-date`,
      `00v-creator-reply-triage-matrix`, `70-reply-triage-grouping-multi`) and trim panel-specific
      assertions out of `00-ui-navigation-settings` — wider blast radius than the "self-contained"
      framing above assumed, since several specs asserted on this panel's own behavior directly.

#### M2. Compress flow/tag/survey/route talk rows to title + status, inline icon actions, details in a popup

- **Current state:** talk rows are NOT `.creator-reply-row` (that class belongs to M1's section) —
  they are `.talk-list-item` inside `#talks-list`, built in `displayTalksList()`
  (`ui-manager.ts:2190` onward).
  - **OUT row** (talks I created), `ui-manager.ts:2500-2529` (~30 lines/row): title, role/type/
    language badges, relative-time meta, expiration+location meta, a stats line (matches/
    mismatches/rate), an optional weighted-score/latest-reply line, an optional matched-names line,
    and an actions row (survey-stats button, broadcast toggle, remove button). Tag talks already
    have a simpler chip-only branch (`2490-2498`).
  - **IN row** (talks sent to me), `ui-manager.ts:2601-2633` (~33 lines/row): title+status+type
    badges, sender avatar/name row, a chip row (progress/language/expiry/location/distance/
    response), relative-time meta, a "from" senders line, and a single "View" action button. Tag
    talks have a simpler branch (`2591-2599`).
- **Actions requirement 2026-07-29 (Bernard): actions must not get their own dedicated row, and
  acting on an item must never need a prior "select the item" click.** Audited the existing click
  wiring to check this isn't already broken: it isn't — action buttons (`.remove-talk-btn`,
  `.survey-stats-btn`, `.view-talk-btn`, `.talk-broadcast-toggle-btn`) already fire immediately on
  their own single click via a document-level delegate (`ui-manager.ts:2200-2272`), and the
  separate row-click listener (`ui-manager.ts:2680-2702`) explicitly excludes clicks inside
  `.talk-item-actions`/`.view-talk-btn` (guard at `2688`) so the two never conflict — there is no
  existing two-step "select row, then act" flow to remove. What needs to change is purely visual:
  stop reserving a whole row for actions.
- Collapse both OUT and IN rows to 2 visible lines — **title** and **status** — with actions
      folded in as compact inline icon buttons rather than a dedicated row:
  - The row itself stays clickable for the primary action (open detail/editor — already the
    existing behavior, `ui-manager.ts:2680-2702`), so no new click is introduced for that case.
  - Secondary, same-shaped actions (remove, broadcast toggle, survey-stats, View) become small
    icon-only buttons inline on the title line (or status line), each independently clickable with
    `stopPropagation()` exactly as today — only their layout (icon-in-line vs. full button row)
    changes, not their click semantics.
  - Move everything else (badges beyond type, expiration, location, chips, matched-names, weighted
    score, sender detail) into a details popup opened from the row.
  - Applies identically to all four talk types (flow/tag/survey/route) — tag's existing
        simpler branch is the template to generalize from, not a special case to preserve.
- New details-popup modal, modeled on the existing `.modal-overlay`/`.modal-content`/
      `.modal-header`/`.modal-title`/`.modal-actions` skeleton already used by
      `showTalkResponseDialog` (`talk-response-dialog.ts:200-245`) and the peer-send-picker modal
      (`user-detail-view.ts:963-1000`) — same duplicate-guard-then-`appendChild`/remove pattern,
      not a new modal convention.
- Test: `stage1` — an OUT row of each talk type renders exactly 2 lines with inline icon
      actions (no dedicated actions row); a single click on an icon fires its action with no prior
      row-selection step; clicking the row body opens the details popup showing the previously
      inline fields.
- Test: `stage2` — an IN row renders 2 lines with an inline View icon; details popup shows
      sender/chip/meta info; the View action still opens the response flow in one click.

**Done 2026-07-30.** Implemented as designed, with one deliberate deviation from the "move
everything else" line above: matched-names (OUT) / sender-name (IN) stay **visible on the row**,
not moved into the popup — they're the interactive item 6/8 click-to-DM traceback affordance, not
decorative detail, and hiding them behind an extra popup-open click would violate Bernard's own
2026-07-29 "acting on an item must never need a prior select step" principle applied to this
affordance. Everything else (language badge, expiration/location meta, stats breakdown,
rank/weighted-score line, IN row's chip row) moved into the hidden `.talk-item-details` /
`.talk-item-status-line` structure as planned. Tag rows were intentionally left untouched — already
a simpler single-line chip branch, no dedicated actions row, single-click quick-decision UX; folding
them into the same template would have been a much larger, riskier change for no compaction benefit
since they're already more compact than the 2-line target.
- `showDetailsPopupFor(detailsEl, originalParent)` / `showTalkItemDetailsPopup(talkId)`
  (`ui-manager.ts`, near `showDmInboxPicker`) reparent (not clone) the row's hidden
  `.talk-item-details` node into a shared `#item-details-popup` modal and back on close, so
  already-wired interactive content inside it keeps working without re-wiring.
- New tests: `37-compact-talk-rows-out.spec.ts` (stage1 — flow/survey/route OUT rows: 2 visible
  lines, no `.talk-item-actions`, popup shows moved fields, broadcast-toggle/survey-stats/remove
  icons all fire on a single click) and `79-compact-talk-row-in.spec.ts` (stage2 — IN row: 2 visible
  lines, sender stays visible, popup shows the chip row, View icon fires on a single click). Both
  confirmed to fail without the fix and pass with it.
- Pre-existing regression risk, surveyed across the whole `tests/e2e/` tree before implementing:
  fixed `00-ui-navigation-settings.spec.ts`'s localization check (the broadcast-toggle's Chinese
  label moved from visible text to the button's `title` attribute — `toContainText` →
  `toHaveAttribute('title', …)`). Verified no regressions on the full at-risk list: 4/4
  `74-talk-row-person-traceback.spec.ts`, `00d-super-user-20-broadcast.spec.ts`,
  `08-super-user-copy-talk.spec.ts`, `38-mobile-talk-answer-flow.spec.ts`,
  `77-talk-to-me-tab-reverse-edge.spec.ts`, `28-stage-zero-n2n.spec.ts`,
  `36-per-question-deep-link.spec.ts`, `caa-techsupport-four-talk-types.spec.ts` (updated for M3,
  see below) — plus a full `stage1-single-user/` + `stage2-two-user/` sweep (149 passed, 2 failed:
  the localization fix above, and `00h-chatroom-hierarchy-broadcast.spec.ts` confirmed pre-existing
  on the base commit, unrelated to this change — a Gun-mesh-timing flake in regional broadcast
  scoping). `tsc`/`lint`/Jest (1048/1048) all clean.

#### M3. Compress Me tab question/answer entries to title + status, inline icon action, details in a popup

- **Current state:** `src/web/ui/answers-view.ts` has two structurally-identical row builders — one
  for flattened per-question history (`389-454`) and one for legacy deduped talk records
  (`455-514`) — each producing an `.answer-question-item.answer-talk-item` div.
  - **Row shell** (`437-451`, `498-512`, ~15 lines): title, a metadata line (senders · item count ·
    date · location · answered-count), an outcome+type+language badge line, a copy-to-talks button,
    plus a nested `.answer-question-list` container.
  - **Nested per-question detail** (`renderAnswerItemsHtml`, `230-303`+): one `.answer-outcome-item`
    per Q/A, each with its own header line (question/tag label + counts), the prompt text, the
    answer/choice, a badge row (manual/auto/permanent mode, auto-use-count, latest-auto-use
    timestamp), and an optional context block (hash + path) — up to 4 more lines per nested
    question, on top of the 3 shell lines above.
  - **Existing click wiring already single-click, no prior selection needed:** `.answer-copy-talk-btn`
    has its own click listener (`answers-view.ts:527-533`, `stopPropagation()`), independent of the
    row's own click listener (`535-541`, guarded to skip the button via `.closest('.answer-copy-talk-btn')`
    at line 537) which opens talk detail. Same "no dedicated actions row" requirement as M2 applies
    here — this is a layout change, not a new interaction to wire up.
- Collapse each answer entry to 2 visible lines — **title** and a single **status** line (e.g.
      outcome + answered-count) — with the copy-to-talks action folded in as a compact inline icon
      on the title or status line rather than its own row. The row body stays clickable to open
      talk detail (existing behavior, unchanged). Move the metadata line, badge line, and all
      nested per-question detail (prompt/answer/mode badges/context) into a details popup opened
      from the entry.
- Reuse the same modal skeleton as M2 rather than inventing a second popup convention.
- Test: `stage1` — an answer entry renders exactly 2 lines with an inline copy-to-talks icon
      (no dedicated actions row), regardless of how many nested questions it has; the icon fires
      copy-to-talks in one click with no prior selection step; the details popup shows the full
      per-question breakdown (prompt, answer, mode badges, context) that used to render inline.

**Done 2026-07-30.** Unlike M2, no exception was made here — per-question detail (prompt/answer/
mode badges/context) moves entirely into the popup, since (unlike matched-names/sender-name) it
has no click-to-navigate affordance of its own; the row body's existing click still opens talk
detail. New `showItemDetailsPopup` dep in `AnswersViewDeps` (`answers-view.ts`), wired in
`ui-manager.ts`'s `displayAnswersList()` as `this.showDetailsPopupFor.bind(this)` — reuses M2's
popup mechanism rather than inventing a second one. Both row builders (flattened-history and
legacy-deduped) collapsed to `.answer-item-title` + `.answer-item-status-line` (outcome +
answered-count + inline copy/details icons), with metadata/badges/`.answer-question-list` moved
into a hidden `.answer-item-details`. New test `76-compact-answer-rows.spec.ts` (stage1, using a
self-answered route talk since its 2-question self-answer produces the richest nested detail of
all four types): 2 visible lines, no dedicated actions row, popup shows the full per-question
breakdown including context path, copy-to-talks icon fires on a single click and the copied talk
appears as a fresh OUT row. Confirmed it fails without the fix and passes with it.
Updated `caa-techsupport-four-talk-types.spec.ts`'s visibility assertions on `.answer-outcome-item`
to open the details popup first (text-content checks like `toContainText` still work while hidden,
but `toBeVisible()` needs the popup open) — a deliberate, expected consequence of this item's own
design change, not an accidental break. Also updated the Jest unit test
`src/test/unit/answers-view.test.ts`'s 5 `displayAnswersList(...)` call sites to include the new
required `showItemDetailsPopup` dep. Verified no other regressions: `08-super-user-copy-talk.spec.ts`,
`77-talk-to-me-tab-reverse-edge.spec.ts`, `00d-super-user-20-broadcast.spec.ts`,
`29-me-answers-search.spec.ts`, `56-me-dialogs.spec.ts`, `36-per-question-deep-link.spec.ts`,
`05-talks-edit.spec.ts`, `35-me-answer-dead-end-retry.spec.ts` all still pass (these only assert on
the outer `.answer-talk-item` container or use visibility-independent selectors, unaffected by the
inner-content move). `tsc`/`lint`/Jest (1048/1048) all clean.

#### M4. Settings tab cleanup

Requirement 2026-07-29 (Bernard): "Settings tab looks too messy."

- **Current state:** `renderSettingsView()` (`ui-manager.ts:3018-3348`, ~330 lines) stacks **9–10
  sections** flat in one long scroll inside `#settings-content` (`ui-manager.ts:3019`, hosted in
  `#settings-view`, `ui-manager.ts:1230`), via a plain CSS grid wrapper (`ui-manager.ts:3117`) —
  profile, credit/reputation stats, languages, talk behavior, distance/home room, content filters,
  linked devices, erase device, storage inspector, and (TechSupport-only) the support inbox.
  - Content filters (`ui-manager.ts:3266`) is really 4–5 sub-concerns bundled into one `<section>`:
    grammar/dirty-word toggles, the dirty-word chip editor, allowed-talk-types chips, a blocked-
    phrases textarea, and a filtered-incoming summary.
  - Every section repeats the same literal inline-style wrapper string
    (`<section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">`,
    e.g. `ui-manager.ts:3118, 3164, 3185, 3227, 3238, 3266, 3317, 3326, 3335`) copy-pasted rather
    than a shared helper — erase-device is the one exception, swapping in a danger border color
    (`ui-manager.ts:3326`).
  - Section headings are inconsistent: some are a plain styled `<div>` (e.g. `3186, 3228, 3239,
    3267`), others are a flex row with title+subtitle+action-button (e.g. `3150-3156, 3165-3169,
    3318-3323, 3327-3331, 3336-3338`) — two interchangeable conventions with no rule for which to
    use where.
  - No accordion/collapsible/tabs-within-tabs pattern exists anywhere in Settings (confirmed: zero
    `<details>`/`<summary>`/"accordion"/"collapsible" hits in `ui-manager.ts`; the only
    `<details>` usage in the whole UI layer is unrelated, in `answers-view.ts:312-313`).
- Extract one shared section-wrapper helper (consistent border/background/padding, one heading
      convention — pick the flex title+subtitle+action pattern since it already covers the cases
      that need an inline action button) and convert all 9–10 sections to use it, instead of the
      copy-pasted inline-style string.
- Split the content-filters section into its actual sub-concerns (or at minimum give each
      sub-concern its own heading within the section) rather than bundling grammar/dirty-word/
      allowed-types/blocked-phrases/summary into one undifferentiated block.
- Decide whether the now-consistent sections should also be grouped/collapsed (e.g. an
      accordion, or a lightweight in-page section nav) given there are 9–10 of them stacked in one
      scroll — no existing pattern to reuse, so this needs a small design decision before
      implementation, not just a mechanical refactor.
- Test: `stage1` — every Settings section renders via the shared wrapper (no leftover ad hoc
      inline-style section markup); all existing controls in every section (profile, languages,
      distance, content filters, linked devices, erase device, storage inspector) still read/write
      the same state and fire the same handlers as before the refactor.

**Done 2026-07-30.** New `renderSettingsSection(opts, bodyHtml)` helper (`ui-manager.ts`, right
before `renderSettingsView`) renders `<details class="settings-section" open><summary>title +
optional subtitle</summary><div class="settings-section-body">optional action + bodyHtml</div>
</details>` — all 9 sections (profile, credit, languages, talk behavior, distance/home, content
filters, linked devices, erase device, storage inspector) now use it, replacing the copy-pasted
`<section style="padding:16px;background:#fff;...">` string. Design decision for the "grouped/
collapsed" question: extended the one existing precedent (`answers-view.ts`'s context-group
`<details>`) rather than inventing an accordion widget or in-page nav — every section is
independently collapsible via the native disclosure triangle, defaulting to **open** so nothing
about current visibility changes unless the user collapses a section themselves. Action controls
(Manage/Erase/Refresh buttons, the credit-visibility checkbox) render in the body just below the
summary rather than inside it, specifically so their own click handlers never fight the browser's
native summary-click-toggles-open/closed behavior — no new click semantics needed for any existing
button. Content-filters split into 4 visually-separated sub-concerns with their own headings:
message filters (new `settingsMessageFiltersHeading`), the dirty-word list (existing
`settingsDirtyWordsListLabel`), allowed talk types (existing `settingsAllowedTypes`), blocked
phrases (existing label promoted to a heading), and filtered-incoming summary (new
`settingsFilteredIncomingHeading`) — two new translation keys added (EN+ZH). New test
`77-settings-section-wrapper.spec.ts` (stage1): asserts zero leftover `<section>` elements, exactly
9 `.settings-section` wrappers all starting `open`, collapsing one section hides only its own body
(others unaffected), then exercises a representative control from profile/credit/content-filters/
distance/linked-devices/erase-device/storage-inspector to confirm each still reads/writes the same
underlying state as before the refactor. Confirmed it fails without the fix (`9` leftover `<section>`
elements found) and passes with it. Verified visually via a throwaway screenshot script (not
committed) — clean bordered cards, consistent title+subtitle+action heading, correct
collapse/expand behavior, and the four labeled content-filters sub-concerns render as intended.
Regression: full `stage1-single-user/` sweep (84/84 passed, including `00-ui-navigation-settings.spec.ts`,
`31-intake-filters-persist.spec.ts`, `32-language-setting-persist.spec.ts`, `00y-chinese-ui-traversal.spec.ts`,
`71-linked-devices-page.spec.ts`, `72-erase-this-device.spec.ts`) plus stage2's
`04-profile-edit-stage-name.spec.ts`. `tsc`/`lint`/Jest (1048/1048) all clean.

#### M5. Compact the TechSupport row on the Contacts tab

Requirement 2026-07-29 (Bernard): TechSupport is a special contact and should stay in the list (or
somewhere visible), but take up less space than it does today.

- **Current state:** the TechSupport row (`src/web/ui/contacts-view.ts:730-741`) is unconditionally
  **3 always-on content lines** — name + a "Pinned" badge + a presence-indicator dot (line 734), a
  dedicated "Built-in support contact" label line (line 735), and a notifications-muted/on status
  line (line 736) — versus an ordinary contact row (`contacts-view.ts:754-765`), which is 2 base
  meta lines plus at most 1 conditional line (sort-mode-dependent, lines 758-761). TechSupport's
  extra footprint is specifically the badge/presence-dot pair plus the two dedicated label lines
  that ordinary rows have no equivalent of.
  - It is **not** part of the sortable peer list at all — unconditionally string-prepended above
    `visiblePeers` (`contacts-view.ts:742`), so it's always pinned to the top regardless of sort
    order, and excluded from the self-heal peer-iteration loop (`contacts-view.ts:787`). Visibility
    (not position) is gated by `showSupportContact` (`contacts-view.ts:669`).
- Compress the row to match (or be smaller than) an ordinary row's footprint — collapse the
      "Built-in support contact" label and the notifications-muted/on status into the same line as
      the name (e.g. as a compact badge/icon next to the presence dot, not a separate line each).
      Keep the "Pinned"-to-top positioning and the presence indicator itself — the requirement is
      shrinking the footprint, not removing the special treatment or hiding the contact.
      **Done 2026-07-30.** Went one step further than merging into one meta line: the "Built-in
      support contact" label was dropped entirely (the "Built-in" pinned badge on the name line
      already says this — a genuinely redundant line, not just mergeable), and mute-state became a
      🔕/🔔 icon next to the presence dot. Result: the row's content is a single line, no
      `.contact-item-meta` divs at all (an ordinary row has 2).
  - Move any detail that doesn't fit inline (e.g. full mute-state explanation) into the
        existing peer-detail/relationship modal (`openSupportControlsDialog`) rather than a new
        row-level popup — TechSupport already has a dedicated controls dialog reachable from the
        row, unlike the Talks/Me items in M2/M3.
        **Done 2026-07-30.** Already true without changes needed — `openSupportControlsDialog`
        (`contacts-view.ts:157`) already renders both the full "Built-in support contact"
        description and the full mute-status sentence; only the row template needed to stop
        duplicating that text.
- Do not touch `contactsViewDeps()` (`ui-manager.ts:1858-1897`, three call sites at `1900`,
      `1904`, `7618`) — the fields it provides (`hasSupportContact`, `isTechSupportOnline`,
      `isSupportNotificationsMuted`) stay the same; only the row template's use of them changes
      from separate lines to inline elements.
      **Confirmed 2026-07-30:** `contactsViewDeps()` diff is empty; only the `supportRow` template
      in `contacts-view.ts` changed.
- Test: `stage1` — TechSupport's contact row renders at (or below) the line-count of an
      ordinary row, still appears pinned at the top of Contacts regardless of sort order, and its
      presence indicator + mute state are still readable (inline instead of on their own lines).
      **Done 2026-07-30:** extended `00k-techsupport-contact-mute.spec.ts` with a
      `.contact-item-meta` count(0) assertion (line-count) plus `.techsupport-mute-indicator`
      `data-support-muted` checks (mute state still readable, machine-checkable); pinned-to-top
      positioning was already covered by existing assertions in that spec and untouched by this
      change. Confirmed these assertions fail without the fix.

#### M6. Show headshots on ordinary contact rows

Requirement 2026-07-29 (Bernard): "for all other contacts, their headshots should be included."
(TechSupport's row is out of scope here — it's the special case handled separately in M5.)

- **Current state: no visual avatar at all.** The ordinary-peer row (`contacts-view.ts:754-765`,
  inside `visiblePeers.map(...)` at `contacts-view.ts:743`) renders only the name, an optional
  "Blocked" badge, two meta lines, and an optional match-rate/rank chip — no `<img>`, no avatar
  element of any kind. A person is represented purely by text today.
- **Reuse what already exists — don't build a new renderer.** `avatarInnerHtml(headshot, fallback,
  escapeHtml)` (`src/web/ui/profile-avatar.ts:5-15`) already does exactly this: renders an
  `<img class="profile-avatar-image">` when the value is a `data:image/...;base64,...` string
  (validated by `isProfilePhoto()`, `profile-avatar.ts:1-3`), or falls back to rendering an emoji
  glyph/fallback character as plain text otherwise (a user's "headshot" is one of a fixed emoji
  set or an actual photo, `ui-manager.ts:3115,5171`/`3806,3868`). It's already used the same way in
  the Relationship modal (`contacts-view.ts:251`) and the peer detail view (`user-detail-view.ts:501`).
- **Data source:** `headshot` field from `user-public-profile/<userId>` in Gun, read via
  `getPublicProfileFoundation` (`app.ts:756-768`, `setPublicProfileFoundationReader`), already
  wired into `ContactsViewDeps.getPublicProfileFoundation` (`contacts-view.ts:41-46`, wired at
  `ui-manager.ts:1895`/`7588`) — no new plumbing needed to *fetch* it, only to *cache and render*
  it in the list.
- **The real gap: no per-peer batch cache for the list.** `contactDetailUserProfileCache`
  (`contacts-view.ts:202`) is a single-slot cache for one contact's detail modal, wiped every time
  a different contact is opened — useless for rendering the whole visible list at once. A headshot
  is a full base64 payload (not a lightweight URL), so a per-row live fetch on every re-render/
  sort/filter would be wasteful. Model the fix on the existing `peerLocationCache` pattern
  (`ui-manager.ts:654-677`: a `Map<userId, ...>` populated once via `prefetchPeerLocations`,
  called before `displayContactsList` runs at `ui-manager.ts:1892`, then read synchronously
  during row rendering).
- **Caution (added after R's audit, 2026-07-29):** adding this prefetch as another blocking
  `await` alongside `prefetchPeerLocations` in `beforeRender` would compound the slow-load problem
  R exists to fix (500 contacts already wait on a ~3.2s blocking chain before anything renders).
  Land R's non-blocking first-chunk-then-fill split before or alongside this item, and make the
  headshot prefetch follow that same fill-in-place pattern rather than gating first paint further.
- Add a `Map<userId, headshot>` cache + a `prefetchPeerHeadshots(userIds)` batch-fetch
      (`Promise.all` over `getPublicProfileFoundation`), called alongside the existing
      `prefetchPeerLocations` before `visiblePeers.map(...)` runs (`contacts-view.ts:742-743`).
      **Done differently 2026-07-30, per the caution above:** no batch `prefetchPeerHeadshots`
      call in `beforeRender` — `peerHeadshotCache`/`resolvePeerHeadshot` exist, but are populated
      per-peer from `contacts-view.ts`'s non-blocking self-heal loop instead, so first paint isn't
      gated on a headshot batch-fetch.
- Render `avatarInnerHtml(cachedHeadshot, '?', escapeHtml)` into each ordinary row
      (`contacts-view.ts:754-765`), reading synchronously from the new cache — same pattern the
      Relationship modal and peer detail view already use, just sourced from the prefetch cache
      instead of a live per-open fetch.
- Test: `stage1`/`stage2` — a contact with a real photo headshot shows the image in their
      Contacts row; a contact with an emoji headshot shows the emoji; a contact with no headshot
      set shows the same `?` fallback the Relationship modal already uses. Re-sorting/filtering the
      list does not re-fetch headshots (reads from cache).
      **Done 2026-07-30 (emoji + no-headshot + no-refetch):** `75-contact-headshots.spec.ts`.
      Real-photo case not separately tested — `avatarInnerHtml`'s photo-vs-emoji branch is
      unchanged, already exercised by the Relationship modal/peer detail view's existing tests;
      re-testing it here would only re-prove the shared helper, not this row's new wiring.
      Confirmed the new spec fails without the fix and passes 3/3 with it.

## 2026-07-30 — N: DM notification, cross-tab "pick a conversation" affordance, talk-row traceback (N1/N2/N3 complete)

Moved from `docs/TODO.md` N.

### N. DM notification, cross-tab "pick a conversation" affordance, talk-row traceback `[Opus]`

Requirement 2026-07-29 (Bernard): being sent a DM should notify me and let me easily get to that
chat window; if more than one person has DMed me, I should see a sorted list of senders and be
able to pick one — reachable no matter which tab I'm currently on. Also: from a Talks-tab item, I
should be able to trace back to who I exchanged it with and go straight to DM with them (N3).

**Audit (2026-07-29).** Two of the three pieces already exist and work; the third (cross-tab
"pick one from a list") does not exist at all today:

- **A toast already fires on a new DM from elsewhere in the app**, but it doesn't navigate.
  `syncConversationMessageSummary` (`ui-manager.ts:8758-8777`) calls
  `showNotification(tf('conversationNewMessage', {name}), 'info')` (line 8776) whenever a new
  incoming message arrives for a conversation that isn't currently open. But `showNotification`
  (`ui-manager.ts:6719-6770`) only wires click-to-navigate when `isMatchNotification &&
  options?.conversationId` (lines 6748-6756) — the DM-arrival call passes no `options`, so
  clicking this toast today only dismisses it.
- **Per-conversation and aggregate unread state already exist and are exercised by a passing
  spec** (`stage2/10-message-unread-badge.spec.ts:265-325`): `conversation.unreadCount`/`unread`
  (`ui-manager.ts:8728-8751`), and an aggregate count via `updateMatchBadge()`
  (`ui-manager.ts:7870-7892`) stamped onto `.nav-btn[data-view="me"] .nav-icon` as a
  `.notification-badge`.
- **There is no cross-tab "pick a conversation" list anywhere in the shipped app.**
  `conversations-view.ts`'s `displayConversationsList()` targets `#conversations-list`
  (`conversations-view.ts:37-39`), which **no static HTML template defines** — confirmed dead code
  (also documented in `29-conversation-list-sorting.md:22-24` and `docs/completed.md:3109`). The
  Me-tab nav badge above therefore points at nothing: it shows a count with no list behind it. The
  actual way to reach any conversation today is Contacts tab → a contact row → the merged
  `#peer-detail-overlay` (`openPeerDetailView`, `user-detail-view.ts:152`) → its messaging section
  (`refreshPeerThreadList`, `user-detail-view.ts:668,683`) → `showConversationDetail`
  (`user-detail-view.ts:777` → `ui-manager.ts:4852`, opens `#conversation-detail-overlay`,
  `ui-manager.ts:1068`) — a multi-step path that only starts from the Contacts tab, not "any tab."
- **Existing sort convention to reuse:** both the dead `conversations-view.ts:42-46` and the live
  Contacts "recent" sort mode (`contacts-view.ts:667-711`, `709`) already sort by most-recent-
  message/interaction time descending — no new sort logic needed, just apply the same rule to
  whichever senders currently have `unread === true`.

**Work**

- **N1 — make the DM toast clickable.** Pass `{ conversationId }` when calling
      `showNotification` for the DM-arrival case (`ui-manager.ts:8776`), and extend the
      click-navigate condition at `ui-manager.ts:6753` to also fire for plain DM-arrival toasts,
      not only `isMatchNotification`. **Design decision needed first:** should the click route
      through `showConversationDetail` (opens the legacy `#conversation-detail-overlay` directly,
      today's only working destination) or through `openPeerDetailView` (the "real"
      Contacts-tab-linked flow, redesign §5 rule N2a's contact-click-lands-on-DM convention)? Pick
      one destination and use it consistently with N2 below.
      **Done 2026-07-30.** Decided `openPeerDetailView`'s destination (via
      `navigateToGraphNode({type:'person',...})`, N2a convention), not `showConversationDetail` —
      keeps one consistent "go to this person" behavior across Contacts/Chatroom-roster/DM-toast/
      future N3/O, rather than the toast being a one-off. Existing Match!-toast click (rule N6)
      left as `showConversationDetail`, unchanged — a separate, already-shipped behavior, not part
      of this decision. `showNotification` gained `peerId`/`peerName` options for this.
- **N2 — build the actual "no matter which tab" affordance**, since none exists: a small
      global element (app-bar icon is the natural fit, consistent with the existing icon-button
      row in `#top-header`) visible from every tab, badge-driven off the same aggregate unread
      count `updateMatchBadge()` already computes (`ui-manager.ts:7870-7892`), that opens a sorted
      list of senders with unread messages — reusing the existing recency sort
      (`contacts-view.ts:709`) and the existing per-conversation `unreadCount`/`unread` fields
      (`ui-manager.ts:8728-8751`). Clicking a person in that list opens their conversation via the
      same destination N1 settles on.
      **Done 2026-07-30.** `#dm-inbox-btn` in `#header-actions`, no `data-appbar-view` attribute
      (so it's visible on every tab by construction, not a per-view special case);
      `showDmInboxPicker()` sorts unread conversations by `lastMessageTime` descending directly
      (didn't need `contacts-view.ts`'s fuller sort-strategy machinery for this simpler list).
  - Decide whether this list is a small dropdown/popover off the app-bar icon (lightweight,
        modeled on the existing `.modal-overlay` pattern used elsewhere — see M2's note on
        `talk-response-dialog.ts:200-245`) or whether it finally revives `#conversations-list` as
        a real, reachable surface. Either is acceptable; **do not leave the Me-tab badge pointing
        at a dead element** as it does today.
        **Decided 2026-07-30:** modal-overlay dropdown (modeled on item 8's
        `showChooseWhoToDmPicker`) — smaller diff than reviving `#conversations-list`/
        `displayConversationsList()`, which remain dead code, unaddressed by this item (a
        separate, still-open cleanup opportunity, not required for this requirement since the
        new picker independently satisfies "pick a conversation from any tab").
- Test: `stage2` — Tom messages Jerry while Jerry is on Chatrooms/Talks/Settings (not
      Contacts); Jerry sees the toast and/or the app-bar affordance's badge update regardless of
      active tab; clicking either navigates to the Tom↔Jerry conversation.
      **Done 2026-07-30, both halves:** toast half via `73-dm-arrival-toast-navigation.spec.ts`;
      badge half via `78-dm-inbox-affordance.spec.ts` (badge visible on Settings, picker opens,
      picking navigates to the right conversation). Both confirmed to fail without their
      respective fixes and pass with them.
- (OPEN) Test: `stage3` — Tom and Jerry both DM Bob while Bob is on a non-Contacts tab; Bob opens the
      cross-tab affordance and sees both senders sorted most-recent-first; picking one opens that
      conversation, and the other sender's unread state is unaffected.
      **Not built 2026-07-30** — `78-dm-inbox-affordance.spec.ts` covers the single-sender case
      (list rendering, sort call, click-to-navigate); the multi-sender sort-order + independent-
      unread-state assertions this stage3 test specifically wants remain an open follow-up.

#### N3. From a Talks-tab item, trace back to who I exchanged it with, then DM them

Requirement 2026-07-29 (Bernard): "from talks tab, on each item, there should be a way to trace
back to whom I exchanged this talk with, then go to DM with him."

**Audit (2026-07-29).** The names are already displayed on talk rows, but they're inert text —
clicking one does nothing beyond what clicking anywhere else on the row does.

- **Not clickable today:** the OUT row's matched-names line (`ui-manager.ts:2469-2472`) and the IN
  row's sender avatar/name + "from …" line (`ui-manager.ts:2610-2614`, `2626-2628`) are plain
  `<div>`/`<span>` elements with no `data-user-id` and no dedicated listener. The only click
  handler on these rows is the row-level one (`ui-manager.ts:2680-2702`), which opens the talk
  editor/detail regardless of where inside the row you click — so today, clicking a name just
  opens the talk, not the person.
- **The peer id is already one property away, not missing data:** the OUT row's matched-names are
  derived from `Object.values(conversations).filter(c => c.talkId === talkId)`
  (`ui-manager.ts:2451-2453`), and each conversation record already carries `otherUserId`
  (`app.ts:2332-2335`, `2395-2398`) — the code just maps it down to a display-only name string,
  discarding the id. The IN row's senders come from `cluster.senders`, already a real
  `senderId → {senderId, senderName}` map (`ui-manager.ts:2547`, `2739-2741`), also reduced to a
  name-only string for display. No new data plumbing is needed, only re-threading the ids that are
  already present into the click targets.
- **DM-opening machinery already exists** — reuse it, don't build a second path:
  `openDirectConversationWithPeer(peerId, peerName)` (`ui-manager.ts:7544`, finds-or-creates a
  conversation for a peer id) and `showConversationDetail(conversationId, threadTalkId?)`
  (`ui-manager.ts:4852`, opens the overlay bound to a specific talk thread). Whichever one N1
  settles on as the DM-toast destination should be the same one used here, for one consistent "go
  to DM" behavior across the app rather than two.
- **Multi-partner talks already carry a real list, not just a count:** a broadcast talk answered by
  several people has more than one entry in the same `conversations`-filter (OUT) or
  `cluster.senders` (IN) source above — so "trace back to whom" can genuinely mean more than one
  person per talk, not just one.

**Work**

- (OPEN) Make the matched-names (OUT) and sender-name/"from …" (IN) elements clickable, threading the
      already-available `otherUserId`/`senderId` onto each as a `data-user-id` (or similar), with a
      dedicated listener that `stopPropagation()`s so it doesn't also trigger the row's
      open-talk-editor/detail behavior (same coexistence pattern the actions buttons already use at
      `ui-manager.ts:2200-2272`/`2680-2702` — a new click target added to an existing row without
      disturbing the row's own click behavior).
  - Single exchange partner: click navigates straight to the DM with that person via the N1
        destination.
        **Done 2026-07-30.** `data-matched-people`/`data-sender-people` (JSON `{id,name}[]`) +
        one delegated handler; single-person case navigates via `navigateToGraphNode`.
  - Multiple exchange partners: click opens a "choose who to DM" list, modeled on the existing
        `#peer-send-picker-modal` (`user-detail-view.ts:952-1000` — list rows + modal skeleton +
        confirm/cancel wiring), adapted from "pick which talks to send" to "pick which person to
        DM." Picking one navigates via the same N1 destination.
        **Done 2026-07-30.** No confirm/cancel step needed here (unlike the send-picker's
        multi-select) — since picking is single-choice, a row click both picks and closes.
- Test: `stage2` — an OUT talk matched by exactly one responder: clicking their name in the
      Talks-tab row opens the DM with them directly.
      **Done 2026-07-30:** `74-talk-row-person-traceback.spec.ts` ("OUT row: clicking the sole
      matched name…"). Confirmed it fails without the fix, passes 3/3 with it.
- Test: `stage3` — an OUT talk matched by two or more responders: clicking the matched-names
      area opens a picker listing all of them; choosing one opens that specific DM.
      **Done 2026-07-30:** `74-talk-row-person-traceback.spec.ts` ("OUT row: two matched
      responders opens…"), 3-user real broadcast+match setup. Confirmed it fails without the fix,
      passes 3/3 with it.
- Test: `stage2` — an IN talk row's sender name: clicking it opens the DM with the sender,
      without also opening the talk editor/detail (click doesn't double-fire).
      **Done 2026-07-30:** same spec, "IN row: clicking the sender name…" — required a real
      broadcast-and-receive setup rather than the fast-match helper, since the fast helper's
      synthetic conversation never populates a real `senderId` on the incoming cluster (only the
      answered-history fallback path does, which has no id by design — noted as a pre-existing,
      out-of-scope quirk). Confirmed it fails without the fix, passes 3/3 with it.

- [x] Test: `stage3` — Tom and Jerry both DM Bob while Bob is on a non-Contacts tab; Bob opens the
      cross-tab affordance and sees both senders sorted most-recent-first; picking one opens that
      conversation, and the other sender's unread state is unaffected.
      **Done 2026-07-30:** `79-dm-inbox-multi-sender.spec.ts`. No product code change needed —
      `showDmInboxPicker` already sorted every unread conversation (not just one sender) by
      `lastMessageTime` descending, and `showConversationDetail` already scoped its
      unread-clearing to the opened conversation only. Confirmed 3/3 green.


## 2026-07-30 — O: Peer detail exchanged talks as pickable DM context

Moved from `docs/TODO.md` O. Complete, all 6 work items + all tests.

### O. Peer detail: exchanged talks as pickable DM context, not just one thread from scratch `[Opus]`

Requirement 2026-07-29 (Bernard): from Contacts, clicking a person should show a page of all talk
exchanges and statistics between the two of us; DM should then be able to use *any* of those talks
as pre-existing context to start from, not just one context from scratch.

**Audit (2026-07-29).** The exchanged-talks list and the statistics already exist — the gap is
that the list isn't interactive, and DM can only be scoped to a talk that already happens to have
messages, not any exchanged talk.

- **Statistics: already built, this part of the ask is essentially done.** `computeLocalStats`
  (`user-detail-view.ts:400-424`) computes sent/received talk+match counts, mutual matched talks,
  and mutual tag count, purely from local data (no server call — the old `peer-routes.ts` server
  endpoint this used to hit was deleted; the formula moved client-side, see
  `src/shared/peer-summary-types.ts:1-4`, `src/web/services/local-peer-derivation.ts:1-22`).
  Rendered by `renderStatsHtml` (`user-detail-view.ts:561-618`) inside the peer-detail overlay.
  Only gap versus "statistics of two": no message-count or "known each other since" stat — minor,
  optional follow-up, not a blocker.
- **Exchanged-talks list: already built, but not clickable at all.** `#peer-talk-history-list`
  (`fetchAndRenderHistory`/`renderHistory`, `user-detail-view.ts:785-865`) already shows **every**
  exchanged talk — title, type badge, sent/received direction, outcome (match/mismatch/pending),
  relative date — with sort and filter controls. But it has **zero click handlers**: confirmed a
  single occurrence of `.peer-history-item` (`:852`) with no listener attached anywhere. It's pure
  display today.
- **A separate, narrower list is the only thing that's clickable, and it's incomplete.**
  `#peer-conversations-section` (`renderMatchedConversations`/`refreshPeerThreadList`,
  `user-detail-view.ts:668-783`) shows one row per talk in `conv.relatedTalkIds` — but that array
  is **only populated once a message tagged with that talkId has actually been sent**
  (`web-conversation-service.ts:212-236`). So a matched talk with zero messages yet, or any
  mismatch/pending talk, never appears here and has no way to become the active DM context — even
  though it's already sitting, inert, in the history list above.
- **"Start DM from scratch" is the only generic entry point, and it really does start from
  scratch.** `openDirectConversationWithPeer` (`ui-manager.ts:7544`, reached via
  `openDirectConversation` at `7600-7601`) always opens the talk-independent `'direct'` DM with no
  talk-context parameter at all (`app.ts:5207`) — there is no way to say "start this DM, but with
  talk X as the opening context."
- **This is a thread-selection problem within one conversation, not a multi-conversation picker.**
  Conversations are 1-per-pair (`buildPairConversationId`, `web-conversation-service.ts:250`), and
  a talk becomes a "thread" inside that one record via `conv.threadSummaries[talkId]`
  (`user-detail-view.ts:692-693,732`; written `ui-manager.ts:8489-8538`) plus per-message `talkId`
  tagging. So "pick any exchanged talk as context" means being able to open/create a
  `threadSummaries[talkId]` entry for a talk that doesn't have one yet, not picking among several
  separate conversations. `currentThreadTalkId` (set once at open time, `ui-manager.ts:4852,4869`)
  already has no in-overlay way to switch mid-session either — confirmed no tab/dropdown control
  exists (only leaving and reopening from a different row resets it, `ui-manager.ts:4956-4970`).

**Work**

- Make `#peer-talk-history-list` rows (`user-detail-view.ts:785-865`) clickable — every
      exchanged talk, not only ones already in `relatedTalkIds`. Clicking one opens the DM with
      that peer, with that talk as the active thread context (creating a `threadSummaries[talkId]`
      entry on demand if one doesn't exist yet, rather than requiring a message to have been sent
      first).
      **Done 2026-07-30.** Turned out `showConversationDetail` already tolerates an arbitrary
      `threadTalkId` with no pre-existing `threadSummaries[talkId]` entry — it just becomes the
      active scope, and the entry forms naturally once a message is sent under it. No extra
      "creation" logic needed beyond wiring the click.
- Extend `openDirectConversationWithPeer`/`showConversationDetail` (`ui-manager.ts:7544`,
      `4852`) to accept an optional `talkId` context param so both the generic "message this
      person" entry point and the history-list click path go through one consistent function,
      instead of the history list needing its own separate opening logic.
      **Done 2026-07-30.** `showConversationDetail` already had it; added the same optional
      `talkId` to `openDirectConversationWithPeer` and the `openDirectConversation` dep it's bound
      through, so the history-list click reuses this one path instead of inventing its own.
- Decide (small design call) whether switching which talk is the "active context" mid-session,
      inside an already-open conversation, is in scope now or a follow-up — today there's no
      in-overlay control for that at all; at minimum, opening from a *different* history row while
      already in a conversation with the same peer should re-scope to the newly picked talk.
      **Decided 2026-07-30:** already correct by construction, no extra work needed — every history
      row click goes through the User layout first (back-then-click-another-row), and
      `showConversationDetail` unconditionally overwrites `currentThreadTalkId` on every call, so
      re-scoping already happens naturally. An in-overlay switcher (without leaving to the User
      layout first) is a follow-up, not required by this item's wording.
- Test: `stage2` — clicking a *mismatched* or *pending* exchanged talk in the history list
      (never previously messaged) opens a DM with that talk as context — no message required to
      exist first.
      **Done 2026-07-30:** `76-peer-history-clickable.spec.ts` ("a mismatch talk with no
      conversation yet…"). Confirmed it fails without the fix, passes 3/3 with it.
- Test: `stage2` — clicking a *matched-with-existing-messages* talk still opens the same
      thread it already would via `#peer-conversations-section` today (no regression).
      **Done 2026-07-30:** same spec's second test, first half (clicking the already-matched
      talk's history row).
- Test: `stage3` — two different exchanged talks with the same peer, picked one after another
      from the history list, each open/create their own distinct thread context rather than
      collapsing into one.
      **Done 2026-07-30 (as stage2, not stage3 — two-user setup was sufficient, a third user
      wasn't needed to exercise "two talks, one peer"):** same spec's second test, second half —
      confirmed both talks share the same conversationId (one-per-pair) but re-scope
      `currentThreadTalkId` distinctly each time.

## 2026-07-30 — P: Me tab robust Q&A -> source-talk traceback (no dead ends)

Moved from `docs/TODO.md` P. Complete, all 3 work items + all 4 tests.

### P. Me tab: robust Q&A → source-talk traceback (no dead ends) `[Opus]`

Requirement 2026-07-29 (Bernard): each question/answer pair on the Me tab should be traceable back
to the talk it came from; the user should not hit a dead end in most cases.

**Audit (2026-07-29).** Traceback already exists at the entry level, but it has one real dead-end
case, no traceback at all for individual questions inside a multi-question entry, and one
inconsistency in destination.

- **Entry-level traceback exists and mostly works.** Clicking an `.answer-talk-item` row
  (`answers-view.ts:535-541`) calls `showTalkDetail(talkId)` (`ui-manager.ts:2952`, impl
  `4599-4645`), which opens instantly if the talk is cached locally (`4617-4629`), or requests it
  via `demandFullTalk` (`app.ts:4886-4905`) otherwise. `talkId` itself is never missing by
  construction — it's a required field written at record-save time (`answer-history-storage.ts:15`;
  `ui-manager.ts:6049-6124`) or derived straight from the `myTalks` object key in the legacy path
  (`answers-view.ts:389, 496`).
- **The actual dead end: a talk that no longer resolves (purged/expired/never re-synced) fails
  silently past a bare error toast, with no recovery.** When `demandFullTalk` can't resolve the
  talk, `app.ts:4899-4903` calls back `null`, and `ui-manager.ts:4636-4641` shows
  `t('talksCouldNotLoadRetry')` as an error toast — **the translation key promises a retry, but no
  retry actually happens or is offered.** This is the literal dead end: talkId is a real pointer
  (not missing data), but a dangling one with no recovery path once it fails.
- **No traceback at the individual-question level — only ever "open the whole talk."** When one
  Me-tab entry groups multiple Q&A pairs (`renderAnswerItemsHtml`, `answers-view.ts:230-321`, one
  `.answer-outcome-item` per pair), there is **no click handler, `data-question-id`, or
  scroll/anchor logic anywhere** in that function — confirmed via grep, no `scrollIntoView`/anchor
  usage tied to a specific question exists in this file or `talk-response-dialog.ts`. Clicking
  anywhere only opens the talk as a whole via the one parent-row listener; there's no way to land
  on the specific question that produced a given answer.
  - **Partial infrastructure already exists for this, unused:** each answer item already computes
    and displays a `contextHash`/`contextLabel`/`contextPath` (`answers-view.ts:66-149,176-219,
    272-273`) showing *where in the flow/route DAG this answer sat* — but it's rendered as inert
    text, never wired to a click or passed into the destination dialog to jump/scroll to that
    question.
- **Destination asymmetry, worth resolving or at least documenting:** `showTalkDetail` branches on
  `myTalks[tid].role` (`ui-manager.ts:4620-4629`) — `'created'` opens the talk **editor**
  (`4623`), `'answered'`/`'copied'` opens the **read-only response dialog** (`4626`). A talk the
  user answered on themselves (self-test of their own created talk) keeps `role === 'created'`
  (`ui-manager.ts:6007-6010`), so it routes to the editor instead of the answer-viewing dialog an
  ordinary incoming-talk answer gets — a different experience for what the user perceives as "the
  same kind of thing: my answer to a question."

**Work**

- Fix the actual dead end: when `demandFullTalk` fails, offer a real retry (re-attempt the
      mesh/identity-key resolution `app.ts:4886-4905` already does) instead of a one-shot error
      toast whose copy already claims retry behavior it doesn't perform. If retry genuinely can't
      succeed (talk gone for good), the toast/message should say so plainly rather than implying a
      retry that isn't there.
      **Done 2026-07-30.** `showNotification`'s new `retry` option re-invokes the exact same
      `showTalkDetail` call on click, so the identical lookup runs again (can succeed later if the
      mesh cache catches up). Left the existing copy ("Check your connection and try again.") as
      is — it now honestly describes what clicking does, rather than a new "talk gone for good"
      message; a truly permanent failure still shows this same retryable toast; a follow-up could
      add attempt-count-based wording if that's ever needed, not required by this fix.
- Wire the already-computed `contextHash`/`contextPath` into the traceback: passing it through
      to `showTalkDetail`/`showTalkResponseDialog` so opening a multi-question entry can
      scroll/highlight the specific question that produced the clicked answer, instead of only
      landing on the talk as a whole.
      **Done 2026-07-30 — build-order item 13.** Used `questionId` as the wire format instead of
      `contextHash` (already unique per question, matches how `.review-question-block` is keyed).
- Resolve or explicitly document the `'created'`-vs-`'answered'` destination asymmetry for
      self-answered own talks — decide whether self-test answers should route to the same
      read-only response view as any other answer, or whether routing to the editor is intended
      and just needs a one-line note so it isn't mistaken for a bug later.
      **Done 2026-07-30.** Decided self-test answers route to the read-only response view, same as
      any other answer — Me-tab clicks always mean "show my answer." `showTalkDetail` gained a
      `preferAnswerView` option; `showTalkDetailAsAnswer` (bound only to `displayAnswersList`)
      passes it, leaving the Talks-tab OUT-row and "My Talks" dialog editor-opening behavior
      untouched for `role:'created'` talks reached from those two contexts.
- Test: `stage1` — a talk purged from local storage: clicking its Me-tab entry surfaces a real
      retry affordance (not just a dead toast), and a successful retry opens the talk normally.
      **Done 2026-07-30:** `35-me-answer-dead-end-retry.spec.ts`. Confirmed it fails without the
      fix and passes 3/3 with it.
- Test: `stage1`/`stage3` — a multi-question flow/route entry: clicking an individual nested
      question's answer opens the talk scrolled/highlighted to that specific question, not just
      the talk's first screen.
      **Done 2026-07-30:** `36-per-question-deep-link.spec.ts` (stage1). Confirmed it fails
      without the fix and passes 3/3 with it.
- Test: `stage1` — a self-answered own-created talk's Me-tab entry: confirm which destination
      it opens (editor or response view) matches the resolved design decision above.
      **Done 2026-07-30:** `05-talks-edit.spec.ts` — "Self-answered own talk: Me-tab entry opens
      the response view, not the editor." Confirmed it fails without the fix, passes with it.

## 2026-07-30 — T: Chatroom-hierarchy broadcast isolation leak (both root causes resolved)

Moved from `docs/TODO.md` T. Commit `eb765411` (root cause #2; root cause #1 landed earlier the same day, folded into the same investigation).

### T. Chatroom-hierarchy broadcast isolation leak: room-scoped mesh session gets stomped back to a stale boot-time room `[Opus]`

**Done 2026-07-30.** Both root causes resolved — see the two writeups below for full detail.

Found 2026-07-30 investigating a genuinely reproducible (non-flaky, fails in full isolation)
failure in `stage2/00h-chatroom-hierarchy-broadcast.spec.ts` ("Broadcaster on North America does
not register inbox for peer joined only under United States" — FR-BM-7, parent-room broadcasts
must not reach a peer who only joined a child/leaf room).

**Root cause #1 (found and fixed):** `initializeChatrooms()` (`app.ts`, the boot-time flow) does
`chatroomId = findOptimalChatroomHierarchical(...)` (often resolves to `global`), sets
`this.currentChatroomId = chatroomId`, then `await`s `chatroomService.joinChatroom(chatroomId,
...)` — a Gun write with retries that can take a while — before finally calling
`chatroomService.subscribeToMembers(chatroomId, ...)`. If the user has already navigated to a
*different* room during that await window (e.g. immediately clicking into a room right after
`bootstrapUser` returns, as this test and any fast-navigating E2E flow does), this callback's
closure-captured `chatroomId` is stale: it wins the single-slot `subscribeToMembers` race against
the newer room's subscription and silently re-scopes the live `PeerMeshService` session — and any
subsequent room-broadcast issued from it — back to the stale boot-time room, even though
`this.currentChatroomId`/the UI correctly show the room the user navigated to. Confirmed via live
instrumentation: Tom's mesh session properly scoped to `north-america` (empty member/neighbor set,
correct — he's alone there), then a `WebChatroomService.membersListCallback` fired with a
closure-captured `chatroomId === 'global'`, reconnecting Tom's mesh to Jerry (who transiently
touches `global` during his own boot) and leaking the broadcast to him.
- **Fixed:** guard the boot-time `subscribeToMembers` call (and its callback) on
      `this.currentChatroomId === chatroomId`, skipping the stale subscription entirely if the
      user has since navigated elsewhere. Verified: no regressions across headcount, chatroom-nav,
      mesh-ping, mesh-response-match, and P0 direct-talk-delivery specs; full unit suite (1048
      tests), `tsc`, and `lint` all clean.

**Root cause #2 (found and resolved 2026-07-30) — revises the original hypothesis: not a product
bug.** Instrumented `subscribeToMembers` and the `'chatroomChanged'` handler with synchronous
stack traces (`new Error().stack`, routed through `console.trace` so the E2E console filter — which
drops plain `console.log` unless `E2E_VERBOSE_CONSOLE=1` — didn't swallow it) and caught the actual
second caller directly:

```
at UIManager.<anonymous> (bundle.js:21798:92)
at UIManager.emit (bundle.js:3863:5)
at showChatroomDetail (bundle.js:32594:14)
at HTMLDivElement.<anonymous> (bundle.js:32522:17)
```

`showChatroomDetail` is the real source, called from `clickBroadcastUntilBulkAck`
(`tests/e2e/helpers/talk-demo-ui.ts`) — a **test helper**, not product code. That helper always
re-clicks the "chatrooms" nav tab internally, which (via `setupBottomNavigation()` in
`ui-manager.ts`) unconditionally resets to the top-level room list — an existing, intentional, and
**widely relied-upon** convention: `openHierarchyLeafRoom`/`openHierarchyNodeRoom` and several
other E2E helpers depend on "click the chatrooms tab -> land on the room list" to then click a
specific room row. Confirmed by trying the opposite fix first (guard the nav-tab handler so it
preserves an already-open room detail, mirroring root cause #1's pattern) — it broke this same
spec file's first test (`openHierarchyLeafRoom` could no longer find room rows, since the list it
needs was no longer shown), proving the nav-tab reset itself is correct, intended behavior, not a
race. `clickBroadcastUntilBulkAck`'s own fallback ("not currently showing a room detail? click
Global") then fires on every call, discarding whatever specific room the caller actually wanted —
no amount of re-entering the target room *before* calling the helper survives, because the helper's
own internal nav-tab click undoes it every time it's invoked.
**Audit answer:** this class of bug does **not** affect any production/user-facing code path —
`'chatroomChanged'` has only its two known, user-click-driven emit sites (both already ruled out by
the original investigation); the "stale room" here was never real user state, only this one test's
interaction with a test-only helper's Global-default assumption.

- Find the second caller: instrumented `subscribeToMembers` and the `'chatroomChanged'`
      handler with synchronous stack traces; found `clickBroadcastUntilBulkAck` (test helper),
      not product code.
- Fix: rather than changing the shared nav-tab convention (proven unsafe above) or the
      shared `clickBroadcastUntilBulkAck` helper (used correctly, with the Global default, by ~15
      other spec files), fixed the one test that needed a different room: re-enter `north-america`
      via `openHierarchyNodeRoom`, then call `app.deliverPendingBroadcastTalksForE2e` directly via
      `page.evaluate` — the same E2E delivery path this file's own first test and most of this
      session's other new specs already use — bypassing the click-based helper's room-selection
      dance entirely instead of fighting it.
- Confirmed `00h-chatroom-hierarchy-broadcast.spec.ts`'s "does not register inbox" test passes
      reliably: 5/5 standalone runs, plus the full 3-test file (all three pass together).
- Audit: not applicable — see "Audit answer" above. The underlying race root cause #1 fixed
      (boot-time `initializeChatrooms` racing a fast subsequent navigation) was real product
      plumbing and remains fixed; root cause #2 turned out to be test-only, so there is no second
      product-level pattern to search for elsewhere (direct-peer-send, mailbox fallback, presence).

`tsc`/`lint`/Jest (1048/1048) all clean. No production code changed for root cause #2 — only
`tests/e2e/staged/stage2-two-user/00h-chatroom-hierarchy-broadcast.spec.ts`.

## 2026-08-01 — K4: full conversion of remaining call sites to stage-snapshot loading

Moved from `docs/TODO.md` K4 (second landing, after the 2026-07-26 fixture landing above and the
2026-07-30 partial `talks-matching`/`isolated-01` conversion).

Re-audited the actual codebase (not the earlier ~174 estimate) before converting: 58 files / 119
`maybeClearGunDatabases()` call sites remained — stage2 (5 files/10 sites), stage3 (43/88), stage4
(1/2), stage5 (4/9), `mass` (4/8), `isolated-02` (1/2), plus stragglers in
`stage1-single-user/00x-tab-sweep-smoke.spec.ts` and `helpers/talks-matching-flow.ts` the earlier
directory-level table hadn't surfaced.

- Every directory converted to its matching `clearGunForStageNSpec()` helper (stage2→2, stage3→3,
  etc). `mass/` and `isolated-02` convert to `clearGunForStage1Spec` (loads the committed stage0
  fixture) rather than a numbered multi-user stage — their ephemeral N-browser-loop specs get no
  benefit from a fixed-population baseline (2026-07-27 decision); `clearGunForStage1Spec` is
  exactly "load the fixture instead of hand-building it," just not one of the progressive stages.
- **Found and fixed a gap the 2026-07-30 partial conversion left behind:** `resetTalksMatchingSession()`
  (the shared `beforeEach` reset used by ~35 call sites across stage2/stage3/isolated) still called
  the bare `maybeClearGunDatabases()` internally, so files that had already "converted" their own
  `beforeAll`/`afterAll` — including `isolated-01`, done 2026-07-30 — were still silently falling
  through on every `beforeEach`. Gave it an optional `clearFn` parameter (default
  `maybeClearGunDatabases`, so any caller not updated keeps prior behavior) and threaded the correct
  stage function through all ~35 call sites.
- Purely mechanical: scripted regex-based import rewrite + call-site replacement, verified
  file-by-file against the exact diff shape of the original talks-matching conversion. Zero
  `maybeClearGunDatabases()` references remain anywhere in `tests/e2e/` outside its own definition
  and the `clearGunForStageNSpec` wrappers.

**Verified:** `tsc --noEmit` clean, `npm run lint` clean (pre-existing tests/e2e-only
warnings/errors confirmed identical before/after via `git stash`, and out of `npm run lint`'s
scope anyway), full Jest suite green (94/94 suites). Ran a representative sample across every
converted directory and both call-site shapes (direct `beforeAll` calls and the shared
`resetTalksMatchingSession` helper) — 10/10 passed under the non-pipeline `clearGunDatabases()`
fallback branch, the one `run-test-all.sh` actually reaches today. The pipeline-snapshot-loading
branch itself (only reached under `E2E_STAGE_PIPELINE=1`) is exercised via the same proven
`clearGunForStage1–5Spec` code shape, not a fresh full `test:e2e:staged` run — judged out of
proportion for a call-site swap with no logic change, matching the 2026-07-30 conversion's own
honestly-flagged limit.

## 2026-07-27/28 — K5 Item 6 + full test list; `answeredBy` question resolved into K7

Moved from `docs/TODO.md` K5 (Items 1-5 archived 2026-07-25/26 above; this is Item 6 + the test
list + the design-question resolution).

- Item 6 tests: `stage1/09-support-faq-reask-no-duplicate.spec.ts` (a known question is still
  auto-answered after TechSupport's browser context closes for good, and re-asking it does not
  create a second FAQ bundle row or regress the inbox entry off `answered`) and
  `stage2/00l-techsupport-faq-cross-user.spec.ts` (a second, unrelated ordinary user is
  auto-answered the same question with zero TechSupport involvement, proving the FAQ bundle is
  genuinely global).
- Full test list, all passing: `10-techsupport-ignores-broadcast-talks.spec.ts` (TechSupport's IN
  index stays empty, headcount stays 2 for tag+flow talks — surfaced a stronger guarantee than
  documented, that the *sender's own* receiver-resolution excludes TechSupport, not just the
  receiver-side check); `06-support-new-question-ack.spec.ts` + `07-support-inbox-answer-flow.spec.ts`
  (new-question ack, TechSupport-stopped mailbox delivery, dev-login answer flow, cross-device
  answered-flip); `09-support-faq-reask-no-duplicate.spec.ts` (known-question auto-answer with
  TechSupport stopped, no duplicate FAQ row on reask). All assert via DOM/Gun state, never toasts.
- **`answeredBy` open question resolved 2026-08-01:** with exactly one operator today, a plain
  `answeredBy` field has nothing to disambiguate — not implemented. Multi-operator answering became
  its own item, K7 (deferred — see `docs/TODO.md`), since "redirect to someone else, relay their
  answer back through TechSupport" is a materially different flow than "record who's logged in."

## 2026-08-01 — L1/L2: legacy-scalar retirement + device-side visit-counter pruning

Moved from `docs/TODO.md` L (CRDT G-Counter migration, size instrumentation, and the 2026-07-25
design decision archived earlier above; this is the 2026-08-01 follow-through).

- **L1: retired the `max(new, legacy)` fallback** in `ChatroomManager.getChatroom` — responses now
  come straight from the G-Counter's `visitTotals()`. Confirmed via research that no client, E2E
  spec, or the committed `stage0.fixture.json` reads the legacy `visitCount`/`uniqueVisitorCount`
  scalars or writes `visits/<eventId>` any more; `migrateLegacyVisitScalar` (the one-time
  slot-seeding migration) is unaffected and stays, since it's what makes the fallback's retirement
  safe. Verified: full unit suite (91 suites, 1094 passed) plus real staged E2E runs
  (`stage2/35-concurrent-visit-counter.spec.ts` 2/2, `stage1/00-ui-navigation-settings.spec.ts` +
  `stage2/01-login-two-users-headcount.spec.ts` 9/9). `techsupport-graph.ts`'s dev-only baseline
  graph still hardcodes the legacy fields but is unreachable from any E2E path — left as is.
- **L2 decision (Bernard, 2026-08-01): lighter than SRS §28.9's merkle-checkpoint pattern, and
  deliberately so** — room-visit data (Tier 3, other users' bounded-TTL cache) doesn't need
  provable pruning the way the ledger/messages do (nobody needs an O(log N) proof a departed
  visitor once visited). Instead: **prune by time by default** (oldest `lastVisitedAt` first past
  `DEFAULT_VISIT_COUNTER_MAX_SLOTS = 500`, adjustable — no production numbers exist yet to tune
  against, so this ships as a sensible default rather than waiting), and **tombstone by folding**
  (each pruned slot's count sums into a per-room `visitCounterPruned` aggregate *before* deletion,
  so `visitTotalsWithPruned()` keeps the lifetime badges numerically identical across a prune).
  Trimming is **device-side and symmetric** — server (`ChatroomManager.pruneVisitCounterIfNeeded`)
  and every browser (`WebChatroomService.pruneVisitCounterIfNeeded`) each run the identical check
  against their own local Gun graph, sharing one pure module
  (`src/shared/visit-counter.ts`: `planVisitCounterPrune`/`foldSlotsIntoPrunedAggregate`).
  Unit-tested (prune selection, fold correctness, badge-invariance across a prune, an end-to-end
  trigger test) and confirmed against real staged E2E runs.
- **`graph-size-report.ts` extended** per the same decision's item #1 ("build a size report tool
  ... so we know which take space and what to trim"): every category with genuine per-room/per-user
  concentration reports `topLocations`/`topUsers` (capped at 10) and, where a timestamp field
  exists, an `ageBuckets` histogram, off `GET /api/test/graph-size`.
- This closes the "are the lifetime badges worth their cost" question too: Bernard chose to keep
  the badges and prune the storage behind them, not delete the feature.

## 2026-07-31 — R1/R2/R3: fast-first-render for Contacts, Talks, and Me/Answers

Moved from `docs/TODO.md` R (audit 2026-07-29, requirement: 500 contacts too slow to load, first
few should show ASAP with the rest filled quietly in the background — as a general list-rendering
principle, not a one-off Contacts fix). R4 (chatroom members, already does the non-blocking-enrich
half correctly, low real-scale ceiling) and R5 (conversations/support-inbox, currently low-volume)
stay explicitly low-priority/no-immediate-work, not part of this landing.

**Shared helper, built once and reused three times:** `src/web/ui/render-list-progressively.ts`
(`renderListProgressively(container, items, { firstChunkSize, renderRow, onFirstChunkRendered?,
prefixHtml?, isStale?, scheduleRemainder? })`) — slice first N, write immediately, process the rest
off the blocking path and append/patch in place. Unit-tested in isolation
(`render-list-progressively.test.ts`, 6 tests).

- **R1 (Contacts, the worst case — audit found a genuine ~3.2s blocking pre-render chain
  *and* no pagination):** `renderContactsListCore` now runs synchronously with no blocking await
  inside it, called immediately then again after the background enrichment
  (`contactPreRenderSync`/`prefetchPeerLocations`) resolves. `CONTACTS_FIRST_CHUNK_SIZE = 25`
  (matching the pre-existing Replies-panel `PAGE_SIZE` precedent). Automatic quiet background fill,
  no manual load-more button, per the requirement's own wording. Added a hard
  `FIRST_ROW_BOUND_MS = 500` timing assertion (`expect.poll`, hard-failing) to
  `04-heavy-user-gui-stress.spec.ts` — previously only `console.warn`-advisory; verified via the
  stash pattern (fails at ~1950ms without the fix, passes at ~400ms with it). Plus 3 new unit tests
  in `contacts-view.test.ts`. **Real bug found and fixed:** the delegated click listener originally
  closed over `deps` at bind time, so a fresh render with a new `deps` object silently kept calling
  the stale callback — fixed by stashing current `deps` on the element and reading it at click time.
- **R2 (Talks tab):** audit found no blocking chain here (fully synchronous already) — same
  no-pagination problem though. `renderOutRow`/`renderInRow` extracted and passed to
  `renderListProgressively`, one delegated listener replacing per-row listeners.
  `TALKS_FIRST_CHUNK_SIZE = 25`. Honest scope note: since there was never a blocking chain, a
  first-row timing bound doesn't cleanly separate fixed-vs-broken here (both versions render 500
  rows in ~150-200ms) — kept as a forward-looking perf budget, not proof of this fix. **Real bug
  found:** the `'out'`-only view-mode branch was missing the `isStale` guard present on the other
  three call sites — caught via `80-talks-list-progressive-render.spec.ts` (100 rows instead of 40
  under rapid re-renders before the fix), fixed, 4/4 stable after.
- **R3 (Me tab Answers):** same treatment; both row builders converted from DOM-construction
  (`appendChild`) to string templates first, `ANSWERS_FIRST_CHUNK_SIZE = 25`. New `onRowsRendered`
  hook so `applyMeAnswerFilter` re-scans after both the first chunk and the deferred remainder land.
  **Real bug found:** the new string-template row wrote `style="display:flex"` (no space) verbatim,
  whereas the old `.style.cssText` assignment round-tripped through CSSOM and normalized to
  `display: flex;` (with space) — broke `29-me-answers-search.spec.ts`'s `[style*="display: flex"]`
  selector; fixed by normalizing the string template's spacing to match.

**Verified across all three:** `81-answers-list-progressive-render.spec.ts` (4/4), 5 new unit
tests in `answers-view.test.ts` (including one proving the delegated listener reads current, not
stale, `deps` across two rapid renders), plus full E2E regression sweeps on both the Talks tab
(11 specs) and Me tab (6 specs) — all green.

## 2026-08-01 — S: merkle-checkpoint pruning implementation (Items 0-3, ledger + messages)

Moved from `docs/TODO.md` S (design note archived 2026-07-31; this is the 2026-08-01
implementation landing). **Two items from this section stay open in `docs/TODO.md`** — the
storage-budget-driven retention formula (decided, not yet implemented) and an unreliable
message-pruning bug found during E2E verification — this entry covers only what's actually done.

- Implemented `CHECKPOINT_CREATED` as a new ledger event kind (SRS §28.9.2) — merkle root over the
  sorted CIDv1 array of the pruned range, SEA-signed, chained via `prev`; keeps the last M=500
  events in full detail.
- Implemented the delta-sync protocol change (SRS §28.9.6): a peer requesting a pruned event gets
  the merkle proof instead of the raw node.
- Implemented the analogous message-checkpoint structure for `pairConversations/*/messages/*`
  (commits to both message ids and ciphertext hashes; keeps the last K_retain=200 messages per
  conversation in full detail).
- Unit-tested: a pruned range's checkpoint correctly verifies an O(log N) proof for an arbitrary
  event/message in range, and rejects a forged proof.

**Real E2E testing** (`tests/e2e/staged/stage2-two-user/30-ledger-message-pruning-e2e.spec.ts`)
found and fixed **four real, previously-invisible bugs** the unit-level fakes couldn't catch: the
ledger was completely inert in every E2E run since Phase E (a `DISABLE_HMR` gate); ledger event
deletion never actually deleted anything (two separate causes — a flat-key `.put(null)` Gun
rejects, then a `serializeDates` field-stripping bug); `getEventBySeq` silently broke every
CID/signature verification it ever did (a date-coercion quirk); and the ledger's delta-sync inbox
was permanently undiscoverable by any receiving peer (a flat-key-vs-nested-chain graph mismatch).
Ledger checkpoint/prune/delta-sync is now solidly proven end to end across many real-browser runs.

## 2026-08-01 — U: broadcast to a contact group, online or not, with deferred delivery

Moved from `docs/TODO.md` U.

Adds a second broadcast entry point (beyond "whoever's in this chatroom right now"): pick a named
group of known contacts from the Contacts tab — *All*, a built-in `RelationshipLabel`, or any
distinct `customLabel` in use (e.g. "Tennis Buddy," which falls out of the existing free-text field
for free — no schema change, no group-membership editor) — and send to the whole group regardless
of whether each member is online. Research found the delivery half needed nothing new:
`PeerMeshService.broadcastTalk()` already accepts an explicit `recipientUserIds` list (room
broadcast is just one caller of a more general primitive), already floods the mesh to whoever's
online, and already falls through to the existing offline mailbox (SEA-encrypted,
`MAILBOX_DEFAULT_TTL_MS=48h`/`MAILBOX_MAX_TTL_MS=72h`) for anyone who doesn't ACK in time — "defer
until online, drop after timeout" was already exactly what that store does.

Built: `listContactGroups`/`resolveContactGroupUserIds` (`src/shared/contact-groups.ts`, v1
simplest — bucket by `RelationshipLabel`/`customLabel`, no new data model, group membership
resolved entirely on the sender's own device, server/other users never see it), a "Broadcast to
group…" picker on the Contacts tab, and delivery reusing `deliverTalkToReceiversOverMesh` verbatim
— the same mesh-flood-plus-mailbox-fallback path every other broadcast already uses. Per-broadcast
custom timeout control was decided against for v1 — the existing fixed 48h/72h mailbox window is
good enough to start.

**Verified:** unit-tested (13 tests) and real-browser-verified
(`32-broadcast-to-contact-group.spec.ts`) — that run caught and fixed a real test-design flaw
(creating a talk while still in a chatroom auto-broadcasts it to the room by default, which would
have let the test pass even with a broken handler; fixed by unchecking "send to chatroom" so the
assertion cleanly proves only the group-broadcast path delivered it). Full unit suite green
throughout (93/93 suites).

## 2026-08-01 — V: Auto Linear Capture (FR-TK-7), two-author credit model, edit-mints-new-id policy

Moved from `docs/TODO.md` V. This was spec'd on the project's first day (`FR-TK-7`/`FR-TK-8`/
`UI-1d`/§13.6/`TC-LIN-01`, `projectplan.md` commit `b24cdda8`, 2026-01-19) and never implemented
against the current architecture — research initially missed that `src/shared/talk-engine.ts`
already contained a same-day `FlowCapture` attempt at this (`parseChatLine`/`createLinearTalk`),
one hyphen away from the SRS's own traceability-table prediction; corrected mid-investigation.

**Decided grammar (simplified 2026-08-01, Bernard — "keep it simple enough"):** dropped the
original spec's `**`/`*` prefix markers. Plain `Question? Answer1; Answer2; …; AnswerN.` — the
**first** answer continues the flow (`isMatch: true`); every other answer ends it (`isIgnore:
true`, the same as tapping Ignore anywhere else in a flow talk) — ordinal position alone encodes
intent, no punctuation burden. Produces `flow`-type talks only (`FR-TK-8` — route/survey stay
Talk-Editor-only). The diversion from plain-text send to talk-capture is **mandatory-confirm,
never silent**.

**Two-author credit model, built to support the append/edit case:** `Talk.originalAuthorId`/
`originalCreatedAt`/`originalAuthorLocation` (permanent, seeded once from the predecessor, copied
forward unchanged) vs. `authorId`/`createdAt`/`authorLocation` (current author/edit metadata,
reassigned only when a content edit mints a new talk id). **Title edits don't count as authorship
at all** (Bernard: "keep the title as is") — consistent with `title` never being part of the
content-hash payload for `flow` talks to begin with. **Edit-mints-a-new-id policy:** a content edit
(changes to `questions`/`type`/`language` — the fields actually inside the identity hash) mints a
new talk id via `buildRevisedTalkDraft()`, links back via `supersedesTalkId`, and retires the
predecessor per a new Settings toggle (`getKeepOldTalkOnEdit()`, default `false` = delete via the
already-existing `UIManager.deleteMyTalk()`; advanced override keeps it disabled via the
already-existing `setTalkDisabled()`, which also floods a real retraction tombstone) — routed
through one new `UIManager.applyTalkRevisionPolicy(predecessorTalkId)`.

**Built:** `FlowCapture.parseChatLine()` reused as-is (matched the decided grammar exactly, now
unit-tested for the first time); `createLinearTalk()`'s original synthetic-button design (no
match/ignore split, unused, untested) rewritten in place as `assembleCapturedTalk()`, reusing the
already-well-tested `TalkAutofix.fix()` for chaining instead of re-implementing it. 17 new unit
tests including `TC-LIN-01`'s exact worked example and an end-to-end `checkIfMatch`/`checkIfIgnore`
proof.

**Verified in real browsers**, not just unit tests, since this is genuinely interactive UI
(confirmation dialog, tappable chips): `31-auto-linear-capture.spec.ts`, two real browsers, full
pipeline (shorthand → mandatory confirmation → chips on both sides → chip-tap quick-reply →
terminator → saved flow Talk in the sender's own OUT list). **Real bug found:** the confirmation
dialog's default z-index (1000) sat below the already-open conversation overlay (1001), so its own
message list intercepted the Accept click — fixed by matching the codebase's existing "float above
an open conversation" tier (2000, same as the media lightbox). Full unit suite green throughout
(92/92 suites).

**Left genuinely open, not silently closed:** whether a metadata-only edit (tags, expiry,
location-radius — not title, which is separately settled) on the existing in-place `updateTalk`
path should reassign `authorId`/`createdAt`/`authorLocation` to the editor, or keep preserving them
as it already does today. In practice `updateTalk`'s existing preserve-on-metadata-edit behavior is
unchanged by this item, so nothing regresses either way — but the question itself was never
explicitly decided.

## 2026-08-01/02 — W: incremental re-broadcast, unified ledger-based suppression, ignore semantics

Moved from `docs/TODO.md` W. Verification requested: "when Adam has exchanged 100 talks with Eve
and broadcasts 120 again, Eve should only receive 20 new" — **confirmed already correct** for the
literal (answered) case via `deliverTalkToReceiversOverMesh`'s pre-send
`shouldSuppressForPeer` check. Research surfaced two adjacent gaps, both since closed:

- **Gap 1 (received-but-unanswered talks weren't suppressed):** fixed by adding
  `UIManager.getUnsentBroadcastTalkReceiverIds(chatroomId, talkIds, receiverIds)` — computes which
  receivers actually still need each individual talk, intersected with the existing room-wide
  "which talks to even attempt" union rather than replacing it. Verified via
  `09-exchange-suppression.spec.ts`, `06-sender-suppression.spec.ts`,
  `00-broadcast-abort-clear-all.spec.ts`, `00-broadcast-boundary-match.spec.ts`, and a 36-talk/user
  mixed-membership room test.
- **Gap 2 (three uncoordinated "don't resend" mechanisms — room-broadcast-history localStorage,
  the ledger's answer-triggered `exchanged` suppression, and peer-detail's separate
  `localTalkExchanges` check) unified onto one ledger-based mechanic (Bernard, 2026-08-01):** new
  `TALK_SENT` ledger event (`talk-ledger.ts`) fires **locally, by the sender, at send time** — no
  round-trip to the recipient — and a new `sent` map (keyed like the existing `exchanged` map)
  closes the "received but not yet answered" hole at the source. `shouldSuppress()` now ORs
  `exchanged` and `sent`. Room-broadcast history (`broadcastConversationHistory`,
  `recordBroadcastConversation`) deleted outright as redundant; `sendDirectTalkToPeer` ("Send My
  Talks") rewired to route through the same `deliverTalkToReceiversOverMesh` chokepoint instead of
  calling `mesh.broadcastTalk` directly; `classifyPeerSendTalks`'s "already sent" check reads the
  ledger instead of `localTalkExchanges`. Behavior change, intentional: suppression is now
  content-hash based, not metadata-timestamp based (a cosmetic touch no longer un-suppresses; only
  a genuine content change does) — the one existing test asserting the old behavior was rewritten.
  Verified: new `talk-ledger.test.ts`/`web-talk-ledger-store` tests, full Jest suite green (95/95,
  +13), and a full real-E2E pass across every suppression-sensitive spec plus the newly-rewired
  peer-send/peer-detail specs — all green, several printing the ledger's own suppression debug
  lines, confirming the unified path is actually exercised.
- **Completeness refinement (Bernard, "if receiver answers 2 of 3 questions, sender should treat it
  as not yet answered"):** root cause was a survey's per-question "Ignore" answer being treated as
  "abandon the whole survey" in three independent code paths (`applyChoice`, the auto-answer path,
  and the `tryCollectAllAutoAnswers` pre-scan) — only one of the three did it correctly. Extracted
  one shared `nextSurveyQuestion()` helper; every non-last survey answer now advances regardless of
  its own isIgnore/isMatch/isTerminal flags. Added a defensive backstop at
  `submitTalkResponsePairDirect` (sender) and `handleMeshTalkResponse` (receiving/author side): both
  independently verify completeness before any mesh send or ledger write.
- **Ignore-semantics clarification (Bernard, 2026-08-02):** the fix above initially conflated two
  distinct things — an asker-provided answer that happens to carry `isIgnore: true` (a real,
  complete answer, e.g. a flow's "No" branch) vs. the dedicated, always-present "Ignore" radio row
  (sentinel `answerId === 'ignore'`) representing the receiver's own opt-out of the *whole talk*.
  Fixed `applyChoice`/the auto-answer path to branch on the sentinel first — the dedicated choice
  now always ends the response immediately regardless of talk type or question position. Also
  closed a gap that predated this whole fix: picking the dedicated Ignore choice still submitted a
  real mismatch response to the sender before this — added `completeTalk(..., { withholdFromSender
  })`, threaded through to `handleTalkCompleted`, which now skips the mesh submission (but still
  runs local bookkeeping) when set.

**Left open in `docs/TODO.md`:** whether `sendBulkTalk`/`BulkSendJob` (found to be dead code —
no consumer/worker anywhere — while investigating this section) should be removed or finished.

## 2026-08-01 — X: Talk.authorLocation blurred by default (SRS FR-CR-8/NFR-S-1 compliance)

Moved from `docs/TODO.md` X. Found while working V's two-author model: `Talk.authorLocation`
stored the raw, precise GPS coordinate at creation (`app.ts`, `this.currentLocation` passed
straight in) and carried it forward unchanged through updates — a direct, confirmed violation of
the SRS's own day-one requirement that only a blurred region ever leaves the device
(`FR-CR-8`/`NFR-S-1`), not a judgment call.

Fixed by switching the one real write site to a blurred value — as a **numeric pair, not the
`region` string** originally sketched, since three real consumers (`haversineMilesBetween`'s
delivery-radius filter, `formatTalkDistanceFromAuthor`, `cid.ts`'s optional location hash) all
expect `{latitude, longitude}` numbers and a string would have forced all three to re-parse. New
`LocationPrivacy.blurCoordinatePair()` reuses the same ~2km grid-snap math `blurLocation` already
uses (extracted into a shared private `gridSnap` helper) but returns a coarse numeric pair — zero
consumers needed to change, `locationRadiusMiles` filtering degrades to approximate exactly as the
SRS's own "approximate is acceptable" precedent for distance sorting already calls for.
Unit-tested, full suite green (91/91 suites).

Scope confirmed with Bernard: "share my precise location with someone" is a separate future
feature, out of scope here; `Chatroom.location`/`BusinessInfo.coordinates` (a business owner
publishing their storefront address) is a different, already-legitimate "specifically requested"
disclosure case, not the same violation — no fix needed there.

## 2026-08-01 — Y1/Y2: copy ≠ authorship; incoming-talk-cluster retention

Moved from `docs/TODO.md` Y. Verification of copy/disable/delete/dedup/trim behavior for incoming
talks against a description of how it should work — five of seven claims confirmed already true
(no action needed); the tombstone half of the sixth was proposed then withdrawn once the actual
gap was understood (Bernard, 2026-08-01: "not necessary since question/answer set is hold in me
tab"). The remaining two were real, scoped work:

- **Y1 — copying a talk stamped the copier as author immediately** (`toOwnedOutgoingTalk()`, at
  copy time, across 4 call sites), when it should only transfer on a real edit. Fixed by deleting
  `toOwnedOutgoingTalk()` outright — all 4 call sites now pass the talk through unmodified, so a
  copy keeps the original sender as `authorId` through copy, broadcast, and re-opening the editor.
  Editing a copy is what actually transfers authorship: `talk-editor-dialog.ts` gates its "update
  in place" mode on `existingTalk.authorId === currentUserId`; a foreign-authored (copied) talk
  falls through to create-a-new-talk on submit instead, stashing the source talk for
  `buildRevisedTalkDraft()` (the same §V machinery) to pick up, then retires the old copied entry
  via `applyTalkRevisionPolicy()`. **Bug found along the way:** `WebTalkService.createTalk()` built
  its returned `Talk` from a field whitelist that silently dropped
  `originalAuthorId`/`originalCreatedAt`/`originalAuthorLocation`/`supersedesTalkId` — meaning §V's
  DM-shorthand append case had the same gap, never caught because the only prior coverage tested
  `buildRevisedTalkDraft()` in isolation, never through actual persistence. Verified via
  `82-copy-then-edit-transfers-authorship.spec.ts`.
- **Y2 — incoming-talk clusters (`ownerIncomingTalkIndex/<userId>/<identityKey>`) had zero
  retention**, and the size-report tool couldn't even see the category (its matcher tested the
  stale `incomingTalksByUser` path name from CLAUDE.md's outdated docs, so every real node fell
  into `unclassifiedCount`). Fixed the matcher; added `planIncomingTalkClusterPrune()` — a direct
  generalization of L2's `planVisitCounterPrune` (oldest-`updatedAt`-first, no fold-into-aggregate
  needed since a pruned cluster's Q&A record survives independently in the Me tab),
  `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS = 500` as the starting threshold, wired as a
  fire-and-forget check inside `upsertLocalIncomingTalkCluster()`. Unit-tested; no E2E, matching
  the L2 precedent (unit-only coverage for this class of background pruning).
- Also fixed, doc hygiene: CLAUDE.md's stale incoming-talk-cluster description (claimed a
  server-side authoritative map; the real implementation is entirely client-side). Left alone as
  out of scope: CLAUDE.md's "Route modules"/"Talk delivery flow" sections are considerably more
  stale than just this one path name (name files/functions removed since the P2P migration) —
  flagged in `docs/TODO.md` for a separate pass, not folded into Y2.

## 2026-08-11 — CC: mandatory financial-data block + two-checkpoint safety toast

Moved from `docs/TODO.md` CC. Closed a real spec/code gap found while checking §BB against the SRS:
`docs/specs/iinpublic-technical-specifications.md` §7.4 ("Credit Card & Financial Data Filter") had
described this since before the current filter architecture existed, targeting a standalone
`src/filters/financialDataFilter.ts` module that was never created — the actual shipped filter had
no financial-data path at all.

- **Detection** (`src/shared/financial-data-guard.ts`, new): card numbers (regex-shape + Luhn
  checksum, so ordinary 13–19 digit sequences like phone numbers or order IDs aren't
  false-positived), IBAN, US routing/account pairs, sort codes, BTC/ETH wallet addresses, and CVV
  (only flagged alongside an actual card-number match in the same text). Pure functions, no
  fuzzy/AI matching — same determinism posture as the rest of the filtering system.
- **Wiring** (`src/shared/message-content-filter.ts`): new `'financial_data'` reason, checked
  first and **unconditionally** — unlike dirty-words/grammar it ignores the `filters` argument
  entirely, so no user or business-chatroom setting can disable it. Every caller of
  `filterOutgoingMessage`/`filterIncomingMessage` (conversation messages) inherited the check for
  free. TechSupport's existing K6 dirty-word/grammar exemption was **not** extended to this check
  (`filterIncomingMessage` now runs the financial check unconditionally even for TechSupport,
  passing `null` filters only to skip the dirty-word/grammar part).
- **Talk creation** (`ui-manager.ts`'s `processTalkForm`): checks talk title + every question/answer
  text before validation/autofix; blocks save with an inline error
  (`editorFinancialDataBlocked`) rather than silently stripping.
- **Safety reminder — revised mid-implementation per Bernard's direction:** the original plan
  ("full tap-to-acknowledge on first occurrence per session, banner on repeats") was rejected —
  "I don't want a banner... it would be annoying to repeat it for many times." Shipped instead as a
  **toast** (reusing the existing `showNotification` mechanism, no new UI element, no layout shift)
  throttled to **once per day per checkpoint** via `localStorage` timestamps
  (`shouldShowCooldownToast`). Two checkpoints: T1 fires in `runBroadcastFromCurrentRoom` right
  before the real `broadcastTalk` emit (not on a no-op/empty-broadcast attempt); T2 fires via a new
  public `UIManager.maybeShowMatchSafetyToast()`, called from the three genuine
  match-creates-a-conversation sites in `app.ts` (the fourth `createConversation` call site,
  `findOrCreateDirectConversation`, is a support/direct channel, not a match, and was deliberately
  left out).
- Fixed a bug introduced mid-implementation: `showContentFilterToast` only branched
  dirty-word-vs-grammar, so a `financial_data` result would have silently rendered the grammar
  message. Added a proper third branch before it could ship.
- Verified: 43 new/updated unit tests (Luhn validity, each detection category, false-positive
  resistance, non-configurability, TechSupport non-exemption), full unit suite green (87 suites /
  1137 tests), type-check and lint clean, and the dealmaker E2E spec re-run to confirm the T2 hook
  in `app.ts`'s match-creation path didn't disturb match behavior (2/2 passed).
- Not yet done: e2e coverage specifically asserting the toast itself (text/cooldown behavior) —
  covered so far only by unit tests on the underlying filter and a manual read of the wiring.

## 2026-08-11 — EE (partial): "Me" tab pinned identity header + sectioning

Moved from `docs/TODO.md` EE (steps 2–3 of 4; step 1 deferred, see below). Corrected an
architecture call made earlier in the same design conversation (§BB/§DD had drafted storing typed
criteria like gender/seeking-preference on `user-public-profile`; Bernard's own framing — "my idea
of profile is only for non string attributes like headshots" — reset that to: profile holds only
StageName + headshot, everything else is an ordinary `AnswerRecord`).

- **Pinned identity header** (`src/web/ui/answers-view.ts`): StageName + headshot rendered above
  the answer list, not part of the scrolling/sectioned content — reuses the existing
  `avatarInnerHtml` helper (`profile-avatar.ts`) rather than a new rendering path. Sourced via a
  new optional `AnswersViewDeps.getCurrentIdentity`, wired in `ui-manager.ts`'s
  `displayAnswersList()` from `this.currentUser`.
- **Sectioning** (`buildAnswerSections`): groups with zero contextual variants land in a "General"
  section (today's flat behavior, unchanged); groups with at least one contextual variant section
  under whichever talk contributed their most-recently-answered contextual variant, titled by that
  talk's own title (category-prefixed via `INTEREST_CATEGORY_LABELS`/`TagCategory` when the source
  talk has tags — currently a no-op in practice since no talk-creation path populates `Talk.tags`
  yet, a separate pre-existing gap noted but not fixed here). Two different listings in the same
  category get two separate sections, never merged — verified directly (a flow's first question,
  having no preceding context, lands in General; its second question sections under the talk's own
  title; two different sell-listings' second questions land in two distinct sections).
  Each section renders progressively via its own `renderListProgressively` call (previously one
  call for the whole flat list) — first-chunk/remainder semantics now apply per section rather
  than globally, which is a real (intentional, not accidental) behavior change for anyone with
  enough answers to hit the chunking threshold across multiple sections.
- **Regression found and fixed during verification:** three existing E2E specs
  (`00-ui-navigation-settings.spec.ts`, `56-me-dialogs.spec.ts`, `00-three-user-talk-matrix.spec.ts`)
  asserted directly on `#answers-list .answer-talk-item`, which no longer existed once the flat
  list became a set of per-section containers. Fixed by keeping `#answers-list` as the *outer*
  wrapper id (containing all sections) rather than introducing a new id — the descendant selector
  those specs already used continued to work with zero test-file changes needed.
- **Step 1 (redirect §BB/§DD's typed built-ins to write into the `AnswerRecord` store) is not
  applicable yet** — §BB (the tag/preference-set registry + `Question.builtIn` schema) hasn't been
  implemented, so there is nothing to redirect. Left as the one open implementation-plan step,
  revisit once §BB ships.
- Verified: 4 new unit tests (identity header present/absent, context-free-vs-contextual
  sectioning, two-listings-never-merged) plus the full existing `answers-view.test.ts` suite
  unchanged (21/21), full unit suite green (87 suites / 1141 tests), type-check and lint clean, and
  3 e2e specs re-run clean after the `#answers-list` id fix (12/12 passed).

## 2026-08-11 — FF (partial): multi-value ("pick any that apply") match-engine core

Moved from `docs/TODO.md` FF (implementation-plan step 2 of 4). Answers a design question raised
mid-session: today's matching is strict single-value exact-text match with no way to express "I'd
accept any of these values" as one criterion, and no AND/OR authoring concept. Resolution: no
boolean-logic UI needed — flow/route sequencing already gives AND across attributes, so the only
missing primitive is OR within one question, which a checkbox list ("select all that apply")
already expresses without any logic vocabulary.

- **Schema:** `Question.answerSelectionMode?: 'single' | 'multiple'` (`types.ts`) and
  `SubmittedAnswer.answerIds?: string[]` (`talk-engine.ts`) — both optional/undefined-safe, so
  every existing talk and call site is unaffected.
- **Match predicate generalized, not replaced:** `checkIfMatch`/`checkIfIgnore` now treat every
  submitted answer as a *set* of answer IDs (`selectedAnswerIds` — a singleton when `answerIds` is
  absent/empty), and the predicate becomes "does the selected set intersect the question's
  isMatch-flagged (or isIgnore-flagged) options" — `anySelectedIsMatch`/`anySelectedIsIgnore`. For
  a singleton set this is provably identical to the original single-answer lookup (a set of size
  one intersects the isMatch set iff its one element is isMatch-flagged), so no existing
  `'single'`-mode question's behavior changes. Deliberately kept `checkIfMatch` and `checkIfIgnore`
  independent of each other (no new cross-check between them) — the original two functions never
  cross-checked either, and adding one would have been a new, unrequested assumption.
  `checkIfIgnore`'s route-talk tests (`talk-engine.test.ts`) are the ones that would have caught it
  if this generalization had shifted behavior — all 14 passed unmodified.
- **Not yet done (docs/TODO.md §FF for the full remaining plan):** chatbot auto-fill
  (`exact-chatbot-memory.ts`'s `findAutoAnswer`) still only ever resolves one answer ID — a
  `'multiple'`-mode question's match predicate is ready, but nothing can auto-select a multi-value
  checkbox set yet. No talk-editor UI toggle ("Multiple choice" vs "Checkboxes") exists. No
  respondent-facing checkbox rendering exists (today's response dialog is radio-button only). No
  e2e coverage. The schema and match engine were built as the stable foundation these depend on, so
  none of them require touching `talk-engine.ts` again once built.
- Verified: 6 new unit tests (any-overlap matches, all-ignore-flagged doesn't, singleton-set
  reproduces legacy behavior exactly via a direct `answerIds`-vs-no-`answerIds` equality
  assertion, empty-`answerIds`-array falls back to `answerId`, explicit unaffected-single-select
  regression case) plus all 14 pre-existing `talk-engine.test.ts` cases unmodified, full unit suite
  green (87 suites / 1147 tests), type-check and lint clean.

## 2026-08-11 — FF completion: multi-select chatbot auto-fill, editor UI, response UI, e2e

Moved from `docs/TODO.md` FF (steps 1, 3, 4 — completing the partial ship recorded above).
Finished the remaining UI/auto-fill layer on top of the schema + match-engine core.

- **Chatbot auto-fill** (`exact-chatbot-memory.ts`): `findAutoAnswerMultiple`, the "pick any that
  apply" counterpart to `findAutoAnswer` — same suppression/permanent/role-veto handling, but
  TEMPORARY-mode resolution collects every distinct remembered answer id present in the current
  option set (not just the newest), reusing `saveTemporaryAnswer`'s existing per-event history
  unchanged. 10 new unit tests.
- **Talk editor** (`talk-editor-form-helpers.ts`, `ui-manager.ts`): a per-question "Respondent may
  select: One (multiple choice) / Any that apply (checkboxes)" toggle. Switching modes converts
  self-answer inputs between radio/checkbox in place; `'multiple'` mode drops the ignore-row
  entirely (the author's own self-answer is just "whichever boxes I check," no separate ignore
  concept at authoring time) and restricts the per-option answer-next dropdown to Ignore/Noticed
  only — a multi-select question is always chain-terminal, since "go to question X" is ambiguous
  when several options can be checked at once. `processTalkForm` collects one `selfAnswers` entry
  per checked box, reusing `saveCreatedTalk`'s existing per-entry `saveAnswerPreference` loop
  unchanged as the substrate `findAutoAnswerMultiple` scans.
- **Response dialog** (`talk-response-dialog.ts`): a plain checkbox list + Submit button, not the
  existing auto/manual/permanent radio grid (which assumes exactly one final answer). Outcome
  determined via the canonical `checkIfMatch` (talk-engine.ts) — never reimplemented locally, per
  the standing invariant that match logic lives only in `talk-engine.ts`.
- **Two real bugs found and fixed along the way**, both in code that predates this feature and
  neither caught by type-checking: `TalkAutofix.fix` and `TalkValidator.validateFlowTalk` each had
  their own independent copy of "only the first answer may be isMatch, every other answer is
  forced to ignore" — a rule that was correct for single-select flow questions but silently
  defeated multi-select entirely. `TalkAutofix` stripped `isMatch` from every checked option but
  the first before the talk was ever saved; independently, `TalkValidator` (which runs after
  autofix) would have rejected a correctly-multi-flagged talk anyway, throwing a validation error
  with no visible JS exception — the talk-editor modal just stayed open with no explanation. Found
  via the e2e spec below actually failing (twice, once per bug) rather than by code inspection.
  Both fixed with an `answerSelectionMode === 'multiple'` branch that preserves every answer's
  author-set isMatch/isIgnore flag unchanged, normalizes to terminal, and forbids `nextQuestionId`.
  7 new unit tests across both functions, including one exercising the full autofix-then-validate
  pipeline end to end.
- **E2E** (`tests/e2e/staged/stage2-two-user/85-multi-value-checkbox-match.spec.ts`, new): a
  buyer's talk asks "Which models would you accept?" as a checkbox question (Model A/B
  isMatch-flagged, Model C isIgnore-flagged); a seller checking Model B matches, a seller checking
  only Model C doesn't — both through real UI (talk editor + response-dialog checkboxes), 2/2
  passed, re-run for stability.
- **Not done, explicitly deferred**: chatbot auto-fill is unit-tested and ready but not yet wired
  into either of `ui-manager.ts`'s two auto-resolution consumption points
  (`resolveAnswerPreferenceForTalkQuestion`'s per-question resolver, and
  `tryBuildChatbotAnswersFromFlattened`'s zero-click dealmaker-style path) — so a `'multiple'`-mode
  question always falls to manual human answering today, never a zero-click chatbot auto-match.
  The e2e spec above tests the manual path only, for this reason. Large-option-count searchable
  chip input (vs. a flat checklist) also deferred, low priority.
- Verified: type-check, lint, full unit suite green (87 suites / 1167 tests), the new e2e spec
  (2/2, re-run for stability), and a regression pass on the dealmaker spec + the earlier
  per-question-deep-link spec (both still pass unmodified) to confirm the `TalkAutofix`/
  `TalkValidator` changes didn't disturb existing single-select flow talks.

## 2026-08-11 — FF: wired chatbot auto-fill into both auto-resolution paths (closing the last gap)

Moved from `docs/TODO.md` FF (the one remaining piece from the completion entry above). Wires
`findAutoAnswerMultiple` (already built and unit-tested) into `ui-manager.ts`'s
`resolveAnswerPreferenceForTalkQuestion` (the per-question resolver both the response dialog's
auto-answer check and `tryBuildChatbotAnswersFromFlattened` funnel through) — so a `'multiple'`-mode
question can now auto-match with zero manual clicks, the same as single-select questions always
could.

Two more real bugs found and fixed along the way, both via an e2e test actually failing (not
inspection):

- **Content-identity collision.** `buildIdentityPayloadFromTalk` (`cid.ts`) hashes question/answer
  *text* only, never isMatch/isIgnore flags. A buyer's and a seller's multi-select talk sharing
  byte-identical question/option wording (required for the chatbot's exact-text memory to connect
  them at all) computed the *same* `qa_` identity key despite opposite match semantics — the
  delivery-dedup ledger silently treated the second broadcast as "already exchanged" and dropped
  it. Not a new gap: this is exactly the collision `Talk.role` was added to the identity hash to
  prevent, earlier this session — the fix was using `role` on the test's talks (as the dealmaker
  spec already does for its buyer/seller pairs), not inventing a second mechanism.
- **Answer-id scheme mismatch.** `findAutoAnswerMultiple` returns content-hash answer ids
  (`makeAnswerId`, `exact-chatbot-memory.ts`); a talk's own `Answer.id` fields are positional
  (`a_0_0`, `a_0_1`, ...) — a different scheme entirely. The existing single-select ANSWER branch
  already translates between the two via text comparison
  (`currentQuestion.answers.find(a => a.text === exact.answerText)`); the new multi-select branch
  initially skipped that translation and returned the content-hash ids straight through, so
  `tryBuildChatbotAnswersFromFlattened`'s `q.answers.some(a => a.id === id)` validity check could
  never match and silently rejected every resolution. Fixed by applying the same
  text-to-positional-id translation per remembered answer.
- A third, more mundane ordering bug was also found and fixed in the *test itself* (not app code):
  the test's helper auto-broadcast a talk at creation time (via the talk editor's
  "Send to Chatroom" default) before the chatbot was enabled on either side, so the one-shot
  auto-reply-on-arrival mechanism had nothing to resolve against — fixed by explicitly
  unchecking "Send to Chatroom" at creation and controlling broadcast timing directly in the test,
  matching the dealmaker spec's "create everything before anyone broadcasts" ordering.
- New e2e test in the same spec file: byte-identical multi-select question on both sides, buyer
  self-answers {Model A, Model B}, seller self-answers {Model B} — zero `openIncomingTalkModal`
  calls, zero checkbox clicks, both sides reach a conversation purely from chatbot auto-resolution.
  3/3 tests in the file passed together, re-run for stability.
- Verified: type-check, lint, full unit suite green (87 suites / 1167 tests), the spec's all 3
  tests together (2 runs), and a regression pass on the dealmaker spec + per-question-deep-link +
  tags-checkbox specs (all pass unmodified).
# TODO reconciliation archive — 2026-08-14

The historical implementation narratives formerly retained in `docs/TODO.md` were reconciled on
2026-08-14. The active file now contains only actionable work. The following completed areas were
removed from the active backlog; their detailed implementation evidence remains elsewhere in this
archive, the technical specification, tests, and commit history:

- A–F and H; host E2E verification; K1–K6; L; Q/M; N; O; P; R1–R3.
- Merkle checkpoint/pruning framework implementation (S), apart from storage-budget caps and final
  real-browser correctness verification.
- T, U, V, X, Y, AA, CC, FF, GG, and HH.
- W incremental rebroadcast implementation, apart from the dead bulk-API disposition decision.
- Z's main Talks row/gesture redesign, apart from popup-variant review.
- BB's six core typed-matching phases: tag registry, built-in schema, comparisons, preference
  storage, auto-resolution, flow/route editor support, and seeded tag-pair picker. Explicit
  deferrals remain active in `TODO.md`.
- EE pinned identity header and context-section grouping; remaining typed-value storage and
  verification work stays active.

Recent native-network work through app version 1.0.7 is also considered shipped: local discovery,
Mac/Windows/Linux/Android packaging, native-version display, Android web-banner correction,
incoming-talk persistence, multi-device fanout/reverse delivery, and the bounded Gun pair-response
soul fix. Android is no longer treated as an unshipped browser-profile stand-in.

## Seven-client physical runtime matrix — 2026-08-14

- Added the opt-in `test:e2e:real-device-matrix` Playwright suite covering the macOS Electron
  app, three physical Android phones, Chromium, WebKit, and Firefox on one memory-only LAN Gun hub.
- Replaced the unavailable `RNV0217207000190` phone with Essential PH-1
  `PM1LHMA7A2707315`; the other verified devices were Huawei `DUM0219418001663` and C10
  `PADC100013000534`.
- Each of the seven runtimes joined presence, authored and broadcast one tag talk, and completed
  one cross-runtime match in a seven-node ring. The physical run passed in 5.0 minutes.
- Physical WebView setup now supports deterministic serial-specific CDP attachment and removes
  accumulated high-volume test/Gun caches while retaining SEA custody and user preferences.
