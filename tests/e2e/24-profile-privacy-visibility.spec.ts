/**
 * Profile privacy visibility: per-viewer filtering of profile Q&A rows.
 *
 * Server rule (src/shared/profile-privacy.ts + GET /api/users/:id?viewerId=...):
 * - `public`: anyone
 * - `contacts_only`: viewer must be in owner's known-people list
 * - `private`: owner only (always hidden from non-self viewers)
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterAction, afterNav, afterSync, headless } from './helpers/timing';
import { gunBaseURL, webBaseURL } from './helpers/ports';
import { attachE2eBrowserTabLabel } from './helpers/e2e-tab-title';

test.describe('Profile privacy visibility', () => {
  let browser: Browser;

  let contextTom: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let contextJerryContact: BrowserContext | undefined;
  let pageJerryContact: Page | undefined;
  let contextJerryNonContact: BrowserContext | undefined;
  let pageJerryNonContact: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterEach(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerryContact?.close().catch(() => {});
    await pageJerryNonContact?.close().catch(() => {});

    await contextTom?.close().catch(() => {});
    await contextJerryContact?.close().catch(() => {});
    await contextJerryNonContact?.close().catch(() => {});
  });

  test.afterAll(async () => {
    await browser?.close().catch(() => {});
    await clearGunDatabases();
  });

  async function bootstrapUser(targetBrowser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const nextContext = await targetBrowser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    const nextPage = await nextContext.newPage();
    await injectIdbClear(nextPage);
    await nextPage.goto(webBaseURL());
    await nextPage.waitForLoadState('load');
    await ensureWindowFitsViewport(nextPage, 960, 1200);
    await afterSync();

    await nextPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await nextPage.waitForSelector('#edit-stagename-btn');
    await nextPage.click('#edit-stagename-btn');
    await afterAction();
    await nextPage.fill('#new-stage-name', stageName);
    await nextPage.click('#edit-stagename-form button[type="submit"]');
    await afterNav();

    attachE2eBrowserTabLabel(nextPage, stageName);
    return { context: nextContext, page: nextPage };
  }

  async function openPeerDetail(page: Page, peerStageName: string): Promise<void> {
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterNav();

    const member = page.locator('.chatroom-member-item').filter({ hasText: peerStageName }).first();
    await expect(member).toBeVisible({ timeout: 15000 });
    await member.click();
    await afterNav();

    await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#peer-stats-section')).toContainText('Public Profile', { timeout: 15000 });
  }

  async function getCurrentUserId(page: Page): Promise<string> {
    return (await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '')).trim();
  }

  test('hides contacts_only/private profile rows from non-owner viewers', async () => {
    const PUBLIC_Q = 'Public Q (visibility)';
    const PUBLIC_A = 'Public A (visibility)';
    const CONTACTS_Q = 'Contacts Only Q (visibility)';
    const CONTACTS_A = 'Contacts Only A (visibility)';
    const PRIVATE_Q = 'Private Q (visibility)';
    const PRIVATE_A = 'Private A (visibility)';

    // Owner: Tom sets three profile Q&A rows with distinct visibility levels.
    const tom = await bootstrapUser(browser, 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    pageTom.on('console', (m) => console.log('[Tom]:', m.text()));

    await pageTom.click('#edit-profile-btn');
    await afterAction();

    const qaList = pageTom.locator('#profile-qa-list');
    await expect(qaList.locator('.profile-qa-row')).toHaveCount(1);

    // Add two more rows (we keep the initial row as row[0]).
    await pageTom.click('#add-profile-qa-btn');
    await afterAction();
    await pageTom.click('#add-profile-qa-btn');
    await afterAction();
    await expect(qaList.locator('.profile-qa-row')).toHaveCount(3);

    const rows = qaList.locator('.profile-qa-row');

    await rows.nth(0).locator('.profile-question-input').fill(PUBLIC_Q);
    await rows.nth(0).locator('.profile-answer-input').fill(PUBLIC_A);
    await rows.nth(0).locator('select.profile-visibility-select').selectOption('public');

    await rows.nth(1).locator('.profile-question-input').fill(CONTACTS_Q);
    await rows.nth(1).locator('.profile-answer-input').fill(CONTACTS_A);
    await rows.nth(1).locator('select.profile-visibility-select').selectOption('contacts_only');

    await rows.nth(2).locator('.profile-question-input').fill(PRIVATE_Q);
    await rows.nth(2).locator('.profile-answer-input').fill(PRIVATE_A);
    await rows.nth(2).locator('select.profile-visibility-select').selectOption('private');

    await pageTom.click('#save-profile-btn');
    await afterNav();
    await afterSync();

    const tomId = await getCurrentUserId(pageTom);
    expect(tomId).toBeTruthy();

    // Viewer 1: Jerry (not in Tom's known-people list)
    const jNon = await bootstrapUser(browser, 'JerryNonContact');
    contextJerryNonContact = jNon.context;
    pageJerryNonContact = jNon.page;
    pageJerryNonContact.on('console', (m) => console.log('[JerryNonContact]:', m.text()));
    await pageJerryNonContact.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await afterSync();

    // Viewer 2: Jerry2 (added to Tom's known-people list)
    const jContact = await bootstrapUser(browser, 'JerryContact');
    contextJerryContact = jContact.context;
    pageJerryContact = jContact.page;
    pageJerryContact.on('console', (m) => console.log('[JerryContact]:', m.text()));
    await pageJerryContact.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await afterSync();

    const jContactId = await getCurrentUserId(pageJerryContact);
    expect(jContactId).toBeTruthy();

    // Add JerryContact as a known person under Tom. This makes `contacts_only` rows visible.
    const postUrl = `${gunBaseURL()}/api/users/${encodeURIComponent(tomId)}/known-people`;
    const postRes = await pageJerryContact.request.post(postUrl, {
      data: {
        targetId: jContactId,
        label: 'friend',
      },
    });
    expect(postRes.ok()).toBeTruthy();
    await afterSync();

    // Assert for non-contact viewer: only `public` rows are visible.
    await openPeerDetail(pageJerryNonContact, 'Tom');
    const statsNon = pageJerryNonContact.locator('#peer-stats-section');
    await expect(statsNon).toContainText(PUBLIC_Q);
    await expect(statsNon).toContainText(PUBLIC_A);
    await expect(statsNon).not.toContainText(CONTACTS_Q);
    await expect(statsNon).not.toContainText(CONTACTS_A);
    await expect(statsNon).not.toContainText(PRIVATE_Q);
    await expect(statsNon).not.toContainText(PRIVATE_A);

    // Assert for contact viewer: `contacts_only` rows are visible; `private` remains hidden.
    await openPeerDetail(pageJerryContact, 'Tom');
    const statsContact = pageJerryContact.locator('#peer-stats-section');
    await expect(statsContact).toContainText(PUBLIC_Q);
    await expect(statsContact).toContainText(PUBLIC_A);
    await expect(statsContact).toContainText(CONTACTS_Q);
    await expect(statsContact).toContainText(CONTACTS_A);
    await expect(statsContact).not.toContainText(PRIVATE_Q);
    await expect(statsContact).not.toContainText(PRIVATE_A);
  });
});

