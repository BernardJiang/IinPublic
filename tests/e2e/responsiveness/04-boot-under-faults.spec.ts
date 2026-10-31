/**
 * Boot under network faults (test plan P1, audit F1): the app must finish starting whatever the
 * hub does, and a tap made while it is still starting must not be lost.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear } from '../helpers/clear-database';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { waitForAppReady } from '../helpers/timing';
import { webAppURLStableChatroom } from '../helpers/ports';
import { failHub, stallHub, stallHubPath, type HubFaultHandle } from '../helpers/ui-responsiveness';

/** The longest a cold boot may take with the hub misbehaving (healthy: ~3 s). */
const FAULTED_BOOT_BUDGET_MS = 15_000;

const FAULTS: Array<{ name: string; apply: (page: Page) => Promise<HubFaultHandle> }> = [
  { name: 'every hub request fails at once (airplane mode)', apply: failHub },
  { name: 'every hub request hangs (Wi-Fi without internet)', apply: stallHub },
  { name: 'only the transport flags hang', apply: (p) => stallHubPath(p, /\/api\/debug\/storage/) },
  { name: 'only presence hangs', apply: (p) => stallHubPath(p, /\/api\/presence\//) },
  { name: 'only user lookups hang', apply: (p) => stallHubPath(p, /\/api\/users\//) },
  { name: 'only room calls hang', apply: (p) => stallHubPath(p, /\/api\/(chatrooms|nearby)\//) },
  { name: 'only TechSupport calls hang', apply: (p) => stallHubPath(p, /\/api\/support\//) },
];

test.describe('GUI responsiveness: boot under hub faults', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let fault: HubFaultHandle | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    await injectIdbClear(page);
  });

  test.afterEach(async () => {
    await fault?.clear().catch(() => undefined);
    fault = undefined;
    await context?.close().catch(() => undefined);
    await clearGunForStage1Spec();
  });

  for (const { name, apply } of FAULTS) {
    test(`boot finishes when ${name}`, async () => {
      const p = page!;
      fault = await apply(p);
      const started = Date.now();
      await p.goto(webAppURLStableChatroom());
      await waitForAppReady(p, FAULTED_BOOT_BUDGET_MS);
      console.log(`[boot] ${name}: ready in ${Date.now() - started} ms`);
      for (const view of ['talks', 'contacts', 'settings', 'chatrooms']) {
        await p.locator(`.nav-btn[data-view="${view}"]`).click();
        await expect(p.locator(`#${view}-view`)).toBeVisible({ timeout: 1_000 });
      }
    });
  }

  test('a Talk created while the app is still starting is saved, not dropped', async () => {
    const p = page!;
    // Hold presence so boot sits for a few seconds before its handlers exist (bounded at 4 s).
    fault = await stallHubPath(p, /\/api\/presence\/register/);
    await p.goto(webAppURLStableChatroom());
    await p.locator('.nav-btn[data-view="talks"]').click();
    await p.locator('#create-talk-btn').click();
    await p.locator('#talk-title').fill('Made during boot');
    const bootedBeforeSubmit = await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.initialized === true);
    await p.locator('#talk-submit-btn').click();
    console.log(`[boot] app already booted when Create was tapped: ${bootedBeforeSubmit}`);
    await waitForAppReady(p, FAULTED_BOOT_BUDGET_MS);
    await expect.poll(() => p.evaluate(() => {
      const talks = (window as any).__iinpublic_collection?.('myTalks') ?? {};
      return Object.values(talks).some((t: any) => String(t?.title || t?.fullTalk?.title || '') === 'Made during boot');
    }), { timeout: 10_000 }).toBe(true);
  });
});
