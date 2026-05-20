import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

test.describe('P2P roadmap P1 — star baseline storage visibility', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('debug endpoint and Settings inspector keep P2P disabled in star mode', async ({ request }) => {
    const endpoint = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(endpoint.ok()).toBeTruthy();
    const payload = await endpoint.json();

    expect(payload.mode).toBe('star');
    expect(payload.topology).toEqual({
      browser: 'Gun client',
      hub: 'Node Gun hub',
      routes: 'HTTP/Socket API',
    });
    expect(payload.flags).toEqual({
      starServerPersistence: 'durable',
      p2pNodeEnabled: false,
      p2pDirectChatEnabled: false,
    });
    expect(payload.pathClassifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', category: 'durable-public' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', category: 'relay-only' }),
        expect.objectContaining({ path: 'conversations/{conversationId}', category: 'removable-legacy' }),
      ]),
    );

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#settings-storage-inspector')).toBeVisible();
    await expect(p.locator('#storage-inspector-flags')).toContainText('Mode');
    await expect(p.locator('#storage-inspector-flags')).toContainText('star');
    await expect(p.locator('#storage-inspector-flags')).toContainText('Local node');
    await expect(p.locator('#storage-inspector-flags')).toContainText('disabled');
    await expect(p.locator('#storage-inspector-flags')).toContainText('Direct chat');
    await expect(p.locator('#storage-inspector-server')).toContainText('chatrooms/{chatroomId}');
    await expect(p.locator('#storage-inspector-local')).toContainText('iinpublic_user_id');
  });
});
