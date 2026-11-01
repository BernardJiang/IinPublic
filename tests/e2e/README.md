# E2E Test Suite for IinPublic Talk System

## Overview

End-to-end tests for the IinPublic real-time Talk system using Playwright. Tests use **short** intervals by default for fast regression; set **long** intervals when you want to watch the run.

## Suite layout (current)

This suite is no longer a small flat list. The canonical coverage/index docs are:

- `docs/testing/journey-coverage.md` (user journeys across web / phone path / real phone)
- `docs/testing/coverage-matrix.md` (spec anchors × E2E mapping; generated)

Top-level E2E folders:

| Folder | Purpose |
|------|----------|
| `staged/` | Main browser regression pipeline (stage0→stage5) |
| `phone-path/` | Browser-driven journeys through phone-like embedded nodes |
| `native-app/` | Real desktop/mobile shell and physical-device journeys |
| `cross-platform/` | Website ↔ webapp/native interoperability scenarios |
| `talks-matching/` | Focused Talk/response/match/mesh behavior and wire privacy checks |
| `responsiveness/` | Hub-stalled and UI responsiveness sweeps |
| `mass/`, `isolated/`, `browser-matrix/`, `embedded-node/`, `platform-smoke/` | Scale, isolation, matrix, and smoke slices |

Shared utilities live under `tests/e2e/helpers/`.

## Short vs long intervals

- **Short (default)** — for CI and automatic regression. Minimal waits between actions and Gun sync.
- **Long** — for human verification. ~3× longer waits and slower `slowMo` so you can follow the flow.

Use the `E2E_INTERVAL` environment variable:

```bash
# Automatic regression (short waits)
npm run test:e2e

# Human watch (long waits)
E2E_INTERVAL=long npx playwright test
```

Timing is centralized in `helpers/timing.ts` (`afterLoad`, `afterSync`, `afterNav`, `afterAction`, `delay`).

## Running tests

### Prerequisites

Playwright config starts dev servers if needed (backend 8080, frontend 3001).

### Commands

```bash
# Run all E2E tests (short intervals)
npm run test:e2e

# Run with long intervals (watch in browser)
E2E_INTERVAL=long npx playwright test

# Run one file
npx playwright test 01-login-single-user-headcount.spec.ts

# Run only talks-matching split (faster triage)
npx playwright test tests/e2e/talks-matching

# UI mode
npx playwright test --ui

# Debug
npx playwright test --debug
```

### Report

```bash
npx playwright show-report
```

## Helpers

- `helpers/clear-database.ts` — clear Gun disk + in-memory before/after suites
- `helpers/timing.ts` — `wait(shortMs, longMs)`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `delay`
- `helpers/browser-window.ts` — viewport / ensure window fits

## Known limitations

- **Gun.js sync**: Tests use configurable waits; long mode gives more time for propagation.
- **Single worker**: Tests run sequentially (`workers: 1`) to avoid races with shared Gun state.
- **Load state**: Tests use `waitForLoadState('load')` (not `networkidle`) so Gun/WebSocket activity doesn't block. **afterLoad/afterSync** are required so Gun can connect and propagate (e.g. headcount); shortening them too much causes headcount stuck at 1 and flaky tests.
- **Incoming talk rows**: `openIncomingTalkModal` / `openIncomingTalkModalWithAutoAnswers` go to the Talks tab first, then poll up to ~2 minutes (with chatrooms ↔ talks tab switches) until the IN row appears. If many tests fail on “incoming row not visible”, stop other processes using ports 8080/3001 and run `npm run test:e2e` again so Playwright can start fresh web + Gun servers.
- **Full suite vs single file**: Files run in directory order (`01`…`08`, then `talks-matching/…`). Multi-browser talks tests run **last**, when webpack + Gun have been under load the longest, so Gun sync and modal opens can take longer than in an isolated run. Mitigations: use `E2E_INTERVAL=long npm run test:e2e` for more `afterSync` slack; avoid a **manually started** dev server on 8080/3001 while Playwright runs (`reuseExistingServer: true` will attach to it and share stale state); close heavy apps to free CPU; or run `npx playwright test tests/e2e/talks-matching` first as a smoke check, then the full command.

### Why `talks-matching/04` and `05` often pass alone but flake at the end of `npm run test:e2e`

**This is usually not “cleanup failed.”** Evidence:

- Each talks-matching file calls `clearGunDatabases()` in `beforeAll` / `beforeEach` / `afterAll`, closes browsers, and hits `POST /api/test/clear-database` so the server’s in-memory Gun graph is reset. If cleanup were systematically broken, **running 04/05 first** would still see leftover state from a **previous manual run** on disk — yet your reorder fix works **within the same** full suite, without changing cleanup code.
- What changes with order is **how warm** the process is: after many tests, the **webpack dev client**, **Node (Gun + Express)**, and **three headed Chromiums** in the talks-matching specs have been busy longer. Gun replication, `getTalkWithRetry`, and incoming-list HTTP paths are **latency-sensitive**; under load they exceed the same timeouts that pass on a **cold** run.

**Cleanup caveats (secondary):** `clearGunDatabases` clears the server in-memory graph via `POST /api/test/clear-database` and browser IndexedDB only. E2E runs with `E2E_GUN_MEMORY_ONLY=1`, so no shared disk cleanup occurs in this path. The dominant source of late-suite failures remains **timing/load**, not stale disk rows.

**Practical mitigations:** Run the heaviest talks-matching specs **early** (rename files so they sort first, or run `npx playwright test tests/e2e/talks-matching/04 …` before the rest), use `E2E_INTERVAL=long` for the full suite, or restart the dev server between CI jobs if you need a perfectly cold Gun server.

### `08-super-user-*` before `talks-matching/03` (timeouts / CDP “guid … not bound”)

Each `08-*` file has **one** test but still uses two `chromium.launch` instances in `beforeAll`. **`afterEach`** closes both contexts after the test so stray contexts do not pile up. **`afterAll`** waits **2s** after `browser.close()` so the OS can reap processes before the next spec (e.g. talks-matching with three Chromes).


npx playwright test tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts --debug
PWDEBUG=1 npx playwright test tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts
PW_SLOW_MO=1000 npx playwright test tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts
PW_SLOW_MO=1000 npm run test:e2e -- tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts
