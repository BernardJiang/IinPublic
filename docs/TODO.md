# IinPublic TODO

Last updated: 2026-04-29

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
- [ ] Add age-verification and adult-content gating end to end:
  capture verification state, require age-gate-first flows for adult talks, and hide adult talks from unverified/underage users
  (Spec: FR-SP-7, FR-SP-8)

### P1 — Add the missing room and targeting model

- [ ] Implement user-defined and business chatrooms with create/rename/delete flows, metadata storage, and membership management
  (Spec: FR-CR-5, FR-CR-6)
- [ ] Support explicit travel mode with single-room presence only:
  a user may switch to one remote room at a time, and when travelling they should no longer appear in any home-region room until they return
  (Spec intent override for FR-CR-9, FR-CR-10)
- [ ] Add tag catalogs/popularity plus the mandatory tag/location preamble for every talk before bulk sending,
  and use those tags as actual targeting criteria during broadcast
  (Spec: FR-TG-2, FR-TG-4..6, FR-BM-5, FR-BM-6)
- [ ] Expand bulk-send targeting beyond “current room broadcast” with selectable audience scope, distance radius, tag filters, and user-count preview
  (Spec: FR-BM-1..5, UI §13.4)

### P2 — Complete analytics, guardrails, and docs

- [ ] Build a survey analytics/results surface instead of only storing counters on answers:
  per-question distributions, percentages, anonymity defaults, and follow-up handling for “Let’s talk in person” survey endings
  (Spec: FR-SV-2..5, UI §13.5)
- [ ] Add actual send/receive rate-limit enforcement and tests for cooldown behaviour
  (Spec: FR-SP-1, FR-SP-2)
- [ ] Refresh current docs so they match the post-Apr-29 implementation:
  `README.md`, `docs/reports/PROJECT_STATUS.md`, and any spec-delta notes should stop listing recently completed UX work as missing
- [ ] Extend automated coverage around the missing server-enforced moderation, block, age-gate, custom-chatroom, and targeting flows so the next feature pass is protected
  (Spec: FR-BTD-4, §15)

## Suggested Execution Order

1. **Profile foundation**
   - Add shared/server/web support for editable `headshot`, `languages`, and profile Q/A writes
   - Expose those controls in Me and read paths in peer/contact detail views
   - Cover with unit + one focused E2E profile flow
2. **Server-enforced moderation**
   - Define one delivery-time filter pipeline on the server
   - Reuse existing intake-filter data where possible, but make server results authoritative
   - Add integration tests around `/received` / incoming-talk registration
3. **Blocking + age gating**
   - Add persistence + routes first
   - Wire talk delivery/profile visibility checks
   - Add UI affordances after the permissions layer exists
4. **Chatroom model expansion**
  - Introduce custom/business room schemas and CRUD
  - Then add single-room travel semantics
  - Only after that expand bulk-send targeting beyond the current room action
5. **Survey dashboard + rate limits + docs cleanup**
   - Finish the remaining analytics/admin surfaces
   - Add cooldown enforcement tests
   - Update status docs once the new server rules land

## Done Recently — do not re-add as greenfield work

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
- Remove completed items instead of keeping stale “missing” work around
- If a task needs a deeper implementation plan, create a focused doc in `docs/roadmap/`
