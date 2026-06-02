import type { Page } from '@playwright/test';
import { afterSync } from './timing';
import { gunBaseURL } from './ports';
import { dismissNotificationOverlays } from './durable-ui';
import { submitTalkEditorAndWaitForOut } from './talk-demo-ui';

/** Clear server-side block edges so prior specs in the same worker cannot poison delivery. */
/** Clear server + client blocks from sender to each receiver before broadcast register. */
export async function unblockSenderFromReceivers(
  page: Page,
  senderId: string,
  receiverIds: string[],
): Promise<void> {
  const base = gunBaseURL();
  const me = String(senderId || '').trim();
  for (const target of receiverIds) {
    const other = String(target || '').trim();
    if (!me || !other || me === other) continue;
    await page.request.delete(`${base}/api/users/${encodeURIComponent(me)}/blocks/${encodeURIComponent(other)}`).catch(() => {});
  }
  await page.evaluate(
    async ({ receiverIds: ids }) => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      if (!app?.currentUser?.id) return;
      const blocked: string[] = app.currentUser.blockedUserIds || [];
      for (const otherId of ids) {
        if (otherId && blocked.includes(otherId)) {
          await app.userService?.unblockUser?.(app.currentUser.id, otherId);
        }
      }
    },
    { receiverIds },
  );
}

export async function ensureNoBlockBetween(
  pageA: Page,
  userIdA: string,
  pageB: Page,
  userIdB: string,
): Promise<void> {
  const base = gunBaseURL();
  for (const [page, blocker, target] of [
    [pageA, userIdA, userIdB],
    [pageB, userIdB, userIdA],
  ] as const) {
    if (!blocker || !target) continue;
    await page.request.delete(`${base}/api/users/${encodeURIComponent(blocker)}/blocks/${encodeURIComponent(target)}`).catch(() => {});
  }
  await pageA.evaluate(
    async ({ otherId }) => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      if (!app?.currentUser?.id || !otherId) return;
      const blocked = app.currentUser.blockedUserIds || [];
      if (blocked.includes(otherId)) {
        await app.userService?.unblockUser?.(app.currentUser.id, otherId);
      }
    },
    { otherId: userIdB },
  );
  await pageB.evaluate(
    async ({ otherId }) => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      if (!app?.currentUser?.id || !otherId) return;
      const blocked = app.currentUser.blockedUserIds || [];
      if (blocked.includes(otherId)) {
        await app.userService?.unblockUser?.(app.currentUser.id, otherId);
      }
    },
    { otherId: userIdA },
  );
  const { expect } = await import('./fixtures');
  await expect
    .poll(
      async () => {
        const res = await pageA.request.get(
          `${base}/api/users/${encodeURIComponent(userIdA)}/block-status/${encodeURIComponent(userIdB)}`,
        );
        if (!res.ok()) return 'http';
        const body = (await res.json()) as { eitherBlocked?: boolean };
        return body.eitherBlocked ? 'blocked' : 'ok';
      },
      { timeout: 10_000, intervals: [100, 200, 400] },
    )
    .toBe('ok');
}

export async function enterGlobalChatroom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('.chatroom-item:has-text("Global")');
  await page.waitForSelector('.chatroom-member-item', { timeout: 15000 });
  await afterSync();
}

export async function createMatchTalk(page: Page, title: string): Promise<void> {
  await dismissNotificationOverlays(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(`Would you like to get coffee together? (${title})`);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, I would.');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No, thanks.');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await submitTalkEditorAndWaitForOut(page, title);
}
