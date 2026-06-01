import type { Page } from '@playwright/test';
import { isDirectTalkDeliveryE2e } from './ports';
import { waitForDistinctGunPeersExcludingSelf } from './talk-demo-ui';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

/**
 * Confirm the audience-preview modal shown before manual Broadcast delivery. It
 * remains tolerant of editor/no-modal branches when there is nothing sendable.
 */
export async function confirmBroadcastTagPreambleIfVisible(
  page: Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS,
  opts?: { minGunPeers?: number },
): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  const editor = page.locator('#talk-editor-modal');
  const sendBtn = page.locator('[data-testid="broadcast-preamble-send"]');

  // A just-submitted editor can overlap the async audience lookup briefly. If
  // Broadcast opened a new editor because there are no sendable talks, it
  // remains visible and there is intentionally nothing to confirm.
  if (await editor.isVisible().catch(() => false)) {
    await editor.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    if (await editor.isVisible().catch(() => false)) return;
  }

  const ready = await sendBtn.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false);
  if (!ready) return;

  if (!(await preamble.isVisible().catch(() => false))) return;
  if (isDirectTalkDeliveryE2e()) {
    const minPeers = opts?.minGunPeers ?? 1;
    if (minPeers > 0) {
      await waitForDistinctGunPeersExcludingSelf(page, minPeers, E2E_ASSERT_TIMEOUT_MS);
    }
  }
  await sendBtn.click({ timeout: 8_000 });
}
