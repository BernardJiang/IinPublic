/**
 * Talk-editor tag-pair picker — docs/TODO.md §BB (deferred from Phase 5, added on request).
 *
 * `#talk-tag`'s value doubles as this talk's `selfTag` (spec §30.2), replacing the old separate
 * `Talk.role`/`#talk-role` picker entirely. This control is a friendlier way to set a self-tag
 * for the app-predefined deal pairs (buy/sell, hiring/jobseeking) via a live opposite-tag
 * preview and an auto-generated first-question suggestion, so two independently-authored talks
 * can share exact wording without either side typing it by hand. `preferenceSet` is derived
 * from the same seeded opposite-tag registry at submit time — a tag with no known opposite
 * defaults to self-match (docs/TODO.md §LL): it matches anyone else tagged the same word.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';

test.describe('Talk editor: tag-pair picker (§BB)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({ headless });
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('typing a known deal tag shows the opposite and pre-fills Q1 — never clobbers a manual edit', async () => {
    const user = await bootstrapUser(browser, 'Picker', 'PickerUser');
    context = user.context;
    page = user.page;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');

    const title = `Used Notebook ${Date.now()}`;
    await page.fill('#talk-title', title);
    await page.selectOption('#talk-type', 'flow');

    // Before typing anything, no preview.
    await expect(page.locator('#talk-tag-preview')).toHaveText('');

    await page.fill('#talk-tag', 'buy');
    await expect(page.locator('#talk-tag-preview')).toContainText('sell');
    // Q1's text was empty, so the template auto-filled it.
    await expect(page.locator('.question-item').first().locator('.question-text')).toHaveValue(`Do you sell ${title}?`);

    // Manually overwrite Q1's text, then change the tag again — the manual edit must survive
    // (the auto-fill only ever touches an EMPTY question-text field).
    await page.locator('.question-item').first().locator('.question-text').fill('My own custom question?');
    await page.fill('#talk-tag', 'sell');
    await expect(page.locator('#talk-tag-preview')).toContainText('buy');
    await expect(page.locator('.question-item').first().locator('.question-text')).toHaveValue('My own custom question?');

    // An unrecognized tag has no known opposite, so it defaults to self-match (§LL) — no
    // crash, and the preview says so instead of leaving the field blank.
    await page.fill('#talk-tag', 'zzz-unrecognized-tag-zzz');
    await expect(page.locator('#talk-tag-preview')).toContainText("Matches anyone also tagged 'zzz-unrecognized-tag-zzz'");

    // Reset to a known tag before submitting, to also prove the tag round-trips through save.
    await page.fill('#talk-tag', 'buy');
    await page.locator('.question-item').first().locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await page.locator('.question-item').first().locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await page.locator('.question-item').first().locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await submitTalkEditorAndWaitForOut(page, title);
    await expect(page.locator('#talk-validation-errors')).not.toBeVisible();

    // Reopen for edit: the tag and question text round-trip correctly.
    const talkItem = page.locator('.talk-list-item').filter({ hasText: title }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15_000 });
    await talkItem.click();
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-tag')).toHaveValue('buy');
    await expect(page.locator('#talk-tag-preview')).toContainText('sell');
    await page.locator('#cancel-talk-btn').click();
  });

  test('a custom (unseeded) tag pair the author types once persists and auto-fills in a later, separate talk', async () => {
    // Not in the 3 hardcoded seed pairs (buy/sell, hiring/jobseeking, male/female) — proves
    // this isn't just the seeded registry already knowing the pair.
    const customTag = `borrow-${Date.now()}`;
    const customOpposite = `lend-${Date.now()}`;

    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.selectOption('#talk-type', 'flow');
    await page.fill('#talk-tag', customTag);
    // Unrecognized so far: self-match default, not the custom opposite yet.
    await expect(page.locator('#talk-tag-preview')).toContainText(`Matches anyone also tagged '${customTag}'`);

    // Author types their own divergent answer, then blurs — this is the persistence trigger.
    await page.fill('#talk-preference-set', customOpposite);
    await page.locator('#talk-title').focus();
    await expect(page.locator('#talk-tag-preview')).toContainText(customOpposite);
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // A brand-new talk editor instance, same tag: the custom pair auto-fills without retyping.
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.selectOption('#talk-type', 'flow');
    await page.fill('#talk-tag', customTag);
    await expect(page.locator('#talk-preference-set')).toHaveValue(customOpposite);
    await expect(page.locator('#talk-tag-preview')).toContainText(customOpposite);
    await page.locator('#cancel-talk-btn').click();
  });
});
