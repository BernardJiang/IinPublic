import { expect, type Page } from '@playwright/test';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

/**
 * Wait until the app records a completed bulk broadcast on `#broadcast-bulk-ack`.
 * Prefer this over matching success toast text: toasts auto-dismiss after ~3s while
 * direct mesh delivery or legacy server registration can still be running.
 */
export async function waitForBroadcastBulkAck(
  page: Page,
  expected: { talksSent: number; receivers: number },
  timeout = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  const loc = page.locator('[data-testid="broadcast-bulk-ack"]');
  await expect
    .poll(
      async () => {
        const sent = await loc.getAttribute('data-broadcast-talks-sent');
        const recv = await loc.getAttribute('data-broadcast-receivers');
        const sentNum = Number(sent);
        const recvNum = Number(recv);
        if (
          Number.isFinite(sentNum) &&
          Number.isFinite(recvNum) &&
          sentNum >= expected.talksSent &&
          recvNum >= expected.receivers
        ) {
          return 'ok';
        }
        return `${sent ?? '?'}/${recv ?? '?'}`;
      },
      {
        timeout,
        intervals: [200, 400, 800],
        message: `broadcast-bulk-ack: expect at least talksSent=${expected.talksSent} receivers=${expected.receivers}`,
      },
    )
    .toBe('ok');
}
