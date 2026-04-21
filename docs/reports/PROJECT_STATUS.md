# IinPublic Project Status

Last updated: 2026-04-20

## Summary

The current repository is a TypeScript app with three main layers:

- `src/web/` for the browser client
- `src/server/` for the Express and Socket.IO server
- `src/shared/` for shared logic and types

Supporting infrastructure already exists for:

- CI via `.github/workflows/ci-cd.yml`
- deploy scripts in `scripts/`
- containerization via `Dockerfile`
- unit and integration tests via Jest
- end-to-end tests via Playwright
- Android work via `android/`

## What Looks Healthy

- Core web/server/shared structure is in place
- Test, lint, and build scripts exist in `package.json`
- Logging infrastructure exists via `src/server/logger.ts`
- Request logging middleware exists via `src/server/middleware/request-logger.ts`
- Shared modules already cover location, reputation, talk flow, and related domain logic

## Current Risks

- `src/server/index.ts` is too large and mixes bootstrap, routes, socket handling, and business logic
- `src/web/ui/ui-manager.ts` is too large and is the main frontend maintenance hotspot
- Documentation still contains stale material from older merged sources
- Repo root still contains generated output and historical artifacts that make navigation harder
- Jest needs explicit protection from nested workspaces like `.claude/`

## Current Priorities

1. Clean up docs so the repo has a reliable source of truth.
2. Reduce repo noise and tighten ignore rules for generated/runtime output.
3. Fix local validation friction, including Jest workspace scanning.
4. Start extracting modules from the two largest maintenance hotspots.

## Useful Commands

```bash
npm run dev
npm test
npm run test:type
npm run test:e2e
npm run lint
npm run build:web
npm run build:server
```

## Doc Map

Use these first:

- [README](../../README.md)
- [How To Run](../guides/HOW_TO_RUN.md)
- [TODO](../TODO.md)
- [Current Docs Map](../current/README.md)
- [Archive Docs Map](../archive/README.md)

## Near-Term Roadmap

- finish the docs and repo cleanup pass
- align local validation and CI expectations
- extract the first server route/bootstrap slice
- extract the first UI feature slice from `ui-manager`
