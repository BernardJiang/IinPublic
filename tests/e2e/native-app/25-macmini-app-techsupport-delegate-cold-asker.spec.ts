/**
 * Real-device regression coverage (2026-09-23): a real Huawei phone asked TechSupport a real
 * question, twice, and neither ever reached an opted-in delegate's inbox — only the master's own
 * mailbox. `tests/e2e/staged/stage2-two-user/00n-techsupport-delegate-answers-cold-asker.spec.ts`
 * proves the pure browser-to-browser fan-out path works even for a "cold" asker (no pre-synced
 * delegate-grant cache), which means the bug is specific to the embedded-node runtime both Android
 * and the packaged desktop app share — the asker's `window.location` is the LOCAL embedded
 * server's own origin (`http://127.0.0.1:<port>`), not the real hub, which changes how
 * `getPublicUserFromApi` (web-gun-service.ts) resolves `deriveBackendApiBaseFromLocation` when
 * `postSupportQuestionToMailbox`'s `resolvePeerEpub` falls back to it. A plain Chromium browser
 * context never exercises that code path at all, so it can't reproduce this — the packaged
 * Electron app can, without needing real Android hardware.
 *
 * Topology: Dana (delegate) is a plain browser tab on the native-app suite's own hub/web server —
 * her side of this bug isn't runtime-specific. Amy (asker) is the packaged macOS Electron app
 * (`platforms/desktop/dist/mac-arm64/IinPublic.app`), asking the instant she boots — no prior
 * delegate-roster sync, mirroring the real phone's very first question after a fresh install. The
 * master's grant is issued via the same local-signer path production actually uses
 * (`signDelegateGrant` + a direct POST), exactly like spec 09's Honor setup — no root browser
 * session anywhere in this test, matching OPEN-27.
 *
 * Runs locally with no physical device and no opt-in env var — it needs `npm run desktop:dist`
 * (or `IINPUBLIC_DESKTOP_EXECUTABLE` pointed at an existing build) and `TECHSUPPORT_SEA_PAIR_JSON`
 * in `.env.local`, same as spec 09 and 00m/00n.
 */
import { chromium, type Browser } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  type NativeUser,
} from './helpers/native-app';
import { afterNav, afterSync } from '../helpers/timing';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../src/shared/techsupport';
import { signDelegateGrant } from '../../../src/shared/techsupport-delegate';
import { loadRealTechSupportPair } from '../helpers/techsupport-real-pair';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
// Distinct from every localPort already used by other native-app specs (19111/19121/19122/19141/19161/19171).
const ELECTRON_LOCAL_PORT = 19181;
const WEBRTC_LAUNCH_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

const REAL_PAIR = loadRealTechSupportPair();
const DEV_PAIR = REAL_PAIR as NonNullable<typeof REAL_PAIR>;

test.describe('Native app: a cold Electron-app asker still reaches a browser delegate (real-device regression, 2026-09-23)', () => {
  test.skip(!REAL_PAIR, 'Set TECHSUPPORT_SEA_PAIR_JSON in .env.local to run this TechSupport-mode spec.');

  let danaBrowser: Browser | undefined;
  let closeDana: (() => Promise<void>) | undefined;
  let amy: NativeUser | undefined;
  let userDataDir = '';

  test.afterEach(async () => {
    await closeDana?.().catch(() => {});
    closeDana = undefined;
    await danaBrowser?.close().catch(() => {});
    danaBrowser = undefined;
    await amy?.app.close().catch(() => {});
    amy = undefined;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('Amy asks from the packaged Electron app the instant it boots — Dana, a browser delegate, must still get the envelope', async () => {
    test.setTimeout(180_000);

    // 1. Dana is an ordinary registered user (browser tab), about to be turned into a delegate.
    danaBrowser = await chromium.launch({ headless: true, args: WEBRTC_LAUNCH_ARGS });
    const dana = await bootstrapBrowserUserOnOrigin(
      danaBrowser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Dana Delegate (browser)',
      'DanaDelegate',
      { waitForSupportGreeting: false },
    );
    closeDana = dana.close;
    await forceJoinGlobal(dana.page);
    const danaPub = await dana.page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || ''));
    expect(danaPub).toBeTruthy();

    // 2. Local signer issues Dana's grant directly to the keyless relay — the production-style
    // root action, no browser page or remotely served JavaScript ever receives the root pair
    // (mirrors spec 09's Honor setup and `techsupport:delegate issue`).
    const grant = await signDelegateGrant({
      delegatePub: danaPub,
      delegateUserId: dana.userId,
      label: "Dana's laptop",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, DEV_PAIR);
    const published = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/support/delegate-grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grant),
    });
    expect(published.ok, await published.text()).toBe(true);

    // 3. Dana's own browser tab picks up the grant live and opts in explicitly.
    await dana.page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await dana.page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(dana.page, SETTINGS_SECTION.supportDelegate);
    const optInToggle = dana.page.locator('#support-delegate-optin-toggle');
    await expect(optInToggle).toBeVisible({ timeout: 20_000 });
    await expect(optInToggle).not.toBeChecked();
    await optInToggle.check();
    await afterSync();
    await expect(dana.page.locator('#support-inbox-section')).toBeVisible({ timeout: 10_000 });

    // 4. Amy: the packaged Electron app, asking the instant it boots — no prior delegate-roster
    // sync of any kind. This is the exact shape of a real phone's first-ever question, and the
    // only leg of this test that actually exercises the embedded-node runtime's own
    // window.location-derived apiBase (see this file's header comment).
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-techsupport-cold-asker-e2e-'));
    amy = await launchNativeUser({
      localPort: ELECTRON_LOCAL_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });
    amy.window.on('console', (m) => console.log('[Amy/Electron]:', m.text()));
    amy.window.on('pageerror', (e) => console.log('[Amy/Electron] pageerror:', e.message));
    await bootstrapNativeWindow(amy.window, 'AmyElectronAsker', { waitForSupportGreeting: false });
    await forceJoinGlobal(amy.window);

    const question = `Electron cold-asker: why won't my dilithium chamber sync at ${Date.now()}?`;
    await amy.window.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const supportRow = amy.window.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(supportRow).toBeVisible({ timeout: 20_000 });
    await supportRow.locator('.contact-item-name').click();
    await expect(amy.window.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(amy.window.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });
    await amy.window.locator('#conversation-message-input').fill(question);
    await amy.window.locator('#send-conversation-message').click();
    await expect(amy.window.locator('#conversation-messages')).toContainText('will get back to you', { timeout: 15_000 });

    // 5. THE ASSERTION THAT FAILS TODAY IN PRODUCTION: Dana's own inbox must show the pending
    // question. Before this session's fix this envelope only ever reached the master's mailbox.
    const inboxItem = dana.page.locator('.support-inbox-item').filter({ hasText: question.slice(0, 20) });
    await expect(inboxItem).toBeVisible({ timeout: 30_000 });
  });
});
