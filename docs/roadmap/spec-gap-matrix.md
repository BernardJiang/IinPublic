# IinPublic Spec-Gap Matrix

Last updated: 2026-04-29

Purpose: map the biggest remaining requirements in
`docs/specs/iinpublic-technical-specification.md` to the current codebase, with
file-level evidence for what already exists and what is still missing.

This is not a replacement for `docs/TODO.md`. The TODO is the execution queue.
This file is the evidence map behind that queue.

## Reading Guide

- `Implemented`: code exists and appears to satisfy the requirement at a meaningful level.
- `Partial`: schema/UI/test hooks exist, but the requirement is not enforced end to end.
- `Missing`: no meaningful production implementation was found in the main `src/` app/server paths.

## Matrix

| Area | Spec refs | Status | Current evidence | Main gaps |
|---|---|---|---|---|
| Profile foundation | FR-UM-2..8, FR-BF-2, UI-1 | Partial | `src/shared/types.ts:23-40` defines `headshot`, `profile`, `languages`, `interests`, `reputation`; `src/server/services/user-service.ts:8-42` persists those fields on create; `src/web/ui/ui-manager.ts:629-718` renders Me profile, filters, and credit; `tests/e2e/04-profile-edit-stage-name.spec.ts:1-120` covers stage-name editing | Me UI still only edits stage name, filters, and credit visibility. No headshot picker, no editable languages UI, no editable profile Q/A attribute surface, and no public profile subset rendered in peer/contact detail views. |
| Intake filters and moderation | FR-BF-1..6, FR-SP-7..8 | Partial | `src/shared/types.ts:3-11` defines `TalkIntakeFilters`; `src/web/ui/talk-intake-filters.ts:15-168` applies distance/time/language/grammar/dirty-word/type filters; `src/web/ui/ui-manager.ts:650-796` exposes filter controls on Me; `src/web/app/app.ts:1239-1255` persists filter and credit-visibility changes; `tests/e2e/13-me-filters-credit.spec.ts:87-139` covers UI behavior | Filtering remains client-side presentation logic for incoming talks. `src/server/routes/talk-delivery-routes.ts:82-220` registers and fans out talks with no authoritative moderation pipeline. No age-gate-first enforcement on delivery, and no adult-content suppression for underage users. |
| Reputation and abuse prevention | FR-UM-6..7, FR-BM-3, FR-SP-4..6 | Partial | `src/shared/reputation.ts:4-108` calculates reputation score, bulk-send capacity, and updates block/like/dislike metrics; `src/shared/types.ts:50-64` models reputation fields; `src/web/ui/ui-manager.ts:699-717` renders read-only credit metrics and visibility toggle; `src/web/ui/contacts-view.ts:46-145` supports peer rating plus relationship notes; `src/test/unit/reputation.test.ts:42-149` covers score/capacity math | There is no real blocking system in the main app/server paths: no block/unblock endpoints, no block list UI, no enforcement in talk delivery, profile visibility, or conversations. Reputation math exists, but the abuse-prevention path is not connected to runtime permissions. |
| Chatroom model expansion | FR-CR-1..10, UI-7 | Partial | `src/shared/types.ts:79-99` already models `global`, `location`, `business`, and `custom` chatroom types; `src/server/routes/chatroom-routes.ts:12-24` supports listing and joining; `src/server/services/chatroom-manager.ts:13-39` supports join/leave/move with a stub `findOptimalChatroom`; `tests/e2e/03-capacity-eviction.spec.ts:10-192` covers capacity/FIFO behavior | No CRUD routes or UI for custom/business chatrooms. No brand/address owner flows. Travel-mode semantics, traveller badges, and remote-room selection flow are still missing. Product direction is now single active room only, so any future travel implementation should remove the user from their home-region room while travelling instead of keeping multi-room presence. Server chatroom selection logic is still effectively stubbed to `global`. |
| Tags and bulk-targeting | FR-TG-1..6, FR-BM-1..6, UI §13.4 | Partial | `src/shared/types.ts:227-245` models tags and categories; tag talks are supported in the talk model and response UI (`src/shared/types.ts:141-174`, `src/web/ui/talk-response-dialog.ts:48-85`); current-room broadcast exists through the status-bar action and server receiver registration (`src/web/ui/ui-manager.ts:335-432`, `src/server/routes/talk-delivery-routes.ts:163-220`); `tests/e2e/07-tags-checkbox.spec.ts:1-140` and `tests/e2e/13-chatroom-scroll-and-broadcast-bar.spec.ts:1-160` cover current behavior | No tag catalog/popularity service. No mandatory talk preamble that forces tag/location targeting before send. No audience picker for business rooms, custom rooms, distance radius, or tag subsets. Bulk sending is still centered on “everyone in the current room”. |
| Survey analytics | FR-SV-1..6, UI-4 | Partial | Survey talks and counters exist in the shared model (`src/shared/types.ts:141-220`); server stats endpoints exist in `src/server/routes/stats-routes.ts:71-112`; answers/stats logic is covered by `tests/e2e/talks-matching/06-survey-customer-satisfaction.spec.ts:1-220`, `tests/e2e/talks-matching/07-survey-restaurants.spec.ts:1-220`, and `tests/e2e/talks-matching/10-stats-four-types.spec.ts:1-220` | There is no dedicated survey analytics UI/dashboard in the main web app. Anonymous/default aggregated results are only available through endpoints/tests, not through a user-facing results surface. |
| Rate limiting and cooldowns | FR-SP-1..3 | Partial | Reputation-based bulk capacity exists in `src/shared/reputation.ts:30-46`; config and tests exercise capacity math rather than real throttling | No server-enforced send/receive cooldown layer was found in the main request paths. No persistent per-user rate-limit state, no rejection path in delivery routes, and no E2E/integration tests for cooldown behavior. |
| Coverage and doc alignment | FR-BTD-4, §15 | Partial | E2E coverage exists for stage name, tags, capacity eviction, contacts, messaging, answer cards, filters, and relationship/credit flows under `tests/e2e/`; unit coverage exists for reputation, answers view, intake filters, and user service under `src/test/unit/` | The new implementation is ahead of the docs in some places and behind the spec in others. Missing automated coverage remains for server-enforced moderation, blocking, age gating, custom/business chatrooms, richer bulk targeting, and true rate limiting. |

