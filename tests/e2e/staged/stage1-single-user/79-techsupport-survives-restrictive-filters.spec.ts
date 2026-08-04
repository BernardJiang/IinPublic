/**
 * TODO §K6 test 2: set maximally restrictive intake filters (language, distance, age,
 * grammar, dirty words) — a TechSupport DM still arrives.
 *
 * TalkIntakeFilters gate the *talk* delivery path only (`talkPassesIntakeFilters`,
 * called from `shouldAcceptIncomingTalkAsync`) — the support conversation is plain
 * DM messaging, never a talk, so it is structurally outside that pipeline. This test
 * proves that holds even when every dimension of the filter is maxed out and the user
 * is not age-verified (the strictest possible receiver configuration): the signed
 * greeting still renders, and a live round-trip through TechSupport's FAQ auto-answer
 * still delivers.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

/** Boots a browser in K3 TechSupport mode, mirroring spec 07/09. */
async function bootstrapTechSupportMode(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
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
  await gotoWebApp(page, webBaseURL());
  await ensureWindowFitsViewport(page, 720, 960);
  await afterLoad();
  attachE2eBrowserTabLabel(page, 'TechSupport');
  return { context, page };
}

test.describe('TechSupport DM survives maximally restrictive intake filters (docs/TODO.md K6)', () => {
  let browser: Browser;
  let userContext: BrowserContext;
  let userPage: Page;
  let techSupportContext: BrowserContext;
  let techSupportPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless: true,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('greeting renders and a new-question round trip completes with every filter maxed out', async () => {
    userContext = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    userPage = await userContext.newPage();
    userPage.on('console', (m) => console.log('[User]:', m.text()));
    await injectIdbClear(userPage);
    await gotoWebApp(userPage, webBaseURL());
    await ensureWindowFitsViewport(userPage, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(userPage, 'FilterUser');

    // Maximally restrictive: a language nobody sends in, a zero-mile radius, grammar +
    // dirty-word gates on, and (implicitly, by never age-verifying) the strictest adult
    // gate too. `talkPassesIntakeFilters` is what these gate — never the support channel.
    await userPage.evaluate(() => {
      const filters = {
        minDistanceMiles: 0,
        maxDistanceMiles: 0,
        allowedLanguages: ['xx'],
        requireGoodGrammar: true,
        blockDirtyWords: true,
        allowedTalkTypes: [],
        customBlockedTerms: ['*'],
        dirtyWords: ['*'],
      };
      window.localStorage.setItem('iinpublic_talk_intake_filters', JSON.stringify(filters));
    });

    await waitForTabActive(userPage, 'contacts');
    const supportContactRow = userPage.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.locator(".contact-item-name").click(); // tap the name — row tap alone no longer opens the DM (contacts-view.ts tap-target split)
    await afterNav();
    // The signed greeting template (K2) renders locally with zero TechSupport-device
    // involvement — first proof the support channel ignores intake filters entirely.
    await expect(userPage.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const question = `Filters maxed out, does this still arrive ${Date.now()}?`;
    await userPage.fill('#conversation-message-input', question);
    await userPage.click('#send-conversation-message');
    await afterSync();
    await expect(userPage.locator('#conversation-messages')).toContainText(question, { timeout: 15_000 });

    // TechSupport boots, drains the mailbox, and answers — the miss/answer round trip
    // (K5) also has to reach this receiver despite the same maxed-out filters still
    // being in effect on their device the whole time.
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);
    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();

    const answer = 'Filters only gate talk delivery, never the support DM channel.';
    const inboxItem = techSupportPage.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 20_000 });
    await inboxItem.locator('.support-inbox-answer-input').fill(answer);
    await inboxItem.locator('.support-inbox-answer-btn').click();
    await afterSync();
    await expect(userPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });

    // The filters are still exactly as restrictive as they started — this wasn't a
    // side-effect of the test relaxing them at any point.
    const stillMaxed = await userPage.evaluate(() => {
      const raw = window.localStorage.getItem('iinpublic_talk_intake_filters');
      const filters = raw ? JSON.parse(raw) : null;
      return filters?.maxDistanceMiles === 0 && filters?.allowedLanguages?.[0] === 'xx';
    });
    expect(stillMaxed).toBe(true);

    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await techSupportPage.close();
    await techSupportContext.close();
    await userPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await userPage.close();
    await userContext.close();
  });
});
