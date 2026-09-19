/**
 * Closes the remaining named directional pairs from docs/TODO.md §3.2 that the seven-client
 * ring matrix (06) does not happen to cover on any given run, since that test's ring order only
 * proves whichever adjacent pairs fall out of push order:
 *   - Chromium -> Android
 *   - Android -> WebKit
 *   - Android -> Firefox
 *   - Android -> macOS App ("Android publishes a Talk and desktop receives it")
 *
 * One real Android phone plus the macOS Electron app, Chromium, WebKit, and Firefox share one
 * LAN Gun hub. Each authors and broadcasts one tag Talk; then each of the four pairs above is
 * exercised as an explicit, individually-assertable completion rather than an implicit ring edge.
 */
import { chromium, firefox, test, expect, webkit, type Browser, type Page } from '@playwright/test';
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
  closeAndroidUser,
  collectAndroidDiagnostics,
  clearAndroidE2ETestProjections,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { clickBroadcastUntilBulkAck, completeTalksInAppByAnswerIds, createTagTalkViaEditor } from '../helpers/talk-demo-ui';
import { configuredAndroidDevices } from './helpers/android-device-config';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19162;
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
const RUN = process.env.E2E_REAL_ANDROID_DIRECTIONAL_PAIRS === '1';
const WEBRTC_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type Peer = { name: string; runtime: string; page: Page; id: string };

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
  peer.page.on('console', (message) => {
    if (!/failed to create talk/i.test(message.text())) return;
    console.log(`[directional-pairs] console ${message.type()} from ${peer.runtime}: ${message.text()}`);
  });
  peer.page.on('pageerror', (error) => {
    console.log(`[directional-pairs] page error from ${peer.runtime}: ${error.message}`);
  });
}

function oneTagTalk(owner: string): string {
  return `directional-${owner}-${Date.now()}`;
}

test.describe('Native app: Android <-> browser-engine directional pairs', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_DIRECTIONAL_PAIRS=1 to run the physical-device pair test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL, or configure a device in tests/matrix/devices.json.');

  let electron: NativeUser | undefined;
  let androidUser: AndroidUser | undefined;
  const browsers: Browser[] = [];
  const browserClosers: Array<() => Promise<void>> = [];
  let userDataDir = '';

  test.afterAll(async () => {
    for (const close of browserClosers) await close().catch(() => {});
    for (const browser of browsers) await browser.close().catch(() => {});
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

  test('each named directional pair exchanges and receives a matching talk', async () => {
    test.setTimeout(600_000);
    const ready = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!ready, `Android device ${ANDROID_SERIAL} is not connected/authorized via adb.`);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;
    const peers: Peer[] = [];

    await resetAndroidAppData(ANDROID_SERIAL);

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-directional-pairs-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'Pairs Mac', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    const macPeer: Peer = { name: 'Pairs Mac', runtime: 'macOS Electron', page: electron.window, id: macId };
    peers.push(macPeer);

    androidUser = await launchAndroidUserViaAdb({
      hubGunUrl: lanHubUrl,
      deviceSerial: ANDROID_SERIAL,
      disableLanDiscovery: true,
    });
    const androidId = await bootstrapNativeWindow(androidUser.window, 'Pairs Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    const androidPeer: Peer = { name: 'Pairs Android', runtime: 'Android', page: androidUser.window, id: androidId };
    peers.push(androidPeer);

    const engines = [
      { name: 'Pairs Chrome', runtime: 'Chromium', launch: () => chromium.launch({ headless: true, args: WEBRTC_ARGS }) },
      { name: 'Pairs Safari', runtime: 'WebKit', launch: () => webkit.launch({ headless: true }) },
      { name: 'Pairs Firefox', runtime: 'Firefox', launch: () => firefox.launch({ headless: true }) },
    ];
    const browserPeers = new Map<string, Peer>();
    for (const engine of engines) {
      const browser = await engine.launch();
      browsers.push(browser);
      const browserUser = await bootstrapBrowserUserOnOrigin(
        browser,
        `http://127.0.0.1:${WEB_PORT}`,
        engine.name,
        engine.name,
        { waitForSupportGreeting: false },
      );
      browserClosers.push(browserUser.close);
      const peer: Peer = { name: engine.name, runtime: engine.runtime, page: browserUser.page, id: browserUser.userId };
      peers.push(peer);
      browserPeers.set(engine.runtime, peer);
    }
    const chromiumPeer = browserPeers.get('Chromium')!;
    const webkitPeer = browserPeers.get('WebKit')!;
    const firefoxPeer = browserPeers.get('Firefox')!;

    expect(new Set(peers.map((peer) => peer.id)).size).toBe(peers.length);
    peers.forEach(attachDiagnostics);

    await Promise.all(peers.map((peer) => forceJoinGlobal(peer.page)));
    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return peers.filter((peer) => memberIds.has(peer.id)).length;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);

    // Only Chromium and Android need to author a talk: Chromium's is completed by Android
    // (Chromium -> Android), and Android's is completed by three different receivers
    // (Android -> WebKit, Android -> Firefox, Android -> macOS App / desktop).
    console.log('[directional-pairs] authoring: Chromium');
    const chromiumTalk = await createTagTalkViaEditor(chromiumPeer.page, { title: oneTagTalk('chromium'), timeoutMs: 90_000 });
    console.log('[directional-pairs] authoring: Android');
    const androidTalk = await createTagTalkViaEditor(androidPeer.page, { title: oneTagTalk('android'), timeoutMs: 90_000 });

    console.log('[directional-pairs] broadcasting: Chromium');
    await clickBroadcastUntilBulkAck(chromiumPeer.page, { minGunPeers: 1, minSent: 1 });
    console.log('[directional-pairs] broadcasting: Android');
    await clickBroadcastUntilBulkAck(androidPeer.page, { minGunPeers: 1, minSent: 1 });

    const complete = async (label: string, receiver: Peer, talk: Awaited<typeof chromiumTalk>) => {
      console.log(`[directional-pairs] completing: ${label}`);
      await completeTalksInAppByAnswerIds(receiver.page, [{
        talkId: talk.talkId,
        talkData: talk.talkData,
        answerIds: ['a_0_match'],
        outcome: 'match',
      }]);
    };

    // Chromium -> Android
    await complete('Chromium -> Android', androidPeer, chromiumTalk);
    // Android -> WebKit
    await complete('Android -> WebKit', webkitPeer, androidTalk);
    // Android -> Firefox
    await complete('Android -> Firefox', firefoxPeer, androidTalk);
    // Android -> macOS App ("Android publishes a Talk and desktop receives it")
    await complete('Android -> macOS App', macPeer, androidTalk);

    console.log('[directional-pairs] all four directional pairs completed');
  });
});
