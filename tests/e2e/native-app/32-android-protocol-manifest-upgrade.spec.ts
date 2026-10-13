/**
 * Physical mixed-release proof for the production K2 -> M2 -> K3 bridge.
 *
 * Phone A runs the current release-1 engine without bundled M2. Phone B runs the same engine with
 * the production M2 history. The test
 * pauses A inside acceptManifestSuffix(), proves ordinary Talk data does not cross while the two
 * peers disagree, then lets A verify M2 with its release-1 K2 anchor. It verifies the durable
 * checkpoint/archive, exchanges Talks in both directions, restarts A, and proves the accepted
 * checkpoint cannot fall back to sequence 1.
 *
 * The companion runner builds both APKs and supplies their paths. This test deliberately removes
 * com.iinpublic.app from the two selected phones, so it must only run on designated test devices.
 */
import { test, expect, type Page } from '@playwright/test';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { protocolManifestHash, type SignedProtocolManifest } from '../../../src/shared/protocol-manifest';
import { bootstrapNativeWindow, forceJoinRoom } from './helpers/native-app';
import {
  ANDROID_PACKAGE,
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';
import { resolveAndroidMatrixDevices, type ConfiguredAndroidDevice } from './helpers/android-device-config';
import { findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';

const execFileAsync = promisify(execFile);
const RUN = process.env.E2E_REAL_ANDROID_PROTOCOL_MANIFEST === '1';
const HUB_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const RELEASE1_APK = path.resolve(process.env.E2E_PROTOCOL_RELEASE1_APK || '');
const RELEASE2_APK = path.resolve(process.env.E2E_PROTOCOL_RELEASE2_APK || '');
const DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '').slice(0, 2);
const ARCHIVE_KEY = 'iinpublic_protocol_manifest_archive_v1';
const CHECKPOINT_KEY = 'iinpublic_protocol_manifest_checkpoint_v1';
const HISTORY_PATH = path.resolve(__dirname, '..', '..', '..', 'src', 'shared', 'protocol-manifest-history.signed.json');
const HISTORY = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) as SignedProtocolManifest[];
const EXPECTED_LATEST = HISTORY.at(-1);
const LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10, timestamp: '2026-10-12T12:00:00.000Z' };

process.env.E2E_PORT_OFFSET = String(HUB_PORT - 8080);

type Peer = {
  device: ConfiguredAndroidDevice;
  user: AndroidUser;
  id: string;
  roomId: string;
};

type StoredManifestState = {
  checkpoint: any;
  archive: SignedProtocolManifest[];
  summary: any;
  compatibility: any;
  mesh: any;
};

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function adb(serial: string, args: string[], timeout = 300_000): Promise<string> {
  const result = await execFileAsync('adb', ['-s', serial, ...args], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  return String(result.stdout);
}

async function installFresh(serial: string, apk: string): Promise<void> {
  if (!fs.existsSync(apk)) throw new Error(`APK does not exist: ${apk}`);
  await adb(serial, ['uninstall', ANDROID_PACKAGE], 60_000).catch(() => '');
  const output = await adb(serial, ['install', '--no-streaming', apk]);
  if (!/Success/i.test(output)) throw new Error(`APK install failed on ${serial}: ${output}`);
}

async function wake(serial: string): Promise<void> {
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], 10_000).catch(() => '');
  await adb(serial, ['shell', 'wm', 'dismiss-keyguard'], 10_000).catch(() => '');
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 10_000).catch(() => '');
}

async function storedManifestState(page: Page): Promise<StoredManifestState> {
  return page.evaluate(({ archiveKey, checkpointKey }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    return {
      checkpoint: JSON.parse(localStorage.getItem(checkpointKey) || 'null'),
      archive: JSON.parse(localStorage.getItem(archiveKey) || '[]'),
      summary: app?.protocolManifestController?.summary?.() || null,
      compatibility: app?.protocolManifestController?.currentCompatibility?.() || null,
      mesh: app?.peerMeshService?.getDiagnostics?.() || null,
    };
  }, { archiveKey: ARCHIVE_KEY, checkpointKey: CHECKPOINT_KEY });
}

