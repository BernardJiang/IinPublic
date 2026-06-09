# Statistics Expansion Roadmap

Last updated: 2026-05-12

Purpose: define the next statistics work on top of the current spec baseline in
`docs/specs/iinpublic-technical-specifications.md` §12.7 and §13.5.

## Current Baseline

Implemented today:

- Per-talk response log recorded through `POST /api/stats/talks/:id/record` and response completion paths.
- Per-talk query endpoints:
  - `GET /api/stats/talks/:id/summary`
  - `GET /api/stats/talks/:id/by-day`
  - `GET /api/stats/talks/:id/by-region`
  - `GET /api/stats/talks/:id/by-answer?questionId=...`
- Expanded query endpoints:
  - `GET /api/stats/talks/:id/time-series`
  - `GET /api/stats/talks/:id/cross-question?questionA=...&questionB=...`
  - `GET /api/stats/talks/:id/chatrooms`
  - `GET /api/stats/chatrooms`
  - `GET /api/stats/peers`
  - `GET /api/stats/dashboard`
- Survey analytics modal/dashboard with summary cards, question distribution, by-day and by-region views.
- Dedicated Statistics tab for cross-talk dashboard navigation.
- Low-count masking in survey analytics UI.
- CSV exports for survey summary, day buckets, and region buckets.
- Follow-up survey creation from the survey analytics dashboard.
- Broadcast tag popularity and UTC-day trend endpoints.
- Peer relationship statistics used in chatroom member lists and peer/contact detail views.

## Design Decisions To Make First

1. Source of truth:
   Decide which statistics are server-authoritative, Gun-mirrored, recomputed from append-only events,
   or allowed to remain ephemeral.
   **Current decision:** normalized response events are append-only and Gun-mirrored; in-memory indices are derived caches; broadcast tag counters are server trend buckets; quota counters remain server-cache state.

2. Privacy:
   Define minimum cohort sizes, region granularity, time bucket granularity, per-viewer permission checks,
   and CSV export masking rules.
   **Current decision:** no precise locations in stats; regions use blurred/chatroom ids; small cohorts are masked at fewer than three responses; exports keep small-cohort masking enabled.

3. Schema:
   Add shared TypeScript response schemas before expanding endpoints. New stats endpoints should not return
   ad hoc JSON shapes.
   **Current decision:** shared schemas and aggregators live in `src/shared/talk-stats.ts`.

4. Retention:
   Decide whether raw response events are retained forever, compacted into buckets, or user-prunable.
   **Current decision:** raw stats response events are retained as Gun-mirrored append-only records; compaction/user pruning remains a production policy follow-up.

## Feature Backlog

### Survey Analytics

- Cross-question correlation: answer A on question 1 vs answer B on question 2.
- Completion and skip rates by question.
- Time-to-answer where timestamps are available.
- Segment filters by region, time bucket, talk type, and responder cohort when privacy thresholds pass.
- Comparison between original and follow-up surveys.

### Talk Analytics

- Unified creator dashboard for tags, flows, routes, and surveys.
- Match rate, ignore rate, response rate, and completion rate across all talk types.
- Time series with consistent day/week/month controls.
- Answer distribution drilldown for every question in a talk.

### Broadcast and Tag Analytics

- Broadcast reach vs response rate.
- Tag demand trends by selected region/time bucket.
- Targeting effectiveness: tags selected, eligible recipients, delivered registrations, responses, matches.
- Distance-cap effectiveness and local vs traveller split.

### Chatroom and Location Analytics

- Room activity over time.
- Broadcast volume, response rate, and match rate by room.
- Region-level trends that never expose precise user location.
- Travel-mode participation and remote-room effectiveness.

### Peer and Reputation Analytics

- Relationship history summaries: sent/received talks, matches, mismatches, mutual tags, messages.
- Reputation trend inputs: ratings, blocks, age-verification votes, and capacity impact.
- Visibility-aware reputation sections that respect profile/reputation privacy settings.

## Verification Requirements

Every new statistics feature should include:

- Unit tests for aggregation math.
- Integration tests for endpoint input validation, empty data, UTC boundaries, and privacy masking.
- E2E tests for dashboard entry points and visible results.
- Documentation updates in `docs/TODO.md`, `docs/reports/PROJECT_STATUS.md`, and `docs/roadmap/spec-gap-matrix.md`.
