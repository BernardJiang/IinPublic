import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Contacts and Me rows have no buttons (owner design 2026-10-25, `list-row-selection.ts`): a
 * long-press selects a row and the AppBar's actions act on it. These helpers drive that like a
 * person would.
 */
export async function longPressRow(page: Page, row: Locator): Promise<void> {
  // A list redraws when late data lands (a seeded or synced row), replacing the row under the
  // press; a person would simply press again, so this does too.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      if (!box) throw new Error('row is not visible for a long-press');
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      await expect(row).toHaveClass(/is-selected/, { timeout: attempt < 3 ? 2_000 : 5_000 });
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.mouse.up().catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }
}

/** Clicks an AppBar action, from the ⋯ overflow panel when the bar has no room for it. */
export async function clickAppBarAction(page: Page, buttonId: string): Promise<void> {
  const button = page.locator(`#${buttonId}`);
  if (!(await button.isVisible())) await page.locator('#app-bar-overflow-btn').click();
  await expect(button).toBeEnabled();
  await button.click();
}

export async function rowToolbarAction(page: Page, row: Locator, buttonId: string): Promise<void> {
  await longPressRow(page, row);
  await clickAppBarAction(page, buttonId);
}
