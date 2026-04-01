# E2E Test Suite for IinPublic Talk System

## Overview

End-to-end tests for the IinPublic real-time Talk system using Playwright. Tests use **short** intervals by default for fast regression; set **long** intervals when you want to watch the run.

## Test Files (compressed from 16 → 9 + talks-matching split)

| File | Coverage |
|------|----------|
| `01-login-and-headcount.spec.ts` | Single user login/re-login; two users headcount 1→2→1→2 + room nav |
| `02-multi-user-headcount.spec.ts` | Three users: sequential enter, FIFO exit, random re-enter |
| `03-capacity-eviction.spec.ts` | Four users: Global fills, fourth bumps first to North America; persistence |
| `04-profile-edit-stage-name.spec.ts` | New user edits stage name |
| `05-talks-edit.spec.ts` | Create talk, Talks tab, Edit with prefilled data |
| `talks-matching/01-tennis-jerry-match.spec.ts` | Tom creates talk, Jerry answers match |
| `talks-matching/02-two-talks-status-answers.spec.ts` | Two talks, status bar match count, Answers tab |
| `talks-matching/03-chatbot-bot-badge.spec.ts` | Chatbot + `announceTalkToRoom`; bot badge on Bob not Tom |
| `talks-matching/04-ignore-then-change-answer.spec.ts` | Multi-Q flow: mismatch then reopen → match |
| `talks-matching/05-partial-auto-answers.spec.ts` | Flattened context: first talk saves prefs; second talk (new hash) auto-fills Q1–Q2; Jerry answers Q3 only |
| `helpers/talks-matching-browsers.ts`, `helpers/talks-matching-flow.ts` | Shared browser launch + Tom/Jerry/Bob flows |
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


npx playwright test tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts --debug
PWDEBUG=1 npx playwright test tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts
PW_SLOW_MO=1000 npx playwright test tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts
PW_SLOW_MO=1000 npm run test:e2e -- tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts