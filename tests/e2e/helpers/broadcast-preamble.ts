import type { Page } from '@playwright/test';
import { afterAction } from './timing';

/**
 * After clicking Broadcast:
 * - If there is at least one OUT talk, the preamble modal (tags + region) appears — we pick one chip and confirm.
 * - If there are no broadcastable talks, the app opens `#talk-editor-modal` instead — we do nothing here.
 *
 * Uses Promise.race so either path settles without a 25s deadlock.
 */
export async function confirmBroadcastTagPreambleIfVisible(
  page: Page,
  options?: { audienceScope?: 'room' | 'subtree' },
): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  const editor = page.locator('#talk-editor-modal');

  const winner = await Promise.race([
    preamble.waitFor({ state: 'visible', timeout: 25_000 }).then(() => 'preamble' as const),
    editor.waitFor({ state: 'visible', timeout: 25_000 }).then(() => 'editor' as const),
  ]);

  if (winner === 'editor') return;

  if (options?.audienceScope === 'subtree') {
    await preamble.locator('input[name="broadcast-audience-scope"][value="subtree"]').check();
    await afterAction();
  }

  await preamble.locator('.broadcast-chip').first().click();
  await page.locator('[data-testid="broadcast-preamble-send"]').click();
}
