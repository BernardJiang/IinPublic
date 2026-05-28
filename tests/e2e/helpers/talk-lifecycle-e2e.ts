import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { gunBaseURL } from './ports';

/** Poll server conversations then inject into browser (Gun push is flaky under parallel E2E). */
export async function waitForServerConversations(page: Page, expectedCount: number): Promise<void> {
  const userId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
  if (!userId) throw new Error('waitForServerConversations: could not get userId from page');

  const url = `${gunBaseURL()}/api/test/user-conversations/${encodeURIComponent(userId)}`;
  let convs: unknown[] = [];
  await expect
    .poll(
      async () => {
        const res = await page.request.get(url);
        if (!res.ok()) return 0;
        const data = (await res.json()) as { conversations?: unknown[] };
        convs = data.conversations ?? [];
        return convs.length;
      },
      { timeout: 60_000, message: `Expected ${expectedCount} conversation(s) on server for user ${userId}` },
    )
    .toBeGreaterThanOrEqual(expectedCount);

  await page.evaluate((conversations) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    for (const conv of conversations as any[]) {
      app?.uiManager?.addNewConversation?.(conv);
    }
  }, convs);
}
