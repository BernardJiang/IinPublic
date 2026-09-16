/**
 * Physical-device variant of ../staged/stage2-two-user/00n-techsupport-conversation-answer-flow:
 * the ordinary "asker" runs on a real Android phone (over adb/WebView, not a desktop browser);
 * TechSupport stays a desktop K3-mode browser, since only the OPERATOR side
 * (findOrCreateDirectConversation / ensureSupportConversationRecord, app.ts) was ever part of
 * the bug this regression-guards — the ordinary user's own side never needed the fix. Both
 * point at this suite's own hub/web servers (native-app/playwright.config.ts), never the main
 * config's parallelSlot()-derived ports.
 *
 * Unlike every other native-app spec that runs entirely on this Mac, the phone is a physically
 * separate machine — adb over USB is only the automation control channel; the app's own network
 * traffic goes over Wi-Fi/LAN, so hubGunUrl below must be this Mac's real LAN IP, never
 * 127.0.0.1. Phone and Mac must be on the same network.
 *
 * Opt-in, real-hardware test: skips itself (does not fail) unless
 * E2E_REAL_ANDROID_TECHSUPPORT_ANSWER=1 is set and a configured/overridden adb device is
 * connected and authorized. See tests/e2e/native-app/05-android-device-boots.spec.ts's own
 * header comment for one-time phone setup (USB debugging, `adb devices` showing "device").
 */
