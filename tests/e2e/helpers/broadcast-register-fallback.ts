import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { gunBaseURL } from './ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../src/shared/techsupport';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

async function fetchMembersFromNode(roomId: string): Promise<Array<{ userId?: string }> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const res = await fetch(`${gunBaseURL()}/api/chatrooms/${encodeURIComponent(roomId)}/members`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    return Array.isArray(rows) ? (rows as Array<{ userId?: string }>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Gun members API — peers visible before register-receivers. */
export async function waitForChatroomMemberCountViaApi(
  page: Page,
  minPeersExcludingSelf: number,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  const me = await page.evaluate(() =>
    String(
      (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } })
        .__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    ),
  );
  const roomId = await page.evaluate(() =>
    String(
      (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { chatroomService?: { getCurrentChatroomId: () => string } } };
        }
      ).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.() || 'global',
    ),
  );
  await expect
    .poll(
      async () => {
        const rows = await fetchMembersFromNode(roomId);
        const count = Array.isArray(rows)
          ? rows.filter((r) => r.userId && r.userId !== me && r.userId !== TECHSUPPORT_ROOT_USER_ID).length
          : 0;
        if (count >= minPeersExcludingSelf) return 'ok';
        const localCount = await page.evaluate(async ({ room, self, techSupportId }) => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          const ids: string[] = (await app?.chatroomService?.getActiveMembers?.(room)) || [];
          return ids.filter((id: string) => id && id !== self && id !== techSupportId).length;
        }, { room: roomId, self: me, techSupportId: TECHSUPPORT_ROOT_USER_ID });
        return localCount >= minPeersExcludingSelf ? 'ok' : String(Math.max(count, localCount));
      },
      { timeout: timeoutMs, intervals: [100, 200, 400] },
    )
    .toBe('ok');
}

/** Invoke the app broadcast path directly when the audience-preview UI does not open in time. */
export async function deliverBroadcastViaAppPath(
  page: Page,
  opts?: { minReceivers?: number },
): Promise<{ talksSent: number; receivers: number }> {
  const minReceivers = opts?.minReceivers ?? 1;
  return page.evaluate(
    async ({ minRecv }) => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      if (!app?.deliverPendingBroadcastTalksForE2e) {
        throw new Error('deliverPendingBroadcastTalksForE2e unavailable');
      }
      const timeout = new Promise<{ talksSent: number; receivers: number }>((_, reject) => {
        window.setTimeout(() => reject(new Error('deliverPendingBroadcastTalksForE2e timed out')), 45_000);
      });
      return Promise.race([
        app.deliverPendingBroadcastTalksForE2e(minRecv, { skipDeliveryAcks: true }),
        timeout,
      ]);
    },
    { minRecv: minReceivers },
  );
}

/** @deprecated use deliverBroadcastViaAppPath. */
export const deliverBroadcastViaRegisterApi = deliverBroadcastViaAppPath;
