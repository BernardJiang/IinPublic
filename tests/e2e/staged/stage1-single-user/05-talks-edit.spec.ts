import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { completeTalkInAppByAnswerIds } from '../../helpers/talk-demo-ui';
import { longPressTalkRow } from '../../helpers/talks-matching-flow';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Talks: create and edit', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const TALK_TITLE = 'Coffee Meetup';
  const TALK_TITLE_EDITED = 'Coffee Meetup (Edited)';

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, stageName);
  }

  test('Create talk, Talks tab shows it with Edit; Edit opens with prefilled data', async () => {
    await bootstrapUser('EditTestUser');

    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', TALK_TITLE);
    await page.selectOption('#talk-language', 'zh');
    await page.selectOption('#talk-type', 'flow');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Do you drink coffee?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const talkItem = page.locator('.talk-list-item').filter({ hasText: TALK_TITLE }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15000 });
    // The role/language badges live inside the row's details popup, opened via long-press.
    await longPressTalkRow(page, talkItem);
    const detailsPopup = page.locator('#item-details-popup');
    await expect(detailsPopup).toBeVisible({ timeout: 10_000 });
    await expect(detailsPopup.locator('.talk-badge-created')).toBeVisible();
    await expect(detailsPopup.locator('.talk-badge-language')).toHaveAttribute('data-language', 'zh');
    await detailsPopup.locator('#close-item-details-popup').click();
    await expect(detailsPopup).toHaveCount(0);

    await talkItem.click();
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue(TALK_TITLE);
    await expect(page.locator('#talk-type')).toHaveValue('flow');
    await expect(page.locator('#talk-language')).toHaveValue('zh');
    await page.fill('#talk-title', TALK_TITLE_EDITED);
    await page.selectOption('#talk-language', 'es');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    const editedTalkItem = page.locator('.talk-list-item').filter({ hasText: TALK_TITLE_EDITED }).first();
    await expect(editedTalkItem).toBeVisible({ timeout: 15000 });
    await expect(editedTalkItem.locator('.talk-badge-language')).toHaveAttribute('data-language', 'es');

    await editedTalkItem.click();
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-language')).toHaveValue('es');
  });

  // TODO §P/§Q build-order item 4: a self-answered own-created talk kept role:'created' in myTalks,
  // so its Me-tab entry incorrectly routed to the talk editor instead of the read-only response
  // view any other answered talk gets. showTalkDetailAsAnswer/preferAnswerView fixes this.
  test('Self-answered own talk: Me-tab entry opens the response view, not the editor', async () => {
    await bootstrapUser('SelfAnswerUser');

    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', 'Self Answer Test');
    await page.selectOption('#talk-type', 'flow');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Do you like tea?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const talkItem = page.locator('.talk-list-item').filter({ hasText: 'Self Answer Test' }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15000 });
    const talkId = await talkItem.getAttribute('data-talk-id');
    expect(talkId).toBeTruthy();

    const talkData = await page.evaluate(async (id) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 }) ?? null;
    }, talkId);
    expect(talkData).toBeTruthy();
    const matchAnswerId = String(talkData.questions?.[0]?.answers?.[0]?.id || '');
    expect(matchAnswerId).toBeTruthy();

    await completeTalkInAppByAnswerIds(page, talkId!, talkData, [matchAnswerId], 'match');

    await page.click('.nav-btn[data-view="me"]');
    await afterSync();
    // docs/TODO.md §LL.2 follow-up: the Me tab no longer shows talk titles or an expand-in-
    // place popup — the row is found by its question prompt, and clicking its answer reaches
    // the talk/response dialog directly.
    const answerItem = page.locator('.answer-talk-item').filter({ hasText: 'Do you like tea?' }).first();
    await expect(answerItem).toBeVisible({ timeout: 15000 });
    await answerItem.locator('.answer-context-jump').click();
    await expect(page.locator('#talk-response-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#talk-editor-modal')).toHaveCount(0);
  });
});
