# IinPublic TODO

Last updated: 2026-05-07

This file is the prioritized backlog for the current repository. It should track the
highest-value spec gaps that still exist in the working codebase, not features that are
already present behind tests.

Detailed evidence for these gaps lives in `docs/roadmap/spec-gap-matrix.md`.

## Current Snapshot

Implemented and covered now:

- Core web/server/shared talk loop is stable and tested end-to-end
- Chatroom member list scroll + single status-bar broadcast action are live
- Contacts list, shared peer/detail view, Talks `IN` / `OUT` navigation, and richer Answers cards are live
- Me-tab intake filters + credit visibility and Contacts relationship editing are live
- Me-tab profile editor (headshot, languages, interests, public Q&A, per-row visibility) and public profile on peer/contact views are live; server filters Q&A on `GET /api/users/:id`
- Survey talks: **Results** on each OUT row opens aggregated stats (`GET /api/stats/talks/:id/summary`)
- Seeded dev entry points exist: `dev:stage-empty`, `dev:stage-user1`, `dev:stage-user2-match`, `dev:stage-user3-network`
- Age-gating UI implemented: `isAdult` talk flag, age-verify vouch button, Credit badge; E2E in `tests/e2e/16-age-gating.spec.ts`
- Blocking + unblock flows and E2E in `tests/e2e/15-blocking-system.spec.ts`
- Custom/business chatrooms: REST + Gun metadata, E2E API spec `tests/e2e/17-chatroom-custom-business-api.spec.ts`, and web **Chatrooms** tab (`➕ New room`, owner rename/delete on room detail)

The backlog below focuses on the biggest remaining gaps between the current implementation
and `docs/specs/iinpublic-technical-specification.md`.

## Priority Backlog

### P0 — Close the largest product/spec gaps

- [x] Profile polish (shipped 2026-05-06): Q&A visibility (public / contacts-only / private), server-side filtering on user fetch, interest `TagCategory` catalog + defaults. **Remaining:** per-viewer allowlists, reputation-section visibility (FR-UM-7), deeper FR-UM audit.
- [x] Intake & moderation — **extended (2026-05-07):** custom blocked phrases on `TalkIntakeFilters` (Me → Talk Filters), server list via `IINPUBLIC_SERVER_BLOCKED_TERMS`, symmetric send/receive cooldown via `IINPUBLIC_SYMMETRIC_TALK_EDGE_COOLDOWN_MS` on `/received`, bulk register (and preview eligibility). Reject codes include `intake_custom_blocked_terms`, `moderation_server_terms`, `symmetric_rate_limit`. Daily/weekly numeric caps from CONFIG remain a further step (see P2).
  (2026-05-07: receiver GPS for distance rules is also read from `users/:id/location` where the web client writes blurred location.)
  (Spec: FR-BF-3..6, FR-SP-3, FR-SP-7, FR-SP-8)
- [x] Blocking + reputation integration (shipped 2026-05-06): `register-receivers-for-broadcast` now enforces sender bulk capacity derived from reputation (including block-count penalties), with integration coverage for capped and zero-capacity senders.
  **Remaining:** full rate-limit/cooldown enforcement stays tracked under FR-SP-1/2.
  (Spec: FR-SP-4..6)

### P1 — Add the missing room and targeting model

- [x] Fix shared disk race in `clearGunDatabases()` (shipped 2026-05-07):
  `tests/e2e/helpers/clear-database.ts` now clears only `POST /api/test/clear-database` + browser IndexedDB.
  No disk deletes remain in the E2E cleanup path because Playwright servers run with `E2E_GUN_MEMORY_ONLY=1`.
  If disk persistence is reintroduced, use per-worker paths (`radata_w{N}/`, `data1_w{N}.json`) instead of shared files.
  (testing-benchmarks.md — cross-worker disk race was ~12.5% suite failure at W4)
- [x] User-defined and business chatrooms (shipped 2026-05-06): REST + Gun metadata (`chatroom-manager` / `chatroom-routes`), membership APIs, and **web** create / rename / delete (`➕ New room`, owner actions on room detail). **Remaining:** richer business profile UX, FIFO vs per-room capacity alignment on the client.
  (Spec: FR-CR-5, FR-CR-6)
- [x] Support explicit travel mode with single-room presence only:
  a user may switch to one remote room at a time, and when travelling they should no longer appear in any home-region room until they return
  (Spec intent override for FR-CR-9, FR-CR-10)
- [x] Tag catalog + bulk broadcast preamble + interest targeting (**shipped** 2026-05-07): curated catalog, mandatory preamble modal, server `broadcastTargetTags` ∩ profile interests (`tag_targeting`).
- [x] Tag / interest **analytics depth** — rolling **UTC day** windows in `BroadcastTagPopularityStore`, `GET /api/stats/broadcast-tags/trends?days=N`, **Me** tab “Broadcast tag trends” table; cumulative `GET /api/stats/broadcast-tags` unchanged for preamble chip sorting.
  (**Earlier 2026-05-07:** in-memory cumulative counts per slug on `POST .../register-receivers-for-broadcast`.)
- [x] Bulk-send from chatrooms: **same chatroom id only** (FR-BM-7) — no implicit delivery to descendant hierarchy rooms; optional **distance cap** (`broadcast_max_distance`); **`POST /api/talks/broadcast-receiver-preview`** for eligible-count preview; wired client + single-room Gun announce + integration coverage.
  (FR-BM-1..5, FR-BM-7 / UI §13.4 surface area; richer **analytics** still open above.)
