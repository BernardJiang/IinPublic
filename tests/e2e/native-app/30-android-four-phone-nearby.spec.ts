/**
 * OPEN-40 physical proof for the current one-Nearby-room design.
 *
 * Four real Android phones start from fresh IinPublic sandboxes, receive the same confirmed
 * location through the production routing method, and must converge on one opaque Nearby room
 * (never legacy Global). Each phone broadcasts one tag Talk to the next phone in a ring. The
 * newest Android phone is then backgrounded with HOME while another Talk is sent to it, and the
 * Talk must be present after the app returns to the foreground.
 *
 * This test intentionally keeps the local hub reachable. Wi-Fi Direct is an automatic fallback
 * only when that hub is unreachable, so the collected status should normally be `standby` plus
 * LAN-peer evidence—not a manufactured Wi-Fi Direct group. A separate offline run is required
 * to claim Wi-Fi Direct itself was exercised.
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';
import { bootstrapNativeWindow, enterNearbyAt } from './helpers/native-app';
import {
  ANDROID_MAIN_ACTIVITY,
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  readAndroidDeviceMetadata,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import type { TestActor } from '../helpers/test-actor';
import {
  backgroundDeliveryJourney,
  everyoneListsEveryone,
  othersOnEachList,
  ringTalkJourney,
  type NearbyParticipant,
} from '../journeys/nearby-ring-journey';
import { resolveAndroidMatrixDevices, type ConfiguredAndroidDevice } from './helpers/android-device-config';

const execFileAsync = promisify(execFile);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');
const RUN = process.env.E2E_REAL_ANDROID_FOUR_PHONE_NEARBY === '1';
const BACKGROUND_ONLY = process.env.E2E_FOUR_PHONE_BACKGROUND_ONLY === '1';
const OFFLINE_WIFI_DIRECT = process.env.E2E_NEARBY_OFFLINE_WIFI_DIRECT === '1';
/** Diagnostic: hub path only, LAN NSD off (isolates LAN-peer effects on delivery). */
const LAN_OFF = process.env.E2E_NEARBY_LAN_OFF === '1';
const OFFLINE_PHONE_COUNT = Number(process.env.E2E_NEARBY_OFFLINE_PHONE_COUNT || '3');
const FIXED_LOCATION = {
  latitude: 32.7157,
  longitude: -117.1611,
  accuracy: 10,
  timestamp: '2026-10-10T12:00:00.000Z',
};

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type Peer = {
  device: ConfiguredAndroidDevice;
  user: AndroidUser;
  id: string;
  sdk: number;
  roomId: string;
};

