# IinPublic TODO

Last updated: 2026-05-21

This is the forward backlog for the current repository. Completed feature ledgers belong in
[Completed Work](completed.md), not in TODO.

Authoritative product scope lives in
[docs/specs/iinpublic-technical-specification.md](specs/iinpublic-technical-specification.md).

## Current Focus

Continue the P2P roadmap:
[P2P Node Network Roadmap](roadmap/p2p-node-network.md).

No active P2P roadmap phase remains in this TODO. Add new forward work here only after it is
scoped against the technical specification or the P2P roadmap.

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

Scope: this backlog captures feature details that are missing, placeholder-level, disconnected, or
implemented only partially across the current main tabs: Chatrooms, Contacts, Talks, Me, and
Settings. Items marked **Future work** are not complete yet and should stay in TODO until shipped and
verified.

### Cross-Tab Language and Localization

- **Future work: full UI localization after profile language selection.** When a user chooses a
  profile language other than English, the entire app menu and UI text should switch to that
  user-specific language: bottom navigation labels, headers, buttons, dialogs, validation errors,
  empty states, notification toasts, Settings labels, Talk editor text, Contact labels, and
  TechSupport welcome/support copy. Current code stores profile languages but renders the app UI in
  English.
- **Future work: separate "primary UI language" from "languages I understand."** The first controls
  menu/UI localization; the second controls incoming talk filtering. Current Settings uses "Profile
  language" and "Incoming talk language filter" close together, but the product model should make
  the difference explicit.
- **Future work: replace ambiguous native multi-select UX for incoming talk languages.** Users must
  be able to choose multiple languages they understand without needing hidden browser gestures such
  as Cmd/Ctrl-click. Use checkboxes or selected-language chips, persist multiple values, and add E2E
  coverage. Current code uses a `<select multiple>` and stores an array, but the UI can appear to
  allow only one choice.
- **Future work: localize language names by the active UI language.** For example, after choosing
  Chinese as the UI language, show language choices and explanatory text in Chinese while preserving
  stable language codes internally.
- **Future work: language-specific grammar and dirty-word filtering.** Current filters are simple
  heuristics. Add language-aware content models or dictionaries, per-language test fixtures, and
  clear behavior when a talk language is unknown.

### Chatrooms Tab

- **Future work: room visitor counter.** Each room must track the absolute number of entry events:
  how many times users have entered the room over its lifetime. This is different from the current
  active member/headcount display, which changes as users join or leave. Store a monotonic
  `visitCount` per room, display it on room rows and room detail, and make increments idempotent per
  deliberate room-enter action so refresh/reconnect does not inflate counts accidentally.
- **Future work: unique visitor count.** Alongside absolute visits, track how many distinct user or
  device identities have ever entered each room. This helps distinguish one user entering 100 times
  from 100 users entering once.
- **Future work: TechSupport global anchor.** The Chatrooms tab still has an empty-state path that
  says "No other users here yet" when the current user is alone. After the TechSupport role ships,
  global room detail should show TechSupport instead of an empty network.
- **Future work: room metadata completeness.** Custom/business rooms collect type, headline,
  description, capacity, and owner, but the room list/detail view does not yet show all of that
  metadata. Add capacity, description, business headline, owner, created date, active members,
  absolute visitor count, and unique visitors to the detail panel.
- **Future work: visit and membership audit tests.** Add unit/integration/E2E coverage proving
  active members decrement correctly, lifetime visit counters never decrement, duplicate reconnects
  do not overcount, room deletion preserves historical counters, and TechSupport is not evicted by
  FIFO/travel/return-home flows.
- **Future work: broadcast transparency.** Broadcast currently sends eligible OUT talks to active
  room members, but the UI should show who will receive the broadcast, who was skipped, which
  language/type/distance filters apply, and whether any TechSupport/support-only talks are excluded.

### Contacts Tab

- **Future work: built-in TechSupport contact.** Contacts are currently loaded from exchanged talk
  peer relationships. Once TechSupport support channels exist, show TechSupport as a pinned built-in
  support contact even before ordinary talk matches exist.
- **Future work: manual/pinned contacts.** Add a way to keep a contact without requiring a prior
  matched talk, with clear privacy boundaries and local-only storage unless explicitly synced.
