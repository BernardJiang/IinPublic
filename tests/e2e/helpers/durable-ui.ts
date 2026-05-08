import { expect, type Page } from '@playwright/test';

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
