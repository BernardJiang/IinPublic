import type { Page } from '@playwright/test';

/**
 * Opens the Talk editor from whichever tab the test is on. The AppBar shows "Create talk" only on
 * the Talks tab (d3cecef7); flows that create a Talk mid-way through a Chatrooms journey press it
 * without leaving their tab, so a later Chatrooms action (Broadcast, member list) still applies.
 * The Talks-tab path itself is covered by stage1/50-appbar-layout.
 */
export async function openTalkEditor(page: Page, options?: { timeout?: number }): Promise<void> {
  const button = page.locator('#create-talk-btn');
  if (await button.isVisible().catch(() => false)) {
    await button.click(options?.timeout !== undefined ? { timeout: options.timeout } : {});
    return;
  }
  await button.waitFor({ state: 'attached', ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}) });
  await button.evaluate((el) => (el as HTMLButtonElement).click());
}
