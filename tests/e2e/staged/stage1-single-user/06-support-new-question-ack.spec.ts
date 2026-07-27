import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { TECHSUPPORT_SUPPORT_ACK_TEMPLATES, verifySupportAck, type SupportAckLocale } from '../../../../src/shared/techsupport-greeting';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

async function currentUserId(page: Page): Promise<string> {
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
}

type AckRecord = {
  id: string;
  senderId: string;
  text: string;
  ackLocale: SupportAckLocale;
  ackSignature: string;
  ackAuthorPub: string;
};

test.describe('TechSupport — a brand-new question renders a signed ack (docs/TODO.md K5)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

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

  test('asking a never-seen question gets a signed "a human will get back to you" ack, not the old blanket reply', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);

    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');

    const userId = await currentUserId(page);
    expect(userId).toBeTruthy();
    const stageName = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''));
    expect(stageName).toBeTruthy();

    await waitForTabActive(page, 'contacts');
    const supportContactRow = page.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.click();
    await afterNav();
    // Greeting first, as established by spec 03.
    await expect(page.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const question = `Why is my flux capacitor reading ${Date.now()}?`;
    await page.fill('#conversation-message-input', question);
    await page.click('#send-conversation-message');
    await afterSync();

    // The hit/miss branch replaces the old blanket "Thanks for the message" canned reply with
    // this signed ack for a question the FAQ bundle has never seen.
    const expectedText = TECHSUPPORT_SUPPORT_ACK_TEMPLATES.en.replace('{name}', stageName);
    await expect(page.locator('#conversation-messages')).toContainText(expectedText, { timeout: 15_000 });
    await expect(page.locator('#conversation-messages')).not.toContainText('TechSupport received it and will keep helping here');

    // Find the message id the app assigned (support_ack_<userMessageId> — poll since the
    // messageId is generated client-side with Date.now()/random, not known in advance).
    let records: AckRecord[] = [];
    await expect
      .poll(async () => {
        const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
        const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
        records = Object.entries(snapshot.gunGraph || {})
          .filter(([soul]) => soul.includes('/messages/support_ack_'))
          .map(([, record]) => record as AckRecord);
        return records.length;
      }, { timeout: 15_000 })
      .toBe(1);

    const [record] = records;
    expect(record.senderId).toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(record.text).toBe(expectedText);
    const verified = await verifySupportAck({
      locale: record.ackLocale,
      template: TECHSUPPORT_SUPPORT_ACK_TEMPLATES[record.ackLocale],
      authorPub: record.ackAuthorPub,
      signature: record.ackSignature,
    });
    expect(verified).not.toBeNull();

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
