# IinPublic TODO

Last updated: 2026-05-27

This is the forward backlog for the current repository. Completed feature ledgers belong in
[Completed Work](completed.md), not in TODO.

Authoritative product scope lives in
[docs/specs/iinpublic-technical-specification.md](specs/iinpublic-technical-specification.md).

## Current Focus

Complete the app-detail phases below while continuing the P2P roadmap:
[P2P Node Network Roadmap](roadmap/p2p-node-network.md).

No active P2P roadmap phase remains in this TODO. Add new forward work here only after it is
scoped against the technical specification or the P2P roadmap.

## Phased Application Detail Completion Plan

Goal: finish the user-visible details of the five main tabs and prove the entire talk lifecycle
with durable tests. This plan is ordered for implementation; the tab-specific and TechSupport
checklists later in this document remain the detailed feature inventory and are not superseded.

Current implementation baseline discovered during the audit:

- Reserved-name validation and its UI/API/E2E acceptance coverage now reject ordinary claims to
  `TechSupport`, `admin`, `administrator`, `api`, `root`, `system`, `support`, and `www`,
  including normalized spelling variations.
- Incoming-talk intake controls have staged multi-user E2E proofs for language, distance, content,
  talk-type, and sent-after cutoff (see [completed.md](completed.md)). Broader grammar/dirty-word
  policy and live distance preamble timing remain future work.
- Settings now supports confirmed photo previews, camera permission fallback, persisted
  Me/Contacts/peer photo rendering, omits empty-interest placeholders, and localizes
  distance, nickname, and photo-file validation feedback in Chinese.
- Settings is the sole editor for Talk Behavior and intake controls; Me offers answer history and a
  Preferences shortcut without duplicating settings inputs.
- The explicit App language setting is separate from profile and incoming-language values, persists
  across reload, and defaults new talks to that language. Reachable strings still need audit coverage.
- Chinese catalog coverage now includes Chatrooms live/member states, Contacts list,
  detail, relationship, block, and public-credit surfaces, plus peer-detail profile,
  history, conversation, and send controls. Chatroom create/rename management,
  broadcast, travel, location, contact relationship action notices, and TechSupport
  mute controls are localized; other action/error notices still require the D2 traversal and audit.
- Chinese catalog coverage now includes the Talks main list, outgoing/incoming row metadata,
  language badges, flow/tag/route editor controls, route branch-tree internals, and flow/tag
  response outcomes. Create/send/update/load/copy/remove/completion feedback and editor
  validation banners are localized; remaining cross-feature notifications and support paths
  remain active D2 work.
- Chinese catalog coverage now includes Me answer-history rows, toolbar filters, profile and
  credit summaries, broadcast-trend states, nickname/profile editors, Preferences, My Talks
  dialogs, and peer-detail interaction panels; remaining action/error surfaces remain active D2 work.
- Chinese catalog coverage now includes Settings Storage Inspector headings, ordinary statuses,
  local-node permissions, SEA/transport/data-ownership policy copy, and server path explanations
  while preserving stable protocol and storage identifiers for diagnosis.
- Chinese catalog coverage now includes conversation list/overlay text, localized relative message
  times, translated TechSupport welcome rendering and support-channel/match notifications while
  retaining the durable English support-greeting payload for compatibility. Conversation and room
  message success/error feedback is localized as well.
- Chinese catalog coverage now includes the creator-facing survey analytics dashboard, privacy and
  CSV-export controls, translated export feedback, and follow-up survey entry workflow.
- Ordinary users with an established support channel now see TechSupport as a pinned built-in
  Contacts row. Contacts and the reachable peer overlay expose local mute/unmute instead of
  ordinary block behavior, and support notifications honor that per-user device setting.
- Matching E2E specs cover several successful, mismatched, ignored, auto-answer, Contacts, and Me
  scenarios independently; they do not yet provide one exhaustive branch matrix from talk creation
  through every sender/responder result.
