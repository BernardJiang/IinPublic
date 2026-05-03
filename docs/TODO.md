# IinPublic TODO

Last updated: 2026-05-03

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
- Seeded dev entry points exist: `dev:stage-empty`, `dev:stage-user1`, `dev:stage-user2-match`, `dev:stage-user3-network`
- Age-gating UI implemented: `isAdult` talk flag, age-verify vouch button, Credit badge

The backlog below focuses on the biggest remaining gaps between the current implementation
and `docs/specs/iinpublic-technical-specification.md`.

## Priority Backlog

### P0 — Close the largest product/spec gaps

- [ ] Complete the user identity/profile surface:
  add editable headshot selection, editable understood languages, and profile question/answer attributes on the Me tab,
  then show the appropriate public subset in peer/contact detail views
  (Spec: FR-UM-3, FR-UM-4, FR-BF-2)
- [ ] Move intake and moderation rules from mostly client-side preference/UI logic into enforced server-side delivery rules:
  language, grammar, dirty-words, distance/time, and age-gated talk filtering should be applied when incoming talks are registered/delivered,
  not only when the receiver opens the web UI
  (Spec: FR-BF-3..6, FR-SP-3, FR-SP-7, FR-SP-8)
- [ ] Add a real blocking system with persistence, endpoints, and UI actions:
  block/unblock a user, prevent blocked users from sending talks or viewing profile/detail surfaces, and feed block counts back into reputation/send capacity
  (Spec: FR-SP-4..6)
- [ ] Add E2E test for age-verification and adult-content gating:
  Tom creates an adult talk, Jerry is age-verified (3 vouch calls), Bob is not; verify Bob does not receive it, Jerry does
  (Spec: FR-SP-7, FR-SP-8 — UI implemented in 48186cc, e2e test pending)
- [ ] Add E2E test for unblocking a user:
  extend test 15 to verify unblock + confirmation that talk delivery resumes
  (e2e-test-coverage.md: Critical Gap #1)

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
- [ ] Build a survey analytics/results surface instead of only storing counters on answers:
  per-question distributions, percentages, anonymity defaults, and follow-up handling for "Let's talk in person" survey endings
  (Spec: FR-SV-2..5, UI §13.5)
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

1. **Fix clearGunDatabases disk race** (P1 — unblocks reliable multi-worker CI)
2. **Age-gating E2E test** (P0 — feature is live, test coverage is missing)
3. **Unblocking E2E test** (P0 — extend test 15)
4. **Profile foundation**
   - Add shared/server/web support for editable `headshot`, `languages`, and profile Q/A writes
   - Expose those controls in Me and read paths in peer/contact detail views
   - Cover with unit + one focused E2E profile flow
5. **Server-enforced moderation**
   - Define one delivery-time filter pipeline on the server
   - Reuse existing intake-filter data where possible, but make server results authoritative
   - Add integration tests around `/received` / incoming-talk registration
6. **Blocking system completion**
   - Persistence + routes are in place; add unblock UI and E2E coverage
7. **Chatroom model expansion**
   - Introduce custom/business room schemas and CRUD
   - Then add single-room travel semantics
   - Only after that expand bulk-send targeting beyond the current room action
   - Add multi-chatroom and hierarchy E2E tests alongside
8. **Survey dashboard + rate limits + reputation + docs cleanup**
   - Finish the remaining analytics/admin surfaces
   - Add cooldown enforcement tests
   - Add reputation system E2E tests
   - Update status docs once the new server rules land

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
- Seeded dev-stage commands for local feature work

## Working Rule

When updating this file:

- Prefer spec gaps and execution priority over implementation detail
- Remove completed items instead of keeping stale "missing" work around
- If a task needs a deeper implementation plan, create a focused doc in `docs/roadmap/`
