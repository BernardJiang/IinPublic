import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { supportQuestionKey } from '../../../../src/shared/techsupport-faq';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

/** Boots a browser in K3 TechSupport mode, mirroring spec 05/07. */
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

async function fetchGunGraph(): Promise<Record<string, any>> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
  return snapshot.gunGraph || {};
}

function faqBundleEntries(graph: Record<string, any>): Array<{ questionKey: string; answer: string }> {
  const bundle = graph['techsupport-faq/bundle'];
  if (typeof bundle?.entriesJson !== 'string') return [];
  try {
    return JSON.parse(bundle.entriesJson);
  } catch {
    return [];
  }
}

test.describe('TechSupport FAQ: a re-asked known question is a hit, not a re-answer (docs/TODO.md K5 Item 6)', () => {
  let browser: Browser;
  let userContext: BrowserContext;
  let userPage: Page;
  let techSupportContext: BrowserContext;
  let techSupportPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('question answered once, then TechSupport stops — the same question re-asked is auto-answered locally with no duplicate FAQ row or inbox regression', async () => {
    // 1. Ordinary user asks a brand-new question (miss path, spec 06) and keeps their tab open
    // for the whole test — this is the tab that will later prove the offline re-ask works.
    userContext = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    userPage = await userContext.newPage();
    userPage.on('console', (m) => console.log('[User]:', m.text()));
    await injectIdbClear(userPage);
    await gotoWebApp(userPage, webBaseURL());
    await ensureWindowFitsViewport(userPage, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(userPage, 'User1');

    await waitForTabActive(userPage, 'contacts');
    const supportContactRow = userPage.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.click();
    await afterNav();
    await expect(userPage.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const question = `How do I recalibrate the flux capacitor ${Date.now()}?`;
    const questionKey = supportQuestionKey(question);
    const answer = 'Hold the reset button for 5 seconds while the capacitor is unplugged.';
    await userPage.fill('#conversation-message-input', question);
    await userPage.click('#send-conversation-message');
    await afterSync();

    // 2. TechSupport boots (K3 mode), drains the mailbox, answers, then stops for good — no
    // TechSupport page exists for the rest of this test.
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);
    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();

    const inboxItem = techSupportPage.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 20_000 });
    await inboxItem.locator('.support-inbox-answer-input').fill(answer);
    await inboxItem.locator('.support-inbox-answer-btn').click();
    await afterSync();
    await expect(inboxItem).toHaveCount(0, { timeout: 15_000 });
    await expect(userPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });

    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await techSupportPage.close();
    await techSupportContext.close();

    // Snapshot state right after the one real answer: exactly one FAQ entry for this key, one
    // answered inbox entry.
    const graphAfterAnswer = await fetchGunGraph();
    const entriesAfterAnswer = faqBundleEntries(graphAfterAnswer).filter((e) => e.questionKey === questionKey);
    expect(entriesAfterAnswer).toHaveLength(1);
    expect(graphAfterAnswer[`techsupport-inbox/${questionKey}`]?.status).toBe('answered');

    // 3. TechSupport is gone. The SAME user's still-open tab re-asks the identical question.
    // This must be an instant local hit — no TechSupport process is running to answer it again.
    await userPage.fill('#conversation-message-input', question);
    await userPage.click('#send-conversation-message');
    await afterSync();

    // The re-ask renders the FAQ answer text again immediately (a second "answer" bubble, not a
    // new ack) — confirms the client took the 'known' branch of handleSupportQuestion locally.
    const answerBubbles = userPage.locator('#conversation-messages').getByText(answer, { exact: false });
    await expect(answerBubbles).toHaveCount(2, { timeout: 15_000 });

    // 4. No duplicate FAQ row and no inbox regression: handleSupportQuestion's 'known' branch never
    // calls postSupportQuestionToMailbox, so the re-ask cannot touch techsupport-inbox at all, and
    // upsertSupportFaqEntry is never invoked a second time for the same key by this path.
    const graphAfterReask = await fetchGunGraph();
    const entriesAfterReask = faqBundleEntries(graphAfterReask).filter((e) => e.questionKey === questionKey);
    expect(entriesAfterReask).toHaveLength(1);
    expect(entriesAfterReask[0].answer).toBe(answer);
    expect(graphAfterReask[`techsupport-inbox/${questionKey}`]?.status).toBe('answered');

    await userPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await userPage.close();
    await userContext.close();
  });
});
