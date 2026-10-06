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

// Same real-key handling as 00m: skips entirely without TECHSUPPORT_SEA_PAIR_JSON in .env.local.
const REAL_PAIR = loadRealTechSupportPair();
const DEV_PAIR = REAL_PAIR as NonNullable<typeof REAL_PAIR>;

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

test.describe('TechSupport delegation: remote invite to a named user, no code or QR', () => {
  test.skip(!REAL_PAIR, 'Set TECHSUPPORT_SEA_PAIR_JSON in .env.local to run this TechSupport-mode spec.');

  let browser: Browser;
  let danaContext: BrowserContext | undefined;
  let danaPage: Page | undefined;
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
    await techSupportPage?.close().catch(() => {});
    await danaContext?.close().catch(() => {});
    await techSupportContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('master invites Dana by user id; Dana accepts in her own Settings; master approves', async () => {
    const dana = await bootstrapUser(browser, 'Dana Delegate', 'Dana');
    danaContext = dana.context;
    danaPage = dana.page;
    const danaUserId = await currentUserId(danaPage);
    expect(danaUserId).toBeTruthy();

    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);
    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();

    // The master looks Dana up, sees her name before sending, then sends — nothing is shown or scanned.
    await techSupportPage.click('#support-delegate-invite-user-btn');
    await techSupportPage.fill('[data-testid="support-delegate-targeted-userid"]', danaUserId);
    await techSupportPage.click('[data-testid="support-delegate-targeted-lookup"]');
    const status = techSupportPage.locator('[data-testid="support-delegate-targeted-status"]');
    await expect(status).toContainText('Dana', { timeout: 10_000 });
    await techSupportPage.click('[data-testid="support-delegate-targeted-send"]');
    await expect(status).toContainText('Invite sent', { timeout: 10_000 });
    await techSupportPage.click('#support-delegate-targeted-cancel');

    // Dana discovers the invite addressed to her identity (relay poll) and accepts it.
    await danaPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await danaPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(danaPage, SETTINGS_SECTION.supportDelegate);
    const accept = danaPage.locator('[data-testid="support-delegate-targeted-accept"]');
    await expect(accept).toBeVisible({ timeout: 60_000 });
    await accept.click();
    await expect(danaPage.locator('[data-testid="support-delegate-targeted-invite"]')).toHaveCount(0, { timeout: 10_000 });

    // The signed request still needs the master's explicit approval, exactly like the code path.
    const pendingRow = techSupportPage.locator('.support-delegate-pending-item', { hasText: danaUserId });
    await expect(pendingRow).toBeVisible({ timeout: 60_000 });
    await pendingRow.locator('[data-testid="support-delegate-approve-btn"]').click();
    await afterSync();
    await expect(techSupportPage.locator('.support-delegate-item', { hasText: danaUserId })).toBeVisible({ timeout: 15_000 });

    await danaPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await danaPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(danaPage, SETTINGS_SECTION.supportDelegate);
    await expect(danaPage.locator('#support-delegate-optin-toggle')).toBeVisible({ timeout: 30_000 });
  });
});
