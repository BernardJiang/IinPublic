import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay } from './helpers/timing';

test.describe('Talks: create and edit', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const TALK_TITLE = 'Coffee Meetup';
  const TALK_TITLE_EDITED = 'Coffee Meetup (Edited)';

  test.beforeAll(async () => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless: false,
      slowMo: delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunDatabases();
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await page.goto('/');
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await afterAction();
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
  }

  test('Create talk, Talks tab shows it with Edit; Edit opens with prefilled data', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/05-talks');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    await bootstrapUser('EditTestUser');

    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    // New UI: expiration, location, Send to Chatroom checkbox, Create button
    await expect(page.locator('#talk-expires')).toBeVisible();
    await expect(page.locator('#talk-location-radius')).toBeVisible();
    await expect(page.locator('#talk-send-to-chatroom')).toBeChecked();
    await expect(page.locator('#talk-submit-btn')).toHaveText('Create');

    await page.fill('#talk-title', TALK_TITLE);
    await page.selectOption('#talk-type', 'matching');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Do you drink coffee?');
    // My answer defaults to Ignore; optional: set self-answer (e.g. "Yes") by clicking the radio
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    // Optional: set expiration and location (defaults Forever / Anywhere)
    await page.selectOption('#talk-expires', '1w');
    await page.selectOption('#talk-location-radius', '100');
    await page.click('#talk-editor-form button[type="submit"]');
    // Wait for modal to close (stable; no dependency on notification timing)
    await page.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 15000 });
    await afterSync();

    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();
    // Resolve the created talk (has Created badge) so Edit/checkbox/Remove targets are stable
    const talkItem = page.locator('.talk-list-item').filter({ hasText: TALK_TITLE }).filter({ has: page.locator('.talk-badge-created') }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15000 });
    await expect(talkItem.locator('.edit-talk-btn')).toBeVisible();

    // Verify Edit button opens editor (delegated capture handler)
    await talkItem.locator('.edit-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'visible', timeout: 10000 });
    await expect(page.locator('#talk-title')).toHaveValue(TALK_TITLE);
    await expect(page.locator('#talk-type')).toHaveValue('matching');
    await expect(page.locator('#talk-expires')).toHaveValue('1w');
    await expect(page.locator('#talk-location-radius')).toHaveValue('100');
    await page.fill('#talk-title', TALK_TITLE_EDITED);
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await expect(page.locator('.talk-list-item').filter({ hasText: TALK_TITLE_EDITED })).toBeVisible({ timeout: 15000 });
  });

  test('Talks list: Disable for broadcast and Remove work reliably', async () => {
    await bootstrapUser('ActionsTestUser');
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    const title = 'To Remove Talk';
    await page.fill('#talk-title', title);
    await page.selectOption('#talk-type', 'matching');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('OK?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Y');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('N');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await page.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 15000 });
    await afterSync();

    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const talkItem = page.locator('.talk-list-item').filter({ hasText: title }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15000 });

    // Verify Disable for broadcast: click label, expect Disabled badge after re-render
    await expect(talkItem.locator('.talk-badge').filter({ hasText: 'Disabled' })).not.toBeVisible();
    await talkItem.locator('.talk-disable-broadcast-label').click();
    await afterSync();
    await expect(page.locator('.talk-list-item').filter({ hasText: title }).locator('.talk-badge').filter({ hasText: 'Disabled' })).toBeVisible({ timeout: 5000 });

    // Verify Remove: click Remove, talk disappears from list
    const itemBeforeRemove = page.locator('.talk-list-item').filter({ hasText: title }).first();
    await itemBeforeRemove.locator('.remove-talk-btn').click();
    await afterSync();
    await expect(page.locator('.talk-list-item').filter({ hasText: title })).not.toBeVisible({ timeout: 5000 });
  });

  test('Disable-for-broadcast checkbox survives multiple toggles and remove (wait for each toggle)', async () => {
    await bootstrapUser('CheckboxStressUser');
    const titles = ['Checkbox Talk A', 'Checkbox Talk B', 'Checkbox Talk C'] as const;

    async function createTalk(title: string): Promise<void> {
      await page.click('#create-talk-btn');
      await page.waitForSelector('#talk-editor-form');
      await page.fill('#talk-title', title);
      await page.selectOption('#talk-type', 'matching');
      const q = page.locator('.question-item').first();
      await q.locator('.question-text').fill('Q?');
      await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Y');
      await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
      await q.locator('.answer-item').nth(1).locator('.answer-text').fill('N');
      await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
      await page.click('#talk-editor-form button[type="submit"]');
      await page.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 15000 });
      await afterSync();
    }

    for (const title of titles) await createTalk(title);

    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();

    // Helper: click disable label and wait for checkbox to reach expected checked state (avoids Gun/sync racing ahead of clicks)
    async function toggleDisableAndWait(talkTitle: string, expectChecked: boolean): Promise<void> {
      const item = page.locator('.talk-list-item').filter({ hasText: talkTitle }).filter({ has: page.locator('.talk-badge-created') }).first();
      await item.locator('.talk-disable-broadcast-label').click();
      const cb = item.locator('.talk-disable-broadcast-checkbox');
      if (expectChecked) {
        await expect(cb).toBeChecked({ timeout: 5000 });
      } else {
        await expect(cb).not.toBeChecked({ timeout: 5000 });
      }
    }

    // Each of 3 talks: toggle checkbox 3 times (on -> off -> on), waiting for state after each click
    for (const title of titles) {
      await toggleDisableAndWait(title, true);   // 1st click -> disabled
      await toggleDisableAndWait(title, false);  // 2nd click -> enabled
      await toggleDisableAndWait(title, true);   // 3rd click -> disabled
    }

    // Remove middle talk (B)
    const middleItem = page.locator('.talk-list-item').filter({ hasText: titles[1] }).filter({ has: page.locator('.talk-badge-created') }).first();
    await middleItem.locator('.remove-talk-btn').click();
    await afterSync();
    await expect(page.locator('.talk-list-item').filter({ hasText: titles[1] })).not.toBeVisible({ timeout: 5000 });

    // Remaining 2 talks: toggle each checkbox 3 times again, waiting for state each time
    for (const title of [titles[0], titles[2]]) {
      await toggleDisableAndWait(title, false);  // was disabled -> enable
      await toggleDisableAndWait(title, true);   // disable again
      await toggleDisableAndWait(title, false);  // enable again
    }
  });

  test('Create talk without sending to chatroom', async () => {
    await bootstrapUser('NoSendUser');
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', 'Private Talk');
    await page.selectOption('#talk-type', 'matching');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Test?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('A.');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('B.');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.uncheck('#talk-send-to-chatroom');
    await page.click('#talk-editor-form button[type="submit"]');
    // Wait for modal to close (stable; no dependency on notification timing)
    await page.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 15000 });
    await afterSync();
    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(page.locator('.talk-list-item').filter({ hasText: 'Private Talk' })).toBeVisible({ timeout: 15000 });
  });
});
