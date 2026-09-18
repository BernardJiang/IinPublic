/**
 * Real-hardware variant of the WP5 device-sync scenario (shared/device-sync-*.ts,
 * web-device-sync-service.ts): one real Android phone and the packaged macOS Electron app
 * ("MacMini" — tests/e2e/native-app/helpers/android-device-config.ts's own doc comment calls this
 * rig "the normal Mac-mini matrix") each independently talk to the same ordinary website user
 * BEFORE ever being linked, producing two completely separate conversations under two
 * completely separate SEA identities (identity-linking.ts's multi-device model: "every device
 * has its own SEA keypair"). The phone and the MacMini app are then linked to each other and
 * sync is enabled on both sides; `WebDeviceSyncService.backfillExistingDataToPeer` ships each
 * device's pre-existing conversation to the other, so opening either app afterward shows BOTH
 * conversations — including the other device's real message text, which this device could never
 * decrypt on its own (see WebDeviceSyncService's own doc comment on why `messages` ships
 * plaintext, not raw Gun ciphertext).
 *
 * Mirrors 09-android-techsupport-delegate-answers.spec.ts's topology/helpers and
 * ../staged/stage2-two-user/95-device-sync-continuous.spec.ts's link+enable-sync UI flow (real
 * QR/code pairing, mutual signed approval, "Enable sync" — copied here nearly verbatim since the
 * two specs exercise the identical protocol/UI, just browser contexts there vs. real hardware
 * here) and ../cross-platform/x5-three-platform-network.spec.ts's `seedPairThread`/
 * `openUserLayoutFor` pattern for standing up a real matched conversation without driving a full
 * talk-broadcast/response flow on a physical device.
 *
 * Opt-in, real-hardware test: skips itself (does not fail) unless
 * E2E_REAL_ANDROID_DESKTOP_DEVICE_SYNC=1 is set and the configured Android device is connected
 * and authorized (adb devices). See 05-android-device-boots.spec.ts's header for one-time phone
 * setup (USB debugging).
 */
import { chromium, test, expect, type Browser as PlaywrightBrowser, type Page } from '@playwright/test';
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
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  type NativeUser,
} from './helpers/native-app';
import { afterNav, delay, headless } from '../helpers/timing';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
// Mirrors native-app/playwright.config.ts's own derivation exactly (see 08/09's identical comment).
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
// Distinct from every localPort already used by other native-app specs (19111/19121/19122/19141/19161/19171).
const ELECTRON_LOCAL_PORT = 19181;

const CONFIGURED = configuredAndroidDevices();
const ANDROID_SERIAL =
  process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || CONFIGURED.find((d) => d.name === 'android-charlie')?.serial || '';
const RUN = process.env.E2E_REAL_ANDROID_DESKTOP_DEVICE_SYNC === '1';

const TALK_ID_ANDROID = 'talk-x-device-sync-android-website';
const TALK_TITLE_ANDROID = 'Android chat';
const TALK_ID_MAC = 'talk-x-device-sync-mac-website';
const TALK_TITLE_MAC = 'MacMini chat';

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

/** Directly seeds a matched pair conversation (no talk-broadcast/response round trip — same
 *  shortcut x5-three-platform-network.spec.ts uses) so a real device doesn't have to drive a
 *  full talk exchange just to stand up something to send messages into. */
async function seedPairThread(
  page: Page,
  otherId: string,
  otherName: string,
  talkId: string,
  talkTitle: string,
): Promise<string> {
  return page.evaluate(async ({ otherId, otherName, talkId, talkTitle }) => {
    const app = (window as any).__iinpublic_app.getApp();
    const me = app.currentUser;
    const conversationId = await app.conversationService.createConversation({
      userId1: me.id,
      userName1: me.stageName,
      userId2: otherId,
      userName2: otherName,
      talkId,
    });
    app.uiManager.addNewConversation({ conversationId, otherUserId: otherId, otherUserName: otherName, talkId });
    const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    myTalks[talkId] = { role: 'created', title: talkTitle, fullTalk: { id: talkId, title: talkTitle } };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));
    return conversationId as string;
  }, { otherId, otherName, talkId, talkTitle });
}

/** Contact-row entry lands directly on the User layout (contacts-view.ts tap-target split). */
async function openUserLayoutFor(page: Page, name: string): Promise<void> {
  await page.click('.nav-btn[data-view="contacts"]');
  await afterNav();
  const row = page.locator('#contacts-list .contact-item').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 30_000 });
}

