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

  test('stale active member is pruned from the visible Nearby headcount after disappearance', async () => {
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
      .toBeGreaterThanOrEqual(2)
      .then(() => readRoomHeadcount(pageA!));
    // Both users share the automatic Nearby room (Global is retired); its headcount excludes TechSupport.
    const roomId = await pageA.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''),
    );
    expect(roomId).toMatch(/^nearby_/);

    const bobId = await pageB.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(bobId).toBeTruthy();

    // Simulate a hard disappearance: no app-level manualCleanup runs for Bob.
    await contextB.close();
    contextB = undefined;
    pageB = undefined;

    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const touchRes = await fetch(`${gunBaseURL()}/api/chatrooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(bobId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageName: 'TTL Bob', lastSeen: staleIso }),
    });
    expect(touchRes.ok).toBe(true);

    const res = await fetch(`${gunBaseURL()}/api/chatrooms/${encodeURIComponent(roomId)}/members`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(res.ok).toBe(true);
    await afterSync();

    // The prune is normally a passive background sweep (chatroom-manager.ts, every 30 s at the
    // 180 s TTL). Waiting for that tick plus client propagation flaked under test:all load
    // (OPEN-43), so run the sweep now; the wait below then only covers propagation to Alice.
    const sweepRes = await fetch(`${gunBaseURL()}/api/test/chatrooms/sweep`, { method: 'POST' });
    expect(sweepRes.ok).toBe(true);
    await expect(roomHeadcount(pageA)).toContainText(String(initialHeadcount - 1), { timeout: 35_000 });
  });
});
