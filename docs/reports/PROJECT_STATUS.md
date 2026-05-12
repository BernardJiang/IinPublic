# IinPublic Project Status

Last updated: 2026-05-12

## Summary

The current repository is a TypeScript app with three main layers:

- `src/web/` — browser client, UI manager, Gun client integration
- `src/server/` — Express server, Socket.IO handlers, Gun server integration
- `src/shared/` — shared types, talk engine, location logic, moderation helpers

Supporting infrastructure exists for CI, deploy scripts, Dockerfile, Jest, Playwright, and an Android skeleton.

## What Is Stable

- Core web/server/shared structure is in place and wired together
- `src/server/index.ts` has been split into route, socket, and bootstrap modules; no longer a monolith
- `src/web/ui/ui-manager.ts` has been split by feature area; the largest feature islands are extracted
- Server-side talk loop is end-to-end tested with HTTP-level integration tests (`src/test/integration/talk-loop.test.ts`)
- Gun authority audit is complete (`docs/roadmap/talk-loop-authority.md`):
  - Stats, match counts, and conversation creation all go through the server
  - `getTalkWithRetry()` prefers the server; Gun is a cache only
  - Client-side Gun conversation-creation fallback has been removed
- Answer/chatbot template flow is documented and has a single clear execution path
- Repo noise is resolved: generated outputs, logs, and test artifacts are gitignored; none are tracked
- Local validation and CI run the same `npm run health` command
- Profile editor + viewer-filtered public profile rendering (including per-row Q&A visibility) are live and end-to-end tested
- Age gating, blocking/unblock, reputation flows, custom/business chatrooms, travel mode, cancellation handling, and exact chatbot Q/A memory are live with focused unit/integration/E2E coverage
- Statistics baseline is live: generic per-talk stats (`summary`, `by-day`, `by-region`, `by-answer`), Talks-row response/match/ignore counts, survey analytics dashboard, low-count masking, CSV exports, follow-up survey creation, broadcast tag popularity/trends, and peer relationship stats

## What Is Still In Progress

- Statistics expansion: richer survey analysis, cross-question correlations, chatroom/location analytics, peer/reputation analytics polish, durable stats persistence, and dashboard navigation
- Docs alignment: keep `docs/specs/iinpublic-technical-specification.md`, `docs/roadmap/spec-gap-matrix.md`, and `docs/TODO.md` synchronized as statistics work lands
- Android: maintenance-only until the web/server loop is stable

## Current Risks

- Gun replication timing still affects the incoming-talk path; the server auto-reply path
  (`POST /api/talks/:id/received`) requires the Gun answer template to be replicated
  before the new talk arrives — if replication is slow, auto-reply may miss
- The `talkCompleted` handler has a Gun direct-write fallback for the response record
  when the server is unreachable; this preserves data but skips match/conversation creation
- Some stats indices and quota counters are in-memory unless mirrored or recomputed; decide durability requirements before building richer analytics on top of them

## Useful Commands

```bash
npm run health        # pre-merge check: typecheck + lint + unit + integration + build
npm test              # unit + integration tests
npm run test:e2e      # Playwright end-to-end
npm run dev           # run web + server together
npm run build         # full build
```

## Doc Map

Use these first:

- [README](../../README.md)
- [Docs Home](../README.md)
- [Technical Specification](../specs/iinpublic-technical-specification.md)
- [How To Run](../guides/HOW_TO_RUN.md)
- [TODO](../TODO.md)
- [Spec Gap Matrix](../roadmap/spec-gap-matrix.md)
- [Talk Loop Authority](../roadmap/talk-loop-authority.md)
- [Current Docs Map](../current/README.md)
