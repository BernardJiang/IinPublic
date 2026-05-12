# IinPublic Docs

Last updated: 2026-05-12

This folder is organized around the authoritative product and technical spec:

- [Technical Specification](specs/iinpublic-technical-specification.md) — requirements, architecture, data model, UI contracts, testing strategy, and future enhancements.
- [TODO](TODO.md) — current execution backlog. Completed feature ledgers do not belong here.
- [Spec Gap Matrix](roadmap/spec-gap-matrix.md) — implementation evidence by spec area.
- [Statistics Expansion Roadmap](roadmap/statistics-expansion.md) — next analytics/statistics design work.
- [Project Status](reports/PROJECT_STATUS.md) — short operational status for the current repo.
- [How To Run](guides/HOW_TO_RUN.md) — local setup, validation commands, and dev workflows.

## Spec-Aligned Map

| Spec area | Current docs | Notes |
|---|---|---|
| Product requirements, architecture, data, APIs, UI, testing | [Technical Specification](specs/iinpublic-technical-specification.md) | Single source of truth. Update this when the product contract changes. |
| Implementation evidence by requirement area | [Spec Gap Matrix](roadmap/spec-gap-matrix.md) | Use file/test evidence, not intent. |
| Current work queue | [TODO](TODO.md), [Statistics Expansion Roadmap](roadmap/statistics-expansion.md) | Forward-looking only. Move completed work into status or the gap matrix. |
| Build, test, and operation | [How To Run](guides/HOW_TO_RUN.md), [Debug Guide](guides/DEBUG_GUIDE.md), [Testing Benchmarks](testing-benchmarks.md) | Keep commands aligned with `package.json`. |
| Testing plans | [Test Plan](testing/testplan.md), [Manual Verification Guide](guides/manual-verification-guide.md) | Broad verification references; current automated status lives in status/gap docs. |
| Historical/imported source docs | [Archive](archive/README.md) | Not authoritative unless explicitly linked from a current doc. |

## Current Implemented Feature Baseline

The spec areas below are merged into the current implementation and should not be re-added to TODO as greenfield work:

- Profile editor and viewer-filtered public profile rendering.
- Intake filters, server-side moderation, blocking/unblock, age gating, reputation scoring, and bulk-capacity enforcement.
- Custom/business chatrooms, hierarchy navigation, single-room travel mode, and same-room broadcast delivery.
- Tag catalog, mandatory broadcast preamble, interest targeting, distance caps, tag popularity, and tag trend stats.
- Talk creation, matching, answer history, contacts, messaging, cancellation/deletion paths, and exact chatbot Q/A memory.
- Generic per-talk stats endpoints, survey analytics dashboard, low-count masking, CSV exports, follow-up survey creation, and peer relationship stats.

## Maintenance Rules

- Keep `docs/specs/iinpublic-technical-specification.md` authoritative.
- Keep `docs/TODO.md` short and future-facing.
- Archive stale phase reports, imported design notes, and old coverage snapshots instead of leaving them in active paths.
- When a feature ships, update the spec gap matrix and project status with concrete file/test evidence.
