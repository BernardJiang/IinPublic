import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {maybeClearGunDatabases, injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterAction, afterSync, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';

async function bootstrapCompactUser(
  browser: Browser,
  label: string,
  stageName: string,
  // See bootstrapUser() in talks-matching-flow.ts — same oversubscribed-worker rationale
  // (this spec boots 8 contexts in one worker, sequentially).
  appReadyTimeoutMs?: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 640, height: 540 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  attachFilteredConsoleLog(page, label);
  await injectIdbClear(page);
  await gotoWebApp(page, webAppURLStableChatroom(), appReadyTimeoutMs);
  await ensureWindowFitsViewport(page, 640, 540);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await page.waitForSelector(
    '#settings-stage-name-input',
    appReadyTimeoutMs ? { timeout: appReadyTimeoutMs } : undefined,
  );
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: appReadyTimeoutMs ?? 10_000 },
    )
    .toBe(stageName);
  await page.evaluate(async (name) => {
    const app = (window as any).__iinpublic_app?.getApp?.() as any;
    if (!app?.currentUser?.id || !app?.chatroomService?.switchChatroom) return;
    await app.chatroomService.switchChatroom(app.currentUser.id, 'global', name);
    app.currentChatroomId = 'global';
    app.uiManager?.setCurrentChatroomId?.('global');
  }, stageName);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await page.click('.chatroom-item[data-chatroom-id="global"]');
  await afterSync();
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

/** Wait until Gun lists at least `peerCount` other active members in `chatroomId` (excludes self/support baseline). */
async function waitForGunPeerCountInRoom(page: Page, chatroomId: string, peerCount: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const count = await page.evaluate(async ({ room }) => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          const me = String(app?.currentUser?.id || '').trim();
          const ids: string[] = (await app?.chatroomService?.getActiveMembers(room)) || [];
          return ids.filter((id: string) => id && id !== me && id !== 'iinpublic-root-techsupport').length;
        }, { room: chatroomId });
        return count >= peerCount ? 'ok' : String(count);
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBe('ok');
}

function peerMemberItems(page: Page) {
  return page.locator('.chatroom-member-item[data-stage-name^="Peer"]');
}

test.describe('Chatroom UX: member list scroll and unified broadcast bar', () => {
  let browser: Browser;
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeEach(async () => {
    await maybeClearGunDatabases();
  });

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
    browser = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,900', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    for (const page of pages) await page.close().catch(() => {});
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    await maybeClearGunDatabases();
  });

  test('chatroom detail keeps one broadcast action and the member list can scroll', async () => {
    test.setTimeout(420_000);
    const owner = await bootstrapCompactUser(browser, 'Owner', 'Owner', 30_000);
    contexts.push(owner.context);
    pages.push(owner.page);

    for (let i = 1; i <= 7; i += 1) {
      const user = await bootstrapCompactUser(browser, `Peer${i}`, `Peer${i}`, 30_000);
      contexts.push(user.context);
      pages.push(user.page);
    }

    await afterSync();
    await waitForGunPeerCountInRoom(owner.page, 'global', 7);
    await owner.page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await owner.page.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();

    const peers = peerMemberItems(owner.page);
    await expect(peers).toHaveCount(7, { timeout: 90_000 });
    for (let i = 1; i <= 7; i += 1) {
      await expect(peers.filter({ hasText: `Peer${i}` })).toHaveCount(1);
    }

    await expect(owner.page.locator('#broadcast-talk-btn')).toHaveCount(1);
    await expect(owner.page.locator('#top-header #broadcast-talk-btn')).toBeVisible();
    await expect(owner.page.locator('#broadcast-talk-btn')).toHaveAttribute('title', /Broadcast|OUT list/);
    await expect(owner.page.getByText('Broadcast talk to everyone here')).toHaveCount(0);

    const membersList = owner.page.locator('#chatroom-members-list');
    await expect
      .poll(async () => {
        return membersList.evaluate((el) => {
          const node = el as HTMLElement;
          return node.scrollHeight > node.clientHeight + 1;
        });
      }, { timeout: 30_000 })
      .toBe(true);

    const scrollState = await membersList.evaluate((el) => {
      const node = el as HTMLElement;
      const before = node.scrollTop;
      node.scrollTop = node.scrollHeight;
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        before,
        after: node.scrollTop,
      };
    });

    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    expect(scrollState.after).toBeGreaterThan(scrollState.before);
  });
});
