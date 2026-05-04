# Test 12 Flake — Root Cause Analysis and Fix

**Date:** 2026-05-03
**Test:** `tests/e2e/talks-matching/12-two-responders-partial-match.spec.ts`
**Commit:** `c167494`
**Status:** Fixed (active sync loop in badge polling)

---

## Symptom

Test 12 (`Jerry matches, Bob mismatches → Tom sees exactly 1 match, no Bob conversation`) was flaky when the full talks-matching suite (tests 01–13) ran with multiple workers (≥3).

- **1–2 workers:** ~90% pass rate (mostly passed)
- **3–4 workers:** ~60–75% pass rate (frequent failures)
- **5+ workers:** ~75–90% pass rate (seemingly improved, but for the wrong reason — faster total runtime meant less time for other failures to manifest)

The test would fail with conversation badge count assertions failing — Tom's badge showed 0 or stale values instead of the expected 1.

---

## Root Cause

### The Gun Database Replication Race

The test calls `clearGunDatabases()` in `beforeAll`, which resets the server's Gun graph by setting `gun._.graph = {}`. This wipes the server state, but clients don't immediately see a clean slate — Gun replicates **incrementally**.

Here's the critical timing issue:

1. **Tests 01–11** run before test 12 in the suite, accumulating a large Gun graph with conversations, messages, talk data, users, etc.
2. **Test 12 starts**, `clearGunDatabases()` resets `gun._.graph = {}` on the server.
3. The client (Tom's browser) had previously synced the large pre-existing graph. After the clear, Gun's `.once()` call returns a snapshot — but because Gun replicates incrementally, **the snapshot may be stale or empty** rather than reflecting the post-clear state.
4. Tom creates a new conversation (via the talk matching flow). Other clients respond. But Tom's client needs to pull the updated conversation data through `needConversationSync` → `.once()` from Gun.
5. **The badge reads from localStorage**, which is only updated when the sync handler ingests fresh Gun data. If the initial `.once()` after the clear misses the new conversation data, the badge never updates to reflect reality.

### Why the Previous Fix Wasn't Enough

A prior fix (commit `2c58744`) added two explicit `requestConversationSync(pageTom)` calls before the badge check. But `waitForConversationBadgeCount` itself was still just **passively reading the DOM** for 30 seconds:

```typescript
// OLD — passive polling, no active sync
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const text = await badge.textContent();
  const count = Number.parseInt(text, 10);
  if (count === expectedCount) return;
  await afterSync();  // just wait, no data pull
}
```

The two syncs before the polling window helped, but if Gun hadn't replicated the data by then, the subsequent 30 seconds of DOM polling accomplished nothing — the badge stayed stale because no new Gun sync was triggered.

### Why More Workers Made It Worse

More workers meant:
- **Concurrent database clears** across test runs, causing Gun replication conflicts and longer convergence times
- **Larger accumulated graph** from parallel test execution, meaning each `.once()` snapshot had more data to process and was more likely to miss newly-created entities
- **Reduced time for replication** between tests due to faster overall suite execution

---

## The Fix

**Commit:** `c1674942aaad`

### Changed `waitForConversationBadgeCount` from passive polling to active sync loop:

```typescript
// NEW — active sync on every iteration
const deadline = Date.now() + 45_000;
while (Date.now() < deadline) {
  // Actively pull the latest conversations from Gun
  await requestConversationSync(page);
  // Give Gun time to replicate the snapshot response
  await afterSync();

  const badge = page.locator('.nav-btn[data-view="me"] .notification-badge');
  try {
    const text = await badge.textContent();
    const count = Number.parseInt(String(text || '0').trim(), 10) || 0;
    if (count === expectedCount) return;
  } catch {
    // Badge not yet rendered — count stays 0
  }
  // Wait between sync + read cycles
  await afterSync();
}
throw new Error(`Me badge did not converge to ${expectedCount} within 45 s`);
```

### Key differences:

| Before | After |
|--------|-------|
| 30s timeout | 45s timeout (gives Gun more time to replicate large graphs) |
| No sync during polling loop | `requestConversationSync()` called every iteration |
| Only read DOM badge | Actively pull Gun data → wait → read badge → repeat |
| Failed if initial sync missed data | Keeps trying until badge converges (or 45s timeout) |

### How `requestConversationSync` works:

```typescript
async function requestConversationSync(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit?.('needConversationSync');
  });
}
```

This dispatches the `needConversationSync` event in the app context, which triggers:
1. A fresh `.once()` call on Gun to pull the current conversation state
2. Processing of the snapshot response
3. Update of localStorage with the latest conversation data
4. UI re-render (including badge count updates)

By calling this every 1.2 seconds (via `afterSync()`), the test keeps "tugging" on Gun until the replicated data converges and the badge reflects the correct count.

### Summary

The fundamental issue was treating localStorage as immediately authoritative after a database clear. Gun's incremental replication means localStorage can stay stale until a new sync cycle completes. The fix makes the test helper actively participate in that sync cycle rather than waiting passively for it to happen.
