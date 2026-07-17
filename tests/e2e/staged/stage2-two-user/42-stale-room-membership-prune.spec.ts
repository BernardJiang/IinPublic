import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { afterSync, headless } from '../../helpers/timing';
import { gunBaseURL } from '../../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Room membership TTL cleanup', () => {
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

  test('stale active member is pruned from the visible Global headcount after disappearance', async () => {
    const globalHeadcount = (page: Page) =>
      page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    const readGlobalHeadcount = async (page: Page) => {
      const text = await globalHeadcount(page).textContent();
      return Number(text?.match(/\d+/)?.[0] || '0');
    };

    const alice = await bootstrapUser(browserA, 'TTL-A', 'TTL Alice');
    contextA = alice.context;
    pageA = alice.page;
    const bob = await bootstrapUser(browserB, 'TTL-B', 'TTL Bob');
    contextB = bob.context;
    pageB = bob.page;

    const initialHeadcount = await expect
      .poll(() => readGlobalHeadcount(pageA!), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3)
      .then(() => readGlobalHeadcount(pageA!));

    const bobId = await pageB.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(bobId).toBeTruthy();

    // Simulate a hard disappearance: no app-level manualCleanup runs for Bob.
    await contextB.close();
    contextB = undefined;
    pageB = undefined;

    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const touchRes = await fetch(`${gunBaseURL()}/api/chatrooms/global/members/${encodeURIComponent(bobId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageName: 'TTL Bob', lastSeen: staleIso }),
    });
    expect(touchRes.ok).toBe(true);

    const res = await fetch(`${gunBaseURL()}/api/chatrooms/global/members`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(res.ok).toBe(true);
    await afterSync();

    await expect(globalHeadcount(pageA)).toContainText(String(initialHeadcount - 1), { timeout: 20_000 });
  });
});
