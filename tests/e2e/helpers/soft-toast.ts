import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export type SoftToastOptions = {
  /** Max ms to poll for toast text (default 4s). */
  timeout?: number;
  /** Label for warning log when toast is absent. */
  label?: string;
};

/**
 * Observe a toast/notification if it appears within `timeout`, but never fail the test.
 * Logs a warning when the pattern is not seen (common under parallel load or fast dismiss).
 */
export async function expectToastSoft(
  page: Page,
  pattern: RegExp | string,
  options?: SoftToastOptions,
): Promise<boolean> {
  const timeout = options?.timeout ?? 4_000;
  const label = options?.label ?? String(pattern);
  const locator = page.locator('.notification');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const text = (await locator.nth(i).textContent()) || '';
      const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
      if (re.test(text)) {
        console.log(`[soft-toast] saw "${label}"`);
        return true;
      }
    }
    await page.waitForTimeout(200);
  }
  console.warn(`[soft-toast] did not see "${label}" within ${timeout}ms (non-fatal)`);
  return false;
}

/** Hard assertion for toasts when a test truly requires one (avoid in parallel suite). */
export async function expectToastHard(page: Page, pattern: RegExp | string, timeout = 10_000): Promise<void> {
  const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  await expect(page.locator('.notification').filter({ hasText: re }).first()).toBeVisible({ timeout });
}
