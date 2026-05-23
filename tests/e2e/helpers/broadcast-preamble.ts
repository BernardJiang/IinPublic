import type { Page } from '@playwright/test';

/**
 * Confirm the audience-preview modal shown before manual Broadcast delivery. It
 * remains tolerant of editor/no-modal branches when there is nothing sendable.
 */
export async function confirmBroadcastTagPreambleIfVisible(page: Page): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  const editor = page.locator('#talk-editor-modal');

  // A just-submitted editor can overlap the async audience lookup briefly. If
  // Broadcast opened a new editor because there are no sendable talks, it
  // remains visible and there is intentionally nothing to confirm.
  if (await editor.isVisible().catch(() => false)) {
    await editor.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    if (await editor.isVisible().catch(() => false)) return;
  }
  const ready = await preamble.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
  if (!ready) return;

  await preamble.locator('.broadcast-chip').first().click();
  await page.locator('[data-testid="broadcast-preamble-send"]').click();
}