- Contacts already exposes basic name/relationship filters and sort choices for recent, name, talk
  count, and matches. It does not yet solve high-volume response triage across many talks and
  responders, or provide weighted ranking and grouped answer review.

### Phase D2 - Full UI Localization

Purpose: make profile/UI language change the actual application language, not just saved metadata.

**Shipped (see [completed.md](completed.md)):** English/Chinese UI catalog with immediate re-render;
App language independent from profile/incoming languages; localized language name display;
`00y-chinese-ui-traversal.spec.ts` plus extended checks in `00-ui-navigation-settings.spec.ts`
(`npm run test:e2e:phase-d2`).

**Remaining:**

- Audit remaining reachable surfaces for unexpected English fallbacks (notifications, edge modals,
  support-only paths) beyond the current traversal specs.
- Language-specific grammar/dirty-word policy (shared with D3 future work).

Exit criteria: UI language is independent from intake language and every reachable main workflow
has an automated Chinese traversal.

### Phase D3 - Incoming Talk Filters and Talk Behavior

Purpose: make every Settings control visibly change delivery or behavior and prove it with real
senders and receivers. Existing filter plumbing is a foundation, not completion of these scenarios.

**Shipped (moved to [completed.md](completed.md)):** three-language intake with broadcast preview;
Talk Behavior auto-copy/chatbot proofs; distance/grammar/dirty-word/talk-type/sent-after/adult/block
multi-user E2E suite (`00m`–`00p`, `00t`) plus Settings coverage.

**Remaining:**

- Language-aware grammar and dirty-word policy beyond the current heuristic lists.
- User-visible `intake_dirty_words` reporting in filtered-count diagnostics.
- Reliable live broadcast preamble copy for distance when receiver location sync lags (delivery
  assertions remain authoritative today).

Exit criteria: each Settings behavior/filter control has at least one allow path, one reject/disabled
path, persisted state verification, and an intelligible reason visible to the user where applicable.

### Phase D4 - Exhaustive Talk Lifecycle and Matching Matrix

Purpose: exercise each possible route from a created talk through receiving, answering, matching,
contacts, and Me answer ownership instead of relying on isolated happy paths.

- **Creator state at creation.** For every talk type (`tag`, `flow`, `survey`, `route`), create from
  the editor and verify title, language, type, expiry/location settings, and creator self-selected
  question/answer pairs appear in the creator's OUT list and Me answer/history surface as designed.
  Verify editing preserves language, branches, self answers, and targeting settings.
**Shipped (partial):** stranger-before-match Contacts label (`00u`), flow/tag multi-responder
match+mismatch matrix (`00w`, `00z`), shared fixtures and `talk-lifecycle-e2e.ts`; script
`npm run test:e2e:phase-d4` (see [completed.md](completed.md)). Survey/route branches, intake-filtered
peer in matrix, and full creator-edit coverage remain open.

- **Pre-answer relationship state.** Send a talk to eligible peers and verify the recipient sees it
  in IN, while any newly discoverable user/contact surface labels the unestablished peer
  `Stranger` before a successful match or saved relationship. Keep TechSupport separate from this
  ordinary stranger classification.
- **All response branches.** Build fixture talks whose branches are named and deterministic, then
  traverse every terminal outcome: match/noticed, ignore, mismatch/no-match, intermediate branch
  continuation, terminal non-match, copy, manual answer, conditional/context answer, saved
  auto-answer, and chatbot-suppressed/manual response. For `route`, traverse every leaf and prove
  identical question text under different paths stores separate context-aware answers.
- **Multiple responder reactions.** Send the same creator talk to multiple responders: one matches,
  one ignores, one mismatches, and one is intake-filtered. Verify the creator receives exactly the
  correct reaction/status for each responder, only matched peers can start the normal conversation
  path, and replies do not merge or overwrite each other's identities or answer records.
