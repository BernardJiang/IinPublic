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
import {
  TECHSUPPORT_GREETING_TEMPLATES,
  verifyTechSupportGreeting,
  type GreetingLocale,
} from '../../../../src/shared/techsupport-greeting';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

async function currentUserId(page: Page): Promise<string> {
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
}

type GreetingRecord = {
  id: string;
  senderId: string;
  text: string;
  greetingLocale: GreetingLocale;
  greetingSignature: string;
  greetingAuthorPub: string;
};

/** Re-verify a stored greeting record — reconstructs the signed payload from the stored field
 * names (`greetingLocale`/`greetingSignature`/`greetingAuthorPub`), not `SignedGreeting`'s own
 * field names, and re-derives `template` from the compiled constant (never trusts a stored one). */
async function verifyStoredGreeting(record: GreetingRecord) {
  return verifyTechSupportGreeting({
    locale: record.greetingLocale,
    template: TECHSUPPORT_GREETING_TEMPLATES[record.greetingLocale],
    authorPub: record.greetingAuthorPub,
    signature: record.greetingSignature,
  });
}

/**
 * Reads the stored greeting record(s) via the server export-snapshot. K1 already established
 * that browser-authored `conversations/.../messages/<id>` writes reliably round-trip through
 * this endpoint in the single-relay E2E environment (unlike server-authored chain writes —
 * see the K1 stage0 test). This does not make the server the authority for the greeting (K2:
 * it is authored client-side, into the receiver's own local Gun, and never transmitted) — it
 * is just how this test reads back what the browser already wrote, the same way the deleted
 * `countSupportWelcomeMessages` helper did for the old model.
 */
async function readGreetingRecords(userId: string): Promise<GreetingRecord[]> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBeTruthy();
  const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
  const suffix = `/messages/support_welcome_${userId}`;
  return Object.entries(snapshot.gunGraph || {})
    .filter(([soul]) => soul.endsWith(suffix))
    .map(([, record]) => record as GreetingRecord);
}

test.describe('TechSupport — signed greeting renders once and verifies (docs/TODO.md K2)', () => {
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

  test('exactly one signed greeting renders, verifies, and survives clear-storage + re-open', async () => {
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

    // 1. Rendered DOM: a contact click lands on the DM conversation directly (redesign §5,
    // rule N2a) — there is no separate conversation-list UI to click through.
    await waitForTabActive(page, 'contacts');
    const supportContactRow = page.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.click();
    await afterNav();
    const messages = page.locator('#conversation-messages');
    await expect(messages).toContainText('Welcome to IinPublic', { timeout: 15_000 });
    await expect(messages).toContainText(stageName);

    // 2. Stored record: exactly one, carrying signature metadata that independently verifies.
    let records: GreetingRecord[] = [];
    await expect
      .poll(async () => {
        records = await readGreetingRecords(userId);
        return records.length;
      }, { timeout: 15_000 })
      .toBe(1);
    const [record] = records;
    expect(record.senderId).toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(record.text).toContain(stageName);
    const verified = await verifyStoredGreeting(record);
    expect(verified).not.toBeNull();
    expect(verified?.locale).toBe(record.greetingLocale);

    // 3. Clear storage and re-open: still exactly one greeting, same content, still verifies —
    // the deterministic message id makes the write idempotent (the K2 replacement for
    // 01-login's old re-login count check).
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await afterSync();

    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await gotoWebApp(page, webBaseURL());
    await afterNav();
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1 re-login');

    const reloginUserId = await currentUserId(page);
    expect(reloginUserId).toBe(userId);

    let reloginRecords: GreetingRecord[] = [];
    await expect
      .poll(async () => {
        reloginRecords = await readGreetingRecords(userId);
        return reloginRecords.length;
      }, { timeout: 15_000 })
      .toBe(1);
    expect(reloginRecords[0].text).toBe(record.text);
    expect(reloginRecords[0].greetingSignature).toBe(record.greetingSignature);
    expect(await verifyStoredGreeting(reloginRecords[0])).not.toBeNull();

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
