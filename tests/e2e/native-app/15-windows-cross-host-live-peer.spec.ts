/**
 * Closes docs/TODO.md Stage 4.4's "Mac Chromium -> Windows Chromium" and "Windows Chromium -> Mac
 * Chromium" bullets, plus contributes to "Mac browser + Windows browser + Android" — the second
 * genuinely LIVE cross-host peer scenario in this repo, mirroring
 * `14-ubuntu-cross-host-live-peer.spec.ts` exactly but for the real `windows-test` worker via
 * `helpers/windows-live-peer.ts`.
 *
 * Four peers share one LAN Gun hub: the macOS Electron app, one real Android phone, a local
 * Chromium browser, and the real Windows Chromium (launched over SSH+CDP — see
 * `windows-live-peer.ts`'s header comment for the real Windows-specific gotchas found and fixed
 * getting a browser to survive past its launching SSH session). Chromium and Android each
 * author/broadcast one tag Talk; Windows completes Chromium's and Android's, and Windows's own
 * authored Talk is completed by Chromium (closes the two named bullets) and by Android — covering
 * both directions of each pair in one run, same shape as the Ubuntu spec.
 */
import { chromium, test, expect, type Browser } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { clickBroadcastUntilBulkAck, completeTalksInAppByAnswerIds, createTagTalkViaEditor } from '../helpers/talk-demo-ui';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { launchWindowsChromePeer, type WindowsBrowserPeer } from './helpers/windows-live-peer';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19164;
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
const RUN = process.env.E2E_REAL_WINDOWS_LIVE_PEER === '1';
const WEBRTC_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type Peer = { name: string; runtime: string; page: import('@playwright/test').Page; id: string };

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

function attachDiagnostics(peer: Peer): void {
  peer.page.on('pageerror', (error) => console.log(`[windows-live-peer] page error from ${peer.runtime}: ${error.message}`));
}