async function sendThreadMessage(page: Page, talkTitle: string, text: string): Promise<void> {
  await page.locator('[data-testid="matched-talk-thread"]').filter({ hasText: talkTitle }).first().click();
  await expect(page.locator('#conversation-thread-scope')).toContainText(talkTitle, { timeout: 20_000 });
  await page.locator('#conversation-message-input').fill(text);
  await page.locator('#send-conversation-message').click();
  await expect(page.locator('#conversation-messages')).toContainText(text, { timeout: 20_000 });
  // Backs out of the thread, onto the still-open peer-detail overlay's thread list — NOT the
  // main app (see `#back-from-peer-detail` below), so the bottom nav stays covered until that
  // overlay itself is dismissed too.
  await page.click('#back-from-conversation');
  await page.click('[data-testid="back-from-peer-detail"]');
  await expect(page.locator('#peer-detail-overlay')).toBeHidden({ timeout: 20_000 });
}

async function conversationCount(page: Page): Promise<number> {
  return page.evaluate(
    () => Object.keys((window as any).__iinpublic_app.getApp().uiManager.getMyConversations()).length,
  );
}

async function hasConversation(page: Page, conversationId: string): Promise<boolean> {
  return page.evaluate(
    (id) => !!(window as any).__iinpublic_app.getApp().uiManager.getMyConversations()[id],
    conversationId,
  );
}

/** Real link flow — identical to stage2-two-user/95-device-sync-continuous.spec.ts's
 *  `linkDevices` happy path, with real-hardware timeouts. */
async function openIdentityDevices(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="settings"]').click();
  await afterNav();
  await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
  await page.locator('[data-testid="settings-linked-devices-btn"]').click();
  await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible({ timeout: 20_000 });
}

async function linkDevices(a: Page, b: Page): Promise<void> {
  await openIdentityDevices(a);
  await openIdentityDevices(b);

  await a.locator('[data-testid="link-a-device-btn"]').click();
  await a.locator('[data-testid="confirm-generate-link-code"]').click();
  const code = (await a.locator('[data-testid="link-device-code"]').textContent()) || '';
  expect(code).not.toBe('');

  // DIAGNOSTIC: does the raw identity-link-request record ever reach `a`'s own Gun peer at all,
  // independent of the app's click-driven one-shot `readIncomingLinkRequest` read? Isolates a
  // Gun sync/relay gap specific to this path (from `a` being a real device on a LAN/adb bridge)
  // from a timing gap in the one-shot-`.once()`-per-click read itself — mirrors
  // 09-android-techsupport-delegate-answers.spec.ts's own identical diagnostic for a different
  // Gun path.
  const aPub = await a.evaluate(() => String((window as any).__iinpublic_app.getApp().gunService.getStoredPair()?.pub || ''));
  const rawRequestSeenAtPromise = a.evaluate((pub) => {
    const started = Date.now();
    const gun = (window as any).__iinpublic_app.getApp().gunService.getGun();
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 120_000);
      gun.get('identity-link-requests').get(pub).map().on((raw: unknown) => {
        if (raw) {
          clearTimeout(timer);
          resolve(Date.now() - started);
        }
      });
    });
  }, aPub);

  await b.locator('[data-testid="enter-link-code-btn"]').click();
  await b.locator('[data-testid="enter-link-code-input"]').fill(code);
  await b.locator('[data-testid="enter-link-code-submit"]').click();
  await expect(b.locator('[data-testid="linked-device-row"]')).toContainText('Waiting for approval', { timeout: 30_000 });

  const rawRequestSeenAt = await rawRequestSeenAtPromise;
  console.log('[test] raw identity-link-request seen by the linking device\'s own peer after (ms):', rawRequestSeenAt);

  // The pairing code has a 5-minute TTL (identity-linking.ts's PAIRING_TTL_MS) starting from
  // when it was generated above — this loop must stay well under that budget (including the
  // up-to-2-minute diagnostic wait already spent) or it guarantees its own failure via expiry
  // regardless of how fast the real sync actually is. Kept short and relies on the diagnostic
  // above having already proven (or ruled out) that the raw record even arrives at all.
  const check = a.locator('[data-testid="link-device-check-request"]');
  await expect(check).toBeVisible({ timeout: 20_000 });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await check.click();
    const approve = a.locator('[data-testid="approve-link-request"]');
    await expect.poll(async () =>
      (await approve.isVisible().catch(() => false)) || (await check.isEnabled().catch(() => false)),
    { timeout: 8_000 }).toBe(true);
    if (await approve.isVisible().catch(() => false)) break;
    await a.waitForTimeout(2_000);
  }
  await expect(a.locator('[data-testid="approve-link-request"]')).toBeVisible({ timeout: 30_000 });
  await a.locator('[data-testid="approve-link-request"]').click();
  await expect(a.locator('[data-testid="linked-device-row"]')).toContainText('Linked', { timeout: 30_000 });

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await b.locator('[data-testid="refresh-linked-devices"]').click();
    if ((await b.locator('[data-testid="linked-device-row"]').textContent())?.includes('Linked')) break;
    await b.waitForTimeout(1_000);
  }
  await expect(b.locator('[data-testid="linked-device-row"]')).toContainText('Linked', { timeout: 30_000 });
}

