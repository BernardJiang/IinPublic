import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

const P2P_DIRECT_ENABLED = true; // Direct P2P is always active — star transport removed.

test.describe('P2P roadmap P4 — conversation transport and signaling', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('debug storage exposes transport modes and HTTP signaling endpoint is retired', async ({ request }) => {
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.conversationTransport).toEqual(
      expect.objectContaining({
        activeMode: P2P_DIRECT_ENABLED ? 'direct-p2p' : 'star-gun',
        // P2P-messaging Phase 1 (spec §19.4): ordinary DMs are direct-p2p only.
        availableModes: ['direct-p2p'],
        messageBodyStorage: P2P_DIRECT_ENABLED ? 'gun-local' : 'gun-legacy',
      }),
    );

    const retiredGet = await request.get(`${gunBaseURL()}/api/p2p/signaling/conv_e2e_transport`);
    expect(retiredGet.status()).toBe(404);
    const retiredPost = await request.post(`${gunBaseURL()}/api/p2p/signaling/conv_e2e_transport`, { data: {} });
    expect(retiredPost.status()).toBe(404);

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-conversation-transport')).toBeVisible();
    await expect(p.locator('#storage-inspector-conversation-transport')).toContainText('Conversation Transport');
    await expect(p.locator('#storage-inspector-conversation-transport-modes')).toContainText('direct-p2p');
  });
});
