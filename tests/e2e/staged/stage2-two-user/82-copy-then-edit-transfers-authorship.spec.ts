import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, afterNav, afterLoad, delay, headless } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import {
  MATCH_ANSWER,
  IGNORE_ANSWER,
  TECH_SUPPORT_NAME,
  TOM_NAME,
  bootstrapSuperUser,
} from '../../helpers/super-user-techsupport-shared';
import { getCurrentUserId } from '../../helpers/reputation-e2e-helpers';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

/**
 * docs/TODO.md §Y1 — a copy is not authorship. Verifies:
 *  1. Copying an incoming talk preserves the original sender as `authorId` (not the copier).
 *  2. Opening the copied row's editor and making a real content edit mints a NEW talk with the
 *     editor as `authorId`, `originalAuthorId` transferred back to the original sender, and the
 *     old copied entry retired (default "delete on edit" policy).
 */
test.describe('Copy then edit transfers authorship', () => {
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
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
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

  test('copy keeps original author; editing mints a new talk owned by the editor', async () => {
    test.setTimeout(300_000);

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
    const tomId = await getCurrentUserId(pageTom);

    const talkTitle = `AuthorshipTransferTalk ${Date.now()}`;
    await pageTechSupport.click('#create-talk-btn');
    await pageTechSupport.waitForSelector('#talk-editor-form');
    await pageTechSupport.click('input[name="talk-type-radio"][value="flow"]');
    await afterAction();
    await pageTechSupport.fill('#talk-title', talkTitle);
    const q = pageTechSupport.locator('.question-item').first();
    await q.locator('.question-text').fill('Original question text?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTechSupport.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await clickBroadcastUntilBulkAck(pageTechSupport);
    await afterSync();
    await afterSync();

    // ── Tom receives, answers, copies ──────────────────────────────────────────
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const incomingRow = pageTom
      .locator('.talk-list-item[data-role="incoming"]')
      .filter({ hasText: talkTitle })
      .first();
    await expect(incomingRow).toBeVisible({ timeout: 90000 });
    await incomingRow.locator('button.view-talk-btn').click();
    await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 25000 });
    await pageTom.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });
    await afterAction();

    await pageTom.click('.nav-btn[data-view="me"]');
    await afterNav();
    // docs/TODO.md §LL.2 follow-up: the row's visible content is the question prompt
    // ("Original question text?"), not the talk title; "copy" is now a small independent
    // link on the answer line itself, no expand-in-place popup anymore.
    const answerRow = pageTom.locator('.answer-talk-item').filter({ hasText: 'Original question text?' }).first();
    await expect(answerRow).toBeVisible({ timeout: 15000 });
    await answerRow.locator('.answer-copy-talk-jump').click();
    await afterNav();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterNav();
    const copyTalkRow = pageTom
      .locator('.talk-list-item[data-role="copied"]')
      .filter({ hasText: talkTitle })
      .first();
    await expect(copyTalkRow).toBeVisible({ timeout: 15000 });
    const copiedTalkId = await copyTalkRow.getAttribute('data-talk-id');

    // ── §Y1 assertion 1: the copy itself did not transfer authorship ───────────
    const copiedFullTalk = await pageTom.evaluate((tid) => {
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      return myTalks[tid as string]?.fullTalk;
    }, copiedTalkId);
    expect(copiedFullTalk.authorId).toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(copiedFullTalk.authorId).not.toBe(tomId);

    // ── Open the copied row's editor (row click, not the broadcast-toggle button) ──
    await copyTalkRow.click();
    await pageTom.waitForSelector('#talk-editor-form', { timeout: 15000 });
    // The dialog must NOT be in "update in place" mode for a foreign-authored talk.
    const editingTalkId = await pageTom.evaluate(
      () => (document.getElementById('talk-editor-form') as HTMLFormElement | null)?.dataset.editingTalkId || '',
    );
    expect(editingTalkId).toBe('');

    // Make a real content edit.
    const editedTitle = `${talkTitle} (edited)`;
    await pageTom.fill('#talk-title', editedTitle);
    const editedQuestion = pageTom.locator('.question-item').first();
    await editedQuestion.locator('.question-text').fill('Edited question text?');
    await submitTalkEditorAndWaitForOut(pageTom, editedTitle);

    // ── §Y1 assertion 2: the edit minted a new talk owned by Tom, with lineage preserved ──
    const newRow = pageTom.locator('.talk-list-item[data-role="created"]').filter({ hasText: editedTitle }).first();
    await expect(newRow).toBeVisible({ timeout: 15000 });
    const newTalkId = await newRow.getAttribute('data-talk-id');
    const newFullTalk = await pageTom.evaluate((tid) => {
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      return myTalks[tid as string]?.fullTalk;
    }, newTalkId);
    expect(newFullTalk.authorId).toBe(tomId);
    expect(newFullTalk.originalAuthorId).toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(newFullTalk.supersedesTalkId).toBe(copiedTalkId);
    expect(newTalkId).not.toBe(copiedTalkId);

    // ── §Y1 assertion 3: the predecessor "copied" entry was retired (default: deleted) ──
    await expect(pageTom.locator(`.talk-list-item[data-talk-id="${copiedTalkId}"]`)).toHaveCount(0);

    console.log('✅ Copy-then-edit authorship transfer verified.');
  });
});
