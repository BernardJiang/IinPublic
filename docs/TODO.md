# IinPublic TODO

Last updated: 2026-04-22 (Phase 2 Core Loop audit complete)

This file is the prioritized backlog for the current repository. It is intentionally short.
It should describe what is still worth doing, not restate features that already exist or
expand into implementation-level specs for every subsystem.

## Current Snapshot

Observed in the repo today:

- TypeScript server, shared, and web layers are present under `src/`
- Android skeleton exists under `android/`
- CI already exists in `.github/workflows/ci-cd.yml`
- Deploy scripts and `Dockerfile` already exist
- Logging infrastructure already exists via `src/server/logger.ts` and `src/server/middleware/request-logger.ts`
- Test tooling already exists for Jest, Playwright, TypeScript, and ESLint
- Large documentation drift still exists across `README.md`, `docs/`, and status reports
- Main maintenance hotspots have been reduced by extracting server bootstrap/socket/route modules and multiple UI feature/dialog helpers out of the former monolith files

## Priorities

### P0 - Clean up source of truth

- [x] Rewrite `README.md` into a short canonical entry point:
  project overview, architecture, run commands, test commands, docs map, current status
- [x] Rewrite `docs/reports/PROJECT_STATUS.md` so it reflects the current TypeScript repo instead of older merged-project history
- [x] Audit `docs/guides/HOW_TO_RUN.md` for accuracy:
  ports, commands, prerequisites, and troubleshooting should match `package.json` and the current app
- [x] Move outdated or historical material into clearer buckets:
  `docs/current/`, `docs/roadmap/`, `docs/archive/` or equivalent
- [ ] Keep this TODO focused on actual remaining work; remove stale “already built” tasks as they are discovered

### P0 - Reduce repo noise

- [ ] Decide which generated outputs should never live in version control:
  `coverage/`, `dist/`, `playwright-report/`, `test-results/`, runtime logs, local app state
- [x] Tighten `.gitignore` to match that decision, including `coverage/`
- [x] Move obvious historical artifacts out of the main path:
  diff files, old reports, screenshots, copied scripts, and imported reference docs that are no longer active
- [x] Separate example/reference code from core product code so the main app is easier to scan

### P1 - Stabilize local validation

- [x] Fix the Jest haste-map collision caused by nested workspace/package scanning:
  exclude `.claude/` and similar non-project package roots from Jest scanning
- [x] Add one reliable repo health command in `package.json`:
  typecheck + lint + unit/integration tests + build checks
- [x] Verify CI uses that same health command where practical, so local and CI expectations match

### P1 - Refactor the main maintenance hotspots

- [x] Break up `src/server/index.ts` into smaller route, socket, and bootstrap modules without changing behavior
- [x] Break up `src/web/ui/ui-manager.ts` by feature area:
  chatrooms, contacts, talks, conversations, profile, shared render helpers
- [x] Add focused regression coverage around the extracted seams before or during the refactor

### P2 - Narrow product work

- [x] Re-rank the active backlog into:
  foundation, core message/talk loop, UX polish, platforms
- [x] Avoid treating Android or iOS work as near-term priority until the core web/server loop is easier to maintain
- [x] Turn broad feature ideas into smaller tickets only when they are about to be worked on

## Phase 2 Backlog

### Foundation

- [x] Finish the remaining repo-noise decision and enforce it consistently:
  generated outputs, local state, logs, and test artifacts should stay out of version control
- [ ] Keep current docs aligned with the working codepaths as the product surface narrows
- [x] Tighten the client-side data write boundary so public vs private SEA-backed data paths are explicit instead of ad hoc

### Core Message / Talk Loop

- [ ] Stabilize the end-to-end user path:
  chatroom presence → talk broadcast → incoming talk registration → answer submission → match/conversation creation
- [x] Audit where the server is still compensating for Gun timing/replication issues and decide which paths are authoritative long-term
  Source of truth: `docs/roadmap/talk-loop-authority.md`
- [ ] Make the answer/template/chatbot flow easier to reason about:
  one clear path for saved answers, auto-reply templates, and talk completion side effects

### UX Polish

- [ ] Reduce UI friction in the core web flow before adding new feature surface:
  talk creation, answering, match visibility, and conversation entry should feel consistent
- [ ] Continue splitting remaining UI feature islands out of `src/web/ui/ui-manager.ts` only when the extracted boundary is user-visible or testable
- [ ] Add narrow tests when a UX-critical seam changes instead of growing a broad speculative backlog

### Platforms

- [ ] Keep Android as maintenance-only for now:
  do not expand Android or start iOS work until the web/server talk loop is stable and easier to maintain
- [ ] Revisit platform priorities only after the foundation and core-loop items above are in a better state

## Already Present

These items were previously tracked as missing or incomplete, but code or infrastructure for
them already exists in the repo and they should not stay in the active TODO as greenfield work:

- CI workflow
- Deploy scripts
- `Dockerfile`
- Structured logger
- Request logging middleware
- Rate limiting/content moderation foundations
- Talk stats/shared supporting utilities
- Android project skeleton

## Working Rule

When updating this file:

- Prefer status and priority over implementation detail
- Link to the file or doc that is the source of truth
- Remove completed items instead of letting the backlog grow forever
- If a task needs a full execution plan, put that plan in `docs/roadmap/`
