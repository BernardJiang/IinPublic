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

## P0 — Statistics Expansion Design

- [x] Create the focused statistics roadmap:
  [docs/roadmap/statistics-expansion.md](roadmap/statistics-expansion.md).
- [ ] Decide the statistics source-of-truth model.
  Document which metrics are server-authoritative in memory, mirrored to Gun, append-only,
  recomputable, or intentionally ephemeral.
- [ ] Define privacy and anonymity rules for every stats surface.
  Include minimum cohort sizes, region/time bucketing rules, per-viewer permission checks,
  and rules for exported CSV data.
- [ ] Define shared stats response schemas in `src/shared/` before adding more endpoints.
  Current endpoints already expose summary, by-day, by-region, by-answer, broadcast-tag popularity,
  and broadcast-tag trends; future endpoints should reuse typed schema contracts.

## P1 — Statistics Product Work

- [ ] Add cross-question survey analytics.
  Examples: answer correlation, segmented answer distribution, skip rate, completion rate,
  and time-to-answer where timestamps are available.
- [ ] Add richer time-series statistics.
  Support day/week/month selection consistently across talk, survey, broadcast-tag, and chatroom stats.
- [ ] Add chatroom/location analytics.
  Track room activity, broadcast reach, response rate, match rate, traveller vs local split,
  and region-level trends without exposing precise user location.
- [ ] Add peer/reputation analytics polish.
  Summarize relationship history, mutual tags, match quality, block/rating impact, and visibility controls
  in a way that respects profile/reputation privacy.
- [ ] Add a statistics dashboard navigation surface.
  Avoid scattering stats only inside row-level modals; give creators one place to scan recent talks,
  surveys, tags, and rooms.

## P2 — Hardening and Verification

- [ ] Persist stats counters that must survive server restarts.
  Daily/weekly quota counters and current stats indices are in-memory unless explicitly mirrored or recomputed.
- [ ] Add integration tests for any new stats endpoint.
  Cover empty data, UTC boundaries, filter parameters, privacy masking, and malformed input.
- [ ] Add E2E tests for the statistics dashboard once the UI expands beyond the current survey modal.
- [ ] Keep `docs/roadmap/spec-gap-matrix.md` and `docs/reports/PROJECT_STATUS.md` updated when a stats feature ships.

## Working Rule

- Remove completed TODOs instead of keeping stale checked-off work.
- Link each future item to the technical specification or a focused roadmap doc.
- Archive old snapshots under `docs/archive/` when they stop representing the current repo.
