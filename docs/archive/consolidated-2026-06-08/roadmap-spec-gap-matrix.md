# IinPublic Spec-Gap Matrix

Last updated: 2026-05-12

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
| Profile foundation | FR-UM-2..8, FR-BF-2, UI-1 | Complete | `src/shared/types.ts:23-40` defines `headshot`, `profile`, `languages`, `interests`, `reputation`; `src/server/services/user-service.ts:getUser()` persists and resolves those fields; viewer-specific filtering uses `src/shared/profile-privacy.ts` via `GET /api/users/:id?viewerId=...`; Me profile editor + per-row visibility are implemented in `src/web/ui/ui-manager.ts` and public profile rendering in `src/web/ui/user-detail-view.ts`/`src/web/ui/contacts-view.ts`; E2E coverage includes `tests/e2e/04-profile-edit-stage-name.spec.ts` and `tests/e2e/24-profile-privacy-visibility.spec.ts` | Remaining focus is on reputation/credit section allowlists (FR-UM-7) and deeper FR-UM audit; profile Q&A visibility itself is now end-to-end implemented and tested. |
| Intake filters and moderation | FR-BF-1..6, FR-SP-7..8 | Implemented | `src/shared/types.ts` defines `TalkIntakeFilters`; `src/shared/talk-intake-filters.ts` contains shared reject-reason logic; `src/server/routes/talk-delivery-routes.ts` applies receiver filters, server blocked terms, distance, adult gating, blocking, symmetric cooldown, and daily/weekly quota checks on `/received` and broadcast receiver registration; coverage includes `src/test/integration/talk-loop.test.ts`, `tests/e2e/13-me-filters-credit.spec.ts`, and `tests/e2e/00g-age-gating.spec.ts` | Remaining polish is broader moderation UX and any future centralized reporting/appeal model. |
| Reputation and abuse prevention | FR-UM-6..7, FR-BM-3, FR-SP-4..6 | Implemented | `src/shared/reputation.ts` calculates reputation score and bulk-send capacity; runtime flows include block/unblock, age vouch threshold, peer star rating, and capacity enforcement. Coverage includes `tests/e2e/15a-blocking-unblock-resumes-talk-delivery.spec.ts`, `tests/e2e/15b-blocking-stops-delivery-and-peer-visibility.spec.ts`, and `tests/e2e/21*.spec.ts` | Remaining focus is reputation-section visibility allowlists and deeper audit of all profile/credit surfaces. |
| Chatroom model expansion | FR-CR-1..10, UI-7 | Implemented | Custom/business chatroom REST + Gun metadata, web create/rename/delete, single-room travel mode, hierarchy broadcast behavior, and location-based reassignment are covered by `tests/e2e/17-chatroom-custom-business-api.spec.ts`, `tests/e2e/18-travel-mode-single-room.spec.ts`, `tests/e2e/00h-chatroom-hierarchy-broadcast.spec.ts`, and `tests/e2e/27-location-auto-assignment.spec.ts` | Richer business profile UX and deeper room/location analytics remain future work. |
| Tags and bulk-targeting | FR-TG-1..6, FR-BM-1..7, UI §13.4 | Implemented | Curated tag catalog, broadcast preamble, interest targeting, distance cap, same-room-only delivery, preview endpoint, cumulative popularity, and daily trend endpoint/UI are implemented and covered by unit/integration/E2E tests including `tests/e2e/00h-chatroom-hierarchy-broadcast.spec.ts` | Future work is deeper analytics presentation beyond the current trends table. |
| Survey and statistics | FR-SV-1..6, UI-4, §12.7, §13.5 | Implemented | Survey talks, typed stats schemas, generic stats endpoints (`summary`, `by-day`, `by-region`, `by-answer`, `time-series`, `cross-question`, `chatrooms`, `peers`, `dashboard`), Talks-row Results modal, dedicated Statistics tab, survey analytics dashboard, low-count anonymity masking, CSV exports, follow-up survey creation, broadcast tag popularity/trends, peer relationship stats, and UTC boundary coverage are implemented. Coverage includes `tests/e2e/00-statistics-dashboard.spec.ts`, `tests/e2e/00i-survey-analytics-dashboard.spec.ts`, talks-matching survey specs, `src/test/unit/talk-stats.test.ts`, and `src/test/integration/talk-loop.test.ts` | Future work is visualization polish and production durability hardening if in-memory caches become insufficient. |
| Rate limiting and cooldowns | FR-SP-1..3 | Implemented | `src/server/services/symmetric-talk-edge-rate-limit.ts` and `src/server/services/daily-weekly-talk-edge-quota-rate-limit.ts` enforce symmetric cooldowns and UTC daily/weekly quotas in delivery routes; `src/test/integration/talk-loop.test.ts` covers rejection and UTC reset behavior | Persistence across server restarts may need a later hardening pass if in-memory counters are not sufficient. |
| Exact chatbot memory | FR-QA-7..13, §12.3 | Implemented | `src/shared/exact-chatbot-memory.ts`, `src/server/exact-chatbot-memory-store.ts`, `src/web/ui/talk-response-dialog.ts`, `src/web/ui/answers-view.ts`, and delivery route integration implement exact IDs, temporary/permanent/suppressed modes, auto-use telemetry, UI state, and server auto-response. Coverage includes `src/test/unit/exact-chatbot-memory.test.ts`, `src/test/unit/answers-view.test.ts`, `src/test/integration/talk-loop.test.ts`, and `tests/e2e/talks-matching/14-exact-chatbot-memory.spec.ts` | Future work is UI polish for custom free-text permanent answers if the product adds free-text answer entry. |
| Coverage and doc alignment | FR-BTD-4, §15 | Implemented baseline | E2E coverage now includes stage name/profile privacy, tags, capacity eviction, contacts, messaging, answer cards/search, filters, relationship/credit, age gating, blocking, custom/business chatrooms, travel mode, hierarchy broadcast, survey dashboard, reputation, cancellation, mobile viewport, reconnect sync, location auto-assignment, and exact chatbot memory | Keep docs aligned as new statistics features land. |

