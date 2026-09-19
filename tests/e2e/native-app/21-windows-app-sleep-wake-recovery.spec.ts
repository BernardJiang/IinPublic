/**
 * OPEN-09: Windows sleep/wake recovery. The installed Windows Electron app runs in the console
 * session; the whole host is suspended (S3) with a wake-timer task and resumes. The SAME app
 * process must keep its identity, reconnect to the LAN hub, rejoin Global, and converge on a Talk
 * the macOS app broadcast after the wake.
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
import { launchWindowsDesktopPeer, type WindowsDesktopPeer } from './helpers/windows-desktop-live-peer';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const APP_PORT = 19169;
const RUN = process.env.E2E_REAL_WINDOWS_SLEEP_WAKE === '1';

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

test.describe('Native app: Windows app sleep/wake recovery', () => {
  test.skip(!RUN, 'Set E2E_REAL_WINDOWS_SLEEP_WAKE=1 (this really suspends the Windows test PC).');

  let electron: NativeUser | undefined;
  let windows: WindowsDesktopPeer | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await windows?.close().catch(() => {});
    await electron?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('installed Windows app survives host sleep and wake', async () => {
    test.setTimeout(60 * 60_000);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const bootOptions = { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false };

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-windows-sleep-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'Sleep Mac', bootOptions);
    await forceJoinGlobal(electron.window);

    windows = await launchWindowsDesktopPeer({ hubGunUrl: lanHubUrl, interactive: true });
    const winId = await bootstrapNativeWindow(windows.page, 'Sleep Windows', bootOptions);
    await forceJoinGlobal(windows.page);

    const inGlobal = async (ids: string[]) => {
      const present = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((m) => m.userId));
      return ids.every((id) => present.has(id));
    };
    await expect.poll(() => inGlobal([macId, winId]), { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(true);

    await windows.sleepAndWake(150);

    const winIdAfter = await bootstrapNativeWindow(windows.page, 'Sleep Windows', { ...bootOptions, updateStageName: false });
    expect(winIdAfter).toBe(winId);
    await forceJoinGlobal(windows.page);
    await expect.poll(() => inGlobal([macId, winId]), { timeout: 120_000, intervals: [1000, 2000, 3000] }).toBe(true);

    const macTalk = await createTagTalkViaEditor(electron.window, { title: `windows-wake-${Date.now()}`, timeoutMs: 90_000 });
    await clickBroadcastUntilBulkAck(electron.window, { minGunPeers: 1, minSent: 1 });
    await completeTalksInAppByAnswerIds(windows.page, [{
      talkId: macTalk.talkId,
      talkData: macTalk.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);
  });
});
