/**
 * Real-hardware variant of ../staged/stage2-two-user/00m-techsupport-delegate-answers: instead of
 * three desktop-browser contexts, the delegate and one asker run on real Android phones (over
 * adb/WebView) and the second asker runs the packaged macOS Electron app — the "turn a phone into
 * a TechSupport agent without ever putting the master key on it" scenario from
 * docs/design/techsupport-k7-design-note.md, exercised end to end on the actual physical devices
 * this project develops against (see reference_android_test_devices memory: android-bob /
 * PM1LHMA7A2707315 is the Essential Phone, android-charlie / RNV0217207000190 is the Honor phone).
 *
 * Topology:
 * - TechSupport root: desktop browser, K3 mode (real signed DM keypair) — the only participant
 *   that ever touches the master private key, exactly once, to issue Honor's delegate grant.
 * - Honor phone (android-charlie): boots as an ordinary user, redeems a master-issued invite code,
 *   opts in, and answers both askers' questions signed with her OWN key — never the master's.
 * - Essential phone (android-bob): ordinary asker, asks TechSupport a question over adb/WebView.
 * - MacMini app (packaged Electron build, platforms/desktop/dist/mac-arm64): ordinary asker, asks
 *   a second, independent question.
 *
 * Both phones and the Electron app plus the desktop TechSupport browser share this suite's own
 * hub/web servers (native-app/playwright.config.ts), never the main config's parallelSlot()-derived
 * ports. Phones reach the hub over the real LAN (adb over USB is only the automation control
 * channel); the Electron app and the desktop TechSupport browser use loopback.
 *
 * Opt-in, real-hardware test: skips itself (does not fail) unless
 * E2E_REAL_ANDROID_TECHSUPPORT_DELEGATE=1 is set and both configured Android devices are connected
 * and authorized (adb devices). See 05-android-device-boots.spec.ts's header for one-time phone
 * setup (USB debugging).
 */
import { chromium, test, expect, type Browser as PlaywrightBrowser, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  launchAndroidUserViaAdb,
  closeAndroidUser,
  clearAndroidE2ETestProjections,
  isAndroidDeviceReady,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { bootstrapNativeWindow, forceJoinGlobal, launchNativeUser, type NativeUser } from './helpers/native-app';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { ensureWindowFitsViewport } from '../helpers/browser-window';
import { afterLoad, afterNav, afterSync, delay, headless } from '../helpers/timing';
import { attachE2eBrowserTabLabel } from '../helpers/e2e-tab-title';
import { expectCurrentUserIsTechSupportRoot } from '../helpers/techsupport-contract';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../src/shared/techsupport';
import { loadRealTechSupportPair } from '../helpers/techsupport-real-pair';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
// Mirrors native-app/playwright.config.ts's own derivation exactly (see 08's identical comment).
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
// Distinct from every localPort already used by other native-app specs (19111/19121/19122/19141/19161).
const ELECTRON_LOCAL_PORT = 19171;

const CONFIGURED = configuredAndroidDevices();
const DELEGATE_SERIAL =
  process.env.NATIVE_APP_ANDROID_SERIAL_DELEGATE?.trim() || CONFIGURED.find((d) => d.name === 'android-charlie')?.serial || '';
const ASKER_SERIAL =
  process.env.NATIVE_APP_ANDROID_SERIAL_ASKER?.trim() || CONFIGURED.find((d) => d.name === 'android-bob')?.serial || '';
const RUN = process.env.E2E_REAL_ANDROID_TECHSUPPORT_DELEGATE === '1';

// Rotated 2026-09-16: the real TechSupport signing key lives only in this machine's own
// `.env.local` (never committed), loaded at runtime instead of hardcoded. The describe block
// below skips entirely when it's absent, so every usage past that guard is safe despite the type
// assertion here.
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
 *  web/hub servers — mirrors 00m/08's helper of the same name, just against WEB_PORT. */
async function bootstrapTechSupportMode(browser: PlaywrightBrowser): Promise<{ context: BrowserContext; page: Page }> {
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
  await gotoWebApp(page, `http://127.0.0.1:${WEB_PORT}`);
  await ensureWindowFitsViewport(page, 720, 960);
  await afterLoad();
  attachE2eBrowserTabLabel(page, 'TechSupport');
  return { context, page };
}

async function currentUserPub(page: Page): Promise<string> {
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || ''));
}

