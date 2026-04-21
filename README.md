# IinPublic

IinPublic is a TypeScript codebase for a location-aware chat and talk system. The repository
contains a web client, a Node/Express server, shared domain logic, Playwright/Jest tests,
and an Android skeleton.

## Architecture

- `src/web/` - Web client, UI manager, Gun client integration
- `src/server/` - Express server, Socket.IO handlers, Gun server integration
- `src/shared/` - Shared types, talk engine, location logic, moderation helpers
- `tests/e2e/` - Playwright end-to-end coverage
- `android/` - Android project skeleton

## Run

Prerequisites:

- Node.js 18+
- npm
- Android Studio only if you need the Android build

Install dependencies:

```bash
npm install
```

Start web and server together:

```bash
npm run dev
```

Default local ports:

- Web: `http://localhost:3001`
- Server: `http://localhost:8080`
- Health check: `http://localhost:8080/health`

Useful alternatives:

```bash
npm run dev:web
npm run dev:server
npm run build:web
npm run build:server
npm run build:android
```

## Test

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:type
npm run test:e2e
npm run lint
```

## Docs

Current working docs:

- [How To Run](./docs/guides/HOW_TO_RUN.md)
- [Project Status](./docs/reports/PROJECT_STATUS.md)
- [Contributing](./docs/dev/contributing.md)
- [TODO](./docs/TODO.md)
- [Current Docs Map](./docs/current/README.md)
- [Archive Docs Map](./docs/archive/README.md)

## Current Status

What is true in this repo today:

- TypeScript web, server, and shared layers are present and wired together
- CI, deploy scripts, Dockerfile, logging, Jest, and Playwright are already in place
- The main maintenance hotspots are `src/server/index.ts` and `src/web/ui/ui-manager.ts`
- Documentation has historical drift from older merged sources and is being tightened

Near-term priorities:

- keep docs aligned with the actual scripts and file layout
- reduce repo noise from generated and historical artifacts
- isolate Jest from nested workspaces like `.claude/`
- begin extracting smaller modules from the largest files
