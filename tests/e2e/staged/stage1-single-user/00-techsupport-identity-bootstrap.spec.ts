import { type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('P2 — TechSupport identity public-Gun bootstrap', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    // The E2E reset republishes the signed public bootstrap record. Start with a
    // new context and empty IndexedDB so this cannot pass from a cached Gun copy.
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

  test('a fresh browser discovers the self-signed identity solely from public Gun', async () => {
    await expect
      .poll(
        () => page!.evaluate(() => (window as any).__iinpublic_app.getApp().discoverTechSupportIdentityFromGun()),
        { timeout: 15_000 },
      )
      .toMatchObject({
        userId: 'iinpublic-root-techsupport',
        role: 'root-techsupport',
        pub: expect.any(String),
        epub: expect.any(String),
        signature: expect.any(String),
      });
  });
});