- **Contacts state transition.** Assert a stranger is not prematurely treated as a relationship;
  after a match, the responder is listed in Contacts with ordinary initial relationship state
  (`Stranger`/no saved label until explicitly classified), correct shared-talk history, nickname/
  relationship update behavior, credit visibility rules, blocking behavior, and sorting/search.
- **Me answer ownership.** For sender and each responder, assert the correct question/answer pair,
  outcome (`Match` or `Mismatch`), manual/auto/conditional mode, copy action, repeated-answer count,
  language, and context path appears only in that user's Me history. Ignored, filtered, support, and
  unreceived talks must not incorrectly pollute answer memory.
- **Delivery and lifecycle edges.** Extend the matrix for send-to-room off/on, broadcast preview,
  direct send, duplicate broadcasts/content consolidation, expired/deleted talks, disconnect and
  reconnect, sender/receiver blocks, adult gate, language/distance/content rejection, and
  TechSupport exclusion or intentional participation.

Recommended test organization:

1. Add reusable fixture builders for one branching talk of each type and response-outcome helpers.
2. Add one sender/one receiver specs for each branch outcome and durable UI/server-state assertions.
3. Add a multi-responder scenario proving creator reactions, Contacts transitions, and answer isolation.
4. Add intake-gated scenarios from Phase D3 that prove a rejected branch never becomes an IN row or
   relationship.
5. Keep the tests in the TechSupport-seeded stage pipeline and explicitly exclude support greetings
   from ordinary talk assertions unless that is what the test exercises.

Exit criteria: every defined talk branch and major delivery rejection has a named automated
scenario proving the corresponding OUT, IN, Contacts, conversation, and Me state.

### Phase D5 - High-Volume Reply Triage and Ranking

Purpose: keep the app usable when a creator receives many replies instead of one or two. A
realistic proof scenario is one creator sending 10 talks to 10 ordinary users and reviewing the
resulting 100 reply records without losing identity, talk, relationship, or outcome context.

- **Creator reply inbox/workbench.** Add a dedicated creator-facing answer/reply review surface, or
  extend Talks/Me with an explicit received-replies mode. Show each reply with responder stage name,
  source talk, response time/date, terminal outcome, matching questions/answers, manual/auto state,
  relationship state, credit/reputation visibility, and whether a conversation exists.
- **Filtering and search.** Support combined filters for date/time range, latest/unread status,
  responder stage name search, selected talk or talk type, response outcome (match/mismatch/ignore/
  filtered/auto), relationship label (`Stranger`, friend, relative, coworker, acquaintance,
  partner, custom), language, and location/distance range where permitted. Filters must compose
  predictably and expose the active filter chips plus a clear-all action.
- **Sorting and grouping.** Support ascending/descending time and date, responder stage name,
  talk title, relationship, number of matched talks with that user, number of matches per talk,
  total replies per talk, match rate, and weighted relevance score. Allow grouping by responder,
  talk, relationship, or day so a creator can answer questions such as "which users matched most of
  my talks?" and "which talks performed best?"
- **Weighted statistics model.** Define a transparent ranking formula rather than hiding an
  arbitrary score. Include selectable or documented factors such as matched-talk count, match
  percentage, recency, existing relationship, mutual/shared interests, visible public credit, and
  penalties for ignored, blocked, filtered, or stale interactions. Show factor breakdown/tooltips,
  provide an unweighted sort option, and never use private answers or hidden credit as ranking input.
- **User ranking behavior.** A responder who matches more of the creator's talks should be able to
  rise to the top of the contact/reply list when sorting by matched-talk count or weighted relevance.
  The creator must still be able to switch back to chronological or alphabetical order, and
  TechSupport/support traffic must be excluded from ordinary ranking unless intentionally included.
- **Talk ranking behavior.** On the Talks tab, allow OUT talks to be sorted by most matches, most
  responses, match rate, latest response, newest/oldest creation time, title, and weighted
  performance. Each OUT row should show response, match, mismatch/ignore, and filtered counts so the
  reason for ordering is visible rather than surprising.
