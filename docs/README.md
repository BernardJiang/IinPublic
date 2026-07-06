# IinPublic Docs

Last updated: 2026-06-08

This folder is organized around four canonical documents (everything else is operational guides or
archive). As of 2026-06-08 the scattered spec/roadmap/status/backlog files were consolidated into
these four; their sources live in [Archive](archive/consolidated-2026-06-08/README.md).

- [Technical Specification](specs/iinpublic-technical-specifications.md) — **all feature/design detail**: requirements, architecture, data model, UI contracts, P2P deep dives (§19–24), testing strategy, future enhancements.
- [Test Plan](testing/testplan.md) — **all test detail**: E2E catalog, strategy, plus flake investigations & benchmarks (Appendix C).
- [TODO](TODO.md) — **all future tasks**: execution queue plus detailed backlog inventory and statistics/spec-gap follow-ups (Appendices A–C).
- [Completed Work](completed.md) — **all completed tasks**: durable ledger for finished features.
- [How To Run](guides/HOW_TO_RUN.md) — local setup, validation commands, and dev workflows.
- [Port Usage Scenarios](design/port-usage-scenarios.md) — shared-dev, E2E, native app, LAN, mobile, and production port model.
- [Native App E2E Strategy](testing/native-app-e2e-strategy.md) — plan for testing Electron/native app instances alongside browser E2E.

## Spec-Aligned Map

| Spec area | Current docs | Notes |
|---|---|---|
| Product requirements, architecture, data, APIs, UI, feature design | [Technical Specification](specs/iinpublic-technical-specifications.md) | Single source of truth. Update this when the product contract changes. |
| Implementation evidence by requirement area | [Completed Work](completed.md) | Shipped-feature ledger; the former spec-gap matrix's "Implemented" rows were folded in (2026-06-08 entry). |
| Current work queue | [TODO](TODO.md) | Forward-looking only (incl. backlog inventory + statistics backlog in Appendices). Move completed work into [Completed Work](completed.md). |
| Completed feature ledger | [Completed Work](completed.md) | Shipped feature history + retired status/audit facts. |
| Build, test, and operation | [How To Run](guides/HOW_TO_RUN.md), [Debug Guide](guides/DEBUG_GUIDE.md) | Keep commands aligned with `package.json`. |
| Port and native topology | [Port Usage Scenarios](design/port-usage-scenarios.md), [Native App E2E Strategy](testing/native-app-e2e-strategy.md) | Shared-dev versus isolated E2E ports, native embedded-node app testing. |
| Testing plans & flake history | [Test Plan](testing/testplan.md), [Manual Verification Guide](guides/manual-verification-guide.md) | Automated catalog + flake/benchmark appendices. |
| Historical/imported source docs | [Archive](archive/README.md) | Not authoritative. 2026-06-08 consolidation sources: [here](archive/consolidated-2026-06-08/README.md). |

## Current Implemented Feature Baseline

The spec areas below are merged into the current implementation and should not be re-added to TODO as greenfield work:

- Profile editor and viewer-filtered public profile rendering.
- Intake filters, server-side moderation, blocking/unblock, age gating, reputation scoring, and bulk-capacity enforcement.
- Custom/business chatrooms, hierarchy navigation, single-room travel mode, and same-room broadcast delivery.
- Tag catalog, mandatory broadcast preamble, interest targeting, distance caps, tag popularity, and tag trend stats.
- Talk creation, matching, answer history, contacts, messaging, cancellation/deletion paths, and exact chatbot Q/A memory.
- Generic per-talk stats endpoints, cross-question/time-series/chatroom/peer/dashboard stats, dedicated Statistics tab, survey analytics dashboard, low-count masking, CSV exports, follow-up survey creation, and peer relationship stats.

## Maintenance Rules

- Keep `docs/specs/iinpublic-technical-specifications.md` authoritative.
- Keep `docs/TODO.md` short and future-facing.
- Move completed TODO items into `docs/completed.md` with concrete evidence.
- Archive stale phase reports, imported design notes, and old coverage snapshots instead of leaving them in active paths.
- When a feature ships, record concrete file/test evidence in `docs/completed.md`.
