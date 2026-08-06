import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed, getIncomingClusterTitlesForUser } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { prepareDirectP2PConversation } from '../../helpers/p2p-transport-e2e';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

/**
 * docs/TODO.md §V — Auto Linear Capture (FR-TK-7). Verifies the whole DM-shorthand-to-Talk
 * pipeline end to end, real browsers: typing `Question? Answer1; Answer2.` shows a mandatory
 * confirmation, a confirmed line renders as tappable chips (not raw text) for both sides,
 * tapping a chip sends a normal quick-reply, and a terminator line finalizes the session into
 * a real flow Talk that shows up in the sender's own Talks/OUT list.
 */
test.describe('Auto Linear Capture from DM shorthand', () => {
  test.describe.configure({ retries: 0 });
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const CAPTURED_LINE = 'Do you like coffee? Yes; No.';
  const TERMINATOR_LINE = "Great, let's meet tomorrow.";

  test.setTimeout(300_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { /* best-effort */ }
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await clearGunForStage2Spec();
  });

  async function bootstrapUser(browser: Browser, label: string, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
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
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('captured line shows confirmation, renders as chips both sides, chip tap replies, terminator saves a Talk', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const tomUserId = await pageTom.evaluate(
      () => (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } }).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    );
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    const jerryUserId = await pageJerry.evaluate(
      () => (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } }).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    );
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // ── Tom and Jerry must match on a talk before a P2P conversation exists ───────────
    const talkTitle = `Coffee Chat ${Date.now()}`;
    const MATCH_ANSWER = 'Yes, lets chat.';
    const IGNORE_ANSWER = 'No thanks.';
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', talkTitle);
    await selectTalkEditorType(pageTom, 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want to chat sometime?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterNav();
    await waitForBroadcastableTalkIds(pageTom, 120_000);
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 240_000);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterSync();

    await expect
      .poll(
        async () => (await getIncomingClusterTitlesForUser(pageJerry, jerryUserId)).length,
        { message: 'Jerry should have incoming talks after broadcast', timeout: 120_000 },
      )
      .toBeGreaterThanOrEqual(1);

    await openIncomingTalkModal(pageJerry, talkTitle);
    await pageJerry
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    await prepareDirectP2PConversation(pageTom, pageJerry, tomUserId, jerryUserId, 'Tom', 'Jerry');

    // ── Tom types the shorthand — a mandatory confirmation must appear first ──────────
    const tomInput = pageTom.locator('#conversation-message-input');
    await expect(tomInput).toBeVisible({ timeout: 10000 });
    await tomInput.fill(CAPTURED_LINE);
    await afterAction();
    await pageTom.click('#send-conversation-message');

    const confirmModal = pageTom.locator('#capture-question-confirm-modal');
    await expect(confirmModal).toBeVisible({ timeout: 10000 });
    await expect(confirmModal).toContainText('Do you like coffee?');
    await pageTom.click('[data-testid="capture-question-confirm-accept"]');
    await afterSync();

    // ── Tom's own copy renders as chips, not the raw CAPTURED_QUESTION: payload ───────
    const tomCard = pageTom.locator('.captured-question-card').first();
    await expect(tomCard).toBeVisible({ timeout: 10000 });
    await expect(tomCard).toContainText('Do you like coffee?');
    await expect(pageTom.locator('#conversation-messages')).not.toContainText('CAPTURED_QUESTION:');

    // ── Jerry sees the same chip card, not raw JSON ───────────────────────────────────
    const jerryCard = pageJerry.locator('.captured-question-card').first();
    await expect(jerryCard).toBeVisible({ timeout: 20000 });
    await expect(jerryCard).toContainText('Do you like coffee?');
    await expect(jerryCard.locator('.captured-question-answer-btn')).toHaveCount(2);
    await expect(pageJerry.locator('#conversation-messages')).not.toContainText('CAPTURED_QUESTION:');

    // ── Jerry taps "Yes" — sends back as an ordinary quick-reply ──────────────────────
    await jerryCard.locator('.captured-question-answer-btn', { hasText: 'Yes' }).click();
    await afterSync();
    await expect(
      pageJerry.locator('#conversation-messages .message-text').filter({ hasText: /^Yes\.?$/ }).first(),
    ).toBeVisible({ timeout: 10000 });
    // Tapped chip is disabled so it can't be answered twice.
    await expect(jerryCard.locator('.captured-question-answer-btn', { hasText: 'Yes' })).toBeDisabled();

    await expect
      .poll(
        async () =>
          pageTom
            .locator('#conversation-messages .message-text')
            .filter({ hasText: /^Yes\.?$/ })
            .first()
            .isVisible()
            .catch(() => false),
        { message: "Tom should see Jerry's quick-reply", timeout: 20000 },
      )
      .toBe(true);

    // ── Tom sends a terminator line — no confirmation dialog, ends the capture ────────
    await tomInput.fill(TERMINATOR_LINE);
    await afterAction();
    await pageTom.click('#send-conversation-message');
    await afterSync();
    await expect(pageTom.locator('#capture-question-confirm-modal')).toHaveCount(0);
    await expect(
      pageTom.locator('#conversation-messages .message-text').filter({ hasText: TERMINATOR_LINE }).first(),
    ).toBeVisible({ timeout: 10000 });

    // ── The captured line finalized into a real flow Talk in Tom's own Talks/OUT list ─
    await pageTom.click('#back-from-conversation');
    await afterNav();
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await expect
      .poll(
        async () =>
          pageTom
            .locator('.talk-list-item[data-role="created"]')
            .filter({ hasText: 'Do you like coffee' })
            .first()
            .isVisible()
            .catch(() => false),
        { message: 'The captured question should have saved as a new Talk', timeout: 20000 },
      )
      .toBe(true);
  });
});