- **Performance and pagination.** Do not render an unbounded response list as volume grows. Add
  pagination or virtualized/infinite scrolling, stable cursor/order semantics, loading and empty
  states, retained filter/sort state after opening detail and returning, and acceptable query/render
  performance for at least 100 replies and a larger stress fixture.
- **Privacy and moderation boundaries.** Ranking and filtering must respect blocked users, profile
  visibility, hidden reputation, support-channel isolation, local-only answer ownership, and
  language/content-filter privacy. Aggregates should not reveal a filtered user's private answer
  body merely because their rejected delivery is counted.
**Shipped (partial):** creator reply triage UI, 10×10 API integration proof, and 10×10 browser
matrix E2E (`npm run test:e2e:phase-d5`) — see [completed.md](completed.md).

- **High-volume E2E proof script.** Create 10 distinct talks for one creator, deliver them to 10
  users, and generate a controlled 100-reply matrix containing match, mismatch, ignore, different
  relationships, different timestamps, and at least one ranking tie. Verify:
  - Exactly 100 ordinary reply records are available to the creator without duplicates or overwritten
    responder identities.
  - Filter by one stage name returns that user's 10 replies; filter by one talk returns its 10
    replies; relationship and date filters return the fixture-defined subsets.
  - Sorting users by matched-talk count puts the deliberately strongest match user first and uses a
    defined stable tie-breaker.
  - Sorting talks by number of matches puts the fixture-defined strongest talk first, with visible
    counts agreeing with underlying reply records.
  - Weighted sorting displays the contributing factors and changes order only according to its
    documented formula.
  - Clearing filters restores all 100 replies, navigation preserves chosen sort/filter state, and
    TechSupport greetings/support channels do not appear in the ordinary result set.

Exit criteria: a user can turn 100 reply records into actionable user and talk rankings through
documented, test-proven filters/sorts without missing, duplicating, or exposing disallowed data.

### Phase D6 - Tab-by-Tab Completion Sweep

Purpose: close UI details revealed while traversing the app. The longer feature backlog below
remains binding; this is the implementation sequence for its visible outcomes.

**Shipped (partial):** tab-sweep/navigation/localization smoke bundle
(`npm run test:e2e:phase-d6`) — see [completed.md](completed.md).

#### Chatrooms

- Finish custom/business room detail metadata: description, capacity, headline, owner, created date,
  active members, lifetime visits, and unique visitors; verify counts and reconnect idempotency.
- Make broadcast recipient preview explain language, distance, type, content, age, block,
  expiration, reputation/quota, and TechSupport/support-only exclusions before sending.
- Verify Global/region/home/travel/return-home paths, member ordering, `Stranger` status before
  ordinary matching, and permanent TechSupport anchor behavior.

#### Contacts

- Make an ordinary answerer/match appear initially as `Stranger` or no assigned relationship until
  the user chooses friend/relative/coworker/acquaintance/partner/custom; ensure all labels filter,
  search, sort, save, and reload correctly.
- Add high-volume responder ranking from Phase D5: matched-talk count, match rate, relationship,
  recency, and transparent weighted relevance, with stable tie-breaking and TechSupport exclusion.
- Complete profile presentation: real headshot, shared/localized languages, shared interests only
  when present, talk history, public credit/privacy, block status, channel/transport health, and
  translated mismatch affordances.

#### Talks

- Complete the exhaustive creation/branch/response matrix in Phase D4 for tag, flow, survey, and
  route, including language edit preservation and creator/recipient state transitions.
- Add recipient and filtered-count diagnostics by rejection reason, targeting preview before send,
  support-talk isolation, expired/deleted/rebroadcast treatment, and clear status for IN versus OUT
  versus copied/answered items.
- Add creator reply triage and OUT-talk ranking from Phase D5, including sorting by most matches,
  most replies, match rate, latest reply, and weighted performance with visible aggregate counts.
