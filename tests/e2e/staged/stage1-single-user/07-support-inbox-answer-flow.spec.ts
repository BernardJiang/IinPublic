import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

/** Boots a browser in K3 TechSupport mode, mirroring spec 05. */
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

test.describe('TechSupport support-inbox: operator answers a pending question (docs/TODO.md K5)', () => {
  let browser: Browser;
  let userContext: BrowserContext;
  let userPage: Page;
  let techSupportContext: BrowserContext;
  let techSupportPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('operator sees the pending question, answers it, and the asker receives the answer + FAQ is published', async () => {
    // 1. Ordinary user asks a brand-new question — takes the miss path (spec 06), delivering the
    // question to TechSupport's offline mailbox.
    userContext = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    userPage = await userContext.newPage();
    userPage.on('console', (m) => console.log('[User]:', m.text()));
    await injectIdbClear(userPage);
    await gotoWebApp(userPage, webBaseURL());
    await ensureWindowFitsViewport(userPage, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(userPage, 'User1');

    const userId = await userPage.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    expect(userId).toBeTruthy();
    const stageName = await userPage.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''));

    await waitForTabActive(userPage, 'contacts');
    const supportContactRow = userPage.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.click();
    await afterNav();
    await expect(userPage.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const question = `How do I reset my flux capacitor ${Date.now()}?`;
    const answer = 'Hold the reset button for 5 seconds while the capacitor is unplugged.';
    await userPage.fill('#conversation-message-input', question);
    await userPage.click('#send-conversation-message');
    await afterSync();

    // 2. TechSupport boots (K3 mode) — this drains the mailbox on boot, ingesting the question
    // into its own local techsupport-inbox/*, and the live subscription renders it into the
    // support-inbox section of the Me/Settings tab.
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);

    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();

    const inboxItem = techSupportPage.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 20_000 });

    // 3. Operator answers inline (question text left as-is here; the privacy-edit affordance is
    // the same textarea, exercised implicitly by being editable).
    await inboxItem.locator('.support-inbox-answer-input').fill(answer);
    await inboxItem.locator('.support-inbox-answer-btn').click();
    await afterSync();

    // The row disappears once the inbox entry flips to answered (only pending entries render).
    await expect(inboxItem).toHaveCount(0, { timeout: 15_000 });

    // 4. Asker's support thread receives the answer.
    await expect(userPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });

    // 5. The FAQ entry is published and independently readable — both the per-key soul (a flat
    // object) and the whole signed bundle (Gun cannot store the `entries` array directly, so it
    // is wire-encoded as `entriesJson`, per faqBundleToGunWire/faqBundleFromGunWire).
    await expect
      .poll(async () => {
        const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
        const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
        const bundle = snapshot.gunGraph?.['techsupport-faq/bundle'];
        if (typeof bundle?.entriesJson !== 'string') return false;
        const entries = JSON.parse(bundle.entriesJson);
        return Array.isArray(entries) && entries.some((e: any) => e?.answer === answer);
      }, { timeout: 15_000 })
      .toBe(true);

    expect(stageName).toBeTruthy();

    await userPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await userPage.close();
    await techSupportPage.close();
    await userContext.close();
    await techSupportContext.close();
  });
});