## Gap Notes By Area

### 1. Profile Foundation

What exists:

- The data model already anticipates a richer profile:
  `src/shared/types.ts:23-40`
- Server user creation preserves `headshot`, `profile`, `languages`, and `interests`:
  `src/server/services/user-service.ts:8-42`
- The Me tab currently renders only stage name, toggles, filters, and credit:
  `src/web/ui/ui-manager.ts:629-718`

What is missing:

- No editor for `headshot`.
- No editor for `languages`.
- No profile Q/A editor for `profile`.
- No peer/contact rendering of the public profile subset.

Best implementation starting points:

- Shared types already exist in `src/shared/types.ts`.
- User write paths belong in `src/server/routes/user-routes.ts` and `src/server/services/user-service.ts`.
- The current Me tab surface should be extended in `src/web/ui/ui-manager.ts`.

### 2. Server-Enforced Moderation

What exists:

- Receiver-side intake filtering logic lives in:
  `src/web/ui/talk-intake-filters.ts:15-168`
- The web app persists those preferences through:
  `src/web/app/app.ts:1239-1255`

Why this is still a gap:

- Registration and fanout routes in
  `src/server/routes/talk-delivery-routes.ts:82-220`
  do not consult user language lists, grammar filters, dirty-word filters,
  distance/time limits, or age state before delivering/registering incoming talks.

Likely implementation seam:

- Add one authoritative server-side eligibility pipeline inside talk registration
  and/or receiver registration flow, then expose filtered reasons to the UI.

### 3. Blocking and Age Gating

What exists:

- Reputation math already includes `blockCount` and `ageVerified`:
  `src/shared/types.ts:50-64`
  and `src/shared/reputation.ts:20-27`, `84-92`

What is missing:

- No production block list management endpoints in `src/server/routes/`.
- No user-facing block/unblock action in `src/web/ui/`.
- No delivery-time checks that reject blocked senders.
- No age-verification UI/workflow in the main app.
- No “adult talk first-question must be age verification” enforcement.

### 4. Chatroom Expansion

What exists:

- The schema is ahead of the implementation:
  `src/shared/types.ts:79-99`
- Chatroom joining/listing is minimal:
  `src/server/routes/chatroom-routes.ts:12-24`
- Server-side optimal placement is not implemented:
  `src/server/services/chatroom-manager.ts:36-39`

What is missing:

- Create/rename/delete custom or business rooms.
- Business metadata management.
- Explicit single-room travel mode and traveller markers.

### 5. Survey Dashboard

What exists:

- Statistics endpoints:
  `src/server/routes/stats-routes.ts:71-112`
- Counter fields on survey answers:
  `src/shared/types.ts:214-219`

What is missing:

- A dedicated survey results screen in the main UI.
- User-facing charts/distributions/percentages.
- An explicit anonymous-by-default presentation model in the web app.

### 6. Rate Limits

What exists:

- Reputation-based bulk capacity:
  `src/shared/reputation.ts:30-46`

What is missing:

- Time-based cooldown enforcement in the server routes.
- Stored send/receive timestamps used as policy.
- Automated tests that prove rejection and recovery after cooldown windows.

## Recommended Next Docs Passes

1. Add a profile-focused implementation plan in `docs/roadmap/` once profile work starts.
2. Add a delivery-policy design note for server moderation, blocking, and age gating before coding those together.
3. Update `docs/reports/PROJECT_STATUS.md` after each major spec-gap area closes so status docs stop drifting behind reality.