- Keep survey aggregate/report/export flows distinct from matching conversations and verify route
  context hashes do not incorrectly reuse answers across branches or languages.

#### Me

- Align profile editing with Settings for headshot, supported languages, interests, and privacy;
  remove empty-interest filler and keep the owner edit path clear.
- Finish Preferences modes for temporary, permanent, suppressed, manual, auto, and conditional
  answer behavior; expose human-readable branch/context explanations, language, export/delete/sync
  ownership controls, and support-message exclusion.
- Add a scalable answer/reply review mode from Phase D5 with filters for responder, talk, date,
  outcome, and relationship; grouping and sorting should remain usable after opening answer detail.

#### Settings

- Deliver the localization and filter behavior in Phases D2-D3, including clear validation,
  persistence, reset, and hidden-count preview.
- Expand storage/transport diagnostics for TechSupport root/support state, room visit counts,
  localization and filter state, default talk language, SEA custody, relay leakage checks, local
  browser storage, and P2P feature flags without exposing secrets.

#### Conversation, Peer Detail, and Hidden Surfaces

- Add support-channel/normal-channel transport status, fallback reason, privacy verification,
  translation consent behavior, and search/history controls to conversation and peer-detail overlays.
- Keep the selected statistics design consistent: no separate bottom-navigation Statistics tab;
  retain contextual aggregate summaries in work views and the completed per-survey analytics dialog.

Exit criteria: a final manual-plus-E2E traversal of every visible control in all five tabs and their
dialogs/overlays has no unexplained placeholder, untested toggle, unreachable feature, or
cross-tab state inconsistency.

## TechSupport Root Network Role

