import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME, isTrustedTechSupportDmPub } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

const DM_TEXT = 'This is TechSupport, operating from a real signed device identity.';

/** Boots a browser in K3 TechSupport mode: injects the root id AND the canonical DM pair
 * before navigation, mirroring what `scripts/dev-techsupport-login.js` does for a real operator. */
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

async function readTechSupportPublishedPub(): Promise<string | undefined> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBeTruthy();
  const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
  return snapshot.gunGraph?.[`users/${TECHSUPPORT_ROOT_USER_ID}`]?.pub;
}

test.describe('TechSupport-mode boot authenticates with the canonical DM key (docs/TODO.md K3)', () => {
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

  test('operator boots as TechSupport with the canonical pub, sends a DM, receiver sees a trusted-key author', async () => {
    // Ordinary user first, so its support conversation with TechSupport exists.
    userContext = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    userPage = await userContext.newPage();
    userPage.on('console', (m) => console.log('[User]:', m.text()));
    await injectIdbClear(userPage);
    await gotoWebApp(userPage, webBaseURL());
    await ensureWindowFitsViewport(userPage, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(userPage, 'User1');

    const userId = await userPage.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    expect(userId).toBeTruthy();
    const conversationId = `conv_support_${TECHSUPPORT_ROOT_USER_ID}_${userId}`;

    // Boot a second browser in TechSupport mode (K3) — the same client, authenticated with the
    // canonical DM pair rather than a freshly generated device pair.
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);

    // The core K3 assertion: the authenticated Gun identity really is the canonical pub, not a
    // random one. Under the pre-K3 dev login this would be a freshly generated SEA.pair() whose
    // pub never matches TECHSUPPORT_PUB.
    const techSupportStoredPub = await techSupportPage.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub,
    );
    expect(techSupportStoredPub).toBe(TECHSUPPORT_PUB);

    // `initializeUser()` publishes pub/epub to the TechSupport user record the first time it
    // sees no `pub` set there (the E2E baseline seed does not set one) — this is the
    // receiver-visible proof that the operator authenticated with the canonical key.
    await expect.poll(() => readTechSupportPublishedPub(), { timeout: 15_000 }).toBe(TECHSUPPORT_PUB);

    // TechSupport posts a DM to the user's support conversation, driving the real send path
    // (never fabricating a record client-side) so the message is genuinely authored by this
    // authenticated Gun identity.
    await techSupportPage.evaluate(
      ({ cid, uid, text, stageName }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.conversationService?.sendMessage?.(cid, 'iinpublic-root-techsupport', text, {
          otherUserId: uid,
          isFromChatbot: false,
        });
      },
      { cid: conversationId, uid: userId, text: DM_TEXT, stageName: TECHSUPPORT_STAGE_NAME },
    );

    // Receiver side: the message renders in the support thread (a durable rendered-content
    // signal, not a toast) once Gun syncs it.
    await waitForTabActive(userPage, 'contacts');
    const supportContactRow = userPage.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.click();
    await afterNav();
    await expect(userPage.locator('#conversation-messages')).toContainText(DM_TEXT, { timeout: 20_000 });

    // Receiver-side authenticity check: the message's claimed author (senderId) has a published
    // identity key that is a trusted DM anchor — the concrete, buildable form of "the client
    // verifies the signature against TECHSUPPORT_PUB" this scenario proves today. (Per-message
    // signing for ad hoc operator DMs, beyond the K2 greeting template, is not yet built; this is
    // the identity-level guarantee K3 actually delivers.)
    const authorPub = await readTechSupportPublishedPub();
    expect(isTrustedTechSupportDmPub(authorPub)).toBe(true);

    await userPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await userPage.close();
    await techSupportPage.close();
    await userContext.close();
    await techSupportContext.close();
  });
});
