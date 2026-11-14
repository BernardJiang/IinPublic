import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { isDirectTalkDeliveryE2e } from './ports';
import { deliverBroadcastViaAppPath, waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

/**
 * Make my held Talks public: talk exchange is automatic (OPEN-112), so switching a Talk to
 * Broadcast On is the user's only step left. Talks created with `isPublic: false` (or the editor's
 * Public box unchecked) are held until this runs. Expired Talks stay as they are.
 */
export async function publishHeldTalks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ui = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.()?.uiManager;
    if (!ui?.setTalkDisabled || !ui?.getMyTalks) throw new Error('uiManager not ready to publish Talks');
    const mine = ui.getMyTalks() as Record<string, any>;
    const now = Date.now();
    const held = Object.entries(mine)
      .filter(([, talk]) => talk?.disabled && (talk.role === 'created' || talk.role === 'copied'))
      .filter(([, talk]) => {
        const raw = talk.expiresAt ?? talk.fullTalk?.expiresAt;
        const at = typeof raw === 'number' ? raw : raw ? new Date(raw).getTime() : NaN;
        return !(Number.isFinite(at) && now > at);
      })
      .map(([id]) => id);
    for (const id of held) ui.setTalkDisabled(id, false);
    return held;
  });
}

/**
 * OUT rows exist and at least one talk can be sent (pending or broadcastable). Held Talks are made
 * public first: that is the user's only step now that exchange is automatic (OPEN-112).
 */
export async function waitForPendingBroadcastTalkIds(page: Page, timeoutMs: number): Promise<void> {
  await publishHeldTalks(page).catch(() => []);
  await expect
    .poll(
      async () => {
        const n = await page.evaluate(() => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          const ui = app?.uiManager;
          const pending = ui?.getPendingBroadcastTalkIds?.() as string[] | undefined;
          if (Array.isArray(pending) && pending.length > 0) return 'ok';
          const fallback = ui?.getBroadcastableTalkIds?.() as string[] | undefined;
          if (Array.isArray(fallback) && fallback.length > 0) return 'ok';
          return 'broadcastable=0';
        });
        return n;
      },
      { timeout: timeoutMs, intervals: [200, 400, 800] },
    )
    .toBe('ok');
}

/**
 * Deliver my public Talks to the current list now. Exchange is automatic (OPEN-112) and there is no
 * Broadcast button or audience dialog any more; this drives the same delivery path the automatic
 * exchange uses, so a spec knows when its Talks have gone out. (Name kept for the many callers.)
 */
export async function confirmBroadcastTagPreambleIfVisible(
  page: Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS,
  opts?: { minGunPeers?: number; requirePreambleUi?: boolean },
): Promise<void> {
  const minPeers = opts?.minGunPeers ?? 1;
  await waitForPendingBroadcastTalkIds(page, timeoutMs);
  if (minPeers > 0) await waitForChatroomMemberCountViaApi(page, minPeers, timeoutMs);
  await deliverBroadcastViaAppPath(page, { minReceivers: minPeers });
}
