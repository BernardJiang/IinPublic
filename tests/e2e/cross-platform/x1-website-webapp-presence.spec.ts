/**
 * X1 (P0 merge gate) — website + webapp simultaneous presence & headcount.
 *
 * Two clients on the shared hub join the same room; each must observe the other
 * in the room headcount. Standing in for website↔webapp, both clients are web
 * contexts against the shared per-worker Gun hub.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { headless, afterNav, afterSync } from '../helpers/timing';
import { bootstrapUser } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

test.describe('X1: cross-platform presence and headcount', () => {
  let browserA: Browser;
  let browserB: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=900,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=900,0', '--window-size=900,1100'] });
  });

  test.afterAll(async () => {
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('both clients see a global headcount that accounts for both', async () => {
    const [a, b] = await Promise.all([
      bootstrapUser(browserA, 'X1-Web', 'X1-Web'),
      bootstrapUser(browserB, 'X1-App', 'X1-App'),
    ]);

    for (const { page } of [a, b]) {
      await page.locator('.nav-btn[data-view="chatrooms"]').click();
      await afterNav();
    }
    await afterSync();

    const headcountOf = (page: typeof a.page) =>
      page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');

    // Both users + the TechSupport baseline ⇒ at least 2 non-support members visible.
    for (const { page } of [a, b]) {
      await expect
        .poll(async () => {
          const txt = (await headcountOf(page).first().textContent().catch(() => '')) || '';
          const n = Number(txt.replace(/[^0-9]/g, ''));
          return Number.isFinite(n) ? n : 0;
        }, { timeout: 30_000, message: 'global headcount should reflect both clients' })
        .toBeGreaterThanOrEqual(2);
    }

    await a.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await b.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
  });
});
