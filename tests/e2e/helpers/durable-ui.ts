import { expect, type Page } from '@playwright/test';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

/** Parse "· 3 matches" from `#status-bar-text`; 0 if no match segment. */
export function parseStatusBarMatchCount(text: string): number {
  const m = text.match(/·\s*(\d+)\s+match(?:es)?/i);
  return m ? parseInt(m[1], 10) : 0;
}

/** Wait until the status bar reports at least `min` matches (durable; avoids Match! toasts). */
export async function waitForStatusBarMatchCountAtLeast(
  page: Page,
  min: number,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        parseStatusBarMatchCount((await page.locator('#status-bar-text').textContent()) || ''),
      { timeout, message: `status bar should show ≥ ${min} match(es)` },
    )
    .toBeGreaterThanOrEqual(min);
}

/** Wait until the status bar reports at most `max` matches (0 = no "· N match" segment). */
export async function waitForStatusBarMatchCountAtMost(
  page: Page,
  max: number,
  timeout = 20_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        parseStatusBarMatchCount((await page.locator('#status-bar-text').textContent()) || ''),
      { timeout, message: `status bar should show ≤ ${max} match(es)` },
    )
    .toBeLessThanOrEqual(max);
}

/** Remove `.notification` nodes so they do not block clicks (not an assertion). */
export async function dismissNotificationOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.notification').forEach((el) => el.remove());
  });
}

/** Poll the receiver-local exchange ledger until a title appears. */
export async function waitForPeerHistoryTitle(
  page: Page,
  _userId: string,
  peerId: string,
  title: string,
  timeout = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(
      () => page.evaluate((pid) => {
        const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        return Object.values(exchanges)
          .filter((entry: any) => String(entry?.peerId || '') === pid)
          .map((entry: any) => String(entry?.title || ''))
          .filter(Boolean);
      }, peerId).catch(() => []),
      { message: `${title} should be in peer talk history`, timeout, intervals: [200, 500, 1000] },
    )
    .toContain(title);
}

/** Wait until contact detail finished loading (not Loading/Could not load). */
export async function waitForContactDetailReady(page: Page, timeout = E2E_ASSERT_TIMEOUT_MS): Promise<void> {
  await expect
    .poll(
      async () => {
        const matchesText = (await page.locator('#contact-detail-matches').textContent()) || '';
        if (/loading/i.test(matchesText) || /could not load/i.test(matchesText)) return matchesText;
        const hasTalkRow = await page.locator('.contact-talk-item').first().isVisible().catch(() => false);
        const talksText = (await page.locator('#contact-talks-list').textContent()) || '';
        if (hasTalkRow || /no talks/i.test(talksText) || /talk/i.test(matchesText)) return 'ready';
        return matchesText || 'pending';
      },
      { timeout, intervals: [200, 400, 800] },
    )
    .toBe('ready');
}
