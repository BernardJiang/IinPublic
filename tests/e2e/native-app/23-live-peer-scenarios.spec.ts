/**
 * Tier 5 combined-hardware scenarios (OPEN-14, 15, 17, 18, 20): one parametrised all-pairs live
 * peer test. Peers are real: the local macOS Electron app, the INSTALLED Windows app and the
 * Ubuntu AppImage (both over SSH+CDP), and physical Android phones — all on one LAN Gun hub.
 * Every peer authors and broadcasts a tag Talk, then EVERY other peer completes it with a match,
 * so each directed pair in the scenario is proven, not inferred.
 *
 * Select with E2E_LIVE_SCENARIO=<name>:
 *   windows-android (14)   mac-windows-android (15)   windows-ubuntu (17)
 *   android-ubuntu (18)    full (20: 2 phones + mac + windows + ubuntu apps)
 * Any required host/device that is offline skips the scenario with an explicit reason.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bootstrapNativeWindow, forceJoinGlobal, launchNativeUser, readGlobalMembersFromHub, type NativeUser } from './helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { clickBroadcastUntilBulkAck, completeTalksInAppByAnswerIds, createTagTalkViaEditor } from '../helpers/talk-demo-ui';
import { launchUbuntuDesktopPeer, type UbuntuDesktopPeer } from './helpers/ubuntu-desktop-live-peer';
import { launchWindowsDesktopPeer, type WindowsDesktopPeer } from './helpers/windows-desktop-live-peer';

type Kind = 'mac' | 'windows' | 'ubuntu' | 'android';
const SCENARIOS: Record<string, Kind[]> = {
  'windows-android': ['windows', 'android'],
  'mac-windows-android': ['mac', 'windows', 'android'],
  'windows-ubuntu': ['windows', 'ubuntu'],
  'android-ubuntu': ['android', 'ubuntu'],
  full: ['android', 'android', 'mac', 'windows', 'ubuntu'],
};
const SCENARIO = process.env.E2E_LIVE_SCENARIO ?? '';
const KINDS = SCENARIOS[SCENARIO];
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type Peer = { name: string; page: import('@playwright/test').Page; id: string; talk?: Awaited<ReturnType<typeof createTagTalkViaEditor>> };

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) if (address.family === 'IPv4' && !address.internal) return address.address;
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

function sshReachable(host: string): boolean {
  try {
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, 'echo up'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

test.describe(`Native app: live peer scenario ${SCENARIO || '(unset)'}`, () => {
  test.skip(!KINDS, `Set E2E_LIVE_SCENARIO to one of: ${Object.keys(SCENARIOS).join(', ')}`);

  const androids: AndroidUser[] = [];
  let electron: NativeUser | undefined;
  let windows: WindowsDesktopPeer | undefined;
  let ubuntu: UbuntuDesktopPeer | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await windows?.close().catch(() => {});
    await ubuntu?.close().catch(() => {});
    for (const android of androids) {
      await clearAndroidE2ETestProjections(android).catch(() => {});
      await closeAndroidUser(android);
    }
    await electron?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('every peer pair exchanges and matches', async () => {
    test.setTimeout(75 * 60_000);
    const serials = configuredAndroidDevices().map((d) => d.serial);
    const needAndroid = KINDS.filter((k) => k === 'android').length;
    const readySerials: string[] = [];
    for (const serial of serials) if (readySerials.length < needAndroid && await isAndroidDeviceReady(serial)) readySerials.push(serial);
    test.skip(readySerials.length < needAndroid, `Need ${needAndroid} ready Android device(s), found ${readySerials.length}.`);
    test.skip(KINDS.includes('windows') && !sshReachable(process.env.WINDOWS_E2E_SSH_HOST || 'windows-test'), 'windows-test is unreachable.');
    test.skip(KINDS.includes('ubuntu') && !sshReachable(process.env.UBUNTU_E2E_SSH_HOST || 'ubuntu-test'), 'ubuntu-test is unreachable.');

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const bootOptions = { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false };
    const peers: Peer[] = [];
    let androidIndex = 0;

    for (const kind of KINDS) {
      if (kind === 'mac') {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-live-scenario-'));
        electron = await launchNativeUser({ localPort: 19171, hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`, userDataDir });
        peers.push({ name: 'Scn Mac', page: electron.window, id: await bootstrapNativeWindow(electron.window, 'Scn Mac', bootOptions) });
      } else if (kind === 'android') {
        const serial = readySerials[androidIndex]!;
        const name = `Scn Android ${androidIndex + 1}`;
        androidIndex += 1;
        await resetAndroidAppData(serial);
        const android = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: serial, disableLanDiscovery: true });
        androids.push(android);
        peers.push({ name, page: android.window, id: await bootstrapNativeWindow(android.window, name, bootOptions) });
      } else if (kind === 'windows') {
        windows = await launchWindowsDesktopPeer({ hubGunUrl: lanHubUrl });
        peers.push({ name: 'Scn Windows', page: windows.page, id: await bootstrapNativeWindow(windows.page, 'Scn Windows', bootOptions) });
      } else {
        ubuntu = await launchUbuntuDesktopPeer({ hubGunUrl: lanHubUrl });
        peers.push({ name: 'Scn Ubuntu', page: ubuntu.page, id: await bootstrapNativeWindow(ubuntu.page, 'Scn Ubuntu', bootOptions) });
      }
      console.log(`[live-scenario] ${peers[peers.length - 1]!.name} ready`);
    }
    expect(new Set(peers.map((p) => p.id)).size).toBe(peers.length);

    await Promise.all(peers.map((p) => forceJoinGlobal(p.page)));
    await expect.poll(async () => {
      const ids = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((m) => m.userId));
      return peers.filter((p) => ids.has(p.id)).length;
    }, { timeout: 120_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);

    const runId = `${SCENARIO}-${Date.now()}`;
    for (const peer of peers) peer.talk = await createTagTalkViaEditor(peer.page, { title: `${runId}-${peer.name.replace(/\s+/g, '-')}`, timeoutMs: 90_000 });
    for (const peer of peers) await clickBroadcastUntilBulkAck(peer.page, { minGunPeers: 1, minSent: 1 });

    for (const receiver of peers) {
      for (const author of peers) {
        if (receiver === author) continue;
        console.log(`[live-scenario] completing: ${author.name} -> ${receiver.name}`);
        await completeTalksInAppByAnswerIds(receiver.page, [{
          talkId: author.talk!.talkId,
          talkData: author.talk!.talkData,
          answerIds: ['a_0_match'],
          outcome: 'match',
        }]);
      }
    }
  });
});