Scope: [FR-CR-1 and FR-CR-2](specs/iinpublic-technical-specification.md#chatrooms-and-location-privacy)
for global-room first entry, plus the P2P identity, signaling, and direct-message boundaries in
[P2P Node Network Roadmap](roadmap/p2p-node-network.md).

Goal: make `TechSupport` the one and only root user of the entire P2P network. On a fresh network,
`TechSupport` must exist before any ordinary user, must be the permanent non-empty global-room
anchor, must greet every new user who enters the global room, and must establish a private support
P2P channel with each user for future help. No ordinary user should ever see an empty network.

Implementation actions:

- Define a canonical reserved root identity: exact stage name `TechSupport`, stable root user id,
  SEA public identity, avatar/headshot, public support profile, and role metadata such as
  `networkRole: "root-techsupport"`.
- Enforce singleton creation at bootstrap: the first account in an empty graph is always
  `TechSupport`; later attempts to create, rename, import, or impersonate `TechSupport` are rejected
  unless they are signed by the canonical root identity.
- Seed `TechSupport` into the global chatroom before ordinary user placement so the global room has
  at least one visible member and a support profile on every first run.
- Give `TechSupport` root network privileges only for support workflows: network bootstrap,
  global-room presence, user greeting, support-channel setup, and diagnostics visible to the user.
  Do not make this a backdoor for reading private profiles, private keys, direct-message bodies,
  encrypted answer memory, or local-only neighbor graphs.
- Add join detection for every ordinary user entering the global room. `TechSupport` sends one
  idempotent welcome message per user/device identity, with retries after reconnect but no duplicate
  spam.
- Establish a direct P2P support channel from `TechSupport` to each user after greeting. Use the
  existing transport abstraction: direct P2P when available, encrypted relay fallback when needed,
  and star-mode compatibility while direct P2P remains disabled.
- Persist support-channel state as user-visible relationship metadata: greeting sent, support channel
  established, last support contact, transport mode used, and current health.
- Add a support bootstrap candidate so new clients can discover `TechSupport` before falling back to
  generic public star-server discovery.
- Surface `TechSupport` consistently in the UI as a built-in support contact, not as a normal user
  who can be blocked, renamed, evicted, rate-limited, or deleted by ordinary flows.
- Add abuse and privacy guardrails: ordinary users can mute support messages locally; blocking
  `TechSupport` should silence notifications but not remove the network anchor; support cannot
  bypass user consent to inspect private local data.
- Add tests proving the singleton/root invariant, reserved-name rejection, first-run seeding,
  global-room non-empty state, welcome idempotency, support-channel creation, transport fallback,
  and absence of leaked private key or plaintext direct-message material.

TechSupport first-run traversal and verification checklist:

1. Bootstrap and identity
   - Start from an empty graph/storage state.
   - Verify `TechSupport` is created before ordinary users and is the only root user.
   - Verify the `TechSupport` stage name, root user id, public SEA identity, headshot, languages,
     interests, and public support profile are present.
   - Verify reserved names such as `TechSupport`, casing variants, `admin`, `system`, and `root`
     cannot be claimed by ordinary user creation or Settings rename.
   - Verify private SEA key material is encrypted at rest and never appears in Gun, relay envelopes,
     logs, localStorage plaintext, or support diagnostics.

2. Global room and network presence
   - Open the Chatrooms tab and verify the global room is visible.
   - Enter the global room and verify `TechSupport` appears as the first/root member.
   - Verify a fresh ordinary user never sees an empty member list while the network is reachable.
   - Verify room member counts include `TechSupport` and update when ordinary users join or leave.
   - Verify `TechSupport` is not evicted by room capacity, FIFO movement, travel mode, or return-home
     flows.
   - Verify custom room creation, room detail views, owner bars, and Broadcast controls still behave
     correctly with the root support member present.

3. New-user greeting
   - Create a new ordinary user and place them in the global room.
   - Verify `TechSupport` detects the join and sends the configured welcome message.
   - Verify the welcome message identifies support clearly and offers the support channel without
     asking for private data.
   - Refresh, reconnect, and switch tabs; verify the welcome message is not duplicated for the same
     user/device identity.
   - Create additional users and verify each receives exactly one welcome sequence.

4. Support P2P channel
   - After greeting, verify a support conversation/channel exists between `TechSupport` and the new
     user.
   - Verify direct P2P transport is used when enabled and both peers are reachable.
   - Verify encrypted relay or star-compatible fallback is used when direct P2P is unavailable.
   - Verify support-channel diagnostics show transport mode, fallback reason, and health without
     uploading analytics.
   - Send a support test message both directions and verify delivery, ordering, read/render state,
     and reconnection behavior.
   - Verify message bodies are encrypted for relay/direct paths and not persisted in public Gun
     shared nodes beyond the allowed compatibility boundary.

5. Chatrooms tab
   - Traverse the hierarchy from Global through expanded region/country/state rooms.
   - Verify the current home room, Return Home button, travel-mode behavior, custom rooms, room
     creation, member list, user rows, detail panels, and status header.
   - Verify `TechSupport` remains visible in global and discoverable as support even when the user
     navigates to another room.
   - Verify Broadcast sends only eligible user talks and does not send private support diagnostics or
     support-only messages.

6. Contacts tab
   - Open Contacts and verify `TechSupport` appears as a built-in support contact once the support
     channel exists.
   - Verify contact search, relation filter, sort order, contact stats, and contact detail rendering.
   - Verify the `TechSupport` contact cannot be deleted or treated as an ordinary matched peer, but
     can be muted locally.
   - Verify ordinary contacts created through talk matches still appear and sort independently of the
     support contact.

7. Talks tab
   - Open Talks and verify All, IN, and OUT filters.
   - Create each basic talk type available in the editor: tag, flow, survey, and route.
   - Verify validation, ignore paths, branching/OR behavior, answer choices, terminal match/ignore
     behavior, and copied/answered/created talk states.
   - Verify `TechSupport` can use talks for support verification without polluting ordinary user
     answer memory unless the user explicitly answers those talks.
   - Verify broadcast and direct-send flows do not automatically send support-only talks to unrelated
     ordinary users.

8. Conversation and peer-detail overlays
   - Open the `TechSupport` support channel from the member row, Contacts detail, and any support
     notification entry point.
   - Verify peer detail shows the public support profile, support-channel status, talk history,
     direct message composer, auto-mode control, and Send My Talks button state.
   - Verify Block User is replaced or constrained for `TechSupport` so ordinary users can mute
     support notifications without deleting the root support channel.
   - Verify ordinary peer detail behavior remains unchanged for non-support users.

9. Me tab
   - Open Me and verify answered question history renders.
   - Verify All, Auto, Manual, and Conditional filters.
   - Open Preferences and verify exact-question answer memory modes: temporary, permanent, and
     suppressed.
   - Verify TechSupport welcome/support messages do not appear as answered talks unless they are
     intentionally delivered as talks and answered by the user.
   - Verify chatbot memory reuse still works for ordinary talks after support bootstrap.

10. Settings tab
    - Verify stage-name editing rejects `TechSupport` and reserved-name variants for ordinary users.
    - Verify headshot, language, incoming language filters, copy-talk autosave, chatbot enabled,
      distance filters, home room, grammar/dirty-word filters, reputation visibility, and custom
      blocked terms still save and reload.
    - Verify Refresh Location updates home-room and travel controls without removing the support
      channel.
    - Verify the storage inspector shows `TechSupport` root identity state, support-channel state,
      transport diagnostics, server persistence policy, relay leak scan, SEA custody status, browser
      localStorage keys, and IndexedDB names.
    - Verify clearing dev stage zero resets ordinary users while reseeding exactly one
      `TechSupport` root identity.

11. Cross-session and multi-user verification
    - Reload the first ordinary user and verify `TechSupport`, the welcome record, and the support
      channel survive.
    - Open two or more ordinary users in separate browser contexts and verify each sees
      `TechSupport` but not each other's private support-channel contents.
    - Verify `TechSupport` can greet and establish support channels concurrently without duplicate
      channel records or cross-user message leakage.
    - Verify offline startup uses the best available local support/contact cache and reconciles with
      the canonical `TechSupport` identity when the network returns.

## Feature Completion Backlog by Tab

Scope: forward-only gaps across Chatrooms, Contacts, Talks, Me, and Settings. Shipped tab features
from the 2026-05-27 audit live in [completed.md](completed.md) (localization controls, room counters,
TechSupport anchor, contact ranking, talk language, creator diagnostics, answer-memory UI, storage
inspector, contextual statistics, runtime diagnostics, and related E2E).

### Cross-Tab Language and Localization

- **Partially implemented: full UI localization (Phase D2).** Proof script shipped; zero English-fallback
  audit on edge/support paths remains.
- **Future work: language-specific grammar and dirty-word filtering.** Current filters are simple
  heuristics. Add language-aware content models or dictionaries, per-language test fixtures, and
  clear behavior when a talk language is unknown.

### Chatrooms Tab

- **Future work: reconnect/idempotency audit** for visit counters and deleted-room history beyond
  current unit/E2E coverage.

### Contacts Tab

- **Future work: manual/pinned contacts.** Add a way to keep a contact without requiring a prior
  matched talk, with clear privacy boundaries and local-only storage unless explicitly synced.
- **Partially implemented: contact detail parity.** Shared-tag drilldown and live transport health
  negotiation beyond recorded conversation evidence.

### Talks Tab

- **Partially implemented: talk targeting preview.** Visible disabled/expired omission explanations
  in peer-send chooser and broadcast modal (delivery omits expired talks today).
- **Future work: support-talk isolation.** TechSupport verification/support talks must not pollute
  ordinary user answer memory or broadcast to unrelated users unless intentionally delivered and
  answered.

### Conversation and Peer Detail Overlays

- **Partially implemented: support-channel status.** Live P2P health negotiation beyond recorded
  conversation evidence.
- **Future work: message privacy verification.** Add visible diagnostics and tests proving direct
  message bodies are not persisted in public Gun shared paths when direct/relay modes are active.
- **Future work: translation in direct messages.** If two users do not share a language, surface the
  language mismatch and add an opt-in translation path that does not leak private message content.
- **Future work: conversation search and history controls.** Add local search, export/delete
  controls, unread filters, and clear labels for local-only versus synced message history.

### Me Tab

- **Future work: translated-answer linking.** Allow users to explicitly link equivalent questions
  across languages when intentional reuse is desired.
- **Future work: profile/answer ownership controls.** Add per-answer delete/export/sync controls
  that clearly distinguish local-only answer memory from public profile rows.
- **Future work: Me-tab high-volume reply triage** (creator reply workbench lives on Talks today; see
  Phase D5 for 100-reply live browser proof).

### Settings Tab

- **Future work: dev reset behavior.** Dev stage reset should clear ordinary state and then reseed
  exactly one TechSupport root identity plus initial visitor-counter baselines.

## E2E Stage Pipeline: TechSupport as Stage 0 Baseline

Scope: `tests/e2e/staged/`, `tests/e2e/helpers/e2e-stage-pipeline.ts`,
`tests/e2e/helpers/bootstrap-canonical.ts`, `tests/e2e/helpers/talks-matching-flow.ts`,
`playwright.config.ts`, and the staged test documentation.

Goal: make Stage 0 the canonical TechSupport baseline for every E2E run. Stage 0 should run all
single-user verification as TechSupport, save a reusable stage snapshot where TechSupport is present
in Global, and every later test stage should load that snapshot before adding ordinary users.

- **Future work: consolidate all single-user tests into the TechSupport Stage 0 suite.** Move or
  reclassify the current `stage1-single-user` specs so they run against `TechSupport` in
  `stage0-bootstrap` or a renamed `stage0-techsupport` project. Single-user app coverage should no
  longer create throwaway users such as `Tom`, `Company`, `Survey Co`, or `EditTestUser` unless the
  test is explicitly verifying ordinary-user creation.
- **Future work: make TechSupport the only actor in single-user tests.** Update helpers and specs so
  single-user tests bootstrap with `bootstrapTechSupport()` and saved `stage0-techsupport` storage
  state, preserving the exact `TechSupport` stage name, canonical user id, Global room membership,
  SEA identity, Settings state, Talks state, Me state, and local storage.
- **Future work: remove Stage 1 as a separate single-user state if it becomes redundant.** After
  single-user coverage moves to Stage 0, either delete/rename `stage1-single-user` or make `stage1`
  a thin alias that only loads `stage0`. Update `E2eStageName`, project dependencies, snapshot
  helpers, and staged docs accordingly.
- **Partially implemented: later stages load the TechSupport baseline.** Finish broader audit coverage
  across every staged spec.
- **Partially implemented: normal tests tolerate TechSupport in Global.** Audit broadcast receiver
  counts and empty-room assertions across the full suite.
- **Future work: prevent TechSupport from polluting ordinary test logic.** Broadcast, contact,
  matching, block, reputation, and survey tests should declare whether TechSupport participates,
  is ignored, or is excluded. Support greetings/channels must not create false matches, unexpected
  unread badges, extra incoming talks, or altered survey counts.
- **Future work: update staged docs and testplan.** Document the new sequence: Stage 0 =
  TechSupport plus all single-user verification; later stages = load TechSupport baseline, add
  ordinary users, verify greeting/support channel, then run normal multi-user tests.
- **Future work: preserve parallel test behavior.** Parallel `npm run test:e2e` should either import
  the TechSupport baseline per worker before non-stage-only specs, or clearly remain isolated while
  still seeding TechSupport before ordinary users. Do not let `maybeClearGunDatabases()` produce a
  network with no TechSupport.

## Working Rule

- Move completed TODOs to [Completed Work](completed.md) instead of keeping stale checked-off work here.
- Link each future item to the technical specification or a focused roadmap doc.
- Archive old snapshots under `docs/archive/` when they stop representing the current repo.