- **Future work: contact language and translation affordances.** Show each contact's public
  languages in readable names, mark shared languages, and offer translation/support hints when the
  viewer and contact do not share a language.
- **Future work: relationship filtering completeness.** Relationship filters should include every
  relationship label the dialog can save, including `partner`, and custom labels should be searchable
  and sortable.
- **Future work: support-specific block behavior.** Ordinary contacts can be blocked. TechSupport
  should have a constrained mute/silence flow instead of a normal delete/block flow that could remove
  the root support channel.
- **Future work: contact detail parity.** Contact detail should show transport/channel health,
  latest support or P2P status, shared talks, shared tags, relationship notes, public credit, and
  whether delivery is blocked by either side.

### Talks Tab

- **Future work: default talk language from user settings.** Each newly created talk should have a
  default language attribute that matches the user's primary profile/UI language, with an explicit
  language dropdown in the Talk editor. Current talk creation and validation hard-code
  `language: "en"` in the UI layer.
- **Future work: display language on every talk row.** OUT and IN rows should show the talk's
  primary language as a badge, using localized language names where possible.
- **Future work: enforce incoming language filtering end to end.** Incoming talks in a language not
  included in the user's understood-languages filter should be hidden or ignored before the user is
  prompted. The shared intake filter supports this, but the UI needs clear filtered-count detail,
  tests for multiple selected languages, and tests proving talk editor language values flow through
  create, broadcast, server registration, incoming clusters, and list rendering.
- **Future work: allow editing a talk's language.** When an existing talk is edited, preserve and
  update its language rather than falling back to English.
- **Future work: language-aware chatbot memory.** Exact-answer memory should include language context
  where necessary so the chatbot does not auto-answer a translated or semantically different question
  only because the structure looks similar.
- **Future work: talk targeting preview.** Before sending or broadcasting, show expected recipients
  and the reasons others will be filtered out: language, talk type, distance, adult/age gate,
  blocked terms, block status, disabled broadcast, or expired talk.
- **Future work: creator diagnostics for filtered incoming talks.** If all incoming talks are
  filtered out, users should be able to see counts by reason, not just a single hidden total.
- **Future work: support-talk isolation.** TechSupport verification/support talks must not pollute
  ordinary user answer memory or broadcast to unrelated users unless intentionally delivered and
  answered.

### Conversation and Peer Detail Overlays

- **Future work: support-channel status.** Peer detail and conversation overlays should show whether
  a conversation is star-gun, encrypted relay, or direct P2P, plus fallback reason and last healthy
  contact time.
- **Future work: message privacy verification.** Add visible diagnostics and tests proving direct
  message bodies are not persisted in public Gun shared paths when direct/relay modes are active.
- **Future work: translation in direct messages.** If two users do not share a language, surface the
  language mismatch and add an opt-in translation path that does not leak private message content.
- **Future work: TechSupport mute flow.** Replace ordinary "Block User" behavior for TechSupport
  with local mute/notification controls while keeping the support channel recoverable.
- **Future work: conversation search and history controls.** Add local search, export/delete
  controls, unread filters, and clear labels for local-only versus synced message history.

### Me Tab

- **Future work: complete answer-memory mode UI.** The Me tab filter shows All, Auto, Manual, and
  Conditional. Preferences still presents a simpler Auto/Manual toggle; add first-class Temporary,
  Permanent, and Suppressed controls that match the exact-chatbot-memory model.
- **Future work: language-aware answer history.** Show the language of each answered talk/question
  and prevent answer reuse across languages unless the user explicitly links translated equivalents.
- **Future work: clearer conditional-answer explanations.** Conditional answers should explain the
  route/context path in human-readable form, not only ids or hashes.
- **Future work: support-message exclusion.** TechSupport welcome and support messages should not
  appear as answered-talk history unless they were delivered as talks and the user intentionally
  answered them.
- **Future work: profile/answer ownership controls.** Add per-answer delete/export/sync controls
  that clearly distinguish local-only answer memory from public profile rows.

### Settings Tab

- **Future work: full localization settings.** Choosing a non-English profile/UI language should
  immediately re-render Settings and all other tabs in that language, and persist across reloads.
