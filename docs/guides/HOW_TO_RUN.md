# How To Run IinPublic

This guide is the current source of truth for local development commands.

## Prerequisites

- Node.js 18+
- npm
- Git
- Android Studio only if you need `android/`

## Install

```bash
npm install
```

## Development

Run both the web client and server:

```bash
npm run dev
```

Run them separately if needed:

```bash
npm run dev:web
npm run dev:server
```

Default local endpoints:

- Web UI: `http://localhost:3001`
- Server: `http://localhost:8080`
- Health endpoint: `http://localhost:8080/health`

Notes:

- The webpack dev server defaults to port `3001`
- The Node server defaults to port `8080`
- Both can be overridden with `PORT` in contexts like parallel Playwright workers
- The browser app derives its API/Gun endpoint from the local web port in development

## Build

```bash
npm run build
npm run build:web
npm run build:server
npm run build:android
```

`npm run build` includes the Android build. If you only need the web/server artifacts, run the
platform-specific build commands directly.

## Test And Validation

```bash
npm run health
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:type
npm run test:e2e
npm run lint
```

`npm run health` is the main pre-merge validation path. It runs type checking, lint,
unit tests, integration tests, and the web/server builds.

## Common Checks

Server health:

```bash
curl http://localhost:8080/health
```

Port conflicts:

```bash
lsof -ti:3001 | xargs kill -9
lsof -ti:8080 | xargs kill -9
```

Clean local runtime state when debugging:

- `radata/`
- `logs/`
- `playwright-report/`
- `test-results/`
- `test-storage/`
- `user_data/`

Prefer removing only what you need, and do not delete files you care about.

## Related Docs

- [README](../../README.md)
- [Project Status](../reports/PROJECT_STATUS.md)
- [TODO](../TODO.md)
- [Contributing](../dev/contributing.md)