async function routeToNearby(user: AndroidUser): Promise<string> {
  const roomId = await user.window.evaluate(async (location) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.currentUser?.id) throw new Error('app user unavailable');
    await app.updateLocationAndMaybeSwitch({ ...location, timestamp: new Date(location.timestamp) });
    return String(app.chatroomService?.getCurrentChatroomId?.() || app.currentChatroomId || '');
  }, LOCATION);
  expect(roomId).toMatch(/^nearby_v/);
  await forceJoinRoom(user.window, roomId);
  return roomId;
}

async function installAcceptanceGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const controller = app?.protocolManifestController;
    if (!controller?.acceptManifestSuffix) throw new Error('protocol manifest controller unavailable');
    const original = controller.acceptManifestSuffix.bind(controller);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const state: any = { entered: false, released: false, release: () => { state.released = true; release(); } };
    let inFlight: Promise<any> | null = null;
    controller.acceptManifestSuffix = (manifests: any, now: any) => {
      state.entered = true;
      if (!inFlight) inFlight = (async () => {
        await gate;
        return original(manifests, now);
      })();
      return inFlight;
    };
    (window as any).__iinpublicManifestAcceptanceGate = state;
  });
}

async function releaseAcceptanceGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const gate = (window as any).__iinpublicManifestAcceptanceGate;
    if (!gate?.release) throw new Error('manifest acceptance gate unavailable');
    gate.release();
  });
}

async function createTalk(peer: Peer, title: string): Promise<{ talkId: string; talkData: any }> {
  await peer.user.window.evaluate((expectedTitle) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.emit) throw new Error('createTalk event unavailable');
    app.uiManager.emit('createTalk', {
      title: expectedTitle,
      type: 'tag',
      language: 'en',
      isAdult: false,
      tags: [],
      questions: [{
        id: 'q_1', text: expectedTitle,
        answers: [
          { id: 'a_match', text: expectedTitle, isMatch: true, isTerminal: true },
          { id: 'a_ignore', text: 'Not interested', isIgnore: true, isTerminal: true },
        ],
      }],
      selfAnswers: [{ questionId: 'q_1', answerId: 'a_match' }],
      createdAt: new Date().toISOString(),
      isTemplate: false,
      usageCount: 0,
      sendToChatroom: false,
    });
  }, title);

  let created: { talkId: string; talkData: any } | null = null;
  await expect.poll(async () => {
    created = await peer.user.window.evaluate((expectedTitle) => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const entry = Object.entries(talks).find(([, value]: [string, any]) =>
        value?.role === 'created' && value?.title === expectedTitle && value?.fullTalk);
      return entry ? { talkId: entry[0], talkData: (entry[1] as any).fullTalk } : null;
    }, title);
    return created !== null;
  }, { timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe(true);
  return created!;
}

async function sendTalk(author: Peer, receiver: Peer, talk: { talkId: string; talkData: any }): Promise<boolean> {
  return Boolean(await author.user.window.evaluate(async ({ receiverId, receiverName, talkId, talkData }) => {
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
    talkId: talk.talkId,
    talkData: talk.talkData,
  }));
}

async function incomingTalkId(page: Page, title: string): Promise<string> {
  try {
    return await findIncomingTalkIdByTitle(page, title);
  } catch {
    return '';
  }
}

async function expectTalk(peer: Peer, title: string, talkId: string): Promise<void> {
  await expect.poll(() => incomingTalkId(peer.user.window, title), {
    timeout: 120_000,
    intervals: [1_000, 2_000, 3_000],
    message: `${peer.device.name} should receive ${title}`,
  }).toBe(talkId);
}

