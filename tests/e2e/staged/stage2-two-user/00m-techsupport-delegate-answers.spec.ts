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

test.describe('TechSupport delegation: master issues a grant, a delegate answers as TechSupport (docs/TODO.md K7)', () => {
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

  test('issue a grant to Dana, she opts in and answers Amy without ever holding the master key, and the master audits it', async () => {
    // 1. Dana is an ordinary registered user, the person about to be turned into a support agent.
    const dana = await bootstrapUser(browser, 'Dana Delegate', 'Dana');
    danaContext = dana.context;
    danaPage = dana.page;
    const danaUserId = await currentUserId(danaPage);
    expect(danaUserId).toBeTruthy();

    // 2. The master (holding the real DM key) generates a one-time invite code, Dana enters it on
    // her own device to send a signed request, and the master reviews + approves it into a real
    // grant — the ONLY step that ever touches the master key. Dana's own device never sees it, and
    // the master never has to type her raw user id.
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

    // 3. Dana enters the code in her own Settings — no grant exists for her yet, so she gets the
    // "become a support delegate" entry form rather than the opt-in toggle.
    await danaPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await danaPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await danaPage.fill('#support-delegate-invite-code-input', inviteCode);
    await danaPage.click('#support-delegate-invite-code-submit');
    await expect(danaPage.locator('#support-delegate-invite-code-status')).toBeVisible({ timeout: 10_000 });

    // 4. The master's panel picks up Dana's signed request live and lists it for review.
    const pendingRow = techSupportPage.locator('.support-delegate-pending-item', { hasText: danaUserId });
    await expect(pendingRow).toBeVisible({ timeout: 20_000 });
    await pendingRow.locator('[data-testid="support-delegate-pending-label"]').fill("Dana's laptop");
    await pendingRow.locator('[data-testid="support-delegate-approve-btn"]').click();
    await afterSync();
    await expect(techSupportPage.locator('.support-delegate-item', { hasText: "Dana's laptop" })).toBeVisible({ timeout: 15_000 });

    // 5. Dana's own client picks up the grant live (her eligibility state updates even while
    // she's on another tab) and shows the opt-in prompt once she visits Settings — holding a
    // valid grant must not silently enable anything on its own.
    await danaPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await danaPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    const optInToggle = danaPage.locator('#support-delegate-optin-toggle');
    await expect(optInToggle).toBeVisible({ timeout: 20_000 });
    await expect(optInToggle).not.toBeChecked();
    await optInToggle.check();
    await afterSync();
    await expect(danaPage.locator('#support-inbox-section')).toBeVisible({ timeout: 10_000 });

    const danaPub = await currentUserPub(danaPage);
    expect(danaPub).toBeTruthy();

    // 6. Amy is a different ordinary user with no idea any of this happened. Before she asks her
    // question, her own client must have already cached Dana's grant live (fan-out addresses the
    // question envelope to every currently-valid delegate at send time).
    const amy = await bootstrapUser(browser, 'Amy Asker', 'Amy');
    amyContext = amy.context;
    amyPage = amy.page;
    await expect
      .poll(
        () => amyPage!.evaluate((pub) => {
          try {
            const raw = localStorage.getItem('iinpublic_techsupport_delegate_grants_v1');
            const all = raw ? JSON.parse(raw) : {};
            return Object.prototype.hasOwnProperty.call(all, pub);
          } catch {
            return false;
          }
        }, danaPub),
        { timeout: 20_000 },
      )
      .toBe(true);

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

    // 7. Dana — not the master — sees and answers the pending question from her own device.
    const inboxItem = danaPage.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 20_000 });
    await inboxItem.locator('.support-inbox-answer-input').fill(answer);
    await inboxItem.locator('.support-inbox-answer-btn').click();
    await afterSync();
    await expect(inboxItem).toHaveCount(0, { timeout: 15_000 });

    // 8. Amy receives the real answer, still attributed to TechSupport — never learns Dana exists.
    await expect(amyPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });

    // 9. The master's own audit view — never Dana's or Amy's — shows who actually answered. The
    // published `canonicalQuestion` is normalized (lowercased) from the raw asked text.
    await expect(techSupportPage.locator('#support-delegates-section')).toContainText(
      new RegExp(question.slice(0, 20), 'i'),
      { timeout: 20_000 },
    );
    await expect(techSupportPage.locator('#support-delegates-section')).toContainText(danaPub.slice(0, 12), { timeout: 5_000 });
  });
});
