import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterNav, afterAction, afterSync, headless } from './helpers/timing';
import { webAppURLStableChatroom } from './helpers/ports';
import { attachE2eBrowserTabLabel } from './helpers/e2e-tab-title';

async function bootstrapCompactUser(
  browser: Browser,
  label: string,
  stageName: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 640, height: 540 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => console.log(`[${label}]:`, m.text()));
  await injectIdbClear(page);
  await page.goto(webAppURLStableChatroom());
  await page.waitForLoadState('load');
  await ensureWindowFitsViewport(page, 640, 540);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await page.waitForSelector('#settings-stage-name-input');
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await page.click('.chatroom-item[data-chatroom-id="global"]');
  await afterSync();
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

test.describe('Chatroom UX: member list scroll and unified broadcast bar', () => {
  let browser: Browser;
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,900', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    for (const page of pages) await page.close().catch(() => {});
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunDatabases();
  });

  test('chatroom detail keeps one broadcast action and the member list can scroll', async () => {
    const owner = await bootstrapCompactUser(browser, 'Owner', 'Owner');
    contexts.push(owner.context);
    pages.push(owner.page);

    for (let i = 1; i <= 7; i += 1) {
      const user = await bootstrapCompactUser(browser, `Peer${i}`, `Peer${i}`);
      contexts.push(user.context);
      pages.push(user.page);
    }

    await expect(owner.page.locator('.chatroom-member-item')).toHaveCount(7, { timeout: 30000 });
    await expect(owner.page.locator('#broadcast-talk-btn')).toHaveCount(1);
    await expect(owner.page.locator('#chatroom-action-bar')).toContainText('Broadcast');
    await expect(owner.page.getByText('Broadcast talk to everyone here')).toHaveCount(0);

    const scrollState = await owner.page.locator('#chatroom-members-list').evaluate((el) => {
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
