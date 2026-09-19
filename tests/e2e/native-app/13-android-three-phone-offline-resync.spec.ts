/**
 * Closes docs/TODO.md §3.4's remaining three-phone bullets, all on real hardware:
 *   - Test concurrent Talk propagation.
 *   - Test one device going offline while others continue.
 *   - Test peer return and resynchronization.
 *
 * All configured phones that `adb` currently reports connected (up to the 3 in
 * tests/matrix/devices.json — mirrors 06's own "mark unavailable devices as skipped" policy,
 * but this scenario specifically needs three to be meaningful, so it skips itself with fewer)
 * join Global and each authors/broadcasts one tag Talk in the SAME `Promise.all`, not
 * sequentially — proving concurrent propagation rather than three back-to-back single-talk
 * broadcasts. One phone then goes offline via `adb shell svc wifi disable` while the other two
 * complete each other's talks — "others continue" while it's gone. Which phone that is gets
 * PROBED, not assumed: `android-charlie` is preferred by default, but at least one real device in
 * this fleet (Huawei EMUI) denies `CHANGE_WIFI_STATE` to the adb shell user outright (confirmed
 * via logcat — see `supportsWifiToggle`'s doc comment), so the test picks whichever connected
 * phone actually allows the toggle rather than failing on a device-specific OEM restriction.
 * Bringing that phone's Wi-Fi back on, this
 * test does NOT hand it the other two talks directly; it polls the phone's own local
 * incoming-talk clusters (`findIncomingTalkIdByTitle`, the same mesh-mirrored-to-local-Gun path
 * CLAUDE.md documents) until the talk it missed while offline actually shows up there, then
 * completes it from that freshly-discovered id — real resynchronization, not an injected
 * shortcut.
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import { bootstrapNativeWindow, forceJoinGlobal, readGlobalMembersFromHub } from './helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import {
  clickBroadcastUntilBulkAck,
  completeTalksInAppByAnswerIds,
  createTagTalkViaEditor,
  findIncomingTalkIdByTitle,
} from '../helpers/talk-demo-ui';
import { resolveAndroidMatrixDevices, type ConfiguredAndroidDevice } from './helpers/android-device-config';

const execFileAsync = promisify(execFile);

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');
const OFFLINE_DEVICE_NAME = process.env.NATIVE_APP_ANDROID_OFFLINE_DEVICE?.trim() || 'android-charlie';
const RUN = process.env.E2E_REAL_ANDROID_THREE_PHONE_RESYNC === '1';

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

async function setAndroidWifiEnabled(serial: string, enabled: boolean): Promise<void> {
  await execFileAsync('adb', ['-s', serial, 'shell', 'svc', 'wifi', enabled ? 'enable' : 'disable'], { timeout: 10_000 });
}

/**
 * `svc wifi disable` needs `android.permission.CHANGE_WIFI_STATE` on the adb shell user (uid
 * 2000) — present on stock AOSP but denied outright on at least one real device in this fleet:
 * confirmed via logcat on `android-charlie` (Huawei FRD_L04/EMUI) —
 * `SecurityException: WifiService: Neither user 2000 nor current process has
 * android.permission.CHANGE_WIFI_STATE` — while `android-alice` and `android-bob` both allow it
 * cleanly. This is a real, device-specific OEM restriction, not flaky hardware, so the offline
 * candidate is picked by probing rather than hardcoding a name.
 */