## Gap Notes By Area

### 1. Profile Foundation

What exists:

- The data model already anticipates a richer profile:
  `src/shared/types.ts:23-40`
- Server user creation preserves `headshot`, `profile`, `languages`, and `interests`:
  `src/server/services/user-service.ts:8-42`
- The Me tab includes the full profile editor surface (headshot, languages, interests, and per-row profile Q&A visibility):
  `src/web/ui/ui-manager.ts`
- Peer/contact detail views render a viewer-filtered public profile subset using server-side filtering on `GET /api/users/:id?viewerId=...`:
  `src/shared/profile-privacy.ts` + `src/web/ui/user-detail-view.ts` / `src/web/ui/contacts-view.ts`

What is missing:

- Reputation/credit section visibility allowlists (FR-UM-7) and a deeper FR-UM audit still need broader verification.

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

Current state:

- The server delivery route now owns the authoritative eligibility pipeline for incoming registration and broadcast receiver registration.
- Rejection reasons are exposed in API responses and covered by integration/E2E tests.

### 3. Blocking and Age Gating

What exists:

- Reputation math already includes `blockCount` and `ageVerified`:
  `src/shared/types.ts:50-64`
  and `src/shared/reputation.ts:20-27`, `84-92`

Current state:

- Block/unblock, delivery rejection, peer visibility, reputation block-count propagation, age-vouch threshold, and adult-talk delivery filtering are implemented and covered.

### 4. Chatroom Expansion

Current state:

- Custom/business chatroom CRUD, owner rename/delete, hierarchy navigation, single-room travel mode,
  same-room broadcast delivery, and location-based reassignment are implemented with E2E coverage.

Future work:

- Richer business profile UX and deeper location analytics belong with the next statistics pass.

### 5. Survey and Statistics

What exists:

- Statistics endpoints live in `src/server/routes/stats-routes.ts`.
- Talk response recording and indices live in `src/server/index.ts`.
- Survey results are visible from OUT rows and the dedicated dashboard, with anonymous low-count masking,
  summary/day/region CSV export, and follow-up survey creation.
- Broadcast tag popularity/trends and peer relationship stats are also implemented.

Future work:

- Cross-question analytics, consistent time-series controls, chatroom/location analytics,
  peer/reputation analytics polish, durable stats persistence, and a unified statistics dashboard.

### 6. Rate Limits

What exists:

- Reputation-based bulk capacity:
  `src/shared/reputation.ts:30-46`

Current state:

- Symmetric cooldown and daily/weekly quotas are enforced in server routes and covered by integration tests.

## Recommended Next Docs Passes

1. Add `docs/roadmap/statistics-expansion.md` before the next analytics feature pass.
2. Update the technical specification if the statistics source-of-truth or privacy model changes.
3. Update `docs/reports/PROJECT_STATUS.md` and this matrix after each major stats area closes.
