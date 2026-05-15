import type { Page } from '@playwright/test';

/**
 * Backward-compatible helper for older broadcast flows. Current Broadcast sends
 * directly with no preamble; if an older build still shows the modal, confirm it.
 */
export async function confirmBroadcastTagPreambleIfVisible(page: Page): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  const editor = page.locator('#talk-editor-modal');

  const winner = await Promise.race([
    preamble.waitFor({ state: 'visible', timeout: 750 }).then(() => 'preamble' as const).catch(() => null),
    editor.waitFor({ state: 'visible', timeout: 750 }).then(() => 'editor' as const).catch(() => null),
  ]);

  if (winner !== 'preamble') return;

  await preamble.locator('.broadcast-chip').first().click();
  await page.locator('[data-testid="broadcast-preamble-send"]').click();
}