- **Future work: clearer multi-language incoming filter control.** Replace the native multi-select
  with checkboxes/chips so users can plainly choose multiple understood languages, and show how many
  are active.
- **Future work: default talk language setting.** Add a visible default-language setting for new
  talks. It should default to the primary UI/profile language but allow override.
- **Future work: reserved root names.** Ordinary users must not be able to rename themselves to
  `TechSupport` or reserved variants such as `admin`, `system`, or `root`.
- **Future work: filter validation and preview.** Settings should preview how many current incoming
  talks would be hidden by language, type, distance, grammar, dirty words, custom blocked terms, and
  age/credit rules before the user leaves the tab.
- **Future work: storage inspector completeness.** Include TechSupport root identity state,
  support-channel state, room visit counters, language-filter state, default talk language, transport
  diagnostics, SEA custody status, relay leak scan, localStorage keys, and IndexedDB names.
- **Future work: profile editor consistency.** The edit-profile dialog still accepts comma-separated
  language codes, while Settings uses selectable language options. Unify these controls and validate
  against the same supported-language list.
- **Future work: dev reset behavior.** Dev stage reset should clear ordinary state and then reseed
  exactly one TechSupport root identity plus initial visitor-counter baselines.

### Disconnected or Hidden Surfaces

- **Future work: expose the statistics dashboard intentionally.** `UIManager` contains a statistics
  dashboard renderer, but the current bottom navigation exposes only Chatrooms, Contacts, Talks, Me,
  and Settings. Decide whether Statistics is a real tab, an admin/debug surface, or archived code;
  then add navigation, permissions, and verification or remove it from active scope.
- **Future work: document all feature flags in Settings.** P2P node, direct chat, star persistence,
  transport fallback, and support bootstrap should be visible as user/developer diagnostics with
  exact runtime values.

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
- **Future work: run a dedicated TechSupport Stage 0 script.** Add or update the stage-0 script so it
  clears the graph, creates/logs in TechSupport, traverses all single-user tabs and basic controls,
  verifies Global headcount/presence, verifies no ordinary user exists yet, then saves
  `stage0.json` plus `stage0-techsupport.storage.json`.
- **Future work: save Stage 0 after TechSupport verification, not before it.** The saved baseline
  should represent a verified TechSupport network root, not merely a login. It should include any
  expected support bootstrap data, default talk/filter settings, storage inspector state, and Global
  room membership needed by later stages.
- **Future work: remove Stage 1 as a separate single-user state if it becomes redundant.** After
  single-user coverage moves to Stage 0, either delete/rename `stage1-single-user` or make `stage1`
  a thin alias that only loads `stage0`. Update `E2eStageName`, project dependencies, snapshot
  helpers, and staged docs accordingly.
- **Future work: make every later stage load the TechSupport baseline directly.** Stage 2 and beyond
  should import `stage0.json` or a derived snapshot that still contains TechSupport in Global before
  adding Adam/Tom/Jerry/Bob/etc. Tests should not start from an empty graph unless they are the Stage
  0 bootstrap test.
- **Future work: ordinary-user bootstrap should verify TechSupport greeting.** Update
  `bootstrapUser()` or a stage-specific wrapper so every new ordinary user entering Global verifies
  TechSupport is visible in the room, receives the TechSupport welcome message exactly once, and has
  a support channel record before the normal test scenario continues.
- **Future work: normal tests must tolerate TechSupport in Global.** Update headcount assertions,
  member-list expectations, broadcast receiver counts, contact lists, and "empty room" assertions so
  TechSupport is always counted or explicitly excluded as the built-in support/root actor.
- **Future work: prevent TechSupport from polluting ordinary test logic.** Broadcast, contact,
  matching, block, reputation, and survey tests should declare whether TechSupport participates,
  is ignored, or is excluded. Support greetings/channels must not create false matches, unexpected
  unread badges, extra incoming talks, or altered survey counts.
- **Future work: add stage snapshot integrity checks.** After saving and loading each stage, assert
  there is exactly one TechSupport root identity, TechSupport is active in Global, ordinary users are
  present only when that stage expects them, and no duplicate support greetings/channels exist.
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
