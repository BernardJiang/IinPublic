# IinPublic Completed Work

Last updated: 2026-05-26

This is the durable ledger for shipped feature work. Keep `TODO.md` focused on forward work:
when an item is finished, move it here with a short description and concrete evidence.

## Maintenance Rule

- Move completed TODO items from `docs/TODO.md` into this file.
- Include the date, feature/phase name, user-visible result, and verification evidence.
- Keep detailed design and future work in the relevant spec or roadmap doc.
- If a completed item later needs more work, add a new TODO entry instead of editing history.

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

Source roadmap: [P2P Node Network Roadmap](roadmap/p2p-node-network.md)

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
