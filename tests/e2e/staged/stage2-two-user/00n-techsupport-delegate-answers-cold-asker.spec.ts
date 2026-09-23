import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { loadRealTechSupportPair } from '../../helpers/techsupport-real-pair';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

// Rotated 2026-09-16: the real TechSupport signing key lives only in this machine's own
// `.env.local` (never committed — see techsupport.ts's TECHSUPPORT_PUB doc comment), loaded at
// runtime instead of hardcoded. The describe block below skips entirely when it's absent, so
// every usage past that guard is safe despite the type assertion here.
const REAL_PAIR = loadRealTechSupportPair();
const DEV_PAIR = REAL_PAIR as NonNullable<typeof REAL_PAIR>;

/** Boots a browser in K3 TechSupport mode, mirroring stage1 specs 05/07/09. */
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

async function currentUserId(page: Page): Promise<string> {
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
}

async function currentUserPub(page: Page): Promise<string> {
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || ''));
}

test.describe('TechSupport delegation: a cold asker (never previously synced the delegate roster) still reaches the delegate (real-device regression, 2026-09-23)', () => {
  test.skip(!REAL_PAIR, 'Set TECHSUPPORT_SEA_PAIR_JSON in .env.local to run this TechSupport-mode spec.');

  let browser: Browser;
  let danaContext: BrowserContext | undefined;
  let danaPage: Page | undefined;
  let amyContext: BrowserContext | undefined;
  let amyPage: Page | undefined;
  let techSupportContext: BrowserContext | undefined;
  let techSupportPage: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1300', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await danaPage?.close().catch(() => {});
    await amyPage?.close().catch(() => {});
    await techSupportPage?.close().catch(() => {});
    await danaContext?.close().catch(() => {});
    await amyContext?.close().catch(() => {});
    await techSupportContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('Amy asks the instant she opens the app, before her own client has ever synced the delegate roster — Dana must still get the envelope', async () => {
    // 1. Dana is an ordinary registered user, about to be turned into a support agent.
    const dana = await bootstrapUser(browser, 'Dana Delegate', 'Dana');
    danaContext = dana.context;
    danaPage = dana.page;
    const danaUserId = await currentUserId(danaPage);
    expect(danaUserId).toBeTruthy();

    // 2. Master issues Dana a grant via the invite handshake (mirrors 00m).
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);
    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await techSupportPage.click('#support-delegate-invite-btn');
    const inviteCode = (await techSupportPage.locator('[data-testid="support-delegate-invite-code"]').textContent())?.trim() || '';
    expect(inviteCode).toBeTruthy();
    await techSupportPage.click('#support-delegate-invite-done');

    await danaPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await danaPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(danaPage, SETTINGS_SECTION.supportDelegate);
    await danaPage.fill('#support-delegate-invite-code-input', inviteCode);
    await danaPage.click('#support-delegate-invite-code-submit');
    await expect(danaPage.locator('#support-delegate-invite-code-status')).toBeVisible({ timeout: 10_000 });

    const pendingRow = techSupportPage.locator('.support-delegate-pending-item', { hasText: danaUserId });
    await expect(pendingRow).toBeVisible({ timeout: 20_000 });
    await pendingRow.locator('[data-testid="support-delegate-pending-label"]').fill("Dana's laptop");
    await pendingRow.locator('[data-testid="support-delegate-approve-btn"]').click();
    await afterSync();
    await expect(techSupportPage.locator('.support-delegate-item', { hasText: "Dana's laptop" })).toBeVisible({ timeout: 15_000 });

    await danaPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await danaPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(danaPage, SETTINGS_SECTION.supportDelegate);
    const optInToggle = danaPage.locator('#support-delegate-optin-toggle');
    await expect(optInToggle).toBeVisible({ timeout: 20_000 });
    await expect(optInToggle).not.toBeChecked();
    await optInToggle.check();
    await afterSync();
    await expect(danaPage.locator('#support-inbox-section')).toBeVisible({ timeout: 10_000 });

    const danaPub = await currentUserPub(danaPage);
    expect(danaPub).toBeTruthy();

    // 3. THE ACTUAL DIFFERENCE FROM 00m: Amy is bootstrapped and asks her question IMMEDIATELY,
    // with no wait for her client's `iinpublic_techsupport_delegate_grants_v1` localStorage cache
    // to have ever observed Dana's grant beforehand — mirroring a real device's very first
    // question after a fresh install (confirmed live 2026-09-23 against a real Huawei phone: the
    // asker's device had never previously fetched/cached the delegate roster before asking).
    // postSupportQuestionToMailbox's own synchronous fetchDelegateGrantsFromServer call at
    // send-time is the ONLY thing that can make fan-out to Dana work here — there is no warm
    // cache and no live Gun subscription to fall back on.
    const amy = await bootstrapUser(browser, 'Amy Asker', 'Amy');
    amyContext = amy.context;
    amyPage = amy.page;

    await amyPage.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const supportRow = amyPage.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportRow.locator('.contact-item-name').click();
    await afterNav();
    await expect(amyPage.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const question = `Why won't my dilithium chamber sync at ${Date.now()}?`;
    const answer = 'Reseat the dilithium chamber and let it recalibrate for 30 seconds.';
    await amyPage.fill('#conversation-message-input', question);
    await amyPage.click('#send-conversation-message');
    await afterSync();
    await expect(amyPage.locator('#conversation-messages')).toContainText('will get back to you', { timeout: 15_000 });

    // 4. Dana — a cold asker's delegate — must still see the pending question in her own inbox.
    // This is the exact assertion that fails against production today (envelope only ever
    // reaches the master's mailbox, never the delegate's).
    const inboxItem = danaPage.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 20_000 });
    await inboxItem.locator('.support-inbox-answer-input').fill(answer);
    await inboxItem.locator('.support-inbox-answer-btn').click();
    await afterSync();
    await expect(inboxItem).toHaveCount(0, { timeout: 15_000 });

    await expect(amyPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });
  });
});
