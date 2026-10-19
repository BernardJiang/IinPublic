import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Nearby list cleanup', () => {
  let browserA: Browser;
  let browserB: Browser;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;

  test.beforeAll(async () => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1000'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1000'] });
  });

  test.afterAll(async () => {
    await pageA?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await pageB?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('a person who disappears leaves the Nearby headcount when the next swap gets no answer', async () => {
    const roomHeadcount = (page: Page) =>
      page.locator('.chatroom-item.current-room .chatroom-headcount');
    const readRoomHeadcount = async (page: Page) => {
      const text = await roomHeadcount(page).textContent();
      return Number(text?.match(/\d+/)?.[0] || '0');
    };

    const alice = await bootstrapUser(browserA, 'TTL-A', 'TTL Alice');
    contextA = alice.context;
    pageA = alice.page;
    const bob = await bootstrapUser(browserB, 'TTL-B', 'TTL Bob');
    contextB = bob.context;
    pageB = bob.page;

    const initialHeadcount = await expect
      .poll(() => readRoomHeadcount(pageA!), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1)
      .then(() => readRoomHeadcount(pageA!));
    // Both users are in Nearby: each one's own list; its headcount excludes TechSupport.
    const roomId = await pageA.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''),
    );
    expect(roomId).toMatch(/^nearby-v3$/);

    // Simulate a hard disappearance: no app-level manualCleanup runs for Bob.
    await contextB.close();
    contextB = undefined;
    pageB = undefined;

    // Nearby is Alice's own list (§3.7): there is no hub membership to expire. Her next swap with
    // Bob gets no answer, which drops him at once; run that swap now instead of waiting a period.
    await pageA.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service.gossipNow());
    await expect(roomHeadcount(pageA)).toContainText(String(initialHeadcount - 1), { timeout: 35_000 });
  });
});
