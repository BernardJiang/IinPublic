import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

/** Boots a browser in K3 TechSupport mode, mirroring stage1 specs 05/07/09. */
async function bootstrapTechSupportMode(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 720, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => console.log('[TechSupport]:', m.text()));
  await injectIdbClear(page);
  await context.addInitScript(
    ({ userId, keypairStorageKey, pairJson }) => {
      window.localStorage.setItem('iinpublic_user_id', userId);
      window.localStorage.setItem(keypairStorageKey, pairJson);
    },
    { userId: TECHSUPPORT_ROOT_USER_ID, keypairStorageKey: 'iinpublic_techsupport_keypair_v1', pairJson: JSON.stringify(DEV_PAIR) },
  );
  await gotoWebApp(page, webBaseURL());
  await ensureWindowFitsViewport(page, 720, 960);
  await afterLoad();
  attachE2eBrowserTabLabel(page, 'TechSupport');
  return { context, page };
}

test.describe('TechSupport FAQ: a different user gets the same question auto-answered (docs/TODO.md K5 Item 6)', () => {
  let browser: Browser;
  let tomContext: BrowserContext | undefined;
  let tomPage: Page | undefined;
  let jerryContext: BrowserContext | undefined;
  let jerryPage: Page | undefined;
  let techSupportContext: BrowserContext | undefined;
  let techSupportPage: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1300', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await tomPage?.close().catch(() => {});
    await jerryPage?.close().catch(() => {});
    await techSupportPage?.close().catch(() => {});
    await tomContext?.close().catch(() => {});
    await jerryContext?.close().catch(() => {});
    await techSupportContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test("Jerry asks the exact question Tom already got answered and is auto-answered with zero TechSupport involvement in Jerry's session", async () => {
    // 1. Tom asks a brand-new question (miss path) and TechSupport answers it once — the only
    // point in this test where a developer/TechSupport session is involved at all.
    const tom = await bootstrapUser(browser, 'Tom FAQ', 'Tom');
    tomContext = tom.context;
    tomPage = tom.page;

    await tomPage.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const tomSupportRow = tomPage.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(tomSupportRow).toBeVisible({ timeout: 15_000 });
    await tomSupportRow.locator('.contact-item-name').click(); // tap the name — row tap alone no longer opens the DM (contacts-view.ts tap-target split)
    await expect(tomPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });

    const question = `Why does my warp coil hum at ${Date.now()} Hz?`;
    const answer = 'A humming warp coil means the plasma injectors need realignment.';
    await tomPage.locator('#conversation-message-input').fill(question);
    await tomPage.locator('#send-conversation-message').click();
    await afterSync();

    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);
    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();

    const inboxItem = techSupportPage.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 20_000 });
    await inboxItem.locator('.support-inbox-answer-input').fill(answer);
    await inboxItem.locator('.support-inbox-answer-btn').click();
    await afterSync();
    await expect(inboxItem).toHaveCount(0, { timeout: 15_000 });
    await expect(tomPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });

    // TechSupport is done for this test — closed before Jerry ever appears.
    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await techSupportPage.close();
    await techSupportContext.close();
    techSupportPage = undefined;
    techSupportContext = undefined;

    // 2. Jerry is a completely different ordinary user who has never asked this question before.
    // He asks the exact same text and must be auto-answered from the now-public FAQ bundle —
    // no TechSupport session exists anywhere in the rest of this test.
    const jerry = await bootstrapUser(browser, 'Jerry FAQ', 'Jerry');
    jerryContext = jerry.context;
    jerryPage = jerry.page;

    await waitForTabActive(jerryPage, 'contacts');
    const jerrySupportRow = jerryPage.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(jerrySupportRow).toBeVisible({ timeout: 15_000 });
    await jerrySupportRow.locator('.contact-item-name').click(); // tap the name — row tap alone no longer opens the DM (contacts-view.ts tap-target split)
    await expect(jerryPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(jerryPage.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    await jerryPage.locator('#conversation-message-input').fill(question);
    await jerryPage.locator('#send-conversation-message').click();
    await afterSync();

    // Core assertion: Jerry gets the real answer text instantly, not the "a human will get back
    // to you" ack — proving the FAQ bundle is genuinely global/public, not scoped to Tom's asker
    // session, and that no developer/TechSupport involvement was needed for Jerry's question.
    await expect(jerryPage.locator('#conversation-messages')).toContainText(answer, { timeout: 15_000 });
    await expect(jerryPage.locator('#conversation-messages')).not.toContainText('will get back to you');
  });
});