- [x] Add E2E tests for multi-chatroom broadcasts and chatroom hierarchy navigation:
  `tests/e2e/19-chatroom-hierarchy-broadcast.spec.ts` — hierarchy expand, **USA** + **Germany** paths, regional broadcast **in the same leaf room**, and **regression**: parent (**North America**) broadcast does **not** register inbox for a peer joined only under **USA**.
  (e2e-test-coverage.md: Critical Gaps #2, #3)

### P2 — Complete analytics, guardrails, and docs

- [x] Add retry or explicit synchronization guard after `clearGunDatabases()` (**shipped** 2026-05-09):
  `tests/e2e/helpers/clear-database.ts` polls `GET /health` until the worker Gun server is up, retries
  `POST /api/test/clear-database` with exponential backoff on failure, then **250ms settle** after a
  successful clear. Throws if the graph cannot be cleared (fail-fast vs. continuing on a dirty graph).
  (testing-benchmarks.md — W1/W2 still valid if radisk/disk persistence returns)
- [ ] Extend survey analytics beyond the Talks-tab **Results** modal (STAT-01 summary): dedicated dashboard, anonymity defaults, exports, and follow-up handling for survey endings
  (Spec: FR-SV-2..5, UI §13.5 — per-question counts/% now visible for survey OUT rows)
- [ ] Add **daily/weekly numeric quotas** (distinct from symmetric cooldown) and tests if product requires hard caps per CONFIG.RATE_LIMITS
  (Spec: FR-SP-1, FR-SP-2 — symmetric cooldown + tests shipped via `IINPUBLIC_SYMMETRIC_TALK_EDGE_COOLDOWN_MS`)
- [ ] Add E2E tests for reputation system flows:
  vouch age-verify votes accumulating to threshold, star rating impact, block count propagation
  (e2e-test-coverage.md: Medium Gap #10)
- [ ] Add E2E tests for messaging edge cases:
  message read receipts, messaging history persistence across re-login, messaging after unblock
  (e2e-test-coverage.md: Medium Gap #5)
- [ ] Add E2E tests for talk deletion by creator mid-broadcast, broadcast cancellation/abortion,
  and talk matching across chatroom boundaries
  (e2e-test-coverage.md: Medium Gaps #6, #8, #9)
- [ ] Add E2E test for profile privacy settings:
  hiding specific profile fields from certain users
  (e2e-test-coverage.md: Medium Gap #7)
- [ ] Refresh current docs so they match the post-May-03 implementation:
  `README.md`, `docs/reports/PROJECT_STATUS.md`, and any spec-delta notes should stop listing recently completed UX work as missing
- [ ] Extend automated coverage around the missing server-enforced moderation, custom-chatroom, and targeting flows so the next feature pass is protected
  (Spec: FR-BTD-4, §15)

### P3 — Nice-to-have coverage

- [ ] Mobile viewport E2E tests: all current tests use desktop/compact viewports
  (e2e-test-coverage.md: Nice-to-Have #11)
- [ ] WebSocket disconnection recovery test: verify Gun sync drop + reconnect handling
  (e2e-test-coverage.md: Nice-to-Have #12)
- [ ] Search/filter within Answers tab test: verify filtering works with 20+ answered talks
  (e2e-test-coverage.md: Nice-to-Have #13)
- [ ] Timezone boundary test for by-day stats API
  (e2e-test-coverage.md: Nice-to-Have #14)
- [ ] Location-based chatroom auto-assignment E2E test
  (e2e-test-coverage.md: Critical Gap #4 — requires GPS mock support)

## Suggested Execution Order

1. **Fix clearGunDatabases disk race** (P1 — done for memory-only E2E; revisit if radisk returns)
2. ~~Age-gating E2E~~ / ~~Unblocking E2E~~ — covered by `16-age-gating.spec.ts` and `15-blocking-system.spec.ts`
3. **Profile spec deltas** — per-viewer privacy, interest catalog/categories, doc/test alignment (`04-profile-edit-stage-name.spec.ts` + editor exist)
4. **Server-enforced moderation**
   - Define one delivery-time filter pipeline on the server
   - Reuse existing intake-filter data where possible, but make server results authoritative
   - Add integration tests around `/received` / incoming-talk registration
5. **Blocking ↔ reputation** — wire block metrics into capacity/score where required
6. **Chatroom model expansion**
   - Custom/business room schemas, CRUD API, web create/rename/delete, travel single-room semantics, broadcast tag preamble/targeting chunk are live (see backlog for popularity + wider audience-scope gaps)
   - Expand bulk-send targeting beyond the current room action
   - Add multi-chatroom and hierarchy E2E tests alongside
7. **Survey dashboard depth + rate limits + reputation + docs cleanup**
   - Build on Talks **Results**; add cooldown enforcement tests, reputation E2E, status doc refresh after server rules land

## Done Recently — do not re-add as greenfield work

- Age-gating UI: `isAdult` talk flag in editor, age-verify vouch button in contacts dialog, "Age verified" Credit badge
- Chatroom member-list scrolling
- Unified broadcast action in the status/chatroom surface
- Contacts list with exchanged-talk stats
- Shared peer detail between chatroom members and contacts
- Talks tab `IN` / `OUT` / back navigation
- Expanded Answers rendering with question/answer metadata
- Me-tab intake filters and credit visibility
- Contacts relationship dialog and peer credit summary
- Survey OUT-row results modal (STAT-01 summary API)
- Seeded dev-stage commands for local feature work

## Working Rule

When updating this file:

- Prefer spec gaps and execution priority over implementation detail
- Remove completed items instead of keeping stale "missing" work around
- If a task needs a deeper implementation plan, create a focused doc in `docs/roadmap/`
