/**
 * OPEN-40-G2.5 connected-hub hardware gate for visitable Nearby cohorts.
 *
 * This is intentionally destructive to the three selected IinPublic app sandboxes. It proves that
 * Android loopback servers forward signed cohort control to one shared upstream index, creates a
 * real C=3 overflow, places all phones into stable identity-derived replacement cohorts, performs
 * explicit same-area handoffs, and sends Talks before and after backgrounding a receiver.
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as http from 'http';
import * as os from 'os';
import { promisify } from 'util';
import type { RoomProtocolCheckpoint } from '../../../src/shared/active-exchange-room';
import {
  deriveNearbyMemberRouteV2,
  nearbyAreaBindingId,
  nearbyCohortRootGroup,
  type NearbyPartitionGroupV2,
  type NearbyPartitionTransitionV2,
} from '../../../src/shared/nearby-cohort-protocol';
import { bootstrapNativeWindow } from './helpers/native-app';
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
import { resolveAndroidMatrixDevices, type ConfiguredAndroidDevice } from './helpers/android-device-config';
import { findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';

const execFileAsync = promisify(execFile);
const RUN = process.env.E2E_REAL_ANDROID_THREE_PHONE_COHORTS === '1';
const HUB_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');
const LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10 };
process.env.E2E_PORT_OFFSET = String(HUB_PORT - 8080);

type Battery = { level: number | null; scale: number | null; plugged: number | null; percentage: number | null };
type Peer = {
  device: ConfiguredAndroidDevice;
  user: AndroidUser;
  id: string;
  pub: string;
  sdk: number;
  roomId: string;
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

async function adb(serial: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('adb', ['-s', serial, 'shell', ...args], {
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return String(result.stdout);
}

async function battery(serial: string): Promise<Battery> {
  const dump = await adb(serial, 'dumpsys', 'battery').catch(() => '');
  const number = (key: string): number | null => {
    const match = dump.match(new RegExp(`^\\s*${key}:\\s*(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const level = number('level');
  const scale = number('scale');
  return {
    level,
    scale,
    plugged: number('plugged'),
    percentage: level != null && scale ? Math.round(level / scale * 10_000) / 100 : null,
  };
}

function getJson(path: string): Promise<{ body: any; bytes: number }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: HUB_PORT, path, timeout: 5_000 }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`GET ${path} returned ${response.statusCode}: ${raw.slice(0, 300)}`));
          return;
        }
        try {
          resolve({ body: JSON.parse(raw), bytes: Buffer.byteLength(raw) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error(`GET ${path} timed out`)));
  });
}

function checkpoint(attempt: number): RoomProtocolCheckpoint {
  return {
    networkId: `iinpublic-open40-g2-physical-${attempt}`,
    protocolEpoch: 2,
    manifestSequence: 1,
    manifestHash: '4'.repeat(64),
    chatroomCapacity: 3,
  };
}

function checkpointQuery(value: RoomProtocolCheckpoint): string {
  return new URLSearchParams({
    networkId: value.networkId,
    protocolEpoch: String(value.protocolEpoch),
    manifestSequence: String(value.manifestSequence),
    manifestHash: value.manifestHash,
    chatroomCapacity: String(value.chatroomCapacity),
  }).toString();
}

async function summaries(value: RoomProtocolCheckpoint, currentRoomId: string) {
  const area = nearbyAreaBindingId({ checkpoint: value, privacyMode: 'regional', geographicPath: '' });
  return getJson(`/api/nearby-cohorts/${encodeURIComponent(area)}/summaries?${checkpointQuery(value)}&currentRoomId=${encodeURIComponent(currentRoomId)}&limit=32`);
}

async function activate(peer: Peer, value: RoomProtocolCheckpoint, defaultGroup: NearbyPartitionGroupV2) {
  const started = Date.now();
  const result = await peer.user.window.evaluate(async ({ targetCheckpoint, targetGroup }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const pair = app?.gunService?.getStoredPair?.();
    const user = app?.currentUser;
    if (!app || !pair?.pub || !pair?.priv || !user?.id) throw new Error('cohort identity unavailable');
    // This physical smoke deliberately injects synthetic signed checkpoints while the ordinary
    // v2 Nearby control heartbeat from bootstrap is still alive. Stop that older allocator before
    // activating v3; otherwise its 15-second refresh can race this awaited switch and move the
    // phone back to the boot room. Production performs one coordinated migration rather than
    // cycling through test checkpoints in a single session.
    if (app.nearbyControlRefreshTimer) clearInterval(app.nearbyControlRefreshTimer);
    app.nearbyControlRefreshTimer = null;
    app.nearbyControlRootAssignment = null;
    app.nearbyControlRoutingLocation = null;
    const active = await app.initializeNearbyCohortTraversal({
      checkpoint: targetCheckpoint,
      userId: user.id,
      pair,
      privacyMode: 'regional',
      defaultGroup: targetGroup,
    });
    await app.switchNearbyCohortRuntime(active);
    return {
      roomId: String(app.chatroomService?.getCurrentChatroomId?.() || app.currentChatroomId || ''),
      active,
      snapshot: app.nearbyCohortTraversalClient?.getSnapshot?.(),
      error: app.nearbyCohortTraversalClient?.getLastError?.(),
    };
  }, { targetCheckpoint: value, targetGroup: defaultGroup });
  expect(result.roomId).toBe(defaultGroup.roomId);
  expect(result.error).toBeNull();
  peer.roomId = result.roomId;
  return Date.now() - started;
}

async function switchCohort(peer: Peer): Promise<number> {
  const started = Date.now();
  const before = peer.roomId;
  const result = await peer.user.window.evaluate(async () => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    await app?.nearbyCohortTraversalClient?.meetAnotherGroup?.();
    return {
      roomId: String(app?.chatroomService?.getCurrentChatroomId?.() || app?.currentChatroomId || ''),
      snapshot: app?.nearbyCohortTraversalClient?.getSnapshot?.(),
      error: app?.nearbyCohortTraversalClient?.getLastError?.(),
    };
  });
  expect(result.error).toBeNull();
  expect(result.snapshot?.status).toBe('ready');
  expect(result.roomId).not.toBe(before);
  peer.roomId = result.roomId;
  return Date.now() - started;
}

async function createTalk(peer: Peer, title: string): Promise<{ talkId: string; talkData: any }> {
  await peer.user.window.evaluate((expectedTitle) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    app?.uiManager?.emit?.('createTalk', {
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
  }, { timeout: 60_000 }).toBe(true);
  return created!;
}

async function deliver(author: Peer, receiver: Peer, title: string): Promise<number> {
  const talk = await createTalk(author, title);
  const started = Date.now();
  const sent = await author.user.window.evaluate(async ({ receiverId, receiverName, talkId, talkData }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    return app?.deliverTalkToReceiversOverMesh?.(
      talkId,
      talkData,
      [{ userId: receiverId, stageName: receiverName }],
      [receiverId],
    );
  }, { receiverId: receiver.id, receiverName: receiver.device.name, ...talk });
  expect(sent).toBe(true);
  let incoming = '';
  await expect.poll(async () => {
    try {
      incoming = await findIncomingTalkIdByTitle(receiver.user.window, title);
      return incoming;
    } catch {
      return '';
    }
  }, { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).toBe(talk.talkId);
  return Date.now() - started;
}

test.describe('Native app: three-phone visitable Nearby cohorts (OPEN-40-G2.5)', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_THREE_PHONE_COHORTS=1 to run this destructive hardware gate.');
  const peers: Peer[] = [];
  const batteryBefore: Record<string, Battery> = {};
  const switchMs: number[] = [];
  const deliveryMs: number[] = [];
  let controlBytes = 0;
  let splitDiscoveryMs = 0;
  let selectedCheckpoint: RoomProtocolCheckpoint | null = null;
  let selectedTransition: NearbyPartitionTransitionV2 | null = null;
  const startedAt = Date.now();

  test.afterAll(async () => {
    for (const peer of peers) await clearAndroidE2ETestProjections(peer.user).catch(() => undefined);
    for (const peer of peers) await closeAndroidUser(peer.user);
  });

  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    const phoneEvidence: Record<string, unknown> = {};
    for (const peer of peers) {
      phoneEvidence[peer.device.name] = {
        serial: peer.device.serial,
        sdk: peer.sdk,
        roomId: peer.roomId,
        batteryBefore: batteryBefore[peer.device.serial],
        batteryAfter: await battery(peer.device.serial),
        nearby: await peer.user.window.evaluate(() => {
          const service = (window as any).__iinpublicNearbyOffline;
          return service ? { status: service.getStatus?.(), diagnostics: service.getDiagnostics?.() } : null;
        }).catch(() => null),
      };
    }
    const percentile = (values: number[], ratio: number) => {
      const ordered = [...values].sort((a, b) => a - b);
      return ordered.length ? ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] : null;
    };
    const evidence = {
      runStartedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      checkpoint: selectedCheckpoint,
      split: selectedTransition ? { axis: selectedTransition.axis, groups: selectedTransition.toGroups.length } : null,
      splitDiscoveryMs,
      switchMs,
      switchP50Ms: percentile(switchMs, 0.5),
      switchP95Ms: percentile(switchMs, 0.95),
      deliveryMs,
      deliveryP50Ms: percentile(deliveryMs, 0.5),
      deliveryP95Ms: percentile(deliveryMs, 0.95),
      observedControlAndRosterResponseBytes: controlBytes,
      duplicateBytes: null,
      duplicateBytesNote: 'No byte-level duplicate counter exists yet; do not infer zero.',
      batteryNote: 'USB-connected smoke snapshots only; this is not an unplugged drain measurement.',
      phones: phoneEvidence,
    };
    console.log(`[three-phone-cohorts] evidence ${JSON.stringify(evidence)}`);
    await testInfo.attach('three-phone-cohort-evidence.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const peer of peers) {
        const diagnostic = await collectAndroidDiagnostics(peer.device.serial);
        await testInfo.attach(`${peer.device.name}-logcat.txt`, { body: Buffer.from(diagnostic.logcat), contentType: 'text/plain' });
        await testInfo.attach(`${peer.device.name}-node-stdio.txt`, { body: Buffer.from(diagnostic.nodeStdio), contentType: 'text/plain' });
      }
    }
  });

  test('shares one index, splits at C, switches cohorts, and survives receiver backgrounding', async () => {
    test.setTimeout(900_000);
    const readiness = await Promise.all(DEVICES.map(async (device) => ({ device, ready: await isAndroidDeviceReady(device.serial) })));
    const available = readiness.filter((entry) => entry.ready).map((entry) => entry.device);
    test.skip(available.length !== 3, `This scenario requires exactly three connected phones; found ${available.length}.`);
    const hubUrl = `http://${lanIp()}:${HUB_PORT}/gun`;
    for (const device of available) batteryBefore[device.serial] = await battery(device.serial);
    await Promise.all(available.map((device) => resetAndroidAppData(device.serial)));

    for (let index = 0; index < available.length; index += 1) {
      const device = available[index]!;
      const metadata = await readAndroidDeviceMetadata(device.serial);
      const user = await launchAndroidUserViaAdb({ hubGunUrl: hubUrl, deviceSerial: device.serial });
      const id = await bootstrapNativeWindow(user.window, `Cohort ${index + 1}`, {
        waitForSupportGreeting: false,
        readinessTimeoutMs: 150_000,
        pinStableLocation: false,
      });
      const pub = await user.window.evaluate(() => String(
        (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
      ));
      expect(pub).toBeTruthy();
      peers.push({ device, user, id, pub, sdk: Number(metadata.sdk || 0), roomId: '' });
    }

    // A rare all-three-to-one-child result would immediately cause a deeper C=3 split. Use a
    // fresh signed checkpoint instead so this three-phone smoke compares one clean two-way split.
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const candidate = checkpoint(attempt);
      const root = nearbyCohortRootGroup(candidate);
      const splitStartedAt = Date.now();
      for (const peer of peers) switchMs.push(await activate(peer, candidate, root));
      let response: Awaited<ReturnType<typeof summaries>> | null = null;
      await expect.poll(async () => {
        response = await summaries(candidate, root.roomId);
        controlBytes += response.bytes;
        return response.body.transitions?.length ?? 0;
      }, { timeout: 30_000, intervals: [500, 1_000] }).toBeGreaterThan(0);
      const transition = response!.body.transitions[0] as NearbyPartitionTransitionV2;
      const defaults = peers.map((peer) => {
        const route = deriveNearbyMemberRouteV2({
          geographicSelectorPath: '',
          requestedGeographicDepth: 0,
          requestedCohortDepth: 1,
          privacyMode: 'regional',
          location: LOCATION,
          identity: peer.pub,
          checkpoint: candidate,
          transitionSeed: transition.transitionSeed,
        });
        return transition.toGroups.find((group) => group.address.cohortPath === route.address.cohortPath)!;
      });
      if (new Set(defaults.map((group) => group.roomId)).size === 1) continue;
      selectedCheckpoint = candidate;
      selectedTransition = transition;
      splitDiscoveryMs = Date.now() - splitStartedAt;
      for (let index = 0; index < peers.length; index += 1) {
        switchMs.push(await activate(peers[index]!, candidate, defaults[index]!));
      }
      break;
    }
    expect(selectedCheckpoint).not.toBeNull();
    expect(selectedTransition?.axis).toBe('cohort');
    expect(selectedTransition?.toGroups).toHaveLength(2);
    expect(new Set(peers.map((peer) => peer.roomId)).size).toBe(2);

    const groups = new Map<string, Peer[]>();
    for (const peer of peers) groups.set(peer.roomId, [...(groups.get(peer.roomId) ?? []), peer]);
    const source = [...groups.values()].sort((a, b) => b.length - a.length)[0]!;
    switchMs.push(await switchCohort(source[0]!));
    if (!peers.some((peer) => peer !== source[0] && peer.roomId === source[0]!.roomId)) {
      switchMs.push(await switchCohort(source[1]!));
    }
    const author = source[0]!;
    const receiver = peers.find((peer) => peer !== author && peer.roomId === author.roomId)!;
    expect(receiver).toBeTruthy();

    const roster = await getJson(`/api/chatrooms/${encodeURIComponent(author.roomId)}/members`);
    controlBytes += roster.bytes;
    await expect.poll(async () => {
      const result = await getJson(`/api/chatrooms/${encodeURIComponent(author.roomId)}/members`);
      controlBytes += result.bytes;
      return result.body.filter((member: any) => [author.id, receiver.id].includes(member.userId)).length;
    }, { timeout: 60_000, intervals: [1_000, 2_000] }).toBe(2);

    deliveryMs.push(await deliver(author, receiver, `open40-g2-foreground-${Date.now()}`));
    await adb(receiver.device.serial, 'input', 'keyevent', 'KEYCODE_HOME');
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const backgroundTitle = `open40-g2-background-${Date.now()}`;
    const background = deliver(author, receiver, backgroundTitle);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await adb(receiver.device.serial, 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY);
    deliveryMs.push(await background);
    expect(await receiver.user.window.evaluate(() => String(
      (window as any).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.() || '',
    ))).toBe(author.roomId);
  });
});
