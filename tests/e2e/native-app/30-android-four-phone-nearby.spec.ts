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
import * as http from 'http';
import * as os from 'os';
import { promisify } from 'util';
import { bootstrapNativeWindow, forceJoinRoom } from './helpers/native-app';
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
import { findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';
import { resolveAndroidMatrixDevices, type ConfiguredAndroidDevice } from './helpers/android-device-config';

const execFileAsync = promisify(execFile);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');
const RUN = process.env.E2E_REAL_ANDROID_FOUR_PHONE_NEARBY === '1';
const BACKGROUND_ONLY = process.env.E2E_FOUR_PHONE_BACKGROUND_ONLY === '1';
const OFFLINE_WIFI_DIRECT = process.env.E2E_NEARBY_OFFLINE_WIFI_DIRECT === '1';
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

function readRoomMembers(roomId: string): Promise<Array<{ userId: string; stageName: string }>> {
  return new Promise((resolve, reject) => {
    const path = `/api/chatrooms/${encodeURIComponent(roomId)}/members`;
    const request = http.get({ host: '127.0.0.1', port: HUB_GUN_PORT, path, timeout: 3_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`GET ${path} returned ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.once('timeout', () => {
      request.destroy();
      reject(new Error(`GET ${path} timed out`));
    });
  });
}

async function routeToFixedNearby(peer: Omit<Peer, 'roomId'>): Promise<string> {
  const result = await peer.user.window.evaluate(async (location) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.currentUser?.id) throw new Error('app user unavailable');
    await app.updateLocationAndMaybeSwitch({ ...location, timestamp: new Date(location.timestamp) });
    const roomId = String(app.chatroomService?.getCurrentChatroomId?.() || app.currentChatroomId || '');
    const assignment = app.chatroomService?.getNearbyRoomAssignment?.();
    const scope = app.activeExchangeRoomController?.getScope?.() || null;
    return { roomId, assignment, scope };
  }, FIXED_LOCATION);

  expect(result.roomId).toMatch(/^nearby_v1_/);
  expect(result.roomId).not.toBe('global');
  expect(result.assignment?.roomId).toBe(result.roomId);
  expect(result.assignment?.localCell).toBeTruthy();
  // Routing geometry is device-local. The shared active scope may carry the opaque room id and
  // capability, but never the coordinate or projected local cell used to choose it.
  const publicScope = JSON.stringify(result.scope || {});
  expect(publicScope).not.toContain('localCell');
  expect(publicScope).not.toContain('latitude');
  expect(publicScope).not.toContain('longitude');

  // updateLocationAndMaybeSwitch performs the production transition. Re-entering that exact id
  // through the test helper only installs the same member/UI callbacks a manual room selection
  // has; it does not bypass or alter Nearby placement.
  await forceJoinRoom(peer.user.window, result.roomId);
  return result.roomId;
}

async function waitForIncoming(peer: Peer, title: string, timeoutMs = 120_000): Promise<string> {
  let talkId = '';
  await expect.poll(async () => {
    try {
      talkId = await findIncomingTalkIdByTitle(peer.user.window, title);
      return true;
    } catch {
      return false;
    }
  }, { timeout: timeoutMs, intervals: [1_000, 2_000, 3_000], message: `${peer.device.name} should receive ${title}` }).toBe(true);
  return talkId;
}

/**
 * Exercise the app's ordinary createTalk handler without depending on synthetic pointer events.
 * Several OEM WebViews stall in CDP's scroll-before-click phase even when the same element is
 * already reported visible; that is an automation limitation, not part of this transport proof.
 */
async function createHardwareTagTalk(
  peer: Peer,
  title: string,
): Promise<{ title: string; talkId: string; talkData: any }> {
  await peer.user.window.evaluate(({ expectedTitle }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.emit) throw new Error('createTalk event unavailable');
    app.uiManager.emit('createTalk', {
      title: expectedTitle,
      type: 'tag',
      language: 'en',
      isAdult: false,
      tags: [],
      questions: [{
        id: 'q_1',
        text: expectedTitle,
        answers: [
          { id: 'a_0_match', text: expectedTitle, isMatch: true, isTerminal: true },
          { id: 'a_0_ignore', text: 'Not interested', isIgnore: true, isTerminal: true },
        ],
      }],
      selfAnswers: [{ questionId: 'q_1', answerId: 'a_0_match' }],
      createdAt: new Date().toISOString(),
      isTemplate: false,
      usageCount: 0,
      sendToChatroom: false,
    });
  }, { expectedTitle: title });

  let created: { title: string; talkId: string; talkData: any } | null = null;
  await expect.poll(async () => {
    created = await peer.user.window.evaluate((expectedTitle) => {
      const raw = localStorage.getItem('myTalks');
      const talks = raw ? JSON.parse(raw) : {};
      const entry = Object.entries(talks).find(([, value]: [string, any]) =>
        value?.role === 'created' && value?.title === expectedTitle && value?.fullTalk);
      if (!entry) return null;
      const [talkId, value] = entry as [string, any];
      return { title: expectedTitle, talkId, talkData: value.fullTalk };
    }, title);
    return created !== null;
  }, { timeout: 90_000, intervals: [500, 1_000, 2_000], message: `${peer.device.name} should create ${title}` }).toBe(true);
  return created!;
}

test.describe('Native app: four Android phones in one current Nearby room (OPEN-40)', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_FOUR_PHONE_NEARBY=1 to run this destructive physical-device test.');

  const peers: Peer[] = [];
  const batteryBefore: Record<string, BatterySnapshot> = {};
  const deliveryMs: number[] = [];

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
        return service ? { status: service.getStatus?.(), diagnostics: service.getDiagnostics?.() } : null;
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
    const expectedPhoneCount = OFFLINE_WIFI_DIRECT ? 3 : 4;
    test.skip(
      available.length !== expectedPhoneCount,
      `This scenario requires exactly ${expectedPhoneCount} connected phones; found ${available.length}.`,
    );
    const hubUrl = OFFLINE_WIFI_DIRECT
      ? 'http://127.0.0.1:1/gun'
      : `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    for (const device of available) {
      await wakeAndUnlock(device.serial);
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
        disableLanDiscovery: OFFLINE_WIFI_DIRECT,
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
    expect(roomId).toMatch(/^nearby_v1_/);

    if (OFFLINE_WIFI_DIRECT) {
      await expect.poll(async () => Promise.all(peers.map((peer) => peer.user.window.evaluate(() => {
        const service = (window as any).__iinpublicNearbyOffline;
        const status = service?.getStatus?.();
        const diagnostics = service?.getDiagnostics?.();
        return status?.kind === 'wifi-direct'
          && (diagnostics?.group?.state === 'owner' || diagnostics?.group?.state === 'client');
      }))), {
        timeout: 180_000,
        intervals: [2_000, 3_000, 5_000],
        message: 'all three phones should form one offline Wi-Fi Direct group',
      }).toEqual(peers.map(() => true));

      await expect.poll(async () => Promise.all(peers.map((peer) => peer.user.window.evaluate((expectedIds) => {
        const service = (window as any).__iinpublic_app?.getApp?.()?.chatroomService;
        const ids = new Set<string>(Array.from(service?.activeMembersForList?.keys?.() || []).map(String));
        return expectedIds.filter((id) => ids.has(id)).length;
      }, peers.map((candidate) => candidate.id)))), {
        timeout: 180_000,
        intervals: [2_000, 3_000, 5_000],
        message: 'all offline peers should converge on the three-person Nearby roster',
      }).toEqual(peers.map(() => peers.length));
    } else {
      await expect.poll(async () => {
        const members = await readRoomMembers(roomId);
        const ids = new Set(members.map((member) => member.userId));
        return peers.filter((peer) => ids.has(peer.id)).length;
      }, {
        timeout: 120_000,
        intervals: [1_000, 2_000, 3_000],
        message: 'hub roster should contain all four Nearby users',
      }).toBe(4);
    }

    const runId = `open40-nearby-${Date.now()}`;
    if (!BACKGROUND_ONLY) {
      // One Talk per phone, each received by the next phone: every physical device proves both the
      // author and receiver paths without producing a 4x4 burst of redundant test traffic.
      for (let index = 0; index < peers.length; index += 1) {
        const author = peers[index];
        const receiver = peers[(index + 1) % peers.length];
        const talk = await createHardwareTagTalk(author, `${runId}-${index + 1}`);
        const startedAt = Date.now();
        const sent = await author.user.window.evaluate(
          () => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1),
        );
        expect(sent?.talksSent ?? 0).toBeGreaterThan(0);
        expect(await waitForIncoming(receiver, talk.talkData.title)).toBe(talk.talkId);
        const elapsed = Date.now() - startedAt;
        deliveryMs.push(elapsed);
        console.log(`[four-phone-nearby] Talk ${index + 1}: ${author.device.name} -> ${receiver.device.name} in ${elapsed} ms`);
      }
    }

    // Use the newest OS in the connected set for the most restrictive background-policy case.
    const receiver = [...peers].sort((a, b) => b.sdk - a.sdk)[0];
    const author = peers.find((peer) => peer !== receiver)!;
    const backgroundTalk = await createHardwareTagTalk(author, `${runId}-background`);
    console.log(`[four-phone-nearby] backgrounding ${receiver.device.name} (API ${receiver.sdk})`);
    await adb(receiver.device.serial, 'input', 'keyevent', 'KEYCODE_HOME');
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const startedAt = Date.now();
    const sent = await author.user.window.evaluate(async ({ receiverId, receiverName, talkId, talkData }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.deliverTalkToReceiversOverMesh?.(
        talkId,
        talkData,
        [{ userId: receiverId, stageName: receiverName }],
        [receiverId],
      );
    }, {
      receiverId: receiver.id,
      receiverName: receiver.device.name,
      talkId: backgroundTalk.talkId,
      talkData: backgroundTalk.talkData,
    });
    expect(sent).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await adb(receiver.device.serial, 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY);
    await expect.poll(
      () => receiver.user.window.evaluate(() => Boolean((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id)),
      { timeout: 30_000 },
    ).toBe(true);
    expect(await waitForIncoming(receiver, backgroundTalk.talkData.title)).toBe(backgroundTalk.talkId);
    deliveryMs.push(Date.now() - startedAt);
    await expect.poll(() => author.user.window.evaluate(async ({ targetRoomId, targetUserId, targetTalkId }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const outbox = app?.peerMeshService?.directTalkOutbox;
      if (!outbox?.list) return -1;
      const entries = await outbox.list(targetRoomId);
      return entries.filter((entry: any) => entry.recipientUserId === targetUserId && entry.talkId === targetTalkId).length;
    }, {
      targetRoomId: roomId,
      targetUserId: receiver.id,
      targetTalkId: backgroundTalk.talkId,
    }), { timeout: 30_000, message: 'sender durable outbox should clear after receiver ACK' }).toBe(0);
    expect(await receiver.user.window.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.() || ''),
    )).toBe(roomId);
    console.log(`[four-phone-nearby] post-background delivery to ${receiver.device.name} verified`);
  });
});
