import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Talks rows have no buttons (owner design 2026-10-24): a tap acts on a tag, a long-press selects a
 * row for the AppBar's ✕ Pass · ♡ Like · 📌 Pin. These helpers drive that like a person would.
 */
export async function longPressTalkRow(page: Page, row: Locator): Promise<void> {
  const box = await row.boundingBox();
  if (!box) throw new Error('row is not visible for a long-press');
  // Away from the left edge: a card keeps its type badge (which takes no gestures) there.
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(row).toHaveClass(/is-selected/);
}

export async function talkToolbarAction(page: Page, row: Locator, action: 'pass' | 'like' | 'pin'): Promise<void> {
  await longPressTalkRow(page, row);
  // On a Talk card the long-press also opens its details popup; closing it keeps the selection.
  const closeDetails = page.locator('#close-item-details-popup');
  if (await closeDetails.isVisible().catch(() => false)) await closeDetails.click();
  const button = page.locator(`#talks-tap-${action}-btn`);
  await expect(button).toBeEnabled();
  await button.click();
}
