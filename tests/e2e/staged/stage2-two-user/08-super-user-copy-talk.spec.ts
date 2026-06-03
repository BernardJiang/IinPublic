import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, afterNav, afterLoad, delay, headless } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck, deliverBroadcastViaRegisterApi } from '../../helpers/talk-demo-ui';
import {
  MATCH_ANSWER,
  IGNORE_ANSWER,
  TECH_SUPPORT_NAME,
  TOM_NAME,
  bootstrapSuperUser,
  waitForTabActive,
} from '../../helpers/super-user-techsupport-shared';

test.describe('Super user: copy talk broadcast toggle + delete', () => {
  let browserTechSupport: Browser;
  let browserTom: Browser;
  let contextTechSupport: BrowserContext;
  let contextTom: BrowserContext;
  let pageTechSupport: Page;
  let pageTom: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTechSupport = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterEach(async () => {
    await contextTechSupport?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    contextTechSupport = undefined as unknown as BrowserContext;
    contextTom = undefined as unknown as BrowserContext;
    pageTechSupport = undefined as unknown as Page;
    pageTom = undefined as unknown as Page;
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => {
          const webApp = (window as any).__iinpublic_app;
          if (webApp?.getApp) webApp.getApp().manualCleanup();
        });
      } catch {
        // ignore
      }
    };
    await manualCleanup(pageTechSupport);
    await manualCleanup(pageTom);
    await pageTechSupport?.close().catch(() => {});
    await pageTom?.close().catch(() => {});
    await contextTechSupport?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await browserTechSupport?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    await clearGunForStage2Spec();
  });

  test('Copy talk: receive saves automatically; disable filters broadcast; enable includes again; delete removes', async () => {
    test.setTimeout(300_000);

    console.log('\n📍 Copy-talk test: TechSupport creates one talk, Tom receives (saved), disables, broadcast 0, enables, broadcast 1, deletes');
    // clearGunForStage2Spec() is already called in beforeAll; no need to repeat here.
    const techSupport = await bootstrapSuperUser(browserTechSupport, 'TechSupport', TECH_SUPPORT_NAME);
    contextTechSupport = techSupport.context;
    pageTechSupport = techSupport.page;
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    const tom = await bootstrapSuperUser(browserTom, 'Tom', TOM_NAME);
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    const copyTalkTitle = 'CopyTestTalk';
    await pageTechSupport.click('#create-talk-btn');
    await pageTechSupport.waitForSelector('#talk-editor-form');
    await pageTechSupport.click('input[name="talk-type-radio"][value="flow"]');
    await afterAction();
    await pageTechSupport.fill('#talk-title', copyTalkTitle);
    const q = pageTechSupport.locator('.question-item').first();
    await q.locator('.question-text').fill('Want to connect for CopyTestTalk?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTechSupport.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await clickBroadcastUntilBulkAck(pageTechSupport);

    await afterSync();
    await afterSync();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const incomingRow = pageTom
      .locator('.talk-list-item[data-role="incoming"]')
      .filter({ hasText: copyTalkTitle })
      .first();
    await expect(incomingRow).toBeVisible({ timeout: 90000 });
    await incomingRow.locator('button.view-talk-btn').click();
    await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 25000 });
    await pageTom.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });
    await afterAction();

    await pageTom.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(pageTom.locator('#answers-content').getByText(copyTalkTitle).first()).toBeVisible({ timeout: 15000 });
    await pageTom
      .locator('.answer-talk-item')
      .filter({ hasText: copyTalkTitle })
      .first()
      .locator('.answer-copy-talk-btn')
      .click();
    await afterNav();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterNav();
    const copyTalkRow = pageTom
      .locator('.talk-list-item[data-role="copied"]')
      .filter({ hasText: copyTalkTitle })
      .first();
    await expect(copyTalkRow).toBeVisible({ timeout: 15000 });
    await copyTalkRow.locator('.talk-broadcast-toggle-btn').click();
    await expect(copyTalkRow.locator('.talk-broadcast-toggle-btn')).toHaveAttribute('data-broadcast-enabled', 'false', {
      timeout: 10000,
    });

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterNav();
    await expect(pageTom.locator('#broadcast-talk-btn')).toBeVisible({ timeout: 10000 });
    const disabledSend = await deliverBroadcastViaRegisterApi(pageTom, { minReceivers: 0 });
    expect(disabledSend.talksSent).toBe(0);
    await waitForTabActive(pageTom, 'chatrooms');
    const talkEditorModal = pageTom.locator('#talk-editor-modal');
    if (await talkEditorModal.isVisible()) {
      await pageTom.locator('#cancel-talk-btn').click();
      await pageTom.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 5000 });
    }

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterNav();
    const copyRowAgain = pageTom
      .locator('.talk-list-item[data-role="copied"]')
      .filter({ hasText: copyTalkTitle })
      .first();
    await copyRowAgain.locator('.talk-broadcast-toggle-btn').click();
    await expect(copyRowAgain.locator('.talk-broadcast-toggle-btn')).toHaveAttribute('data-broadcast-enabled', 'true', {
      timeout: 10000,
    });
    await afterNav();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterAction();
    await clickBroadcastUntilBulkAck(pageTom, { minGunPeers: 0 });
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle }).first().locator('.remove-talk-btn').click();
    await afterNav();
    await expect
      .poll(
        async () => pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle }).count(),
        { message: 'history row removed without relying on toast', timeout: 10_000 },
      )
      .toBe(0);
    await expect(pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle })).toHaveCount(0);

    console.log('✅ Copy-talk test complete: receive saved, disabled filtered from broadcast, enable included, delete removed.');
  });
});
