# IinPublic Completed Work

Last updated: 2026-05-25

This is the durable ledger for shipped feature work. Keep `TODO.md` focused on forward work:
when an item is finished, move it here with a short description and concrete evidence.

## Maintenance Rule

- Move completed TODO items from `docs/TODO.md` into this file.
- Include the date, feature/phase name, user-visible result, and verification evidence.
- Keep detailed design and future work in the relevant spec or roadmap doc.
- If a completed item later needs more work, add a new TODO entry instead of editing history.

## 2026-05-25 - D2 Independent App Language And Talk Default

Added an explicit persisted App language selector for completed English and Chinese catalogs,
separate from profile language and incoming-talk intake languages. Switching App language now
re-renders translated navigation and Settings without changing profile metadata, survives reload,
and supplies the default language of a newly created talk while retaining its per-talk selector.

Evidence:

- UI preference and renderer: `src/web/ui/ui-settings-storage.ts`, `src/web/ui/ui-manager.ts`,
  `src/web/ui/ui-translations.ts`
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