async function enableSyncBothSidesAndClose(a: Page, b: Page): Promise<void> {
  await a.locator('[data-testid="linked-device-sync-btn"]').click();
  await b.locator('[data-testid="linked-device-sync-btn"]').click();
  await expect(a.locator('[data-testid="linked-device-row"]')).toContainText('Syncing', { timeout: 20_000 });
  await expect(b.locator('[data-testid="linked-device-row"]')).toContainText('Syncing', { timeout: 20_000 });
  await a.locator('[data-testid="linked-devices-close"]').click();
  await b.locator('[data-testid="linked-devices-close"]').click();
}

test.describe('Native app: Android phone + MacMini Electron app link and merge their separate Website conversations', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_DESKTOP_DEVICE_SYNC=1 to run this physical-device test.');
  test.skip(!ANDROID_SERIAL, 'Configure the Android device (tests/matrix/devices.json "android-charlie") or set NATIVE_APP_ANDROID_SERIAL.');

  let android: AndroidUser | undefined;
  let electron: NativeUser | undefined;
  let userDataDir = '';
  let websiteBrowser: PlaywrightBrowser | undefined;
  let website: { page: Page; userId: string; close: () => Promise<void> } | undefined;

  test.afterEach(async () => {
    if (android) await clearAndroidE2ETestProjections(android);
    await closeAndroidUser(android);
    android = undefined;
    await electron?.app.close().catch(() => {});
    electron = undefined;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    await website?.close().catch(() => {});
    website = undefined;
    await websiteBrowser?.close().catch(() => {});
    websiteBrowser = undefined;
  });

  test('linking the phone and the MacMini app merges each one\'s separate Website conversation onto the other', async () => {
    test.setTimeout(900_000);
    const androidReady = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!androidReady, `Configured Android device ${ANDROID_SERIAL} is unavailable — connect it with USB debugging enabled.`);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;

    // 1. Website: an ordinary desktop browser user — the third party both the phone and the
    // MacMini app separately talk to, before either has ever heard of the other.
    websiteBrowser = await chromium.launch({ headless, slowMo: headless ? 0 : delay(50, 150) });
    website = await bootstrapBrowserUserOnOrigin(websiteBrowser, `http://127.0.0.1:${WEB_PORT}`, 'Website', 'Website');

    // 2. Android phone: an ordinary registered user with its own independent SEA identity.
    android = await launchAndroidUserViaAdb({ deviceSerial: ANDROID_SERIAL, hubGunUrl: lanHubUrl, resetAppData: true });
    android.window.on('console', (m) => console.log('[Android]:', m.text()));
    android.window.on('pageerror', (e) => console.log('[Android] pageerror:', e.message));
    const androidId = await bootstrapNativeWindow(android.window, 'Android Phone', { readinessTimeoutMs: 110_000 });
    expect(androidId).toBeTruthy();
    await forceJoinGlobal(android.window);

    // 3. MacMini app (packaged Electron build): a second, completely independent SEA identity —
    // not yet linked to the phone at all.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-device-sync-e2e-'));
    electron = await launchNativeUser({ localPort: ELECTRON_LOCAL_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    electron.window.on('console', (m) => console.log('[MacMini]:', m.text()));
    electron.window.on('pageerror', (e) => console.log('[MacMini] pageerror:', e.message));
    const macId = await bootstrapNativeWindow(electron.window, 'MacMini', { readinessTimeoutMs: 110_000 });
    expect(macId).toBeTruthy();
    await forceJoinGlobal(electron.window);

    // Baseline conversation count before seeding anything — every user auto-gets a TechSupport
    // welcome conversation at boot (CLAUDE.md: "TechSupport is the built-in first user"), so the
    // real starting count isn't 0. Assert deltas from here rather than hardcoding what else
    // exists, so this test doesn't silently depend on TechSupport's own conversation behavior.
    const androidBaselineCount = await conversationCount(android.window);
    const macBaselineCount = await conversationCount(electron.window);

    // 4. Each device separately "talks to a website user": the phone matches with Website under
    // one talk, the MacMini app matches with Website under a DIFFERENT talk — two independent
    // conversations sharing nothing but the same Website counterpart, exactly mirroring one
    // person's two unlinked devices each separately meeting the same stranger.
    const androidWebsiteConv = await seedPairThread(android.window, website.userId, 'Website', TALK_ID_ANDROID, TALK_TITLE_ANDROID);
    await seedPairThread(website.page, androidId, 'Android Phone', TALK_ID_ANDROID, TALK_TITLE_ANDROID);
    const macWebsiteConv = await seedPairThread(electron.window, website.userId, 'Website', TALK_ID_MAC, TALK_TITLE_MAC);
    await seedPairThread(website.page, macId, 'MacMini', TALK_ID_MAC, TALK_TITLE_MAC);
    expect(androidWebsiteConv).not.toBe(macWebsiteConv);

    const androidMessage = `Hello from the Android phone ${Date.now()}`;
    const macMessage = `Hello from the MacMini app ${Date.now()}`;
    await openUserLayoutFor(android.window, 'Website');
    await sendThreadMessage(android.window, TALK_TITLE_ANDROID, androidMessage);
    await openUserLayoutFor(electron.window, 'Website');
    await sendThreadMessage(electron.window, TALK_TITLE_MAC, macMessage);

    // Before linking: neither device has ever heard of the other's conversation.
    expect(await conversationCount(android.window)).toBe(androidBaselineCount + 1);
    expect(await conversationCount(electron.window)).toBe(macBaselineCount + 1);

    // 5. Link the phone and the MacMini app to EACH OTHER — two devices of the same real-world
    // owner, each with its own independent SEA identity (identity-linking.ts's multi-device
    // model) — then turn on continuous sync on both sides.
    await linkDevices(android.window, electron.window);
    await enableSyncBothSidesAndClose(android.window, electron.window);

    // 6. WebDeviceSyncService.backfillExistingDataToPeer ships each device's pre-existing
    // Website conversation (and its message) to the other on activation. Both devices end up
    // with BOTH conversations — the whole point: open either app and every conversation is
    // there, "seamlessly," not just the one that device personally created.
    await expect.poll(() => conversationCount(android.window), { timeout: 120_000, intervals: [2_000] }).toBe(androidBaselineCount + 2);
    await expect.poll(() => conversationCount(electron.window), { timeout: 120_000, intervals: [2_000] }).toBe(macBaselineCount + 2);
    await expect.poll(() => hasConversation(android.window, macWebsiteConv), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasConversation(electron.window, androidWebsiteConv), { timeout: 30_000 }).toBe(true);

    // 7. Not just background state: opening the IMPORTED conversation's thread on each device
    // actually renders the other device's real message — plaintext this device never decrypted
    // itself (see WebDeviceSyncService's own doc comment on the `messages` category). Must pass
    // the talk's thread scope explicitly (matching the talk this pair matched on) — without it,
    // showConversationDetail defaults to the "direct" scope and conversation-detail-view.ts's
    // own thread isolation (redesign §5, `messageInCurrentThread`) filters the thread-scoped
    // synced message straight back out, same as it would for a live one.
    await android.window.evaluate(
      ({ id, talkId }) => (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(id, talkId),
      { id: macWebsiteConv, talkId: TALK_ID_MAC },
    );
    await expect(android.window.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
    await expect(android.window.locator('#conversation-messages')).toContainText(macMessage, { timeout: 20_000 });

    await electron.window.evaluate(
      ({ id, talkId }) => (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(id, talkId),
      { id: androidWebsiteConv, talkId: TALK_ID_ANDROID },
    );
    await expect(electron.window.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
    await expect(electron.window.locator('#conversation-messages')).toContainText(androidMessage, { timeout: 20_000 });

    if (!headless) await new Promise((resolve) => setTimeout(resolve, 5_000));
  });
});
