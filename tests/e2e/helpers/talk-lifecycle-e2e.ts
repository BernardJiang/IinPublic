import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { fetchUserConversations } from './conversation-e2e';

/** Poll pair-local conversations then inject into browser state when needed. */
export async function waitForServerConversations(page: Page, expectedCount: number): Promise<void> {
  const userId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
  if (!userId) throw new Error('waitForServerConversations: could not get userId from page');

  let convs: unknown[] = [];
  await expect
    .poll(
      async () => {
        convs = await fetchUserConversations(page, userId);
        return convs.length;
      },
      { timeout: 60_000, message: `Expected ${expectedCount} conversation(s) for user ${userId}` },
    )
    .toBeGreaterThanOrEqual(expectedCount);

  await page.evaluate((conversations) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    for (const conv of conversations as any[]) {
      app?.uiManager?.addNewConversation?.(conv);
    }
  }, convs);
}
