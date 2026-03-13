# E2E Test Suite for IinPublic Talk System

## Overview

End-to-end tests for the IinPublic real-time Talk system using Playwright. Tests use **short** intervals by default for fast regression; set **long** intervals when you want to watch the run.

## Test Files (compressed from 16 → 9)

| File | Coverage |
|------|----------|
| `01-login-and-headcount.spec.ts` | Single user login/re-login; two users headcount 1→2→1→2 + room nav |
| `02-multi-user-headcount.spec.ts` | Three users: sequential enter, FIFO exit, random re-enter |
| `03-capacity-eviction.spec.ts` | Four users: Global fills, fourth bumps first to North America; persistence |
| `04-profile-edit-stage-name.spec.ts` | New user edits stage name |
| `05-talks-edit.spec.ts` | Create talk, Talks tab, Edit with prefilled data |
| `05-talks-matching.spec.ts` | Tennis match; two talks + status bar + Answer tab; chatbot + bot icon; ignore then change answer |
| `06-contacts-tab.spec.ts` | Contacts list, click contact → matching talks |
| `07-tags-checkbox.spec.ts` | Tag create, checkbox match/ignore |
| `08-super-user-techsupport.spec.ts` | 10 tags + 10 talks, Tom answers all; copy-talk broadcast toggle + delete |

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
npx playwright test 01-login-and-headcount.spec.ts

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
