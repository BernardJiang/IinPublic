import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { afterNav } from './timing';

/**
 * Opens the Chatrooms list even when the product correctly restores a previously opened room.
 * Tests that intend to choose a room must explicitly leave that restored detail first.
 */
export async function ensureChatroomList(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document.querySelector('[data-testid="broadcast-preamble-modal"]')?.remove();
    })
    .catch(() => {});

  const chatroomsTab = page.locator('.nav-btn[data-view="chatrooms"]');
  if (!(await chatroomsTab.evaluate((element) => element.classList.contains('active')).catch(() => false))) {
    await chatroomsTab.click();
    await afterNav();
  }

  const list = page.locator('#chatroom-list-container');
  if (!(await list.isVisible().catch(() => false))) {
    await page.locator('#back-to-chatrooms').click();
  }
  await expect(list).toBeVisible();
}
