/**
 * E2E tests for chatroom peer-detail views:
 *   1. Chatroom member list shows "Stranger" for unknown users
 *   2. Clicking a member opens the peer detail overlay (back button closes it)
 *   3. Peer detail shows talk history + sort/filter controls after a talk exchange
 *   4. "Send My Talks" auto mode delivers talks to a peer
 *   5. "Send My Talks" manual mode shows picker modal
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, headless } from './helpers/timing';
import { webAppURLStableChatroom } from './helpers/ports';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';
import {
  openIncomingTalkModal,
  syncIncomingFromServer,
  waitForIncomingTalkClusterOnServer,
  waitForResponseModalClosed,
  waitForTabActive,
  resetTalksMatchingSession,
} from './helpers/talks-matching-flow';

test.describe('Chatroom peer detail views', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.setTimeout(180_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await clearGunDatabases();
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunDatabases();
  });

  async function setup(
    tomName: string,
    jerryName: string,
  ): Promise<{
    ctxTom: BrowserContext; pageTom: Page;
    ctxJerry: BrowserContext; pageJerry: Page;
  }> {
    const ctxTom = await browserTom.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const pageTom = await ctxTom.newPage();
    pageTom.on('console', (m) => console.log(`[Tom]:`, m.text()));
    await injectIdbClear(pageTom);
    await pageTom.goto(webAppURLStableChatroom());
    await pageTom.waitForLoadState('load');
    await ensureWindowFitsViewport(pageTom, 640, 1000);
    await afterLoad();
    await setStageNameAndGoToChatrooms(pageTom, tomName);

    const ctxJerry = await browserJerry.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const pageJerry = await ctxJerry.newPage();
    pageJerry.on('console', (m) => console.log(`[Jerry]:`, m.text()));
    await injectIdbClear(pageJerry);
    await pageJerry.goto(webAppURLStableChatroom());
    await pageJerry.waitForLoadState('load');
    await ensureWindowFitsViewport(pageJerry, 640, 1000);
    await afterLoad();
    await setStageNameAndGoToChatrooms(pageJerry, jerryName);

    return { ctxTom, pageTom, ctxJerry, pageJerry };
  }

  async function teardown(
    ctxTom?: BrowserContext,
    ctxJerry?: BrowserContext,
    pageTom?: Page,
    pageJerry?: Page,
  ): Promise<void> {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: ctxTom, jerry: ctxJerry },
    );
  }

  async function setStageNameAndGoToChatrooms(page: Page, name: string): Promise<void> {
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await afterAction();
    await page.fill('#new-stage-name', name);
    await page.click('#edit-stagename-form button[type="submit"]');
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
  }

  /** Navigate to chatroom list (unhides list, hides detail) then click Global to enter detail. */
  async function enterGlobalChatroom(page: Page): Promise<void> {
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.waitForSelector('#chatroom-list-container', { state: 'visible' });
    await page.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();
  }

  // ---------------------------------------------------------------------------
  // Test 1: Stranger status
  // ---------------------------------------------------------------------------

  test('member list shows Stranger status for unknown user', async () => {
    const { ctxTom, pageTom, ctxJerry, pageJerry } = await setup('TomS', 'JerryS');
    try {
      await enterGlobalChatroom(pageTom);
      await enterGlobalChatroom(pageJerry);

      // Tom waits for Jerry to appear
      await pageTom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
      const jerryItem = pageTom.locator('.chatroom-member-item').filter({ hasText: 'JerryS' });
      await expect(jerryItem).toBeVisible({ timeout: 15_000 });

      // After async stats load, status should become "Stranger"
      const status = jerryItem.locator('.chatroom-member-status');
      await expect(status).toHaveText('Stranger', { timeout: 15_000 });
    } finally {
      await teardown(ctxTom, ctxJerry, pageTom, pageJerry);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 2: Open/close peer detail overlay
  // ---------------------------------------------------------------------------

  test('clicking a chatroom member opens the peer detail overlay', async () => {
    const { ctxTom, pageTom, ctxJerry, pageJerry } = await setup('TomOv', 'JerryOv');
    try {
      await enterGlobalChatroom(pageTom);
      await enterGlobalChatroom(pageJerry);

      await pageTom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
      const jerryItem = pageTom.locator('.chatroom-member-item').filter({ hasText: 'JerryOv' });
      await expect(jerryItem).toBeVisible({ timeout: 15_000 });
      await jerryItem.click();

      // Peer detail overlay opens
      await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
      await expect(pageTom.locator('#peer-detail-name')).not.toBeEmpty();
      await expect(pageTom.locator('#peer-stats-section')).toBeVisible();
      await expect(pageTom.locator('#peer-send-talks-btn')).toBeVisible();

      // Back button closes it
      await pageTom.click('#back-from-peer-detail');
      await expect(pageTom.locator('#peer-detail-overlay')).not.toBeVisible({ timeout: 5_000 });
    } finally {
      await teardown(ctxTom, ctxJerry, pageTom, pageJerry);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3: Talk history after exchange
  // ---------------------------------------------------------------------------

  test('peer detail shows talk history after a talk exchange', async () => {
    const { ctxTom, pageTom, ctxJerry, pageJerry } = await setup('TomTH', 'JerryTH');
    try {
      await enterGlobalChatroom(pageTom);
      await enterGlobalChatroom(pageJerry);

      // Tom creates and broadcasts a talk
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await pageTom.waitForSelector('#talk-editor-form', { timeout: 15_000 });
      await pageTom.fill('#talk-title', 'Tennis Peer Test');
      await pageTom.selectOption('#talk-type', 'flow');
      const q = pageTom.locator('.question-item').first();
      await q.locator('.question-text').fill('Peer detail test: want to play tennis?');
      await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets play.');
      await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
      await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
      await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
      await pageTom.click('#talk-editor-form button[type="submit"]');
      await afterSync();

      // Re-enter the chatroom detail and broadcast
      await enterGlobalChatroom(pageTom);
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await afterSync();
      await waitForTabActive(pageTom, 'chatrooms');

      // Jerry answers the talk
      await openIncomingTalkModal(pageJerry, 'Tennis Peer Test');
      await pageJerry
        .locator('input.choice-radio[data-answer-text="Yes, lets play."][data-mode="manual"]')
        .first()
        .click();
      await waitForResponseModalClosed(pageJerry);
      await afterSync();

      // Tom goes to chatroom detail and clicks on Jerry
      await enterGlobalChatroom(pageTom);
      await pageTom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
      const jerryItem = pageTom.locator('.chatroom-member-item').filter({ hasText: 'JerryTH' });
      await expect(jerryItem).toBeVisible({ timeout: 15_000 });
      await jerryItem.click();

      await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
      // History controls appear once history loads
      await expect(pageTom.locator('#peer-history-controls')).toBeVisible({ timeout: 20_000 });
      await expect(pageTom.locator('.peer-history-item').first()).toBeVisible({ timeout: 15_000 });

      // Sort by outcome
      await pageTom.click('.peer-sort-btn[data-sort="outcome"]');
      await afterAction();
      await expect(pageTom.locator('.peer-sort-btn[data-sort="outcome"]')).toHaveClass(/active/);

      // Filter to sent only
      await pageTom.click('.peer-filter-tab[data-filter="sent"]');
      await afterAction();
      const sentCount = await pageTom.locator('.peer-history-item').count();
      expect(sentCount).toBeGreaterThanOrEqual(1);

      await pageTom.click('#back-from-peer-detail');
    } finally {
      await teardown(ctxTom, ctxJerry, pageTom, pageJerry);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 4: Send My Talks — auto mode
  // ---------------------------------------------------------------------------

  test('Send My Talks auto mode sends unsent talks to peer', async () => {
    const { ctxTom, pageTom, ctxJerry, pageJerry } = await setup('TomSend', 'JerrySend');
    try {
      // Tom creates a talk (not yet sent to Jerry)
      await pageTom.click('#create-talk-btn');
      await pageTom.waitForSelector('#talk-editor-form', { timeout: 15_000 });
      await pageTom.fill('#talk-title', 'Send Test Talk');
      await pageTom.selectOption('#talk-type', 'flow');
      const q = pageTom.locator('.question-item').first();
      await q.locator('.question-text').fill('Peer detail auto-send test: any sport?');
      await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
      await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
      await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
      await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
      await pageTom.click('#talk-editor-form button[type="submit"]');
      await afterSync();

      // Both enter Global chatroom
      await enterGlobalChatroom(pageTom);
      await enterGlobalChatroom(pageJerry);

      // Tom opens peer detail for Jerry
      await pageTom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
      const jerryItem = pageTom.locator('.chatroom-member-item').filter({ hasText: 'JerrySend' });
      await expect(jerryItem).toBeVisible({ timeout: 15_000 });
      await jerryItem.click();

      await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });

      // Auto mode should be checked by default
      await expect(pageTom.locator('#peer-auto-mode-checkbox')).toBeChecked();

      // Click Send My Talks
      const sendBtn = pageTom.locator('#peer-send-talks-btn');
      await sendBtn.click();
      await afterSync();

      // Button text changes to indicate success (sent N or nothing new)
      await expect(sendBtn).not.toHaveText('📤 Send My Talks', { timeout: 10_000 });

      // Jerry should see the talk in their Talks tab
      await pageJerry.click('.nav-btn[data-view="talks"]');
      await afterNav();
      await waitForIncomingTalkClusterOnServer(pageJerry, 'Send Test Talk');
      await syncIncomingFromServer(pageJerry);
      await afterSync();
      await expect(pageJerry.locator('#talks-list')).toContainText('Send Test Talk', { timeout: 20_000 });

      await pageTom.click('#back-from-peer-detail');
    } finally {
      await teardown(ctxTom, ctxJerry, pageTom, pageJerry);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 5: Send My Talks — manual mode picker
  // ---------------------------------------------------------------------------

  test('Send My Talks manual mode shows picker modal', async () => {
    const { ctxTom, pageTom, ctxJerry, pageJerry } = await setup('TomMan', 'JerryMan');
    try {
      // Tom creates a talk
      await pageTom.click('#create-talk-btn');
      await pageTom.waitForSelector('#talk-editor-form', { timeout: 15_000 });
      await pageTom.fill('#talk-title', 'Manual Mode Talk');
      await pageTom.selectOption('#talk-type', 'flow');
      const q = pageTom.locator('.question-item').first();
      await q.locator('.question-text').fill('Peer detail manual-send test: ready?');
      await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
      await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
      await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
      await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
      await pageTom.click('#talk-editor-form button[type="submit"]');
      await afterSync();

      // Both enter Global chatroom
      await enterGlobalChatroom(pageTom);
      await enterGlobalChatroom(pageJerry);

      // Tom opens peer detail for Jerry
      await pageTom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
      const jerryItem = pageTom.locator('.chatroom-member-item').filter({ hasText: 'JerryMan' });
      await expect(jerryItem).toBeVisible({ timeout: 15_000 });
      await jerryItem.click();

      await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });

      // Switch to manual mode
      const autoCheckbox = pageTom.locator('#peer-auto-mode-checkbox');
      await expect(autoCheckbox).toBeChecked();
      await autoCheckbox.click();
      await expect(autoCheckbox).not.toBeChecked();

      // Click Send My Talks → picker modal opens
      await pageTom.locator('#peer-send-talks-btn').click();
      await afterAction();

      const pickerModal = pageTom.locator('#peer-send-picker-modal');
      await expect(pickerModal).toBeVisible({ timeout: 10_000 });

      // Cancel button closes picker
      await pageTom.click('#cancel-send-picker');
      await expect(pickerModal).not.toBeVisible({ timeout: 5_000 });

      await pageTom.click('#back-from-peer-detail');
    } finally {
      await teardown(ctxTom, ctxJerry, pageTom, pageJerry);
    }
  });
});
