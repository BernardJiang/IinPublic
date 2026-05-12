# Testing Benchmarks — Flake Investigation

Last updated: 2026-05-12

## Flaky Test: `12-two-responders-partial-match`

Root cause analysis for historical flakiness observed at W4+ during full suite runs.

### Isolation Benchmark (Single Test Only) — 2026-05-02

When run in isolation, the test passes at **every** worker count. The test itself is **not inherently flaky**:

| Workers | Duration | Pass | Fail | Exit |
|---------|----------|------|------|------|
| W1      | 47s      | 1    | 0    | 0    |
| W2      | 47s      | 1    | 0    | 0    |
| W3      | 49s      | 1    | 0    | 0    |
| W4      | 50s      | 1    | 0    | 0    |
| W5      | 52s      | 1    | 0    | 0    |
| W6      | 54s      | 1    | 0    | 0    |
| W7      | 58s      | 1    | 0    | 0    |
| W8      | 59s      | 1    | 0    | 0    |

### Full Suite Run (talks-matching/, 13 files) — 2026-05-02

When run as part of `tests/e2e/talks-matching/` at W4, the test fails (1 failed, 12 passed in 5.8m). **This reproduces the historical flakiness.**

### Root Cause

**Cross-test interference via shared disk paths in `clearGunDatabases()`.**

The issue is in `tests/e2e/helpers/clear-database.ts` (lines 17-42):

```typescript
// Shared disk paths — NOT per-worker isolated
const radataPath = path.join(__dirname, '../../../radata');
const serverDataPath = path.join(__dirname, '../../../data1.json');
const altServerDataPath = path.join(__dirname, '../../../data.json');
```

When multiple workers run concurrently:
1. Each worker correctly starts its own Gun server on `8080+N` with `E2E_GUN_MEMORY_ONLY=1`
2. Each worker correctly clears its own **in-memory** database via `POST /api/test/clear-database`
3. **BUT** every worker also deletes shared disk paths (`radata/`, `data1.json`, `data.json`)
4. When Worker 0 deletes `radata/` at the end of a test, Worker 1 may be in the middle of syncing — Gun's disk persistence layer tears down mid-write
5. This causes Gun graph corruption for subsequent tests running on any worker

The test is most vulnerable because:
- It launches **3 separate browser instances** with heavy Gun sync (Tom, Jerry, Bob)
- It has 30s polling timeouts for conversation badges and visibility
- If Gun data gets wiped mid-sync, the conversation never appears → timeout failure at line 157

### Historical Data (Previous Benchmarks)

For reference, earlier benchmarks showed:
- W1 (clean): 4.75m / 32 pass
- W4 (clean): 2.6m / 28 pass + 4 fail (12.5%)
- Noisy runs had even worse results due to port conflicts + disk races

### Fix Applied: Remove Disk Clears and Synchronize HTTP Clear

`tests/e2e/helpers/clear-database.ts` now:

- polls `GET /health` before clearing,
- retries `POST /api/test/clear-database` with exponential backoff,
- relies on `E2E_GUN_MEMORY_ONLY=1` server state instead of deleting shared disk paths,
- waits a short settle window after a successful clear, and
- still clears browser IndexedDB through `injectIdbClear()`.

### Action Items

- [x] Investigate root cause of `12-two-responders-partial-match` flakiness
  - **DIAGNOSED: Cross-test disk race in clearGunDatabases(), not inherent test flakiness**
- [x] Remove shared disk deletes from `clearGunDatabases()` (keep only in-memory clear via `/api/test/clear-database`)
  - Servers run with `E2E_GUN_MEMORY_ONLY=1` so disk persistence is optional
  - If disk persistence is needed, switch to per-worker paths (`radata_w{N}/`, `data1_w{N}.json`)
- [x] Add retry or explicit synchronization for tests that depend on Gun graph stability after clear
- [x] Revalidate high-worker E2E after the cleanup path changed
  - `PW_WORKERS=10 npm run test:e2e` passed with 58 tests on 2026-05-12.
