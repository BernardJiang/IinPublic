/**
 * Closes docs/TODO.md Stage 5.4's "macOS App + Windows App" bullet — the first LIVE desktop-app
 * (not just browser) cross-host peer scenario in this repo. Two real packaged Electron apps —
 * the local macOS build and the real Windows AppImage, built and launched over SSH+CDP on
 * `windows-test` — share one LAN Gun hub, author/broadcast one tag Talk each, and complete each
 * other's.
 *
 * Mechanism: `helpers/windows-desktop-live-peer.ts` deploys the current revision, builds the
 * AppImage (reusing `run-windows-e2e.mjs`'s own dependency-hash-stamp caching so a repeat run with
 * unchanged `package-lock.json` files skips `npm ci`), extracts it, and launches the packaged
 * `iinpublic-desktop` executable on the real X11 display with `--remote-debugging-port` — Electron
 * apps are Chromium under the hood and honor this switch even packaged. Unlike the browser peers
 * (`windows-live-peer.ts`, `windows-live-peer.ts`), this does NOT need a reverse tunnel for the
 * WebCrypto/secure-context trap: the app's own UI loads from bundled local files via its own
 * embedded server, exactly like the local macOS Electron app already does, so
 * `IINPUBLIC_HUB_GUN_URL` just points at the Mac's real LAN Gun URL directly (same as every
 * Android spec's `hubGunUrl`).
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
const APP_PORT = 19167;
const RUN = process.env.E2E_REAL_MACOS_WINDOWS_DESKTOP_LIVE_PEER === '1';

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

test.describe('Native app: macOS App <-> Windows App, both real packaged desktop builds', () => {
  test.skip(!RUN, 'Set E2E_REAL_MACOS_WINDOWS_DESKTOP_LIVE_PEER=1 to run the live desktop-app cross-host peer test.');

  let electron: NativeUser | undefined;
  let windowsDesktop: WindowsDesktopPeer | undefined;
  let userDataDir = '';

  test.afterAll(async () => {
    await windowsDesktop?.close().catch(() => {});
    await electron?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('macOS Electron app and the real Windows Electron app exchange matching talks', async () => {
    test.setTimeout(60 * 60_000);

    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-macos-windows-desktop-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'DesktopPeer Mac', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    await forceJoinGlobal(electron.window);

    console.log('[macos-windows-desktop] building and launching the real Windows desktop app over SSH + CDP (can take several minutes on a cold cache)');
    windowsDesktop = await launchWindowsDesktopPeer({ hubGunUrl: lanHubUrl });
    const windowsId = await bootstrapNativeWindow(windowsDesktop.page, 'DesktopPeer Windows', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    await forceJoinGlobal(windowsDesktop.page);

    expect(macId).not.toBe(windowsId);

    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return [macId, windowsId].every((id) => memberIds.has(id));
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(true);
    console.log('[macos-windows-desktop] both real desktop apps present in Global');

    const runId = `macos-windows-desktop-${Date.now()}`;
    console.log('[macos-windows-desktop] authoring: macOS App');
    const macTalk = await createTagTalkViaEditor(electron.window, { title: `${runId}-macos-app`, timeoutMs: 90_000 });
    console.log('[macos-windows-desktop] authoring: Windows App');
    const windowsTalk = await createTagTalkViaEditor(windowsDesktop.page, { title: `${runId}-windows-app`, timeoutMs: 90_000 });

    console.log('[macos-windows-desktop] broadcasting: macOS App');
    await clickBroadcastUntilBulkAck(electron.window, { minGunPeers: 1, minSent: 1 });
    console.log('[macos-windows-desktop] broadcasting: Windows App');
    await clickBroadcastUntilBulkAck(windowsDesktop.page, { minGunPeers: 1, minSent: 1 });

    console.log('[macos-windows-desktop] completing: Windows App -> macOS App');
    await completeTalksInAppByAnswerIds(electron.window, [{
      talkId: windowsTalk.talkId,
      talkData: windowsTalk.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);
    console.log('[macos-windows-desktop] completing: macOS App -> Windows App');
    await completeTalksInAppByAnswerIds(windowsDesktop.page, [{
      talkId: macTalk.talkId,
      talkData: macTalk.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);

    console.log('[macos-windows-desktop] both directions completed: the real Windows desktop app is a genuine live peer');
  });
});
