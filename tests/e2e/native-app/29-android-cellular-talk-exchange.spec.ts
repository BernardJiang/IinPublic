/**
 * Real cellular path: one phone on MOBILE DATA (Wi-Fi off, SIM only) exchanges Talks and a DM
 * with a phone on Wi-Fi, both pointed at the PUBLIC hub. Nothing here is reachable over the LAN,
 * so every byte crosses carrier NAT: hub relay, mesh/mailbox fallback, and the WebRTC DataChannel
 * for the post-match DM.
 *
 * Runs against production (`NATIVE_APP_CELLULAR_HUB`, default https://www.iinpublic.com/gun), so
 * both phones join a private, run-unique room instead of Global to avoid showing test Talks to
 * real users.
 *
 *   E2E_REAL_ANDROID_CELLULAR=1 \
 *   NATIVE_APP_ANDROID_CELLULAR=<serial with SIM> NATIVE_APP_ANDROID_WIFI_PEER=<serial> \
 *   npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/29-android-cellular-talk-exchange.spec.ts
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { bootstrapNativeWindow, forceJoinRoom } from './helpers/native-app';
import {
  closeAndroidUser,
  collectAndroidDiagnostics,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { completeTalksInAppByAnswerIds, createTagTalkViaEditor, findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';
import { openConversationViaServer, waitForServerConversationBetween, getConversationIdBetween } from '../helpers/conversation-e2e';

const execFileAsync = promisify(execFile);

const RUN = process.env.E2E_REAL_ANDROID_CELLULAR === '1';
const HUB = process.env.NATIVE_APP_CELLULAR_HUB?.trim() || 'https://www.iinpublic.com/gun';
const CELLULAR_SERIAL = process.env.NATIVE_APP_ANDROID_CELLULAR?.trim() || '';
const WIFI_SERIAL = process.env.NATIVE_APP_ANDROID_WIFI_PEER?.trim() || '';

type Peer = { name: string; serial: string; user: AndroidUser; id: string };

async function adb(serial: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('adb', ['-s', serial, ...args], { timeout: 15_000 });
  return stdout;
}

async function setWifi(serial: string, enabled: boolean): Promise<void> {
  await adb(serial, 'shell', 'svc', 'wifi', enabled ? 'enable' : 'disable');
}

async function wakeAndUnlock(serial: string): Promise<void> {
  await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP').catch(() => '');
  await adb(serial, 'shell', 'wm', 'dismiss-keyguard').catch(() => '');
  await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK').catch(() => '');
}

/** True when the default network is cellular, i.e. Wi-Fi really is out of the path. */
async function onCellularOnly(serial: string): Promise<boolean> {
  const out = await adb(serial, 'shell', 'dumpsys', 'connectivity').catch(() => '');
  const active = out.split('\n').find((line) => /Active default network/i.test(line)) ?? '';
  const netId = active.match(/(\d+)/)?.[1];
  if (!netId) return false;
  const agent = out.split('\n').find((line) => line.includes(`NetworkAgentInfo{network{${netId}}`)) ?? '';
  return /CELLULAR/.test(agent) && !/WIFI/.test(agent);
}

/**
 * The WebView only talks to its on-device node (127.0.0.1:8088), so the page cannot probe the hub
 * itself; ping from the phone's shell instead. The Talk exchange below proves the app's own path.
 */
async function hubReachableFromPhone(serial: string): Promise<boolean> {
  const host = new URL(HUB).hostname;
  const out = await adb(serial, 'shell', 'ping', '-c', '2', '-W', '5', host).catch(() => '');
  return / 0% packet loss/.test(out) || /\b[12] received/.test(out);
}