test.describe('Android mixed releases: K2 authenticates M2 and learns K3', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_PROTOCOL_MANIFEST=1; this erases IinPublic on two test phones.');
  test.skip(HISTORY.length === 0, 'The production history must contain M2.');
  test.skip(!process.env.E2E_PROTOCOL_RELEASE1_APK || !process.env.E2E_PROTOCOL_RELEASE2_APK,
    'Set E2E_PROTOCOL_RELEASE1_APK and E2E_PROTOCOL_RELEASE2_APK.');

  let oldPeer: Peer | undefined;
  let newPeer: Peer | undefined;

  test.afterAll(async () => {
    if (oldPeer) await clearAndroidE2ETestProjections(oldPeer.user).catch(() => undefined);
    if (newPeer) await clearAndroidE2ETestProjections(newPeer.user).catch(() => undefined);
    await closeAndroidUser(oldPeer?.user);
    await closeAndroidUser(newPeer?.user);
  });

  test('old phone gates Talks, accepts signed history, and retains it across restart', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(900_000);
    expect(DEVICES).toHaveLength(2);
    expect(EXPECTED_LATEST).toBeTruthy();
    const ready = await Promise.all(DEVICES.map((device) => isAndroidDeviceReady(device.serial)));
    test.skip(!ready.every(Boolean), `Two selected phones must be connected: ${DEVICES.map((d) => d.serial).join(', ')}`);

    const [oldDevice, newDevice] = DEVICES;
    await Promise.all(DEVICES.map((device) => wake(device.serial)));
    console.log(`[protocol-manifest] installing release 1 on ${oldDevice.name}; release 2 on ${newDevice.name}`);
    await installFresh(oldDevice.serial, RELEASE1_APK);
    await installFresh(newDevice.serial, RELEASE2_APK);
    const hubUrl = `http://${lanIp()}:${HUB_PORT}/gun`;

    const oldUser = await launchAndroidUserViaAdb({
      hubGunUrl: hubUrl,
      deviceSerial: oldDevice.serial,
      disableLanDiscovery: true,
    });
    const oldId = await bootstrapNativeWindow(oldUser.window, 'Manifest release 1', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 150_000,
      pinStableLocation: false,
    });
    const oldRoom = await routeToNearby(oldUser);
    oldPeer = { device: oldDevice, user: oldUser, id: oldId, roomId: oldRoom };

    const initial = await storedManifestState(oldUser.window);
    expect(initial.checkpoint?.sequence).toBe(1);
    expect(initial.archive).toEqual([]);
    expect(initial.summary?.sequence).toBe(1);
    expect(initial.mesh?.manifestReadyNeighborCount ?? 0).toBe(0);
    await installAcceptanceGate(oldUser.window);

    const newUser = await launchAndroidUserViaAdb({
      hubGunUrl: hubUrl,
      deviceSerial: newDevice.serial,
      disableLanDiscovery: true,
    });
    const newId = await bootstrapNativeWindow(newUser.window, 'Manifest release 2', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 150_000,
      pinStableLocation: false,
    });
    const newRoom = await routeToNearby(newUser);
    newPeer = { device: newDevice, user: newUser, id: newId, roomId: newRoom };
    expect(newRoom).toBe(oldRoom);

    await expect.poll(() => oldUser.window.evaluate(
      () => Boolean((window as any).__iinpublicManifestAcceptanceGate?.entered),
    ), { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).toBe(true);
    const held = await storedManifestState(oldUser.window);
    expect(held.checkpoint?.sequence).toBe(1);
    expect(held.mesh?.manifestReadyNeighborCount ?? 0).toBe(0);

    const gatedTitle = `manifest-gated-${Date.now()}`;
    const gatedTalk = await createTalk(newPeer, gatedTitle);
    const sentWhileHeld = await sendTalk(newPeer, oldPeer, gatedTalk);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(await incomingTalkId(oldUser.window, gatedTitle)).toBe('');
    console.log(`[protocol-manifest] Talk while M2 held returned ${sentWhileHeld}; receiver remained empty`);

    await releaseAcceptanceGate(oldUser.window);
    const expectedHash = protocolManifestHash(EXPECTED_LATEST!);
    const expectedSequence = EXPECTED_LATEST!.body.sequence;
    await expect.poll(async () => (await storedManifestState(oldUser.window)).checkpoint?.sequence, {
      timeout: 120_000,
      intervals: [500, 1_000, 2_000],
    }).toBe(expectedSequence);
    await expect.poll(() => Promise.all([oldUser, newUser].map(async (user) =>
      (await storedManifestState(user.window)).mesh?.manifestReadyNeighborCount ?? 0)), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000],
    }).toEqual([1, 1]);

    const accepted = await storedManifestState(oldUser.window);
    expect(accepted.checkpoint?.manifestHash).toBe(expectedHash);
    expect(accepted.checkpoint?.nextReleaseKeys).toEqual(EXPECTED_LATEST!.body.nextReleaseKeys);
    expect(accepted.archive.map((entry) => entry.body.sequence)).toEqual(HISTORY.map((entry) => entry.body.sequence));
    expect(accepted.archive[0]?.body.sequence).toBe(2);
    expect(accepted.archive[0]?.signerKeyId).toBe(HISTORY[0].signerKeyId);
    expect(accepted.compatibility?.status).toBe('compatible');

    if (!await incomingTalkId(oldUser.window, gatedTitle)) await sendTalk(newPeer, oldPeer, gatedTalk);
    await expectTalk(oldPeer, gatedTitle, gatedTalk.talkId);

    const replyTitle = `manifest-reply-${Date.now()}`;
    const reply = await createTalk(oldPeer, replyTitle);
    expect(await sendTalk(oldPeer, newPeer, reply)).toBe(true);
    await expectTalk(newPeer, replyTitle, reply.talkId);

    await closeAndroidUser(oldPeer.user);
    const restartedUser = await launchAndroidUserViaAdb({
      hubGunUrl: hubUrl,
      deviceSerial: oldDevice.serial,
      disableLanDiscovery: true,
    });
    const restartedId = await bootstrapNativeWindow(restartedUser.window, 'unused', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 150_000,
      pinStableLocation: false,
      updateStageName: false,
    });
    expect(restartedId).toBe(oldId);
    await forceJoinRoom(restartedUser.window, oldRoom);
    oldPeer = { ...oldPeer, user: restartedUser };

    const restarted = await storedManifestState(restartedUser.window);
    expect(restarted.checkpoint?.sequence).toBe(expectedSequence);
    expect(restarted.checkpoint?.manifestHash).toBe(expectedHash);
    expect(restarted.archive.map((entry) => entry.body.sequence)).toEqual(HISTORY.map((entry) => entry.body.sequence));
    await expect.poll(async () => (await storedManifestState(restartedUser.window)).mesh?.manifestReadyNeighborCount ?? 0, {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000],
    }).toBe(1);

    const restartTitle = `manifest-after-restart-${Date.now()}`;
    const restartTalk = await createTalk(oldPeer, restartTitle);
    expect(await sendTalk(oldPeer, newPeer, restartTalk)).toBe(true);
    await expectTalk(newPeer, restartTitle, restartTalk.talkId);

    await testInfo.attach('protocol-manifest-phone-evidence.json', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({
        oldDevice,
        newDevice,
        roomId: oldRoom,
        expectedSequence,
        expectedHash,
        k2SignerKeyId: HISTORY[0].signerKeyId,
        nextReleaseKeys: EXPECTED_LATEST!.body.nextReleaseKeys,
        gatedTalk: { sentWhileHeld, talkId: gatedTalk.talkId },
        accepted,
        restarted,
      }, null, 2)),
    });
  });

  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const peer of [oldPeer, newPeer]) {
      if (!peer) continue;
      const diagnostics = await collectAndroidDiagnostics(peer.device.serial).catch(() => null);
      if (!diagnostics) continue;
      await testInfo.attach(`${peer.device.name}-logcat.txt`, {
        contentType: 'text/plain', body: Buffer.from(diagnostics.logcat),
      });
      await testInfo.attach(`${peer.device.name}-node-stdio.txt`, {
        contentType: 'text/plain', body: Buffer.from(diagnostics.nodeStdio),
      });
    }
  });
});