async function askTechSupport(page: Page, question: string): Promise<void> {
  await page.click('.nav-btn[data-view="contacts"]');
  await afterNav();
  const supportRow = page.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
  await expect(supportRow).toBeVisible({ timeout: 20_000 });
  await supportRow.locator('.contact-item-name').click();
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });
  await page.locator('#conversation-message-input').fill(question);
  await page.locator('#send-conversation-message').click();
  await expect(page.locator('#conversation-messages')).toContainText('will get back to you', { timeout: 15_000 });
}

test.describe('Native app: a real Honor phone is a TechSupport delegate, answering a real Essential phone and the MacMini Electron app', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_TECHSUPPORT_DELEGATE=1 to run this physical-device test.');
  test.skip(!DELEGATE_SERIAL, 'Configure the delegate ("android-charlie"/Honor) device in tests/matrix/devices.json or set NATIVE_APP_ANDROID_SERIAL_DELEGATE.');
  test.skip(!ASKER_SERIAL, 'Configure the asker ("android-bob"/Essential) device in tests/matrix/devices.json or set NATIVE_APP_ANDROID_SERIAL_ASKER.');
  test.skip(!REAL_PAIR, 'Set TECHSUPPORT_SEA_PAIR_JSON in .env.local to run this TechSupport-mode spec.');

  let honor: AndroidUser | undefined;
  let essential: AndroidUser | undefined;
  let electron: NativeUser | undefined;
  let userDataDir = '';
  let techSupportBrowser: PlaywrightBrowser | undefined;
  let techSupportContext: BrowserContext | undefined;
  let techSupportPage: Page | undefined;

  test.afterEach(async () => {
    if (honor) await clearAndroidE2ETestProjections(honor);
    if (essential) await clearAndroidE2ETestProjections(essential);
    await closeAndroidUser(honor);
    await closeAndroidUser(essential);
    honor = undefined;
    essential = undefined;
    await electron?.app.close().catch(() => {});
    electron = undefined;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    await techSupportPage?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await techSupportContext?.close().catch(() => {});
    await techSupportBrowser?.close().catch(() => {});
    techSupportPage = undefined;
    techSupportContext = undefined;
    techSupportBrowser = undefined;
  });

  test('Honor phone becomes a delegate and answers real questions from the Essential phone and the MacMini app', async () => {
    test.setTimeout(480_000);
    const [delegateReady, askerReady] = await Promise.all([
      isAndroidDeviceReady(DELEGATE_SERIAL),
      isAndroidDeviceReady(ASKER_SERIAL),
    ]);
    test.skip(!delegateReady, `Configured Honor device ${DELEGATE_SERIAL} is unavailable — connect it with USB debugging enabled.`);
    test.skip(!askerReady, `Configured Essential device ${ASKER_SERIAL} is unavailable — connect it with USB debugging enabled.`);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;

    // 1. Local website as TechSupport root — the ONLY participant that ever holds the master
    // private key. Used exactly once below, to issue Honor's grant.
    techSupportBrowser = await chromium.launch({ headless, slowMo: headless ? 0 : delay(50, 150) });
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(techSupportBrowser));
    await expectCurrentUserIsTechSupportRoot(techSupportPage);

    // 2. Honor phone boots as an ordinary registered user — no key handling on the phone at all.
    // resetAppData: true — required so a prior run's on-device identity doesn't leak into this
    // one (reference_android_test_devices memory: "Real gap found (harness, not app)").
    honor = await launchAndroidUserViaAdb({ deviceSerial: DELEGATE_SERIAL, hubGunUrl: lanHubUrl, resetAppData: true });
    honor.window.on('console', (m) => console.log('[Honor]:', m.text()));
    honor.window.on('pageerror', (e) => console.log('[Honor] pageerror:', e.message));
    const honorUserId = await bootstrapNativeWindow(honor.window, 'Honor Delegate', { readinessTimeoutMs: 110_000 });
    expect(honorUserId).toBeTruthy();
    await forceJoinGlobal(honor.window);

    // 3. Master generates a one-time invite code; Honor enters it on her own phone to publish a
    // signed self-identifying request — the master never has to type her raw user id, and her
    // phone never sees the master key.
    await techSupportPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await techSupportPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await techSupportPage.click('#support-delegate-invite-btn');
    const inviteCode = (await techSupportPage.locator('[data-testid="support-delegate-invite-code"]').textContent())?.trim() || '';
    expect(inviteCode).toBeTruthy();
    await techSupportPage.click('#support-delegate-invite-done');

    await honor.window.click('.nav-btn[data-view="me"]');
    await afterNav();
    await honor.window.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await honor.window.fill('#support-delegate-invite-code-input', inviteCode);
    await honor.window.click('#support-delegate-invite-code-submit');
    await expect(honor.window.locator('#support-delegate-invite-code-status')).toBeVisible({ timeout: 15_000 });
    console.log('[test] Honor invite-code-status text:', await honor.window.locator('#support-delegate-invite-code-status').textContent());

    // 4. Master's panel picks up Honor's signed request live and approves it into a real grant —
    // the only step in this whole test that touches the master key. Real hardware over a LAN Gun
    // link needs more slack than the desktop-only 00m spec's 20s.
    // DIAGNOSTIC: check whether the raw Gun record is even reaching the master's OWN peer at
    // all, independent of the app's live `.map().on()` subscription — isolates a Gun sync/relay
    // gap (embedded-node Android write never reaches the hub the desktop reads from, matching
    // the documented chatroom-membership propagation gap in 08's own header comment) from a
    // subscription-wiring bug in app.ts.
    const rawRequestSeenAt = await techSupportPage.evaluate(async (uid) => {
      const started = Date.now();
      const gun = (window as any).__iinpublic_app.getApp().gunService.getGun();
      return new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 90_000);
        const ref = gun.get('techsupport-delegate-requests').map();
        ref.on((raw: any) => {
          if (raw && String(raw.candidateUserId || '') === uid) {
            clearTimeout(timer);
            resolve(Date.now() - started);
          }
        });
      });
    }, honorUserId);
    console.log('[test] raw Gun record for Honor\'s request seen by master\'s own peer after (ms):', rawRequestSeenAt);

    const pendingRow = techSupportPage.locator('.support-delegate-pending-item', { hasText: honorUserId });
    await expect(pendingRow).toBeVisible({ timeout: 30_000 });
    await pendingRow.locator('[data-testid="support-delegate-pending-label"]').fill('Honor phone');
    await pendingRow.locator('[data-testid="support-delegate-approve-btn"]').click();
    await afterSync();
    await expect(techSupportPage.locator('.support-delegate-item', { hasText: 'Honor phone' })).toBeVisible({ timeout: 20_000 });

    // 5. Honor's own device picks up the grant live and shows an opt-in prompt — she must
    // explicitly accept before delegate mode turns on.
    await honor.window.click('.nav-btn[data-view="me"]');
    await afterNav();
    await honor.window.click('.nav-btn[data-view="settings"]');
    await afterNav();
    const optInToggle = honor.window.locator('#support-delegate-optin-toggle');
    await expect(optInToggle).toBeVisible({ timeout: 30_000 });
    await expect(optInToggle).not.toBeChecked();
    await optInToggle.check();
    await afterSync();
    await expect(honor.window.locator('#support-inbox-section')).toBeVisible({ timeout: 15_000 });
    const honorPub = await currentUserPub(honor.window);
    expect(honorPub).toBeTruthy();

    // 6. Essential phone: a completely different, real ordinary user asking a real question.
    essential = await launchAndroidUserViaAdb({ deviceSerial: ASKER_SERIAL, hubGunUrl: lanHubUrl, resetAppData: true });
    essential.window.on('console', (m) => console.log('[Essential]:', m.text()));
    essential.window.on('pageerror', (e) => console.log('[Essential] pageerror:', e.message));
    await bootstrapNativeWindow(essential.window, 'Essential Asker', { readinessTimeoutMs: 110_000 });
    await forceJoinGlobal(essential.window);
    const essentialQuestion = `Essential Phone: why does the chat lag on cellular data ${Date.now()}?`;
    const essentialAnswer = 'That is expected on a slow connection — messages still sync once you have a stronger signal.';
    await askTechSupport(essential.window, essentialQuestion);

    // 7. MacMini app (packaged Electron build): the second, independent asker.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-techsupport-delegate-e2e-'));
    electron = await launchNativeUser({ localPort: ELECTRON_LOCAL_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    electron.window.on('console', (m) => console.log('[MacMini]:', m.text()));
    electron.window.on('pageerror', (e) => console.log('[MacMini] pageerror:', e.message));
    await bootstrapNativeWindow(electron.window, 'MacMini Asker', { readinessTimeoutMs: 110_000 });
    await forceJoinGlobal(electron.window);
    const macQuestion = `MacMini app: can I export my conversation history ${Date.now()}?`;
    const macAnswer = 'Not yet — conversation export is planned but not shipped in this build.';
    await askTechSupport(electron.window, macQuestion);

    // 8. Honor — not the master — sees and answers both pending questions from her own phone,
    // signing each answer with her OWN key.
    for (const { question, answer } of [
      { question: essentialQuestion, answer: essentialAnswer },
      { question: macQuestion, answer: macAnswer },
    ]) {
      const inboxItem = honor.window.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
      await expect(inboxItem).toBeVisible({ timeout: 30_000 });
      // The Support Inbox section re-renders (a full innerHTML replace) every time the 3s
      // mailbox poll re-ingests this same still-pending question (idempotent overwrite, but it
      // still re-renders) — a fill() that lands between renders gets wiped before the click ever
      // reads it, with no error (support-inbox-view.ts's click handler silently no-ops on an
      // empty answer). Retry fill+click until the row actually disappears instead of assuming
      // one attempt lands cleanly.
      await expect(async () => {
        const stillPresent = await inboxItem.count();
        if (stillPresent === 0) return;
        await inboxItem.locator('.support-inbox-answer-input').fill(answer);
        await inboxItem.locator('.support-inbox-answer-btn').click();
        await afterSync();
        expect(await inboxItem.count()).toBe(0);
      }).toPass({ timeout: 45_000, intervals: [500, 1000, 2000] });
    }

    // 9. Both askers receive their real answers, still attributed to TechSupport — neither ever
    // learns Honor exists.
    await expect(essential.window.locator('#conversation-messages')).toContainText(essentialAnswer, { timeout: 30_000 });
    await expect(electron.window.locator('#conversation-messages')).toContainText(macAnswer, { timeout: 30_000 });

    // 10. The master's own audit view — never either asker's — shows Honor answered both.
    await expect(techSupportPage.locator('#support-delegates-section')).toContainText(
      new RegExp(essentialQuestion.slice(0, 20), 'i'),
      { timeout: 20_000 },
    );
    await expect(techSupportPage.locator('#support-delegates-section')).toContainText(
      new RegExp(macQuestion.slice(0, 20), 'i'),
      { timeout: 20_000 },
    );
    await expect(techSupportPage.locator('#support-delegates-section')).toContainText(honorPub.slice(0, 12), { timeout: 5_000 });

    if (!headless) await new Promise((resolve) => setTimeout(resolve, 5_000));
  });
});