type BatterySnapshot = {
  level: number | null;
  scale: number | null;
  status: number | null;
  plugged: number | null;
  percentage: number | null;
};

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function adb(serial: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('adb', ['-s', serial, 'shell', ...args], {
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return String(result.stdout);
}

async function wakeAndUnlock(serial: string): Promise<void> {
  await adb(serial, 'input', 'keyevent', 'KEYCODE_WAKEUP').catch(() => '');
  await adb(serial, 'wm', 'dismiss-keyguard').catch(() => '');
  await adb(serial, 'input', 'keyevent', 'KEYCODE_BACK').catch(() => '');
  await adb(serial, 'cmd', 'statusbar', 'collapse').catch(() => '');
}

/**
 * Android keeps a Wi-Fi Direct group after the app that formed it is killed or its data cleared, and
 * a cleared app has no permission left to see or remove it. A leftover group from an earlier offline
 * run splits the radio between the access point and the group channel, so drop it with a Wi-Fi
 * toggle before this run starts.
 */
async function dropLeftoverWifiDirectGroup(serial: string): Promise<void> {
  const p2p = await adb(serial, 'dumpsys', 'wifip2p').catch(() => '');
  if (!/groupFormed: true/.test(p2p)) return;
  console.log(`[four-phone-nearby] ${serial}: dropping a leftover Wi-Fi Direct group`);
  await adb(serial, 'svc', 'wifi', 'disable');
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await adb(serial, 'svc', 'wifi', 'enable');
  await expect.poll(async () => /inet \d/.test(await adb(serial, 'ip', '-4', 'addr', 'show', 'wlan0').catch(() => '')), {
    timeout: 45_000,
    intervals: [1_000, 2_000],
    message: `${serial} should reconnect to Wi-Fi after dropping its Wi-Fi Direct group`,
  }).toBe(true);
}

async function grantOfflineNearbyPermissions(serial: string, sdk: number): Promise<void> {
  const permissions = sdk >= 33
    ? [
      'android.permission.NEARBY_WIFI_DEVICES',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
    ]
    : ['android.permission.ACCESS_FINE_LOCATION'];
  for (const permission of permissions) {
    await execFileAsync('adb', ['-s', serial, 'shell', 'pm', 'grant', 'com.iinpublic.app', permission], {
      timeout: 5_000,
    });
  }
}

async function readBattery(serial: string): Promise<BatterySnapshot> {
  const dump = await adb(serial, 'dumpsys', 'battery').catch(() => '');
  const read = (key: string): number | null => {
    const value = dump.match(new RegExp(`^\\s*${key}:\\s*(\\d+)`, 'm'))?.[1];
    return value == null ? null : Number(value);
  };
  const level = read('level');
  const scale = read('scale');
  return {
    level,
    scale,
    status: read('status'),
    plugged: read('plugged'),
    percentage: level != null && scale ? Math.round(level / scale * 10_000) / 100 : null,
  };
}

/** Nearby v3: every phone at the same public point, each in its own list (no shared room). */
async function routeToFixedNearby(peer: Omit<Peer, 'roomId'>): Promise<string> {
  const roomId = await enterNearbyAt(peer.user.window, FIXED_LOCATION);
  // The shared active scope may carry the scope id, but never the coordinate behind it.
  const publicScope = JSON.stringify(await peer.user.window.evaluate(
    () => (window as any).__iinpublic_app?.getApp?.()?.activeExchangeRoomController?.getScope?.() || {},
  ));
  expect(publicScope).not.toContain('latitude');
  expect(publicScope).not.toContain('longitude');
  return roomId;
}

/** The phone as a journey participant (tests/e2e/journeys/nearby-ring-journey.ts). */
function participant(peer: Peer): NearbyParticipant {
  const actor: TestActor = {
    id: peer.device.name,
    runtime: 'android-webview',
    page: peer.user.window,
    background: async () => {
      await adb(peer.device.serial, 'input', 'keyevent', 'KEYCODE_HOME');
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    },
    foreground: async () => { await adb(peer.device.serial, 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY); },
  };
  return { actor, userId: peer.id, stageName: peer.device.name };
}

test.describe('Native app: four Android phones in one current Nearby room (OPEN-40)', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_FOUR_PHONE_NEARBY=1 to run this destructive physical-device test.');

  const peers: Peer[] = [];
  const batteryBefore: Record<string, BatterySnapshot> = {};
  const deliveryMs: number[] = [];
  // WebView console per phone, attached to every run: logcat is chatty-collapsed on Huawei/Honor.
  const consoleLines: Record<string, string[]> = {};

  test.afterAll(async () => {
    for (const peer of peers) await clearAndroidE2ETestProjections(peer.user).catch(() => {});
    for (const peer of peers) await closeAndroidUser(peer.user);
  });

  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    const diagnostics: Record<string, unknown> = {};
    for (const peer of peers) {
      const batteryAfter = await readBattery(peer.device.serial);
      const nearby = await peer.user.window.evaluate(() => {
        const service = (window as any).__iinpublicNearbyOffline;
        const scope = (window as any).__iinpublic_app?.getApp?.()?.activeExchangeRoomController?.getScope?.();
        return service ? {
          status: service.getStatus?.(),
          diagnostics: service.getDiagnostics?.(),
          // Which group this phone considers its own right now (the name is broadcast over the air anyway).
          expectedGroupName: service.currentCredentials?.()?.networkName ?? null,
          scopeRoomId: scope?.roomId ?? null,
          roomTokenPrefix: typeof scope?.roomToken === 'string' ? scope.roomToken.slice(0, 8) : null,
        } : null;
      }).catch(() => null);
      diagnostics[peer.device.name] = {
        serial: peer.device.serial,
        sdk: peer.sdk,
        roomId: peer.roomId,
        batteryBefore: batteryBefore[peer.device.serial],
        batteryAfter,
        nearby,
      };
    }
    const sorted = [...deliveryMs].sort((a, b) => a - b);
    const percentile = (ratio: number): number | null => sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
      : null;
    const evidence = {
      fixedLocation: { accuracy: FIXED_LOCATION.accuracy },
      roomId: peers[0]?.roomId,
      phoneCount: peers.length,
      talkDeliveryMilliseconds: deliveryMs,
      p50Milliseconds: percentile(0.5),
      p95Milliseconds: percentile(0.95),
      phones: diagnostics,
      batteryNote: 'Short USB-connected smoke snapshot only; not a statistically meaningful drain rate.',
    };
    console.log(`[four-phone-nearby] evidence ${JSON.stringify(evidence)}`);
    await testInfo.attach('four-phone-nearby-evidence.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });

    for (const peer of peers) {
      const consolePath = testInfo.outputPath(`${peer.device.name}-webview-console.txt`);
      fs.writeFileSync(consolePath, (consoleLines[peer.device.name] ?? []).join('\n'));
      await testInfo.attach(`${peer.device.name}-webview-console.txt`, { path: consolePath, contentType: 'text/plain' });
    }

    if (testInfo.status !== testInfo.expectedStatus) {
      for (const peer of peers) {
        const failure = await collectAndroidDiagnostics(peer.device.serial);
        await testInfo.attach(`${peer.device.name}-logcat.txt`, { body: Buffer.from(failure.logcat), contentType: 'text/plain' });
        await testInfo.attach(`${peer.device.name}-node-stdio.txt`, { body: Buffer.from(failure.nodeStdio), contentType: 'text/plain' });
      }
    }
  });

  test('four phones converge, exchange Talks in a ring, and recover delivery after backgrounding', async () => {
    test.setTimeout(900_000);
    const readiness = await Promise.all(ANDROID_DEVICES.map(async (device) => ({
      device,
      ready: await isAndroidDeviceReady(device.serial),
    })));
    const available = readiness.filter((entry) => entry.ready).map((entry) => entry.device);
    const expectedPhoneCount = OFFLINE_WIFI_DIRECT ? OFFLINE_PHONE_COUNT : 4;
    test.skip(
      available.length !== expectedPhoneCount,
      `This scenario requires exactly ${expectedPhoneCount} connected phones; found ${available.length}.`,
    );
    const hubUrl = OFFLINE_WIFI_DIRECT
      ? 'http://127.0.0.1:1/gun'
      : `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    for (const device of available) {
      await wakeAndUnlock(device.serial);
      await dropLeftoverWifiDirectGroup(device.serial);
      batteryBefore[device.serial] = await readBattery(device.serial);
    }
    console.log(`[four-phone-nearby] clearing only ${available.length} IinPublic app sandboxes`);
    await Promise.all(available.map((device) => resetAndroidAppData(device.serial)));

    for (let index = 0; index < available.length; index += 1) {
      const device = available[index];
      const metadata = await readAndroidDeviceMetadata(device.serial);
      if (OFFLINE_WIFI_DIRECT) await grantOfflineNearbyPermissions(device.serial, Number(metadata.sdk || 0));
      console.log(`[four-phone-nearby] launching ${device.name} (${metadata.model}, Android ${metadata.release})`);
      const user = await launchAndroidUserViaAdb({
        hubGunUrl: hubUrl,
        deviceSerial: device.serial,
        disableLanDiscovery: OFFLINE_WIFI_DIRECT || LAN_OFF,
      });
      const lines: string[] = consoleLines[device.name] = [];
      user.window.on('console', (message) => {
        if (lines.length < 20_000) lines.push(`${new Date().toISOString()} ${message.type()} ${message.text()}`);
      });
      const id = await bootstrapNativeWindow(user.window, `Nearby ${index + 1}`, {
        waitForSupportGreeting: false,
        readinessTimeoutMs: 150_000,
        pinStableLocation: false,
      });
      const partial = { device, user, id, sdk: Number(metadata.sdk || 0) };
      const roomId = await routeToFixedNearby(partial);
      peers.push({ ...partial, roomId });
      console.log(`[four-phone-nearby] ready ${device.name}: ${id} -> ${roomId}`);
    }

    const roomIds = new Set(peers.map((peer) => peer.roomId));
    expect(roomIds.size).toBe(1);
    const [roomId] = roomIds;
    expect(roomId).toBe('nearby-v3');

    if (OFFLINE_WIFI_DIRECT) {
      await expect.poll(async () => Promise.all(peers.map((peer) => peer.user.window.evaluate(() => {
        const service = (window as any).__iinpublicNearbyOffline;
        const diagnostics = service?.getDiagnostics?.();
        return diagnostics?.wifiDirectActive === true
          && (diagnostics?.group?.state === 'owner' || diagnostics?.group?.state === 'client');
      }))), {
        timeout: 180_000,
        intervals: [2_000, 3_000, 5_000],
        message: `all ${expectedPhoneCount} phones should form one offline Wi-Fi Direct group`,
      }).toEqual(peers.map(() => true));

      await expect.poll(() => othersOnEachList(peers.map(participant)), {
        timeout: 180_000,
        intervals: [2_000, 3_000, 5_000],
        message: `every offline phone should have the other ${expectedPhoneCount - 1} on its Nearby list`,
      }).toEqual(peers.map(() => peers.length - 1));
    } else {
      await everyoneListsEveryone(peers.map(participant));

      // Talks can travel over the hub alone; this proves every phone also found every other over LAN NSD.
      if (!LAN_OFF) await expect.poll(async () => Promise.all(peers.map((peer) => peer.user.window.evaluate(() => {
        const diagnostics = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.();
        const onLan = (diagnostics?.peers || []).filter((entry: { onLan?: boolean }) => entry.onLan).length;
        return diagnostics?.lanNsd === true ? onLan : -1;
      }))), {
        timeout: 120_000,
        intervals: [2_000, 3_000, 5_000],
        message: 'every phone should run LAN NSD and see the other three phones on the LAN',
      }).toEqual(peers.map(() => peers.length - 1));
    }

    const runId = `open40-nearby-${Date.now()}`;
    // One Talk per phone, each received by the next phone (journey shared with staged/stage4/07).
    if (!BACKGROUND_ONLY) deliveryMs.push(...await ringTalkJourney(peers.map(participant), runId));

    // Use the newest OS in the connected set for the most restrictive background-policy case.
    const receiver = [...peers].sort((a, b) => b.sdk - a.sdk)[0];
    const author = peers.find((peer) => peer !== receiver)!;
    console.log(`[four-phone-nearby] backgrounding ${receiver.device.name} (API ${receiver.sdk})`);
    deliveryMs.push(await backgroundDeliveryJourney(participant(author), participant(receiver), runId, roomId));
    console.log(`[four-phone-nearby] post-background delivery to ${receiver.device.name} verified`);
  });
});
