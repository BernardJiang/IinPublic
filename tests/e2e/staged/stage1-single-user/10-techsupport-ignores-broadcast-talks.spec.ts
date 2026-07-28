import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterAction, afterLoad, afterNav, afterSync, delay, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser, incomingClustersIncludeTitleForUser } from '../../helpers/talks-matching-flow';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

/**
 * Boots a browser in K3 TechSupport mode and joins Global — mirrors spec 05/07/09's helper, but
 * uses the mesh-enabled stable-chatroom URL (not the bare base URL) since this spec needs
 * TechSupport to be a real mesh participant, not just a settings-tab visitor.
 */
async function bootstrapTechSupportModeInGlobal(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 720, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => console.log('[TechSupport]:', m.text()));
  await injectIdbClear(page);
  await context.addInitScript(
    ({ userId, keypairStorageKey, pairJson }) => {
      window.localStorage.setItem('iinpublic_user_id', userId);
      window.localStorage.setItem(keypairStorageKey, pairJson);
    },
    { userId: TECHSUPPORT_ROOT_USER_ID, keypairStorageKey: 'iinpublic_techsupport_keypair_v1', pairJson: JSON.stringify(DEV_PAIR) },
  );
  await gotoWebApp(page, webAppURLStableChatroom());
  await ensureWindowFitsViewport(page, 720, 960);
  await afterLoad();
  attachE2eBrowserTabLabel(page, 'TechSupport');
  await page.click('.chatroom-item:has-text("Global")');
  await afterSync();
  return { context, page };
}

test.describe('TechSupport ignores broadcast talks entirely (docs/TODO.md K5, invariant 1)', () => {
  let browser: Browser;
  let aliceContext: BrowserContext;
  let alicePage: Page;
  let techSupportContext: BrowserContext;
  let techSupportPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(300_000);
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1300', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('flow and tag broadcasts to Global never land in TechSupport\'s IN index; headcount stays 2 throughout', async () => {
    // TechSupport joins Global first so it is a live mesh participant for the whole broadcast,
    // not merely the client-side headcount floor (K1) — this is what makes the exclusion check
    // meaningful rather than trivially true.
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportModeInGlobal(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);

    const alice = await bootstrapUser(browser, 'Alice TalkExclusion', 'Alice');
    aliceContext = alice.context;
    alicePage = alice.page;
    await alicePage.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Headcount is Alice + built-in TechSupport = 2, before any talk exists.
    const headcountOnAlice = alicePage.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    await expect(headcountOnAlice).toContainText('2', { timeout: 20_000 });

    // `waitForChatroomMemberCountViaApi` (used internally by clickBroadcastUntilBulkAck's default
    // peer-count wait) deliberately excludes TECHSUPPORT_ROOT_USER_ID from its receiver count,
    // since TechSupport is never a valid talk receiver by design — with only TechSupport in the
    // room, that count can never reach 1, so this spec bypasses the wait (`minGunPeers: 0`)
    // rather than fighting a helper that is correctly modeling TechSupport as a non-receiver.

    // --- Tag talk (checkbox type — no branching required) ---
    const tagTitle = `TechSupport-Exclusion Tag ${Date.now()}`;
    await alicePage.click('#create-talk-btn');
    await alicePage.waitForSelector('#talk-editor-form');
    await selectTalkEditorType(alicePage, 'tag');
    await alicePage.fill('#talk-title', tagTitle);
    await submitTalkEditorAndWaitForOut(alicePage, tagTitle);
    await clickBroadcastUntilBulkAck(alicePage, { minGunPeers: 0, minSent: 0 });
    await afterSync();
    await afterAction();

    // --- Flow talk (directed-question type — minimal one-question branch) ---
    const flowTitle = `TechSupport-Exclusion Flow ${Date.now()}`;
    await alicePage.click('#create-talk-btn');
    await alicePage.waitForSelector('#talk-editor-form');
    await selectTalkEditorType(alicePage, 'flow');
    await alicePage.fill('#talk-title', flowTitle);
    const q = alicePage.locator('.question-item').first();
    await q.locator('.question-text').fill('Does this affect you?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await submitTalkEditorAndWaitForOut(alicePage, flowTitle);
    await clickBroadcastUntilBulkAck(alicePage, { minGunPeers: 0, minSent: 0 });
    await afterSync();
    await afterAction();

    // Extra settle time: with no bulk-ack to wait on, give any in-flight delivery/accept logic
    // time to finish before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Core assertion: neither broadcast ever appears in TechSupport's own local IN index. The
    // sender-side console log confirms the exclusion is enforced even earlier than expected:
    // Alice's own broadcastTalk() logs "no receivers resolved (no other active members in this
    // chatroom)" — TechSupport is excluded from the sender's own receiver-resolution step, so no
    // offer is even addressed to it. This is a stronger guarantee than a receiver-side reject
    // would be; acceptsIncomingTalks() in shouldAcceptIncomingTalkAsync (checked before any
    // type-specific match/ignore logic) remains the receiver-side backstop if that ever changes.
    expect(await incomingClustersIncludeTitleForUser(techSupportPage, TECHSUPPORT_ROOT_USER_ID, tagTitle)).toBe(false);
    expect(await incomingClustersIncludeTitleForUser(techSupportPage, TECHSUPPORT_ROOT_USER_ID, flowTitle)).toBe(false);

    // Headcount is unaffected by the broadcasts, on both sides.
    await expect(headcountOnAlice).toContainText('2', { timeout: 10_000 });
    const headcountOnTechSupport = techSupportPage.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    await expect(headcountOnTechSupport).toContainText('2', { timeout: 10_000 });

    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await alicePage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await techSupportPage.close();
    await alicePage.close();
    await techSupportContext.close();
    await aliceContext.close();
  });
});
