# IinPublic TODO

Last updated: 2026-05-06

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
- Me-tab profile editor (headshot, languages, interests, public Q&A) and public profile (incl. interests) on peer/contact views are live
- Survey talks: **Results** on each OUT row opens aggregated stats (`GET /api/stats/talks/:id/summary`)
- Seeded dev entry points exist: `dev:stage-empty`, `dev:stage-user1`, `dev:stage-user2-match`, `dev:stage-user3-network`
- Age-gating UI implemented: `isAdult` talk flag, age-verify vouch button, Credit badge; E2E in `tests/e2e/16-age-gating.spec.ts`
- Blocking + unblock flows and E2E in `tests/e2e/15-blocking-system.spec.ts`

The backlog below focuses on the biggest remaining gaps between the current implementation
and `docs/specs/iinpublic-technical-specification.md`.

## Priority Backlog

### P0 — Close the largest product/spec gaps

- [ ] Profile polish vs spec: field-level privacy (hide specific Q&A from certain viewers), tag catalog / category beyond `other` for interests, and any remaining FR-UM deltas
  (Spec: FR-UM-3..8, FR-BF-2 — Me editor + languages + interests + Q&A + public subset on peer/contact are live)
- [ ] Move intake and moderation rules from mostly client-side preference/UI logic into enforced server-side delivery rules:
  language, grammar, dirty-words, distance/time, and age-gated talk filtering should be applied when incoming talks are registered/delivered,
  not only when the receiver opens the web UI
  (Spec: FR-BF-3..6, FR-SP-3, FR-SP-7, FR-SP-8)
- [ ] Blocking + reputation integration: feed block counts (and related limits) into reputation/send capacity where the spec calls for it
  (Spec: FR-SP-4..6 — block/unblock, routes, UI, and delivery gating are in place)

### P1 — Add the missing room and targeting model

- [ ] Fix shared disk race in `clearGunDatabases()`:
  remove the `radata/`, `data1.json`, `data.json` deletes (servers run with `E2E_GUN_MEMORY_ONLY=1` so disk persistence is unused);
  if disk persistence is ever needed, switch to per-worker paths (`radata_w{N}/`, `data1_w{N}.json`)
  (testing-benchmarks.md — cross-worker disk race causes ~12.5% suite failure at W4)
- [ ] Implement user-defined and business chatrooms with create/rename/delete flows, metadata storage, and membership management
  (Spec: FR-CR-5, FR-CR-6)
- [ ] Support explicit travel mode with single-room presence only:
  a user may switch to one remote room at a time, and when travelling they should no longer appear in any home-region room until they return
  (Spec intent override for FR-CR-9, FR-CR-10)
- [ ] Add tag catalogs/popularity plus the mandatory tag/location preamble for every talk before bulk sending,
  and use those tags as actual targeting criteria during broadcast
  (Spec: FR-TG-2, FR-TG-4..6, FR-BM-5, FR-BM-6)
- [ ] Expand bulk-send targeting beyond "current room broadcast" with selectable audience scope, distance radius, tag filters, and user-count preview
  (Spec: FR-BM-1..5, UI §13.4)
- [ ] Add E2E tests for multi-chatroom broadcasts and chatroom hierarchy navigation:
  broadcast to region-specific rooms (e.g., "North America"), navigate Global → Region → City hierarchy
  (e2e-test-coverage.md: Critical Gaps #2, #3)

### P2 — Complete analytics, guardrails, and docs

- [ ] Add retry or explicit synchronization guard in tests that depend on Gun graph stability after `clearGunDatabases()`:
  prevents timeout failures when Gun sync tears down mid-write during parallel runs
  (testing-benchmarks.md — W1/W2 remain recommended for CI until disk race is fixed)
- [ ] Extend survey analytics beyond the Talks-tab **Results** modal (STAT-01 summary): dedicated dashboard, anonymity defaults, exports, and follow-up handling for survey endings
  (Spec: FR-SV-2..5, UI §13.5 — per-question counts/% now visible for survey OUT rows)
- [ ] Add actual send/receive rate-limit enforcement and tests for cooldown behaviour
  (Spec: FR-SP-1, FR-SP-2)
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
   - Introduce custom/business room schemas and CRUD
   - Then add single-room travel semantics
   - Only after that expand bulk-send targeting beyond the current room action
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
