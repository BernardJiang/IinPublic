# IinPublic TODO

Last updated: 2026-05-12

This is the forward backlog for the current repository. Completed feature ledgers belong in
[Project Status](reports/PROJECT_STATUS.md) or the [Spec Gap Matrix](roadmap/spec-gap-matrix.md),
not in TODO.

Authoritative product scope lives in
[docs/specs/iinpublic-technical-specification.md](specs/iinpublic-technical-specification.md).

## Current Focus

The major spec features implemented so far are merged into the current docs baseline:

- Profile editing and viewer-filtered profile privacy
- Server-enforced intake/moderation filters, age gating, blocking/unblock, reputation, and rate limits
- Custom/business chatrooms, hierarchy navigation, same-room broadcast delivery, and single-room travel mode
- Tag catalog, broadcast preamble, interest targeting, distance caps, tag popularity, and tag trend stats
- Exact chatbot Q/A memory with temporary/permanent/suppressed modes and auto-use telemetry
- Talk lifecycle coverage for cancellation/deletion, matching, contacts, messaging, and answer history
- Survey analytics dashboard with summary/by-day/by-region views, low-count masking, CSV exports, and follow-up survey creation

## P0 — UI Navigation and Control Surfaces

- [x] Set the bottom navigation to exactly Chatrooms, Contacts, Talks, Me, Settings.
- [x] Merge Answers into Me and list answered question/answer pairs there with all/selected filters.
- [x] Remove the Statistics bottom tab and expose statistics contextually on product surfaces.
- [x] Move user-controlled settings into Settings: languages, multi-language filter, auto-save received talks,
  chatbot, distance, home location, grammar/dirty-word filters, and reputation/credit visibility.

## P1 — Tab-Specific Workflow Polish

- [x] Chatrooms: add a top status bar plus action bar with New Room, Return Home, Broadcast, and detail Back.
- [x] Chatrooms: define home as the smallest regional room matching the user's location and enable Return Home only away from home.
- [x] Chatrooms: allow selecting a room user, sending all talks to that user, or manually sending messages; allow broadcasting before or after opening the member list.
- [x] Contacts: add status/action bars, default to users who exchanged talks, show peer stats, support filters/sort, and restore the last tab position.
- [x] Talks: add status/action bars, visually differentiate tag/flow/survey/route talks, consolidate duplicate incoming talks, remove answered incoming talks, copy to outgoing when enabled, sort talks, disable unchecked tags in outgoing, and open editor popups from outgoing rows.
- [x] Me: add status/action bars, show answered talks by type, and color answer rows green/manual red/conditional yellow for chatbot behavior.

## P2 — Verification

- [x] Add an E2E script that assumes room capacity 3 and fills 1 global room, 6 continental rooms, and 1 USA room with 25 people, verifying automatic smaller regional room creation.
- [x] Run `PW_WORKERS=10 npm run test:e2e` after the UI changes.

## Working Rule

- Remove completed TODOs instead of keeping stale checked-off work.
- Link each future item to the technical specification or a focused roadmap doc.
- Archive old snapshots under `docs/archive/` when they stop representing the current repo.