test.describe('Native app: Windows real Chromium as a live cross-host peer', () => {
  test.skip(!RUN, 'Set E2E_REAL_WINDOWS_LIVE_PEER=1 to run the live Windows cross-host peer test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL, or configure a device in tests/matrix/devices.json.');

  let electron: NativeUser | undefined;
  let androidUser: AndroidUser | undefined;
  let windowsPeer: WindowsBrowserPeer | undefined;
  let localBrowser: Browser | undefined;
  let localBrowserClose: (() => Promise<void>) | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await localBrowserClose?.().catch(() => {});
    await localBrowser?.close().catch(() => {});
    await windowsPeer?.close().catch(() => {});
    if (androidUser) await clearAndroidE2ETestProjections(androidUser).catch(() => {});
    await closeAndroidUser(androidUser);
    await electron?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || !ANDROID_SERIAL) return;
    const diagnostics = await collectAndroidDiagnostics(ANDROID_SERIAL);
    await testInfo.attach('android-logcat.txt', { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
    await testInfo.attach('android-node-stdio.txt', { body: Buffer.from(diagnostics.nodeStdio), contentType: 'text/plain' });
  });

  test('Windows Chromium exchanges matching talks with a Mac browser and a real Android phone', async () => {
    test.setTimeout(600_000);
    const ready = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!ready, `Android device ${ANDROID_SERIAL} is not connected/authorized via adb.`);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;
    const peers: Peer[] = [];

    await resetAndroidAppData(ANDROID_SERIAL);

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-windows-live-peer-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'WinPeer Mac', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    peers.push({ name: 'WinPeer Mac', runtime: 'macOS Electron', page: electron.window, id: macId });

    androidUser = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: ANDROID_SERIAL, disableLanDiscovery: true });
    const androidId = await bootstrapNativeWindow(androidUser.window, 'WinPeer Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    peers.push({ name: 'WinPeer Android', runtime: 'Android', page: androidUser.window, id: androidId });

    localBrowser = await chromium.launch({ headless: true, args: WEBRTC_ARGS });
    const chromiumUser = await bootstrapBrowserUserOnOrigin(localBrowser, `http://127.0.0.1:${WEB_PORT}`, 'WinPeer Chrome', 'WinPeer Chrome', { waitForSupportGreeting: false });
    localBrowserClose = chromiumUser.close;
    peers.push({ name: 'WinPeer Chrome', runtime: 'Chromium', page: chromiumUser.page, id: chromiumUser.userId });

    console.log('[windows-live-peer] launching real Chromium on windows-test over SSH + CDP');
    // Reverse-tunnel this Mac's web+gun ports onto Windows's OWN loopback (see
    // windows-live-peer.ts's header comment) — navigating to the LAN IP directly breaks
    // WebCrypto (not a secure context), which Gun's SEA shim needs.
    windowsPeer = await launchWindowsChromePeer({ reverseForwardPorts: [WEB_PORT, HUB_GUN_PORT] });
    const windowsLoopbackWebUrl = `http://127.0.0.1:${WEB_PORT}`;
    const windowsUser = await bootstrapBrowserUserOnOrigin(windowsPeer.browser, windowsLoopbackWebUrl, 'WinPeer Windows', 'WinPeer Windows', { waitForSupportGreeting: false });
    peers.push({ name: 'WinPeer Windows', runtime: 'Windows Chromium (live SSH peer)', page: windowsUser.page, id: windowsUser.userId });

    expect(new Set(peers.map((peer) => peer.id)).size).toBe(peers.length);
    peers.forEach(attachDiagnostics);

    await Promise.all(peers.map((peer) => forceJoinGlobal(peer.page)));
    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return peers.filter((peer) => memberIds.has(peer.id)).length;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);
    console.log('[windows-live-peer] all 4 peers present in Global, including the real Windows host');

    const runId = `windows-live-peer-${Date.now()}`;
    console.log('[windows-live-peer] authoring: Chromium (Mac)');
    const chromiumTalk = await createTagTalkViaEditor(chromiumUser.page, { title: `${runId}-mac-chrome`, timeoutMs: 90_000 });
    console.log('[windows-live-peer] authoring: Android');
    const androidTalk = await createTagTalkViaEditor(androidUser.window, { title: `${runId}-android`, timeoutMs: 90_000 });
    console.log('[windows-live-peer] authoring: Windows Chromium');
    const windowsTalk = await createTagTalkViaEditor(windowsUser.page, { title: `${runId}-windows-chrome`, timeoutMs: 90_000 });

    console.log('[windows-live-peer] broadcasting: Chromium (Mac)');
    await clickBroadcastUntilBulkAck(chromiumUser.page, { minGunPeers: 1, minSent: 1 });
    console.log('[windows-live-peer] broadcasting: Android');
    await clickBroadcastUntilBulkAck(androidUser.window, { minGunPeers: 1, minSent: 1 });
    console.log('[windows-live-peer] broadcasting: Windows Chromium');
    await clickBroadcastUntilBulkAck(windowsUser.page, { minGunPeers: 1, minSent: 1 });

    const complete = async (label: string, receiver: import('@playwright/test').Page, talk: Awaited<typeof chromiumTalk>) => {
      console.log(`[windows-live-peer] completing: ${label}`);
      await completeTalksInAppByAnswerIds(receiver, [{
        talkId: talk.talkId,
        talkData: talk.talkData,
        answerIds: ['a_0_match'],
        outcome: 'match',
      }]);
    };

    // Windows -> Mac browser (and the reverse) — closes the named "Windows Chromium -> Mac
    // Chromium" and "Mac Chromium -> Windows Chromium" bullets.
    await complete('Windows Chromium -> Mac Chromium', chromiumUser.page, windowsTalk);
    await complete('Mac Chromium -> Windows Chromium', windowsUser.page, chromiumTalk);
    // Windows <-> Android.
    await complete('Windows Chromium -> Android', androidUser.window, windowsTalk);
    await complete('Android -> Windows Chromium', windowsUser.page, androidTalk);

    console.log('[windows-live-peer] all cross-host pairs completed: Windows is a genuine live peer');
  });
});
