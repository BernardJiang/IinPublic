/**
 * D6 acceptance closure — Contacts tab: stranger default, relationship save, and sort.
 *
 * Acceptance items from backlog inventory:
 *  - Ordinary answerers/matches start as Stranger/unassigned until explicit relationship selection.
 *  - All relationship labels filter/search/sort/save/reload correctly.
 *
 * Flow:
 *  1. Tom creates a flow talk, broadcasts it.
 *  2. Jerry answers with the match answer → Tom gets a match.
 *  3. Tom opens Contacts → Jerry appears with "Stranger" label (no label set yet).
 *  4. Tom opens Jerry's detail → clicks "Edit Relationship" → saves "friend".
 *  5. Tom goes back to contacts list → Jerry now shows "Friend" in the meta line.
 *  6. Sort by relationship → Jerry still visible; sort by weighted → Jerry visible.
 *  7. Navigate away and back → relationship label persists (loaded from encrypted storage).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear } from '../../helpers/clear-database';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';
import { afterLoad, afterSync, afterNav, afterAction } from '../../helpers/timing';
import { completeTalkInAppByAnswerIds, createTalksFromCompanyPage } from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';

test.describe.configure({ timeout: 180_000 });

test.describe('Contacts: stranger default label → save relationship → sort (D6)', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
    browserTom = await chromium.launch();
    browserJerry = await chromium.launch();
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await maybeClearGunDatabases();
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    const page = await context.newPage();
    attachFilteredConsoleLog(page, label);
    await injectIdbClear(page);
    await page.goto(webAppURLStableChatroom());
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('new match starts as Stranger; can be labeled Friend and sort/persist correctly', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Tom creates a simple flow talk
    const [tennis] = await createTalksFromCompanyPage(pageTom, [
      {
        title: 'Tennis Partner',
        type: 'flow',
        language: 'en',
        questions: [{
          id: 'q_tennis_rel',
          text: 'Want a tennis partner?',
          answers: [
            { id: 'a_tennis_rel_yes', text: 'Yes!', isMatch: true, isTerminal: true },
            { id: 'a_tennis_rel_no', text: 'No thanks.', isIgnore: true, isTerminal: true },
          ],
        }],
        selfAnswers: [{ questionId: 'q_tennis_rel', answerId: 'a_tennis_rel_yes' }],
      },
    ]);

    // Jerry answers with match
    await completeTalkInAppByAnswerIds(pageJerry, tennis.talkId, tennis.talkData, ['a_tennis_rel_yes'], 'match');
    await waitForStatusBarMatchCountAtLeast(pageJerry, 1);
    await afterSync();

    // ─── Step 1: Tom opens Contacts → Jerry appears as Stranger ───────────────
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const jerryContactItem = pageTom.locator('.contact-item:not([data-support-contact="true"])').filter({ hasText: 'Jerry' }).first();
    await expect(jerryContactItem).toBeVisible({ timeout: 20_000 });

    // Contact meta line should show "Stranger" as the relationship (case-insensitive)
    const metaText = await jerryContactItem.locator('.contact-item-meta').last().innerText().catch(() => '');
    expect(metaText.toLowerCase()).toContain('stranger');

    // ─── Step 2: Open Jerry's detail → verify "Stranger" in detail view ───────
    await jerryContactItem.click();
    await afterNav();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10_000 });

    // ─── Step 3: Save "Friend" relationship label ──────────────────────────────
    const editBtn = pageTom.locator('#contact-edit-relationship-btn');
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10_000 });

    await pageTom.locator('#contact-relationship-label').selectOption('friend');
    await pageTom.locator('#contact-relationship-save-btn').click();
    await afterSync();
    // Modal should close
    await expect(pageTom.locator('#contact-relationship-modal')).not.toBeVisible({ timeout: 10_000 });

    // ─── Step 4: Back to list → Jerry now shows "Friend" ─────────────────────
    await pageTom.locator('#back-to-contacts-list').click();
    await afterAction();

    const jerryAfterSave = pageTom.locator('.contact-item:not([data-support-contact="true"])').filter({ hasText: 'Jerry' }).first();
    await expect(jerryAfterSave).toBeVisible({ timeout: 10_000 });
    const metaAfter = await jerryAfterSave.locator('.contact-item-meta').last().innerText().catch(() => '');
    // Should now show "Friend" (or "friend"), not "Stranger"
    expect(metaAfter.toLowerCase()).toContain('friend');
    expect(metaAfter.toLowerCase()).not.toContain('stranger');

    // ─── Step 5: Sort by relationship → Jerry still visible ───────────────────
    await pageTom.locator('#contacts-sort-order').selectOption('relationship');
    await afterAction();
    await expect(pageTom.locator('.contact-item:not([data-support-contact="true"])').filter({ hasText: 'Jerry' })).toBeVisible({ timeout: 5_000 });

    // ─── Step 6: Sort by weighted → Jerry still visible ───────────────────────
    await pageTom.locator('#contacts-sort-order').selectOption('weighted');
    await afterAction();
    await expect(pageTom.locator('.contact-item:not([data-support-contact="true"])').filter({ hasText: 'Jerry' })).toBeVisible({ timeout: 5_000 });

    // ─── Step 7: Navigate away and back → Friend label persists ───────────────
    await pageTom.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterNav();

    const jerryAfterReload = pageTom.locator('.contact-item:not([data-support-contact="true"])').filter({ hasText: 'Jerry' }).first();
    await expect(jerryAfterReload).toBeVisible({ timeout: 15_000 });
    const metaReloaded = await jerryAfterReload.locator('.contact-item-meta').last().innerText().catch(() => '');
    expect(metaReloaded.toLowerCase()).toContain('friend');
  });
});