async function waitForIncoming(peer: Peer, title: string): Promise<string> {
  let talkId = '';
  await expect.poll(async () => {
    try {
      talkId = await findIncomingTalkIdByTitle(peer.user.window, title);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 120_000, intervals: [2_000, 3_000, 5_000], message: `${peer.name} should receive "${title}"` }).toBe(true);
  return talkId;
}

test.describe('Native app: real cellular phone exchanges Talks and a DM through the public hub', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_CELLULAR=1 to run the physical cellular test.');
  test.skip(!CELLULAR_SERIAL || !WIFI_SERIAL, 'Set NATIVE_APP_ANDROID_CELLULAR and NATIVE_APP_ANDROID_WIFI_PEER.');

  const peers: Peer[] = [];

  test.afterAll(async () => {
    await setWifi(CELLULAR_SERIAL, true).catch(() => {});
    for (const peer of peers) await closeAndroidUser(peer.user);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const peer of peers) {
      const diagnostics = await collectAndroidDiagnostics(peer.serial);
      await testInfo.attach(`${peer.name}-logcat.txt`, { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
      await testInfo.attach(`${peer.name}-node-stdio.txt`, { body: Buffer.from(diagnostics.nodeStdio), contentType: 'text/plain' });
    }
  });

  test('cellular ↔ Wi-Fi: both directions of Talk delivery, match, and a DM', async () => {
    test.setTimeout(600_000);

    for (const serial of [CELLULAR_SERIAL, WIFI_SERIAL]) await wakeAndUnlock(serial);
    await setWifi(CELLULAR_SERIAL, false);
    await expect.poll(() => onCellularOnly(CELLULAR_SERIAL), {
      timeout: 30_000,
      message: 'cellular phone should be on mobile data only',
    }).toBe(true);

    await Promise.all([resetAndroidAppData(CELLULAR_SERIAL), resetAndroidAppData(WIFI_SERIAL)]);
    for (const [name, serial] of [['cellular', CELLULAR_SERIAL], ['wifi', WIFI_SERIAL]] as const) {
      console.log(`[cellular] launching ${name}: ${serial}`);
      const user = await launchAndroidUserViaAdb({ hubGunUrl: HUB, deviceSerial: serial, disableLanDiscovery: true });
      const id = await bootstrapNativeWindow(user.window, `cell-${name}`, {
        waitForSupportGreeting: false,
        readinessTimeoutMs: 150_000,
        pinStableLocation: false,
      });
      peers.push({ name, serial, user, id });
    }
    const [cell, wifi] = peers;
    expect(await hubReachableFromPhone(CELLULAR_SERIAL)).toBe(true);
    expect(await onCellularOnly(CELLULAR_SERIAL)).toBe(true);

    const runId = `cellular-${Date.now()}`;
    await Promise.all(peers.map((peer) => forceJoinRoom(peer.user.window, runId)));

    // Wi-Fi → cellular.
    const wifiTalk = await createTagTalkViaEditor(wifi.user.window, { title: `${runId}-from-wifi`, timeoutMs: 90_000 });
    const sentToCell = await wifi.user.window.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1),
    );
    console.log(`[cellular] wifi broadcast ${JSON.stringify(sentToCell)}`);
    const t0 = Date.now();
    expect(await waitForIncoming(cell, wifiTalk.talkData.title)).toBe(wifiTalk.talkId);
    console.log(`[cellular] cellular phone received wifi talk after ${Date.now() - t0}ms`);

    // Cellular → Wi-Fi.
    const cellTalk = await createTagTalkViaEditor(cell.user.window, { title: `${runId}-from-cell`, timeoutMs: 90_000 });
    const sentToWifi = await cell.user.window.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1),
    );
    console.log(`[cellular] cellular broadcast ${JSON.stringify(sentToWifi)}`);
    const t1 = Date.now();
    expect(await waitForIncoming(wifi, cellTalk.talkData.title)).toBe(cellTalk.talkId);
    console.log(`[cellular] wifi phone received cellular talk after ${Date.now() - t1}ms`);

    // The cellular phone answers with a match; the response has to travel back over carrier NAT.
    await completeTalksInAppByAnswerIds(cell.user.window, [{
      talkId: wifiTalk.talkId, talkData: wifiTalk.talkData, answerIds: ['a_0_match'], outcome: 'match',
    }]);
    const t2 = Date.now();
    await Promise.all([
      waitForServerConversationBetween(cell.user.window, cell.id, wifi.id, 180_000),
      waitForServerConversationBetween(wifi.user.window, wifi.id, cell.id, 180_000),
    ]);
    console.log(`[cellular] match conversation on both phones after ${Date.now() - t2}ms`);

    // Post-match DM over the direct P2P transport (WebRTC across carrier NAT).
    const conversationId = await getConversationIdBetween(wifi.user.window, wifi.id, cell.id);
    await Promise.all([
      openConversationViaServer(cell.user.window, cell.id, 'cell-wifi', wifi.id),
      openConversationViaServer(wifi.user.window, wifi.id, 'cell-cellular', cell.id),
    ]);
    for (const [from, to, text] of [[cell, wifi, `${runId} hello from mobile data`], [wifi, cell, `${runId} hello from wifi`]] as const) {
      await from.user.window.evaluate(async ({ cid, sid, body }) => {
        await (window as any).__iinpublic_app?.getApp?.()?.conversationService.sendMessage(cid, sid, body);
      }, { cid: conversationId, sid: from.id, body: text });
      const t = Date.now();
      await expect.poll(
        () => to.user.window.locator('#conversation-messages .message-text').filter({ hasText: text }).first().isVisible().catch(() => false),
        { timeout: 90_000, message: `${to.name} should see "${text}"` },
      ).toBe(true);
      console.log(`[cellular] DM ${from.name} → ${to.name} visible after ${Date.now() - t}ms`);
    }
  });
});
