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

What is stable today:

- TypeScript web, server, and shared layers are wired together and tested end-to-end
- CI, deploy scripts, Dockerfile, logging, Jest, and Playwright are in place
- Server and UI modules have been split out of the former large files
- Server-side talk loop (registration → answer → match → conversation) has HTTP-level integration tests
- Gun authority is audited; server is authoritative for stats, matches, and conversations
- Me-tab profile editor (headshot, languages, interests, profile Q&A with per-row visibility) and viewer-filtered public profile rendering in peer/contact views are live
- Age gating, blocking/unblock, reputation flows, custom/business chatrooms, travel mode, survey analytics, cancellation handling, and exact chatbot Q/A memory are implemented with focused coverage

Active work (see [TODO](./docs/TODO.md)):

- Nice-to-have coverage for mobile layout, reconnect recovery, Answers search/filter, timezone boundaries, and GPS auto-assignment
- Ongoing docs alignment as the product surface changes