import { test, expect, chromium, type Browser as PlaywrightBrowser, type BrowserContext, type Page } from '@playwright/test';
import * as os from 'os';
import {
  launchAndroidUserViaAdb,
  closeAndroidUser,
  clearAndroidE2ETestProjections,
  isAndroidDeviceReady,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { bootstrapNativeWindow, forceJoinGlobal } from './helpers/native-app';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { ensureWindowFitsViewport } from '../helpers/browser-window';
import { afterLoad, afterNav, afterSync, delay, headless } from '../helpers/timing';
import { attachE2eBrowserTabLabel } from '../helpers/e2e-tab-title';
import { expectCurrentUserIsTechSupportRoot } from '../helpers/techsupport-contract';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../src/shared/techsupport';
import { loadRealTechSupportPair } from '../helpers/techsupport-real-pair';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
// Mirrors native-app/playwright.config.ts's own derivation exactly — the static web server
// (scripts/e2e-static-web.mjs) derives its Gun hub port from its OWN port using this same
// offset, so the desktop TechSupport browser below must load from this exact web port for its
// app code to find the right hub.
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
const RUN = process.env.E2E_REAL_ANDROID_TECHSUPPORT_ANSWER === '1';

// Rotated 2026-09-16: the real TechSupport signing key lives only in this machine's own
// `.env.local` (never committed — see techsupport.ts's TECHSUPPORT_PUB doc comment), loaded at
// runtime instead of hardcoded. The describe block below skips entirely when it's absent, so
// every usage past that guard is safe despite the type assertion here.
const REAL_PAIR = loadRealTechSupportPair();
const DEV_PAIR = REAL_PAIR as NonNullable<typeof REAL_PAIR>;

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

/** Desktop TechSupport session (K3 mode: real signed DM keypair), pointed at this suite's own
 *  web/hub servers — mirrors 00n-techsupport-conversation-answer-flow.spec.ts's helper of the
 *  same name, just against WEB_PORT instead of the main config's webBaseURL(). */
async function bootstrapTechSupportMode(browser: PlaywrightBrowser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 720, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await injectIdbClear(page);
  await context.addInitScript(
    ({ userId, keypairStorageKey, pairJson }) => {
      window.localStorage.setItem('iinpublic_user_id', userId);
      window.localStorage.setItem(keypairStorageKey, pairJson);
    },
    { userId: TECHSUPPORT_ROOT_USER_ID, keypairStorageKey: 'iinpublic_techsupport_keypair_v1', pairJson: JSON.stringify(DEV_PAIR) },
  );
  await gotoWebApp(page, `http://127.0.0.1:${WEB_PORT}`);
  await ensureWindowFitsViewport(page, 720, 960);
  await afterLoad();
  attachE2eBrowserTabLabel(page, 'TechSupport');
  return { context, page };
}

test.describe('Native app: Android user + desktop TechSupport operator conversation', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_TECHSUPPORT_ANSWER=1 to run this physical-device test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL to the target adb serial (or configure it in matrix/devices.json).');
  test.skip(!REAL_PAIR, 'Set TECHSUPPORT_SEA_PAIR_JSON in .env.local to run this TechSupport-mode spec.');

  let androidUser: AndroidUser | undefined;
  let desktopBrowser: PlaywrightBrowser | undefined;
  let techSupportContext: BrowserContext | undefined;
  let techSupportPage: Page | undefined;

  test.afterEach(async () => {
    if (androidUser) await clearAndroidE2ETestProjections(androidUser);
    await closeAndroidUser(androidUser);
    androidUser = undefined;
    await techSupportPage?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await techSupportContext?.close().catch(() => {});
    await desktopBrowser?.close().catch(() => {});
    techSupportPage = undefined;
    techSupportContext = undefined;
    desktopBrowser = undefined;
  });

  test('phone user asks several questions; desktop TechSupport operator answers via the ordinary conversation UI', async () => {
    test.setTimeout(240_000);
    const deviceReady = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!deviceReady, `Configured adb device ${ANDROID_SERIAL} is unavailable — connect it with USB debugging enabled.`);

    // Any "server persist failed" / "Not a TechSupport conversation id" console line is exactly
    // the regression this spec (and its desktop sibling, 00n) exists to catch.
    const regressionErrors: string[] = [];

    // 1. Ordinary user, on the real phone. The app's own JS bundle here is whatever is already
    // installed on the device (npm run android:build && npm run android:install to refresh it)
    // — but that's fine for this side: the ordinary user's own path to the support conversation
    // was never part of the bug, only the OPERATOR's (desktop, below) was.
    // resetAppData: true — without it, a stale identity/conversation from an earlier run on
    // this same physical device (force-stop/relaunch alone does not wipe app data) leaks into
    // this run, per this project's own reference_android_test_devices memory ("Real gap found
    // (harness, not app)": pm clear is required between independent native-app spec runs on
    // the same device or the second run inherits the first's on-device identity).
    androidUser = await launchAndroidUserViaAdb({
      deviceSerial: ANDROID_SERIAL,
      hubGunUrl: `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`,
      resetAppData: true,
    });
    androidUser.window.on('console', (message) => {
      const text = message.text();
      if (/persist failed|Not a TechSupport conversation id/i.test(text)) regressionErrors.push(`[phone] ${text}`);
    });

    const stageName = `Android Support Asker ${Date.now()}`;
    const userId = await bootstrapNativeWindow(androidUser.window, stageName, {
      readinessTimeoutMs: 110_000,
    });
    expect(userId).toBeTruthy();
    // bootstrapNativeWindow's own implicit chatrooms-tab visit isn't reliable enough for
    // TechSupport (a separate desktop process/device) to see this phone in Global's member
    // list — forceJoinGlobal's explicit HTTP membership publish is the same belt-and-suspenders
    // real hardware/LAN specs elsewhere in this suite (06-seven-client-real-device-matrix) rely
    // on for exactly this reason.
    await forceJoinGlobal(androidUser.window);

    await androidUser.window.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const supportRow = androidUser.window.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(supportRow).toBeVisible({ timeout: 15_000 });
    await supportRow.locator('.contact-item-name').click();
    await expect(androidUser.window.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(androidUser.window.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const questions = [
      `Why does the app show me offline when I'm online ${Date.now()}?`,
      `Can I change my display name after signup ${Date.now()}?`,
    ];
    const answers = [
      'Presence updates every few seconds — give it a moment and it should flip to online.',
      'Yes — Settings > Profile lets you change your display name any time.',
    ];

    for (const question of questions) {
      await androidUser.window.locator('#conversation-message-input').fill(question);
      await androidUser.window.locator('#send-conversation-message').click();
      await expect(androidUser.window.locator('#conversation-messages')).toContainText('will get back to you', { timeout: 15_000 });
      await afterSync();
    }

    // 2. TechSupport, on a desktop browser (K3 mode), reaches the SAME conversation. The
    // desktop-only sibling spec (00n) does this via a literal click on the peer's row in a
    // shared chatroom's member list; that discovery step doesn't work here because the Android
    // build runs its own embedded Node server on the device (port 8088) which relays to the
    // remote hub, and this device's chatroom-membership write never became visible to the
    // desktop browser's own direct connection to that hub within any reasonable wait — a
    // real, separate presence-propagation question about the embedded-node build against a
    // non-production hub, unrelated to the conversation-routing bug this spec exists to guard.
    // Emitting the SAME 'openDirectConversation' event a real click would (app.ts's handler
    // calls the exact findOrCreateDirectConversation/ensureSupportConversationRecord code this
    // spec is verifying) reaches the identical conversation without depending on that
    // discovery step.
    // headless mirrors every other spec in this suite (!!process.env.CI) — visible locally by
    // default, so you can actually watch the operator side answer, not just trust a green
    // assertion. This was previously hardcoded to true, which is why it never showed up.
    // slowMo paces the clicks/typing so a human watching can actually follow along.
    desktopBrowser = await chromium.launch({ headless, slowMo: headless ? 0 : delay(50, 150) });
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(desktopBrowser));
    techSupportPage.on('console', (message) => {
      const text = message.text();
      if (/persist failed|Not a TechSupport conversation id/i.test(text)) regressionErrors.push(`[techsupport] ${text}`);
    });
    await expectCurrentUserIsTechSupportRoot(techSupportPage);

    const conversationId = await techSupportPage.evaluate(
      ({ peerId, peerName }) =>
        new Promise<string>((resolve, reject) => {
          const app = (window as any).__iinpublic_app.getApp();
          app.uiManager.emit('openDirectConversation', { peerId, peerName, resolve, reject });
        }),
      { peerId: userId, peerName: stageName },
    );
    expect(conversationId).toBe(`conv_support_${TECHSUPPORT_ROOT_USER_ID}_${userId}`);
    await techSupportPage.evaluate((cid) => {
      (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(cid);
    }, conversationId);
    await expect(techSupportPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });

    // All questions (and their auto-acks) are visible from the operator's side — proof this is
    // the SAME conversation the phone has been writing into, not a disconnected one.
    for (const question of questions) {
      await expect(techSupportPage.locator('#conversation-messages')).toContainText(question, { timeout: 60_000 });
    }

    for (const answer of answers) {
      await techSupportPage.locator('#conversation-message-input').fill(answer);
      await techSupportPage.locator('#send-conversation-message').click();
      await afterSync();
    }

    // 3. The phone's already-open thread receives every reply.
    for (const answer of answers) {
      await expect(androidUser.window.locator('#conversation-messages')).toContainText(answer, { timeout: 60_000 });
    }

    expect(regressionErrors).toEqual([]);

    // Hold both screens visible for a few seconds after the assertions pass — afterEach tears
    // everything down (force-stops the phone app, closes the desktop browser) immediately
    // otherwise, easy to miss if you're watching for it.
    if (!headless) await new Promise((resolve) => setTimeout(resolve, 5_000));
  });
});