async function supportsWifiToggle(serial: string): Promise<boolean> {
  try {
    await execFileAsync('adb', ['-s', serial, 'shell', 'svc', 'wifi', 'disable'], { timeout: 10_000 });
    await execFileAsync('adb', ['-s', serial, 'shell', 'svc', 'wifi', 'enable'], { timeout: 10_000 }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

type Peer = { device: ConfiguredAndroidDevice; user: AndroidUser; id: string; talk?: Awaited<ReturnType<typeof createTagTalkViaEditor>> };

test.describe('Native app: three real Android phones — concurrent propagation, one offline, resync on return', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_THREE_PHONE_RESYNC=1 to run the physical three-phone test.');

  const peers: Peer[] = [];
  let offlineSerial = '';

  test.afterAll(async () => {
    if (offlineSerial) await setAndroidWifiEnabled(offlineSerial, true).catch(() => {});
    for (const peer of peers) await clearAndroidE2ETestProjections(peer.user).catch(() => {});
    for (const peer of peers) await closeAndroidUser(peer.user);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const peer of peers) {
      const diagnostics = await collectAndroidDiagnostics(peer.device.serial);
      await testInfo.attach(`${peer.device.name}-logcat.txt`, { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
      await testInfo.attach(`${peer.device.name}-node-stdio.txt`, { body: Buffer.from(diagnostics.nodeStdio), contentType: 'text/plain' });
    }
  });

  test('three phones propagate concurrently; one goes offline and resyncs what it missed on return', async () => {
    test.setTimeout(600_000);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    const readiness = await Promise.all(ANDROID_DEVICES.map(async (device) => ({ device, ready: await isAndroidDeviceReady(device.serial) })));
    const available = readiness.filter((r) => r.ready).map((r) => r.device);
    for (const { device, ready } of readiness) {
      if (!ready) console.log(`[three-phone] skipping ${device.name} (${device.serial}): not connected/authorized via adb`);
    }
    test.skip(available.length < 3, `This scenario needs 3 connected phones; only ${available.length} available.`);

    // Not every phone in the fleet allows `svc wifi disable` for the adb shell user — confirmed
    // one real device (android-charlie, Huawei EMUI) denies CHANGE_WIFI_STATE outright (see
    // `supportsWifiToggle`'s doc comment). Probe rather than assume a fixed device name.
    const preferredOffline = available.find((device) => device.name === OFFLINE_DEVICE_NAME);
    const toggleCapability = await Promise.all(
      [...(preferredOffline ? [preferredOffline] : []), ...available.filter((d) => d !== preferredOffline)]
        .map(async (device) => ({ device, canToggle: await supportsWifiToggle(device.serial) })),
    );
    for (const { device, canToggle } of toggleCapability) {
      if (!canToggle) console.log(`[three-phone] ${device.name} (${device.serial}) does not allow Wi-Fi toggling for the adb shell user — skipping it as the offline candidate`);
    }
    const offlineCandidate = toggleCapability.find((entry) => entry.canToggle);
    test.skip(!offlineCandidate, 'None of the connected phones allow adb-driven Wi-Fi toggling (CHANGE_WIFI_STATE denied for the shell user on every one available).');
    const offlineDevice = offlineCandidate!.device;
    console.log(`[three-phone] running with: ${available.map((d) => d.name).join(', ')}; offline candidate: ${offlineDevice.name}`);

    await Promise.all(available.map((device) => resetAndroidAppData(device.serial)));

    for (const device of available) {
      console.log(`[three-phone] launching ${device.name}: ${device.serial}`);
      const user = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: device.serial, disableLanDiscovery: true });
      const id = await bootstrapNativeWindow(user.window, device.name, {
        waitForSupportGreeting: false,
        readinessTimeoutMs: 110_000,
        pinStableLocation: false,
      });
      peers.push({ device, user, id });
    }

    await Promise.all(peers.map((peer) => forceJoinGlobal(peer.user.window)));
    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return peers.filter((peer) => memberIds.has(peer.id)).length;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);

    const runId = `three-phone-${Date.now()}`;
    // Concurrent propagation: all three author AND broadcast in the same Promise.all, not
    // sequentially — proves the mesh handles simultaneous broadcasts from multiple real devices,
    // not just one at a time.
    console.log('[three-phone] authoring and broadcasting concurrently on all phones');
    await Promise.all(peers.map(async (peer) => {
      peer.talk = await createTagTalkViaEditor(peer.user.window, { title: `${runId}-${peer.device.name}`, timeoutMs: 90_000 });
      await clickBroadcastUntilBulkAck(peer.user.window, { minGunPeers: 1, minSent: 1 });
    }));

    const offlinePeer = peers.find((peer) => peer.device.serial === offlineDevice.serial)!;
    const onlinePeers = peers.filter((peer) => peer.device.serial !== offlineDevice.serial);
    expect(onlinePeers.length).toBe(2);
    offlineSerial = offlineDevice.serial;

    console.log(`[three-phone] taking ${offlineDevice.name} offline`);
    await setAndroidWifiEnabled(offlineDevice.serial, false);

    // The other two continue without it: each completes the other's talk.
    const [first, second] = onlinePeers;
    console.log(`[three-phone] ${first.device.name} completes ${second.device.name}'s talk while ${offlineDevice.name} is offline`);
    await completeTalksInAppByAnswerIds(first.user.window, [{
      talkId: second.talk!.talkId,
      talkData: second.talk!.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);
    console.log(`[three-phone] ${second.device.name} completes ${first.device.name}'s talk while ${offlineDevice.name} is offline`);
    await completeTalksInAppByAnswerIds(second.user.window, [{
      talkId: first.talk!.talkId,
      talkData: first.talk!.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);

    console.log(`[three-phone] bringing ${offlineDevice.name} back online`);
    await setAndroidWifiEnabled(offlineDevice.serial, true);
    offlineSerial = '';

    // Real resync, not an injected shortcut: poll the reconnected phone's OWN local
    // incoming-talk clusters until the talk it missed while offline actually shows up.
    const missedTalkTitle = `${runId}-${first.device.name}`;
    let resyncedTalkId = '';
    await expect.poll(async () => {
      try {
        resyncedTalkId = await findIncomingTalkIdByTitle(offlinePeer.user.window, missedTalkTitle);
        return true;
      } catch {
        return false;
      }
    }, { timeout: 120_000, intervals: [2_000, 3_000, 5_000] }).toBe(true);
    console.log(`[three-phone] ${offlineDevice.name} resynced missed talk: ${resyncedTalkId}`);
    // The point already proven above is the resync itself — the reconnected phone discovered
    // this talk through its OWN local mesh cluster, not an injection. Completing it uses the
    // author's own already-known talkData (held in `first.talk` since creation) rather than a
    // REST re-fetch (`GET /api/talks/:id`) that isn't what this bullet is testing and can 202-poll
    // indefinitely for a talk this server process never separately indexed.
    expect(resyncedTalkId).toBe(first.talk!.talkId);
    await completeTalksInAppByAnswerIds(offlinePeer.user.window, [{
      talkId: resyncedTalkId,
      talkData: first.talk!.talkData,
      answerIds: ['a_0_match'],
      outcome: 'match',
    }]);
    console.log('[three-phone] offline phone completed the talk it missed — resync verified end to end');
  });
});
