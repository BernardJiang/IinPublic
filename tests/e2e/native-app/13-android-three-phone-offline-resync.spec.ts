/**
 * Three real phones near each other (Nearby v3 personal lists), sharing the journey body with
 * staged/stage3/81 (tests/e2e/journeys/nearby-ring-journey.ts, OPEN-59 step 3):
 *   J-NEARBY-04  all three author and send Talks in the same Promise.all; each receives the other
 *                two (concurrent propagation, not three back-to-back sends);
 *   J-NEARBY-05  one phone's Wi-Fi goes off; only then does another phone send it a Talk; the two
 *                online phones answer each other's Talks meanwhile; Wi-Fi back on, the missed Talk
 *                shows up in the returning phone's own local incoming clusters (real catch-up).
 * The offline phone is PROBED, not assumed: some OEM builds deny `svc wifi disable` to the adb
 * shell user (see `supportsWifiToggle`). Rewritten 2026-10-20 for v3: the former room-partition
 * and Global steps went with the v2 shared rooms and the room-wide mesh overlay.
 */
import { test } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import { bootstrapNativeWindow, enterNearbyAt } from './helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import type { TestActor } from '../helpers/test-actor';
import { everyoneListsEveryone, offlineResyncJourney, type NearbyParticipant } from '../journeys/nearby-ring-journey';
import { resolveAndroidMatrixDevices, type ConfiguredAndroidDevice } from './helpers/android-device-config';

const execFileAsync = promisify(execFile);

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');
const OFFLINE_DEVICE_NAME = process.env.NATIVE_APP_ANDROID_OFFLINE_DEVICE?.trim() || 'android-charlie';
const RUN = process.env.E2E_REAL_ANDROID_THREE_PHONE_RESYNC === '1';
const FIXED_LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10, timestamp: '2026-10-10T12:00:00.000Z' };

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

type Peer = { device: ConfiguredAndroidDevice; user: AndroidUser; id: string };

/** The phone as a journey participant; its offline switch is the phone's Wi-Fi. */
function participant(peer: Peer, onOffline: (serial: string, offline: boolean) => void): NearbyParticipant {
  const actor: TestActor = {
    id: peer.device.name,
    runtime: 'android-webview',
    page: peer.user.window,
    setOffline: async (offline) => {
      console.log(`[three-phone] ${peer.device.name} Wi-Fi ${offline ? 'off' : 'on'}`);
      await setAndroidWifiEnabled(peer.device.serial, !offline);
      onOffline(peer.device.serial, offline);
    },
  };
  return { actor, userId: peer.id, stageName: peer.device.name };
}

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

    await Promise.all(peers.map((peer) => enterNearbyAt(peer.user.window, FIXED_LOCATION)));
    const track = (serial: string, offline: boolean) => { offlineSerial = offline ? serial : ''; };
    const people = peers.map((peer) => participant(peer, track));
    await everyoneListsEveryone(people);
    const offline = people[peers.findIndex((peer) => peer.device.serial === offlineDevice.serial)];
    await offlineResyncJourney(people, offline, `three-phone-${Date.now()}`);
    console.log('[three-phone] concurrent Talks and offline catch-up verified');
  });
});
