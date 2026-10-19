import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { headless } from '../../helpers/timing';
import { bootstrapOnPage, launchPersistentUser } from '../../helpers/crash-recovery';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Nearby list cleanup after an OS-level browser crash', () => {
  let browserA: Browser;
  let contextA: BrowserContext | undefined;
  let pageA: Page | undefined;
  let contextB: BrowserContext | undefined;
  let userDataDirB: string;

  test.beforeAll(async () => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1000'] });
    userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpub-room-crashB-'));
  });

  test.afterAll(async () => {
    await pageA?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    try { fs.rmSync(userDataDirB, { recursive: true, force: true }); } catch { /* ignore */ }
    await clearGunForStage2Spec();
  });

  test('a SIGKILLed person leaves the Nearby headcount when the next swap gets no answer', async () => {
    const roomHeadcount = (page: Page) =>
      page.locator('.chatroom-item.current-room .chatroom-headcount');
    const readRoomHeadcount = async (page: Page) => {
      const text = await roomHeadcount(page).textContent();
      return Number(text?.match(/\d+/)?.[0] || '0');
    };

    const alice = await bootstrapUser(browserA, 'CrashRoom-A', 'Crash Room Alice');
    contextA = alice.context;
    pageA = alice.page;

    const b = await launchPersistentUser(userDataDirB, 660);
    contextB = b.context;
    const pageB = b.page;
    const bobId = await bootstrapOnPage(pageB, 'Crash Room Bob');
    expect(bobId).toBeTruthy();

    const initialHeadcount = await expect
      .poll(() => readRoomHeadcount(pageA!), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2)
      .then(() => readRoomHeadcount(pageA!));
    // Both users are in Nearby: each one's own list; its headcount excludes TechSupport.
    const roomId = await pageA.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''),
    );
    expect(roomId).toMatch(/^nearby-v3$/);

    let bClosed = false;
    contextB.on('close', () => { bClosed = true; });
    b.kill();
    await expect
      .poll(() => bClosed, { timeout: 15_000, message: 'Bob browser context should close after SIGKILL' })
      .toBe(true);
    contextB = undefined;

    // Nearby is Alice's own list (§3.7): there is no hub membership to expire. Her next swap with
    // Bob gets no answer, which drops him at once; run that swap now instead of waiting a period.
    await pageA.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service.gossipNow());
    await expect(roomHeadcount(pageA)).toContainText(String(initialHeadcount - 1), { timeout: 35_000 });
  });
});
