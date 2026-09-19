/**
 * Closes docs/TODO.md Stage 5.2's "Ubuntu browser -> Mac browser" and "Ubuntu browser -> Android"
 * bullets — the first genuinely LIVE cross-host peer scenarios in this repo (every prior
 * Ubuntu/Windows test is remote-batch: deploy, build, run entirely on that host, ship a report
 * back; see `environment-availability.ts`'s own doc comment on this exact gap).
 *
 * Mechanism: `helpers/ubuntu-live-peer.ts` launches Ubuntu's already-installed Playwright
 * Chromium headless with a real remote-debugging port, tunnels it to this Mac over SSH, and
 * connects via CDP — the same pattern `native-app-android.ts` already uses for a real physical
 * Android WebView. The Ubuntu browser navigates to this Mac's LAN-exposed native-app hub URL, so
 * from Gun's perspective it is an ordinary fourth peer on the same hub: no star/relay involved.
 *
 * Four peers share one LAN Gun hub: the macOS Electron app, one real Android phone, a local
 * Chromium browser, and the real Ubuntu Chromium. Chromium and Android each author/broadcast one
 * tag Talk; Ubuntu completes Chromium's (Ubuntu -> ... proving Ubuntu can receive) and Android's
 * (Android -> Ubuntu), and Ubuntu's own authored Talk is completed by Chromium (Ubuntu -> Mac
 * browser) and by Android (Ubuntu -> Android) — covering both named bullets plus their reverse
 * directions in one run.
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
import { launchUbuntuChromePeer, type UbuntuBrowserPeer } from './helpers/ubuntu-live-peer';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19163;
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
const RUN = process.env.E2E_REAL_UBUNTU_LIVE_PEER === '1';
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
  peer.page.on('pageerror', (error) => console.log(`[ubuntu-live-peer] page error from ${peer.runtime}: ${error.message}`));
}

test.describe('Native app: Ubuntu real Chromium as a live cross-host peer', () => {
  test.skip(!RUN, 'Set E2E_REAL_UBUNTU_LIVE_PEER=1 to run the live Ubuntu cross-host peer test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL, or configure a device in tests/matrix/devices.json.');

  let electron: NativeUser | undefined;
  let androidUser: AndroidUser | undefined;
  let ubuntuPeer: UbuntuBrowserPeer | undefined;
  let localBrowser: Browser | undefined;
  let localBrowserClose: (() => Promise<void>) | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await localBrowserClose?.().catch(() => {});
    await localBrowser?.close().catch(() => {});
    await ubuntuPeer?.close().catch(() => {});
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

  test('Ubuntu Chromium exchanges matching talks with a Mac browser and a real Android phone', async () => {
    test.setTimeout(600_000);
    const ready = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!ready, `Android device ${ANDROID_SERIAL} is not connected/authorized via adb.`);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;
    const peers: Peer[] = [];

    await resetAndroidAppData(ANDROID_SERIAL);

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-ubuntu-live-peer-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'LivePeer Mac', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    peers.push({ name: 'LivePeer Mac', runtime: 'macOS Electron', page: electron.window, id: macId });

    androidUser = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: ANDROID_SERIAL, disableLanDiscovery: true });
    const androidId = await bootstrapNativeWindow(androidUser.window, 'LivePeer Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    peers.push({ name: 'LivePeer Android', runtime: 'Android', page: androidUser.window, id: androidId });

    localBrowser = await chromium.launch({ headless: true, args: WEBRTC_ARGS });
    const chromiumUser = await bootstrapBrowserUserOnOrigin(localBrowser, `http://127.0.0.1:${WEB_PORT}`, 'LivePeer Chrome', 'LivePeer Chrome', { waitForSupportGreeting: false });
    localBrowserClose = chromiumUser.close;
    peers.push({ name: 'LivePeer Chrome', runtime: 'Chromium', page: chromiumUser.page, id: chromiumUser.userId });

    console.log('[ubuntu-live-peer] launching real Chromium on ubuntu-test over SSH + CDP');
    // Reverse-tunnel this Mac's web+gun ports onto Ubuntu's OWN loopback (see
    // ubuntu-live-peer.ts's header comment) — navigating to the LAN IP directly breaks WebCrypto
    // (not a secure context), which Gun's SEA shim needs.
    ubuntuPeer = await launchUbuntuChromePeer({ reverseForwardPorts: [WEB_PORT, HUB_GUN_PORT] });
    const ubuntuLoopbackWebUrl = `http://127.0.0.1:${WEB_PORT}`;
    const ubuntuUser = await bootstrapBrowserUserOnOrigin(ubuntuPeer.browser, ubuntuLoopbackWebUrl, 'LivePeer Ubuntu', 'LivePeer Ubuntu', { waitForSupportGreeting: false });
    peers.push({ name: 'LivePeer Ubuntu', runtime: 'Ubuntu Chromium (live SSH peer)', page: ubuntuUser.page, id: ubuntuUser.userId });

    expect(new Set(peers.map((peer) => peer.id)).size).toBe(peers.length);
    peers.forEach(attachDiagnostics);

    await Promise.all(peers.map((peer) => forceJoinGlobal(peer.page)));
    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return peers.filter((peer) => memberIds.has(peer.id)).length;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);
    console.log('[ubuntu-live-peer] all 4 peers present in Global, including the real Ubuntu host');

    const runId = `ubuntu-live-peer-${Date.now()}`;
    console.log('[ubuntu-live-peer] authoring: Chromium (Mac)');
    const chromiumTalk = await createTagTalkViaEditor(chromiumUser.page, { title: `${runId}-mac-chrome`, timeoutMs: 90_000 });
    console.log('[ubuntu-live-peer] authoring: Android');
    const androidTalk = await createTagTalkViaEditor(androidUser.window, { title: `${runId}-android`, timeoutMs: 90_000 });
    console.log('[ubuntu-live-peer] authoring: Ubuntu Chromium');
    const ubuntuTalk = await createTagTalkViaEditor(ubuntuUser.page, { title: `${runId}-ubuntu-chrome`, timeoutMs: 90_000 });

    console.log('[ubuntu-live-peer] broadcasting: Chromium (Mac)');
    await clickBroadcastUntilBulkAck(chromiumUser.page, { minGunPeers: 1, minSent: 1 });
    console.log('[ubuntu-live-peer] broadcasting: Android');
    await clickBroadcastUntilBulkAck(androidUser.window, { minGunPeers: 1, minSent: 1 });
    console.log('[ubuntu-live-peer] broadcasting: Ubuntu Chromium');
    await clickBroadcastUntilBulkAck(ubuntuUser.page, { minGunPeers: 1, minSent: 1 });

    const complete = async (label: string, receiver: import('@playwright/test').Page, talk: Awaited<typeof chromiumTalk>) => {
      console.log(`[ubuntu-live-peer] completing: ${label}`);
      await completeTalksInAppByAnswerIds(receiver, [{
        talkId: talk.talkId,
        talkData: talk.talkData,
        answerIds: ['a_0_match'],
        outcome: 'match',
      }]);
    };

    // Ubuntu -> Mac browser (and the reverse) — closes the named "Ubuntu browser -> Mac browser" bullet.
    await complete('Ubuntu Chromium -> Mac Chromium', chromiumUser.page, ubuntuTalk);
    await complete('Mac Chromium -> Ubuntu Chromium', ubuntuUser.page, chromiumTalk);
    // Ubuntu <-> Android — closes the named "Ubuntu browser -> Android" bullet.
    await complete('Ubuntu Chromium -> Android', androidUser.window, ubuntuTalk);
    await complete('Android -> Ubuntu Chromium', ubuntuUser.page, androidTalk);

    console.log('[ubuntu-live-peer] all cross-host pairs completed: Ubuntu is a genuine live peer');
  });
});
