# Repo Cleanup Plan

Last updated: 2026-04-20

This is the concrete execution checklist for the current repo cleanup and documentation pass.
Use it alongside `docs/TODO.md`.

## Week 1

- [ ] Rewrite `README.md`
- [ ] Rewrite `docs/reports/PROJECT_STATUS.md`
- [ ] Reconcile `docs/guides/HOW_TO_RUN.md` with `package.json`
- [ ] Move outdated docs into `docs/archive/` or another clearly named historical area
- [ ] Tighten `.gitignore`
- [ ] Fix Jest scanning to ignore `.claude/` and similar nested worktrees

## Week 2

- [ ] Add a single validation script in `package.json`
- [ ] Update CI to rely on the same validation path where sensible
- [ ] Extract the first route/module group from `src/server/index.ts`
- [ ] Extract the first UI feature slice from `src/web/ui/ui-manager.ts`
- [ ] Add or update regression tests around the extracted modules

## Definitions Of Done

### Docs cleanup is done when:

- `README.md` can orient a new contributor in under 10 minutes
- run/build/test instructions match current scripts
- `PROJECT_STATUS.md` describes the current repo, not older merged history
- historical reference material is clearly separated from active docs

### Repo cleanup is done when:

- generated artifacts are ignored or intentionally retained
- stale diff files and duplicate scripts are no longer cluttering the root
- test tooling ignores unrelated nested package roots

### Refactor kickoff is done when:

- at least one slice is extracted from `src/server/index.ts`
- at least one slice is extracted from `src/web/ui/ui-manager.ts`
- behavior is preserved and validated by tests
