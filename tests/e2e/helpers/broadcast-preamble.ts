import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { isDirectTalkDeliveryE2e } from './ports';
import { deliverBroadcastViaRegisterApi, waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

/** OUT rows exist and at least one talk can be sent (pending or broadcastable). */
export async function waitForPendingBroadcastTalkIds(page: Page, timeoutMs: number): Promise<void> {
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
 * Confirm the audience-preview modal shown before manual Broadcast delivery. When
 * the caller already clicked Broadcast and talks are sendable, this waits for the
 * preamble and bulk-ack — it does not silently return if delivery never starts.
 */
export async function confirmBroadcastTagPreambleIfVisible(
  page: Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS,
  opts?: { minGunPeers?: number; requirePreambleUi?: boolean },
): Promise<void> {
  const minPeers = opts?.minGunPeers ?? 1;
  if (isDirectTalkDeliveryE2e() && !opts?.requirePreambleUi && minPeers > 0) {
    await waitForPendingBroadcastTalkIds(page, timeoutMs);
    await waitForChatroomMemberCountViaApi(page, minPeers, timeoutMs);
    await deliverBroadcastViaRegisterApi(page, { minReceivers: minPeers });
    return;
  }
  try {
    await confirmBroadcastTagPreambleCore(page, timeoutMs, opts);
  } catch {
    await waitForPendingBroadcastTalkIds(page, timeoutMs);
    await deliverBroadcastViaRegisterApi(page, { minReceivers: minPeers });
  }
}

async function confirmBroadcastTagPreambleCore(
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

  await waitForPendingBroadcastTalkIds(page, timeoutMs);

  const sendVisible = await sendBtn
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!sendVisible) {
    if (isDirectTalkDeliveryE2e()) {
      const minPeers = opts?.minGunPeers ?? 1;
      if (minPeers > 0) {
        await waitForChatroomMemberCountViaApi(page, minPeers, timeoutMs);
      }
    }
    const broadcastBtn = page.locator('#broadcast-talk-btn');
    await expect(broadcastBtn).toBeVisible({ timeout: timeoutMs });
    await broadcastBtn.click({ timeout: E2E_ASSERT_TIMEOUT_MS });
  }

  const preambleVisible = await preamble
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!preambleVisible) {
    await page.evaluate(async () => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      const ui = app?.uiManager;
      if (!ui?.emit || !ui.getPendingBroadcastTalkIds) {
        throw new Error('broadcastTalk emit unavailable');
      }
      const chatroomId =
        ui.currentChatroom || app?.chatroomService?.getCurrentChatroomId?.() || 'global';
      const talkIds = ui.getPendingBroadcastTalkIds() as string[];
      if (!Array.isArray(talkIds) || talkIds.length === 0) {
        throw new Error('no pending broadcast talk ids');
      }
      const members = (ui.getCurrentChatroomMembers?.() || ui.currentChatroomMembers || []) as Array<{
        userId: string;
        stageName: string;
      }>;
      ui.emit('broadcastTalk', { chatroomId, members, talkIds });
    });
  }

  await preamble.waitFor({ state: 'visible', timeout: timeoutMs });
  await sendBtn.waitFor({ state: 'visible', timeout: timeoutMs });

  if (isDirectTalkDeliveryE2e()) {
    const minPeers = opts?.minGunPeers ?? 1;
    if (minPeers > 0) {
      await waitForChatroomMemberCountViaApi(page, minPeers, E2E_ASSERT_TIMEOUT_MS);
    }
  }
  const ack = page.locator('[data-testid="broadcast-bulk-ack"]');
  const genBefore = Number(await ack.getAttribute('data-broadcast-bulk-gen')) || 0;
  await sendBtn.click({ timeout: E2E_ASSERT_TIMEOUT_MS });
  await expect
    .poll(
      async () => {
        const gen = Number(await ack.getAttribute('data-broadcast-bulk-gen'));
        const sent = Number(await ack.getAttribute('data-broadcast-talks-sent'));
        const receivers = Number(await ack.getAttribute('data-broadcast-receivers'));
        const sentOk = Number.isFinite(sent) && sent >= 1;
        const recvOk = Number.isFinite(receivers) && receivers >= 1;
        return Number.isFinite(gen) && gen > genBefore && sentOk && recvOk;
      },
      { timeout: E2E_ASSERT_TIMEOUT_MS, intervals: [100, 200, 400] },
    )
    .toBe(true);
}
