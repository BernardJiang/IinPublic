/**
 * Closes docs/TODO.md Stage 5.2's "Ubuntu browser -> Windows browser" bullet and contributes
 * toward Stage 5.4's "Mac mini orchestrates a real distributed IinPublic environment" milestone —
 * combines both live cross-host peer mechanisms (`ubuntu-live-peer.ts`, `windows-live-peer.ts`)
 * into one five-peer run: macOS Electron, one real Android phone, a local Chromium browser, the
 * real Ubuntu Chromium, and the real Windows Chromium, all sharing one LAN Gun hub. Each of the
 * five authors/broadcasts one tag Talk; the interesting new pair this file adds beyond what
 * `14-ubuntu-cross-host-live-peer.spec.ts` and `15-windows-cross-host-live-peer.spec.ts` already
 * cover individually is Ubuntu <-> Windows directly (two different remote hosts exchanging with
 * each other, not just each with the Mac/Android) — proven with an explicit completion in both
 * directions rather than assumed from the other two specs passing independently.
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
import { launchWindowsChromePeer, type WindowsBrowserPeer } from './helpers/windows-live-peer';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19165;
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
const RUN = process.env.E2E_REAL_FIVE_WAY_LIVE_PEER === '1';
const WEBRTC_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type Peer = { name: string; runtime: string; page: import('@playwright/test').Page; id: string; talk?: Awaited<ReturnType<typeof createTagTalkViaEditor>> };

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
  peer.page.on('pageerror', (error) => console.log(`[five-way] page error from ${peer.runtime}: ${error.message}`));
}

test.describe('Native app: five-way live cross-host peer matrix (Mac + Android + Ubuntu + Windows)', () => {
  test.skip(!RUN, 'Set E2E_REAL_FIVE_WAY_LIVE_PEER=1 to run the five-way live cross-host peer test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL, or configure a device in tests/matrix/devices.json.');

  let electron: NativeUser | undefined;
  let androidUser: AndroidUser | undefined;
  let ubuntuPeer: UbuntuBrowserPeer | undefined;
  let windowsPeer: WindowsBrowserPeer | undefined;
  let localBrowser: Browser | undefined;
  let localBrowserClose: (() => Promise<void>) | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await localBrowserClose?.().catch(() => {});
    await localBrowser?.close().catch(() => {});
    await ubuntuPeer?.close().catch(() => {});
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

  test('macOS, Android, Ubuntu, and Windows all share Global and exchange matching talks, including Ubuntu <-> Windows directly', async () => {
    test.setTimeout(900_000);
    const ready = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!ready, `Android device ${ANDROID_SERIAL} is not connected/authorized via adb.`);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;
    const peers: Peer[] = [];

    await resetAndroidAppData(ANDROID_SERIAL);

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-five-way-live-peer-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'FiveWay Mac', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    peers.push({ name: 'FiveWay Mac', runtime: 'macOS Electron', page: electron.window, id: macId });

    androidUser = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: ANDROID_SERIAL, disableLanDiscovery: true });
    const androidId = await bootstrapNativeWindow(androidUser.window, 'FiveWay Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    peers.push({ name: 'FiveWay Android', runtime: 'Android', page: androidUser.window, id: androidId });

    localBrowser = await chromium.launch({ headless: true, args: WEBRTC_ARGS });
    const chromiumUser = await bootstrapBrowserUserOnOrigin(localBrowser, `http://127.0.0.1:${WEB_PORT}`, 'FiveWay Chrome', 'FiveWay Chrome', { waitForSupportGreeting: false });
    localBrowserClose = chromiumUser.close;
    peers.push({ name: 'FiveWay Chrome', runtime: 'Chromium', page: chromiumUser.page, id: chromiumUser.userId });

    console.log('[five-way] launching real Chromium on ubuntu-test over SSH + CDP');
    ubuntuPeer = await launchUbuntuChromePeer({ reverseForwardPorts: [WEB_PORT, HUB_GUN_PORT] });
    const ubuntuUser = await bootstrapBrowserUserOnOrigin(ubuntuPeer.browser, `http://127.0.0.1:${WEB_PORT}`, 'FiveWay Ubuntu', 'FiveWay Ubuntu', { waitForSupportGreeting: false });
    peers.push({ name: 'FiveWay Ubuntu', runtime: 'Ubuntu Chromium (live SSH peer)', page: ubuntuUser.page, id: ubuntuUser.userId });

    console.log('[five-way] launching real Chromium on windows-test over SSH + CDP');
    windowsPeer = await launchWindowsChromePeer({ reverseForwardPorts: [WEB_PORT, HUB_GUN_PORT] });
    const windowsUser = await bootstrapBrowserUserOnOrigin(windowsPeer.browser, `http://127.0.0.1:${WEB_PORT}`, 'FiveWay Windows', 'FiveWay Windows', { waitForSupportGreeting: false });
    peers.push({ name: 'FiveWay Windows', runtime: 'Windows Chromium (live SSH peer)', page: windowsUser.page, id: windowsUser.userId });

    expect(new Set(peers.map((peer) => peer.id)).size).toBe(peers.length);
    peers.forEach(attachDiagnostics);

    await Promise.all(peers.map((peer) => forceJoinGlobal(peer.page)));
    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return peers.filter((peer) => memberIds.has(peer.id)).length;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);
    console.log(`[five-way] all ${peers.length} peers present in Global, including real Ubuntu and Windows hosts`);

    const runId = `five-way-${Date.now()}`;
    for (const peer of peers) {
      console.log(`[five-way] authoring: ${peer.runtime}`);
      peer.talk = await createTagTalkViaEditor(peer.page, { title: `${runId}-${peer.name.replace(/\s+/g, '-')}`, timeoutMs: 90_000 });
    }
    for (const peer of peers) {
      console.log(`[five-way] broadcasting: ${peer.runtime}`);
      await clickBroadcastUntilBulkAck(peer.page, { minGunPeers: 1, minSent: 1 });
    }

    const ubuntuFiveWayPeer = peers.find((p) => p.runtime.startsWith('Ubuntu'))!;
    const windowsFiveWayPeer = peers.find((p) => p.runtime.startsWith('Windows'))!;

    const complete = async (label: string, receiver: Peer, author: Peer) => {
      console.log(`[five-way] completing: ${label}`);
      await completeTalksInAppByAnswerIds(receiver.page, [{
        talkId: author.talk!.talkId,
        talkData: author.talk!.talkData,
        answerIds: ['a_0_match'],
        outcome: 'match',
      }]);
    };

    // The new pair this file specifically proves: two different remote hosts exchanging with
    // EACH OTHER, not just each independently with the Mac/Android.
    await complete('Ubuntu -> Windows', windowsFiveWayPeer, ubuntuFiveWayPeer);
    await complete('Windows -> Ubuntu', ubuntuFiveWayPeer, windowsFiveWayPeer);

    console.log('[five-way] Ubuntu <-> Windows direct exchange verified — five-way live cross-host matrix complete');
  });
});
