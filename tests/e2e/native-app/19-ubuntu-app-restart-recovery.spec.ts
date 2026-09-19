/**
 * OPEN-11: Ubuntu app restart recovery. The real packaged Ubuntu Electron app and the local macOS
 * Electron app share a LAN hub. The Ubuntu process is killed (no graceful shutdown) and relaunched
 * on the same profile: it must come back with the same identity, re-appear in the hub's Global
 * membership, and converge on a Talk the macOS app broadcast while it was down.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';
import { clickBroadcastUntilBulkAck, completeTalksInAppByAnswerIds, createTagTalkViaEditor } from '../helpers/talk-demo-ui';
import { launchUbuntuDesktopPeer, type UbuntuDesktopPeer } from './helpers/ubuntu-desktop-live-peer';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const APP_PORT = 19168;
const RUN = process.env.E2E_REAL_UBUNTU_RESTART === '1';

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

test.describe('Native app: Ubuntu app restart recovery', () => {
  test.skip(!RUN, 'Set E2E_REAL_UBUNTU_RESTART=1 to run the Ubuntu restart-recovery test.');

  let electron: NativeUser | undefined;
  let ubuntu: UbuntuDesktopPeer | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await ubuntu?.close().catch(() => {});
    await electron?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('killed and relaunched Ubuntu app keeps identity, rejoins, and converges', async () => {
    test.setTimeout(25 * 60_000);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const bootOptions = { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false };

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-ubuntu-restart-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'Restart Mac', bootOptions);
    await forceJoinGlobal(electron.window);

    ubuntu = await launchUbuntuDesktopPeer({ hubGunUrl: lanHubUrl });
    const ubuntuId = await bootstrapNativeWindow(ubuntu.page, 'Restart Ubuntu', bootOptions);
    await forceJoinGlobal(ubuntu.page);

    const inGlobal = async (ids: string[]) => {
      const present = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((m) => m.userId));
      return ids.every((id) => present.has(id));
    };
    await expect.poll(() => inGlobal([macId, ubuntuId]), { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(true);

    // Hard restart, then broadcast from macOS while the Ubuntu app is coming back up.
    await ubuntu.restart();
    const macTalk = await createTagTalkViaEditor(electron.window, { title: `ubuntu-restart-${Date.now()}`, timeoutMs: 90_000 });
    await clickBroadcastUntilBulkAck(electron.window, { minGunPeers: 1, minSent: 1 });

    const ubuntuIdAfter = await bootstrapNativeWindow(ubuntu.page, 'Restart Ubuntu', { ...bootOptions, updateStageName: false });
    expect(ubuntuIdAfter).toBe(ubuntuId);
    await forceJoinGlobal(ubuntu.page);
    await expect.poll(() => inGlobal([macId, ubuntuId]), { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(true);

    await completeTalksInAppByAnswerIds(ubuntu.page, [{
      talkId: macTalk.talkId,
      talkData: macTalk.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);
  });
});
