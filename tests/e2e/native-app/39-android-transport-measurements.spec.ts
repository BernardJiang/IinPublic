/**
 * Measurement run on real phones (OPEN-40-G2.5 transport slice, the discovery-timer physical gate,
 * and OPEN-70's per-contact cost). One run, one transport mode, every phone named in
 * NATIVE_APP_ANDROID_SERIALS (2–5):
 *
 *   1. discovery: launch → app ready → hub roster has everyone (hub modes) / LAN NSD sees everyone
 *      (hub-lan) / one Wi-Fi Direct group and a converged roster (wifi-direct);
 *   2. connection cost: a fresh WebRTC connection per pair (session.reconnect), repeated, with the
 *      selected candidate types;
 *   3. broadcast loop (the Nearby v3 delivery model): each phone in turn sends one Talk to every
 *      other phone one at a time, then to all at once; time per contact and until all received;
 *   4. background: the newest-Android phone is sent a Talk after N minutes in the background;
 *   5. idle window: N minutes idle in Nearby with Android's battery accounting reset (charging
 *      ignored via `dumpsys battery unplug`), then the app's estimated mAh, network bytes and
 *      wakelock time, plus how often each phone's discovery state changed (radio churn).
 *
 * Modes (E2E_MEASURE_MODE):
 *   hub-lan     local hub reachable, LAN discovery on (default)
 *   hub-only    local hub reachable, LAN discovery off
 *   wifi-direct hub unreachable, LAN discovery off: phones must form a Wi-Fi Direct group
 *   ble-only   hub unreachable, LAN and Wi-Fi Direct off: discovery evidence only (BLE is never a
 *              Talk-body transport)
 *   mixed-nearby one phone reaches the local hub over Wi-Fi STA while the others use an
 *                unreachable hub; LAN discovery is off and Wi-Fi Direct supplies their link
 *   cellular    public hub, private run-unique room; phones in E2E_MEASURE_CELLULAR_SERIALS turn
 *               Wi-Fi off and use mobile data
 *
 * Destructive: clears the IinPublic app data on every named phone. Results:
 * test-results/android-measurements/<mode>-<time>.json, summarised in
 * docs/testing/android-transport-measurements.md.
 *
 *   E2E_REAL_ANDROID_MEASURE=1 E2E_MEASURE_MODE=hub-lan NATIVE_APP_ANDROID_SERIALS=<s1>,<s2>,<s3> \
 *   npx playwright test --config tests/e2e/native-app/playwright.config.ts \
 *     tests/e2e/native-app/39-android-transport-measurements.spec.ts
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { bootstrapNativeWindow, enterNearbyAt, forceJoinRoom, nearbyListIds } from './helpers/native-app';
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

type Mode = 'hub-lan' | 'hub-only' | 'wifi-direct' | 'cellular' | 'ble-only' | 'mixed-nearby';
const RUN = process.env.E2E_REAL_ANDROID_MEASURE === '1';
const MODE = (process.env.E2E_MEASURE_MODE || 'hub-lan') as Mode;
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const PUBLIC_HUB = process.env.NATIVE_APP_CELLULAR_HUB?.trim() || 'https://www.iinpublic.com/gun';
const SERIALS = process.env.NATIVE_APP_ANDROID_SERIALS || '';
const CELLULAR_SERIALS = new Set((process.env.E2E_MEASURE_CELLULAR_SERIALS || '').split(',').map((s) => s.trim()).filter(Boolean));
const RECONNECTS = Number(process.env.E2E_MEASURE_RECONNECTS || '5');
const BACKGROUND_MINUTES = Number(process.env.E2E_MEASURE_BACKGROUND_MIN || '5');
const IDLE_MINUTES = Number(process.env.E2E_MEASURE_IDLE_MIN || '15');
const SAMPLE_SECONDS = 30;
/** OPEN-73: also record a CPU profile of each phone's embedded node during the idle window. */
const PROFILE = process.env.E2E_MEASURE_PROFILE === '1';
const PROFILE_SECONDS = 60;
/** Idle with the screens off, the way a phone in a pocket idles (otherwise the screen stays on). */
const SCREEN_OFF = process.env.E2E_MEASURE_SCREEN_OFF === '1';
const ONLINE_SERIAL = process.env.E2E_MEASURE_ONLINE_SERIAL?.trim() || '';
const timingNumber = (name: string): number | undefined => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1_000 ? Math.round(value) : undefined;
};
const DISCOVERY_TIMING = {
  scanWindowMs: timingNumber('E2E_DISCOVERY_SCAN_MS'),
  offlineBackoffBaseMs: timingNumber('E2E_DISCOVERY_OFFLINE_BASE_MS'),
  offlineBackoffMaxMs: timingNumber('E2E_DISCOVERY_OFFLINE_MAX_MS'),
  offlineBackoffMaxNoBleMs: timingNumber('E2E_DISCOVERY_OFFLINE_NO_BLE_MAX_MS'),
  onlineBackoffBaseMs: timingNumber('E2E_DISCOVERY_ONLINE_BASE_MS'),
  onlineBackoffMaxMs: timingNumber('E2E_DISCOVERY_ONLINE_MAX_MS'),
};
const PACKAGE = 'com.iinpublic.app';
const FIXED_LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10, timestamp: '2026-10-18T12:00:00.000Z' };

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type Phone = {
  device: ConfiguredAndroidDevice;
  user: AndroidUser;
  id: string;
  sdk: number;
  model: string;
  release: string;
  uid: string;
  roomId: string;
};

type Evidence = {
  mode: Mode;
  startedAt: string;
  appVersion?: string;
  phones: Array<{ name: string; serial: string; model: string; android: string; sdk: number; onMobileData: boolean }>;
  discovery: Record<string, Record<string, number | null>>;
  connections: Array<{ from: string; to: string; ms: number | null; error?: string; local?: string; remote?: string }>;
  broadcast: Array<{ author: string; style: 'one-at-a-time' | 'all-at-once'; sendMs: Record<string, number>; receivedMs: Record<string, number | null>; allReceivedMs: number | null }>;
  background: { receiver: string; minutes: number; receivedWhileBackgroundMs: number | null; receivedAfterForegroundMs: number | null } | null;
  idle: Record<string, unknown>;
  radio: Record<string, unknown>;
  transport: Record<string, unknown>;
  notes: string[];
};

async function adb(serial: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('adb', ['-s', serial, 'shell', ...args], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  return String(result.stdout);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function wakeAndUnlock(serial: string): Promise<void> {
  await adb(serial, 'input', 'keyevent', 'KEYCODE_WAKEUP').catch(() => '');
  await adb(serial, 'wm', 'dismiss-keyguard').catch(() => '');
  await adb(serial, 'cmd', 'statusbar', 'collapse').catch(() => '');
}

async function setWifi(serial: string, enabled: boolean): Promise<void> {
  await adb(serial, 'svc', 'wifi', enabled ? 'enable' : 'disable');
}

/** True when the default network is cellular, i.e. Wi-Fi really is out of the path. */
async function onCellularOnly(serial: string): Promise<boolean> {
  const out = await adb(serial, 'dumpsys', 'connectivity').catch(() => '');
  const active = out.split('\n').find((line) => /Active default network/i.test(line)) ?? '';
  const netId = active.match(/(\d+)/)?.[1];
  if (!netId) return false;
  const agent = out.split('\n').find((line) => line.includes('NetworkAgentInfo{') && line.includes(` network{${netId}}`)
    || line.includes(`NetworkAgentInfo{network{${netId}}`)) ?? '';
  return /CELLULAR/.test(agent) && !/WIFI/.test(agent);
}

async function dropLeftoverWifiDirectGroup(serial: string): Promise<void> {
  const p2p = await adb(serial, 'dumpsys', 'wifip2p').catch(() => '');
  if (!/groupFormed: true/.test(p2p)) return;
  await setWifi(serial, false);
  await sleep(3_000);
  await setWifi(serial, true);
  await sleep(10_000);
}

async function grantOfflineNearbyPermissions(serial: string, sdk: number): Promise<void> {
  const permissions = sdk >= 33
    ? ['android.permission.NEARBY_WIFI_DEVICES', 'android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_ADVERTISE', 'android.permission.BLUETOOTH_CONNECT']
    : ['android.permission.ACCESS_FINE_LOCATION'];
  for (const permission of permissions) await adb(serial, 'pm', 'grant', PACKAGE, permission).catch(() => '');
}

async function appUid(serial: string): Promise<string> {
  const dump = await adb(serial, 'dumpsys', 'package', PACKAGE).catch(() => '');
  return dump.match(/(?:userId|appId)=(\d+)/)?.[1] ?? '';
}

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) if (address.family === 'IPv4' && !address.internal) return address.address;
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

/** Poll until `check` is true; the elapsed milliseconds, or null on timeout. */
async function timeUntil(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check().catch(() => false)) return Date.now() - started;
    await sleep(intervalMs);
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function routeToFixedNearby(window: AndroidUser['window']): Promise<string> {
  return enterNearbyAt(window, FIXED_LOCATION);
}

async function createTagTalk(phone: Phone, title: string): Promise<{ talkId: string; talkData: any }> {
  await phone.user.window.evaluate((expectedTitle) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
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
  }, title);
  let created: { talkId: string; talkData: any } | null = null;
  await expect.poll(async () => {
    created = await phone.user.window.evaluate((expectedTitle) => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const entry = Object.entries(talks).find(([, value]: [string, any]) => value?.role === 'created' && value?.title === expectedTitle && value?.fullTalk);
      return entry ? { talkId: entry[0], talkData: (entry[1] as any).fullTalk } : null;
    }, title);
    return created !== null;
  }, { timeout: 90_000, intervals: [500, 1_000] }).toBe(true);
  return created!;
}

async function hasIncoming(phone: Phone, title: string): Promise<boolean> {
  try {
    await findIncomingTalkIdByTitle(phone.user.window, title);
    return true;
  } catch {
    return false;
  }
}

/** Send one Talk to the given receivers over the mesh; returns how long the send call took. */
async function sendTo(author: Phone, talk: { talkId: string; talkData: any }, receivers: Phone[]): Promise<number> {
  const started = Date.now();
  await author.user.window.evaluate(async ({ talkId, talkData, members }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    return app?.deliverTalkToReceiversOverMesh?.(talkId, talkData, members, members.map((member: { userId: string }) => member.userId));
  }, { talkId: talk.talkId, talkData: talk.talkData, members: receivers.map((r) => ({ userId: r.id, stageName: r.device.name })) });
  return Date.now() - started;
}

async function discoveryState(phone: Phone): Promise<string> {
  return phone.user.window.evaluate(() => {
    const d = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.();
    if (!d) return 'none';
    return [d.stage, d.wifiDirectActive ? 'wd' : '-', d.group?.state ?? '-', d.lanNsd ? 'nsd' : '-', (d.peers || []).length].join('|');
  }).catch(() => 'unavailable');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The app's line from `dumpsys batterystats --checkin`: estimated mAh, bytes, wakelock time. */
function parseBatteryStats(checkin: string, uid: string): Record<string, unknown> {
  const rows = checkin.split('\n').map((line) => line.split(',')).filter((cols) => cols[1] === uid && cols[2] === 'l');
  const out: Record<string, unknown> = {};
  const nt = rows.find((cols) => cols[3] === 'nt');
  if (nt) {
    out.mobileRxBytes = Number(nt[4]);
    out.mobileTxBytes = Number(nt[5]);
    out.wifiRxBytes = Number(nt[6]);
    out.wifiTxBytes = Number(nt[7]);
  }
  const pwi = checkin.split('\n').map((line) => line.split(',')).find((cols) => cols[3] === 'pwi' && cols[4] === 'uid' && cols[1] === uid);
  if (pwi) out.estimatedMah = Number(pwi[5]);
  const wakelocks = rows.filter((cols) => cols[3] === 'wl');
  // wl: name, full time, f, count, partial time, p, count, …
  out.partialWakelockMs = wakelocks.reduce((sum, cols) => sum + (Number(cols[8]) || 0), 0);
  const wifi = rows.find((cols) => cols[3] === 'wfl');
  if (wifi) out.wifiScanMs = Number(wifi[5]) || 0;
  const cpu = rows.find((cols) => cols[3] === 'cpu');
  if (cpu) out.cpuMs = (Number(cpu[4]) || 0) + (Number(cpu[5]) || 0);
  return out;
}

type CpuProfile = {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>;
  samples: number[];
  timeDeltas: number[];
};

/** Self time per function, largest first: where the embedded node spent the window. */
function topSelfTime(profile: CpuProfile, limit = 15): Array<{ fn: string; ms: number }> {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const frame = byNode.get(id)?.callFrame;
    if (!frame) return;
    const file = frame.url.split('/').slice(-2).join('/');
    const key = `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([fn, ms]) => ({ fn, ms: Math.round(ms) }));
}

/**
 * CPU % over `seconds` (second `top` frame) for the app's busiest threads and for every process
 * that belongs to it, including the WebView's sandboxed renderer (its own isolated uid).
 */
async function sampleAppCpu(serial: string, seconds: number): Promise<{ processes: Array<{ name: string; cpu: number }>; threads: Array<{ name: string; cpu: number }> }> {
  const secondFrame = (out: string) => out.split(/\n(?=Tasks:|Threads:)/).pop() ?? '';
  const rows = (frame: string, nameColumnFromEnd: number) => frame.split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => /^\d+$/.test(cols[0] ?? '') && cols.length > 9)
    .map((cols) => {
      const cpuIndex = cols.findIndex((col, i) => i > 5 && /^\d+(\.\d+)?$/.test(col) && /^\d+(\.\d+)?$/.test(cols[i + 1] ?? '') && /:/.test(cols[i + 2] ?? ''));
      return { name: cols.slice(cols.length - nameColumnFromEnd).join(' '), cpu: cpuIndex > 0 ? Number(cols[cpuIndex]) : 0 };
    });
  const pid = (await adb(serial, 'pidof', PACKAGE).catch(() => '')).trim().split(/\s+/)[0];
  const topRun = async (...args: string[]) => String((await execFileAsync('adb', ['-s', serial, 'shell', 'top', ...args], {
    timeout: (seconds + 30) * 1000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch(() => ({ stdout: '' }))).stdout);
  const [processOut, threadOut] = await Promise.all([
    topRun('-b', '-n', '2', '-d', String(seconds)),
    pid ? topRun('-H', '-b', '-n', '2', '-d', String(seconds), '-p', pid) : Promise.resolve(''),
  ]);
  const processes = rows(secondFrame(processOut), 1)
    .filter((row) => /iinpublic|sandboxed|webview|webview_zygote/i.test(row.name))
    .sort((a, b) => b.cpu - a.cpu).slice(0, 6);
  const threads = rows(secondFrame(threadOut), 2)
    .sort((a, b) => b.cpu - a.cpu).slice(0, 10);
  return { processes, threads };
}

/** CDP profile of the WebView page plus how its main thread spent the window. */
async function profileWebViewPage(page: AndroidUser['window'], seconds: number): Promise<{ profile?: CpuProfile; metrics?: Record<string, number>; error?: string }> {
  try {
    const cdp = await page.context().newCDPSession(page);
    const metricsNow = async () => Object.fromEntries(((await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }).metrics.map((m) => [m.name, m.value]));
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    const before = await metricsNow();
    await cdp.send('Profiler.start');
    await sleep(seconds * 1000);
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
    const after = await metricsNow();
    const delta = (name: string) => Math.round(((after[name] ?? 0) - (before[name] ?? 0)) * 1000);
    await cdp.detach().catch(() => undefined);
    return {
      profile,
      metrics: {
        taskMs: delta('TaskDuration'),
        scriptMs: delta('ScriptDuration'),
        layoutMs: delta('LayoutDuration'),
        recalcStyleMs: delta('RecalcStyleDuration'),
        layoutCount: Math.round((after.LayoutCount ?? 0) - (before.LayoutCount ?? 0)),
        recalcStyleCount: Math.round((after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0)),
        nodes: Math.round(after.Nodes ?? 0),
        jsHeapMb: Math.round((after.JSHeapUsedSize ?? 0) / 1e6),
      },
    };
  } catch (error) {
    return { error: String((error as Error)?.message || error) };
  }
}

function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]!;
}

test.describe('Native app: transport measurements on real phones', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_MEASURE=1 to run this destructive physical-device measurement.');
  test.skip(!SERIALS, 'Name the phones in NATIVE_APP_ANDROID_SERIALS (they are shared; never measure unnamed phones).');

  const phones: Phone[] = [];
  const consoleLines: Record<string, string[]> = {};
  const evidence: Evidence = {
    mode: MODE,
    startedAt: new Date().toISOString(),
    phones: [],
    discovery: {},
    connections: [],
    broadcast: [],
    background: null,
    idle: {},
    radio: {},
    transport: {},
    notes: [],
  };

  test.afterAll(async () => {
    for (const phone of phones) {
      await adb(phone.device.serial, 'dumpsys', 'battery', 'reset').catch(() => '');
      if (CELLULAR_SERIALS.has(phone.device.serial)) await setWifi(phone.device.serial, true).catch(() => {});
      await clearAndroidE2ETestProjections(phone.user).catch(() => {});
      await closeAndroidUser(phone.user);
    }
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  test.afterEach(async ({}, testInfo) => {
    const summary = {
      connectionP50Ms: percentile(evidence.connections.flatMap((c) => (c.ms == null ? [] : [c.ms])), 0.5),
      connectionP95Ms: percentile(evidence.connections.flatMap((c) => (c.ms == null ? [] : [c.ms])), 0.95),
      connectionFailures: evidence.connections.filter((c) => c.ms == null).length,
      deliveryP50Ms: percentile(evidence.broadcast.flatMap((b) => Object.values(b.receivedMs).flatMap((v) => (v == null ? [] : [v]))), 0.5),
      deliveryP95Ms: percentile(evidence.broadcast.flatMap((b) => Object.values(b.receivedMs).flatMap((v) => (v == null ? [] : [v]))), 0.95),
      perContactSendP50Ms: percentile(evidence.broadcast.filter((b) => b.style === 'one-at-a-time').flatMap((b) => Object.values(b.sendMs)), 0.5),
    };
    const body = JSON.stringify({ ...evidence, summary }, null, 2);
    console.log(`[measure] summary ${JSON.stringify(summary)}`);
    const dir = path.resolve('test-results', 'android-measurements');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${MODE}-${evidence.startedAt.replace(/[:.]/g, '-')}.json`), body);
    await testInfo.attach('measurements.json', { body: Buffer.from(body), contentType: 'application/json' });
    for (const phone of phones) {
      const consolePath = testInfo.outputPath(`${phone.device.name}-webview-console.txt`);
      fs.writeFileSync(consolePath, (consoleLines[phone.device.name] ?? []).join('\n'));
      await testInfo.attach(`${phone.device.name}-webview-console.txt`, { path: consolePath, contentType: 'text/plain' });
    }
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const phone of phones) {
        const failure = await collectAndroidDiagnostics(phone.device.serial);
        await testInfo.attach(`${phone.device.name}-logcat.txt`, { body: Buffer.from(failure.logcat), contentType: 'text/plain' });
      }
    }
  });

  test(`measure ${MODE}`, async () => {
    test.setTimeout((25 + BACKGROUND_MINUTES + IDLE_MINUTES) * 60_000);
    const devices = resolveAndroidMatrixDevices(SERIALS);
    const ready = [];
    for (const device of devices) if (await isAndroidDeviceReady(device.serial)) ready.push(device);
    test.skip(ready.length < 2, `Needs at least two ready phones; found ${ready.length}.`);

    const localHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const hubUrlFor = (serial: string): string => {
      if (MODE === 'cellular') return PUBLIC_HUB;
      if (MODE === 'wifi-direct' || MODE === 'ble-only') return 'http://127.0.0.1:1/gun';
      if (MODE === 'mixed-nearby' && serial !== ONLINE_SERIAL) return 'http://127.0.0.1:1/gun';
      return localHubUrl;
    };
    if (MODE === 'mixed-nearby') expect(ready.some((device) => device.serial === ONLINE_SERIAL), 'E2E_MEASURE_ONLINE_SERIAL must name a ready phone').toBe(true);
    const runId = `measure-${MODE}-${Date.now()}`;

    for (const device of ready) {
      await wakeAndUnlock(device.serial);
      if (MODE === 'wifi-direct' || MODE === 'mixed-nearby') await dropLeftoverWifiDirectGroup(device.serial);
      if (MODE === 'cellular' && CELLULAR_SERIALS.has(device.serial)) {
        await setWifi(device.serial, false);
        await expect.poll(() => onCellularOnly(device.serial), { timeout: 30_000, message: `${device.serial} should be on mobile data` }).toBe(true);
      }
    }
    await Promise.all(ready.map((device) => resetAndroidAppData(device.serial)));

    // 1. Launch and discovery.
    for (let index = 0; index < ready.length; index += 1) {
      const device = ready[index]!;
      const metadata = await readAndroidDeviceMetadata(device.serial);
      const sdk = Number(metadata.sdk || 0);
      if (MODE === 'wifi-direct' || MODE === 'ble-only' || MODE === 'mixed-nearby') await grantOfflineNearbyPermissions(device.serial, sdk);
      const launchedAt = Date.now();
      const user = await launchAndroidUserViaAdb({
        hubGunUrl: hubUrlFor(device.serial),
        deviceSerial: device.serial,
        disableLanDiscovery: MODE !== 'hub-lan',
        discoveryTiming: DISCOVERY_TIMING,
      });
      const lines: string[] = consoleLines[device.name] = [];
      user.window.on('console', (message) => {
        if (lines.length < 20_000) lines.push(`${new Date().toISOString()} ${message.type()} ${message.text()}`);
      });
      const id = await bootstrapNativeWindow(user.window, `Measure ${index + 1}`, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000, pinStableLocation: false });
      if (MODE === 'ble-only') {
        await user.window.evaluate(() => {
          localStorage.setItem('iinpublic_nearby_wifi_direct', '0');
          localStorage.setItem('iinpublic_nearby_bluetooth', '1');
          window.dispatchEvent(new CustomEvent('iinpublic-nearby-settings-changed'));
        });
      }
      const readyMs = Date.now() - launchedAt;
      const phone: Phone = { device, user, id, sdk, model: String(metadata.model), release: String(metadata.release), uid: await appUid(device.serial), roomId: '' };
      phones.push(phone);
      evidence.phones.push({ name: device.name, serial: device.serial, model: phone.model, android: phone.release, sdk, onMobileData: CELLULAR_SERIALS.has(device.serial) });
      evidence.discovery[device.name] = { launchToReadyMs: readyMs };
      console.log(`[measure] ${device.name} (${phone.model}, Android ${phone.release}) ready in ${readyMs} ms`);
    }
    // Everyone enters Nearby at the same moment, so discovery is timed from one shared start.
    const discoveryStartedAt = Date.now();
    await Promise.all(phones.map(async (phone) => {
      const routedAt = Date.now();
      if (MODE === 'cellular') {
        await forceJoinRoom(phone.user.window, runId);
        phone.roomId = runId;
      } else {
        phone.roomId = await routeToFixedNearby(phone.user.window);
      }
      evidence.discovery[phone.device.name]!.routeMs = Date.now() - routedAt;
    }));
    evidence.appVersion = await phones[0]!.user.window.evaluate(() => String((window as any).__IINPUBLIC_VERSION__ || (window as any).__iinpublic_app?.getApp?.()?.appVersion || '')).catch(() => '');
    expect(new Set(phones.map((p) => p.roomId)).size).toBe(1);
    const allIds = phones.map((p) => p.id);
    const sinceStart = (ms: number | null) => (ms == null ? null : Date.now() - discoveryStartedAt);

    if (MODE === 'wifi-direct' || MODE === 'mixed-nearby') {
      const groupMs = sinceStart(await timeUntil(async () => (await Promise.all(phones.map((p) => p.user.window.evaluate(() => {
        const d = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.();
        return d?.wifiDirectActive === true && (d?.group?.state === 'owner' || d?.group?.state === 'client');
      })))).every(Boolean), 240_000, 1_000));
      evidence.discovery.all = { ...(evidence.discovery.all ?? {}), wifiDirectGroupMs: groupMs };
      if (MODE === 'mixed-nearby' && groupMs != null) {
        const coexistence = await Promise.all(phones.map(async (phone) => ({
          name: phone.device.name,
          serial: phone.device.serial,
          ...(await phone.user.window.evaluate(async () => {
            const hub = await fetch('/api/local-link/hub-status', { cache: 'no-store' }).then((response) => response.json()) as { reachable?: unknown };
            let path: { connected?: unknown; validated?: unknown; transports?: unknown } = {};
            try {
              const raw = (window as any).IinPublicNearby?.networkPathState?.();
              if (raw) path = JSON.parse(raw);
            } catch {
              // Assertion below reports the absent path rather than hiding it.
            }
            const nearby = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.();
            return { hubReachable: hub.reachable === true, path, groupState: nearby?.group?.state };
          })),
        })));
        const online = coexistence.find((phone) => phone.serial === ONLINE_SERIAL);
        expect(online?.hubReachable, 'the designated online phone should still reach the hub while its Wi-Fi Direct group is active').toBe(true);
        expect(Array.isArray(online?.path.transports) && online.path.transports.map(String).includes('wifi'), 'the designated online phone should retain its Wi-Fi STA path').toBe(true);
        expect(online?.groupState === 'owner' || online?.groupState === 'client', 'the designated online phone should also remain in the Wi-Fi Direct group').toBe(true);
        for (const phone of coexistence.filter((entry) => entry.serial !== ONLINE_SERIAL)) {
          expect(phone.hubReachable, `${phone.name} should remain hub-offline`).toBe(false);
        }
        evidence.notes.push(`Mixed-path coexistence verified: ${online?.name} retained a validated Wi-Fi hub path while all phones shared the Wi-Fi Direct group.`);
      }
    }
    if (MODE !== 'cellular' && MODE !== 'wifi-direct') {
      // Nearby v3: no hub roster; the first phone's list holding everyone else stands in for it.
      evidence.discovery.all = {
        ...(evidence.discovery.all ?? {}),
        firstListMs: sinceStart(await timeUntil(async () => {
          const ids = new Set(await nearbyListIds(phones[0]!.user.window));
          return allIds.filter((id) => id !== phones[0]!.id).every((id) => ids.has(id));
        }, 120_000, 250)),
      };
    }
    // Every phone has everyone else: on its Nearby list, or in the room roster for the cellular
    // run's synthetic room.
    const rosterMs = sinceStart(await timeUntil(async () => (await Promise.all(phones.map(async (p) => {
      if (MODE === 'ble-only') {
        return p.user.window.evaluate((expected) => {
          const diagnostics = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.();
          return (diagnostics?.peers || []).filter((peer: { sources?: string[] }) => peer.sources?.includes('ble')).length >= expected;
        }, phones.length - 1);
      }
      const seen = MODE === 'cellular'
        ? new Set<string>(await p.user.window.evaluate(() => Array.from((window as any).__iinpublic_app?.getApp?.()?.chatroomService?.activeMembersForList?.keys?.() || []).map(String)))
        : new Set<string>(await nearbyListIds(p.user.window));
      return allIds.filter((id) => id !== p.id).every((id) => seen.has(id));
    }))).every(Boolean), 240_000, 500));
    evidence.discovery.all = { ...(evidence.discovery.all ?? {}), everyRosterMs: rosterMs };
    if (MODE === 'hub-lan') {
      evidence.discovery.all.lanNsdAllMs = sinceStart(await timeUntil(async () => (await Promise.all(phones.map((p) => p.user.window.evaluate(() => {
        const d = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.();
        return (d?.peers || []).filter((peer: { onLan?: boolean }) => peer.onLan).length;
      })))).every((n) => n >= phones.length - 1), 120_000, 500));
    }
    // Every pair also has a live mesh link with a confirmed encrypted session.
    if (MODE !== 'ble-only') {
      evidence.discovery.all.meshAllMs = sinceStart(await timeUntil(async () => (await Promise.all(phones.map((p) => p.user.window.evaluate((ids) => {
        const mesh = (window as any).__iinpublic_app?.getApp?.()?.peerMeshService;
        return ids.filter((id: string) => mesh?.neighbors?.get?.(id)?.session?.secureSessionConfirmed === true).length;
      }, allIds.filter((id) => id !== p.id))))).every((n) => n >= phones.length - 1), 120_000, 500));
    }
    console.log(`[measure] discovery ${JSON.stringify(evidence.discovery.all)} (from ${new Date(discoveryStartedAt).toISOString()})`);
    expect(rosterMs, MODE === 'ble-only' ? 'every phone should see every other BLE beacon' : 'every phone should list every other phone').not.toBeNull();

    // 2. Fresh connection per pair, from the side that makes the WebRTC offer.
    if (MODE !== 'ble-only') {
    for (let i = 0; i < phones.length; i += 1) {
      for (let j = i + 1; j < phones.length; j += 1) {
        const [a, b] = phones[i]!.id.localeCompare(phones[j]!.id) < 0 ? [phones[i]!, phones[j]!] : [phones[j]!, phones[i]!];
        await a.user.window.evaluate((otherId) => (window as any).__iinpublic_app?.getApp?.()?.peerMeshService?.waitForConnectedNeighbor?.(otherId, 20_000), b.id).catch(() => false);
        for (let rep = 0; rep < RECONNECTS; rep += 1) {
          const result = await a.user.window.evaluate(async (otherId) => {
            const mesh = (window as any).__iinpublic_app?.getApp?.()?.peerMeshService;
            const neighbor = mesh?.neighbors?.get?.(otherId);
            if (!neighbor?.session?.reconnect) return { ms: null, error: 'no mesh session' };
            const started = performance.now();
            try {
              await neighbor.session.reconnect(20_000);
              const ms = Math.round(performance.now() - started);
              const pair = await neighbor.session.getSelectedCandidatePair?.().catch?.(() => null);
              return { ms, local: pair?.localType, remote: pair?.remoteType };
            } catch (error) {
              return { ms: null, error: String((error as Error)?.message || error) };
            }
          }, b.id);
          evidence.connections.push({ from: a.device.name, to: b.device.name, ...result });
          await sleep(1_000);
        }
      }
    }
    console.log(`[measure] connections ${JSON.stringify(evidence.connections.map((c) => c.ms))}`);

    // 3. The broadcast loop: one at a time, then all at once, from every phone.
    for (const style of ['one-at-a-time', 'all-at-once'] as const) {
      for (const author of phones) {
        const receivers = phones.filter((p) => p !== author);
        const talk = await createTagTalk(author, `${runId}-${style}-${author.device.name}`);
        const title = talk.talkData.title as string;
        const started = Date.now();
        const receivedMs: Record<string, number | null> = {};
        const watchers = receivers.map(async (receiver) => {
          receivedMs[receiver.device.name] = await timeUntil(() => hasIncoming(receiver, title), 120_000, 250)
            .then((ms) => (ms == null ? null : Date.now() - started));
        });
        const sendMs: Record<string, number> = {};
        if (style === 'one-at-a-time') {
          for (const receiver of receivers) sendMs[receiver.device.name] = await sendTo(author, talk, [receiver]);
        } else {
          sendMs.all = await sendTo(author, talk, receivers);
        }
        await Promise.all(watchers);
        const values = Object.values(receivedMs);
        evidence.broadcast.push({
          author: author.device.name,
          style,
          sendMs,
          receivedMs,
          allReceivedMs: values.every((v) => v != null) ? Math.max(...(values as number[])) : null,
        });
        console.log(`[measure] ${style} from ${author.device.name}: send ${JSON.stringify(sendMs)} received ${JSON.stringify(receivedMs)}`);
      }
    }

    // 4. Background delivery to the newest Android.
    if (BACKGROUND_MINUTES > 0) {
      const receiver = [...phones].sort((a, b) => b.sdk - a.sdk)[0]!;
      const author = phones.find((p) => p !== receiver)!;
      const talk = await createTagTalk(author, `${runId}-background`);
      await adb(receiver.device.serial, 'input', 'keyevent', 'KEYCODE_HOME');
      console.log(`[measure] ${receiver.device.name} in the background for ${BACKGROUND_MINUTES} min`);
      await sleep(BACKGROUND_MINUTES * 60_000);
      const started = Date.now();
      await sendTo(author, talk, [receiver]);
      const whileBackground = await timeUntil(() => hasIncoming(receiver, talk.talkData.title), 60_000, 1_000);
      let afterForeground: number | null = null;
      if (whileBackground == null) {
        await adb(receiver.device.serial, 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY);
        afterForeground = await timeUntil(() => hasIncoming(receiver, talk.talkData.title), 120_000, 500)
          .then((ms) => (ms == null ? null : Date.now() - started));
      } else {
        await adb(receiver.device.serial, 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY);
      }
      evidence.background = { receiver: receiver.device.name, minutes: BACKGROUND_MINUTES, receivedWhileBackgroundMs: whileBackground, receivedAfterForegroundMs: afterForeground };
      console.log(`[measure] background ${JSON.stringify(evidence.background)}`);
      await sleep(5_000);
    }
    }

    // 5. Idle window with battery accounting, and discovery-state churn.
    if (IDLE_MINUTES > 0) {
      for (const phone of phones) {
        await adb(phone.device.serial, 'dumpsys', 'battery', 'unplug').catch(() => '');
        await adb(phone.device.serial, 'dumpsys', 'batterystats', '--reset').catch(() => '');
      }
      evidence.notes.push('Battery: Android\'s per-app power estimate with charging hidden (dumpsys battery unplug); the phones stay on USB, so this is the model estimate, not measured drain.');
      evidence.notes.push(SCREEN_OFF ? 'Idle window with the screens off.' : 'Idle window with the screens on.');
      if (SCREEN_OFF) for (const phone of phones) await adb(phone.device.serial, 'input', 'keyevent', 'KEYCODE_SLEEP').catch(() => '');
      const states: Record<string, string[]> = Object.fromEntries(phones.map((p) => [p.device.name, []]));
      if (PROFILE) {
        // The page is served by the embedded node on loopback, so it may call the loopback-only window.
        // At the same time, profile the WebView page itself over CDP (script, layout, style, paint).
        // Android 7's WebView drops the whole page connection when a CDP session is opened on it.
        const pageWindows = Promise.all(phones.map((phone) => (phone.sdk >= 29
          ? profileWebViewPage(phone.user.window, PROFILE_SECONDS)
          : Promise.resolve({ error: `page profile skipped on Android SDK ${phone.sdk}` }))));
        const cpuSamples = Promise.all(phones.map((phone) => sampleAppCpu(phone.device.serial, 30)));
        const windows = await Promise.all(phones.map((phone) => phone.user.window.evaluate(async (seconds) => {
          const response = await fetch(`/api/debug/runtime-window?seconds=${seconds}`, { cache: 'no-store' });
          return response.ok ? response.json() : { error: `${response.status} ${await response.text()}` };
        }, PROFILE_SECONDS).catch((error) => ({ error: String(error) }))));
        const pages = await pageWindows;
        const cpu = await cpuSamples;
        phones.forEach((phone, index) => {
          (evidence.idle as Record<string, unknown>)[`${phone.device.name}-cpu`] = cpu[index];
          console.log(`[measure] cpu ${phone.device.name} ${JSON.stringify(cpu[index])}`);
        });
        phones.forEach((phone, index) => {
          const page = pages[index]!;
          if (page.profile) {
            fs.mkdirSync(path.resolve('test-results', 'android-measurements'), { recursive: true });
            fs.writeFileSync(path.resolve('test-results', 'android-measurements', `${MODE}-${phone.device.name}-page-${evidence.startedAt.replace(/[:.]/g, '-')}.cpuprofile`), JSON.stringify(page.profile));
          }
          const summary = { metrics: page.metrics, topSelfTime: page.profile ? topSelfTime(page.profile) : null, error: page.error };
          (evidence.idle as Record<string, unknown>)[`${phone.device.name}-page`] = summary;
          console.log(`[measure] page ${phone.device.name} ${JSON.stringify(summary)}`);
        });
        const dir = path.resolve('test-results', 'android-measurements');
        fs.mkdirSync(dir, { recursive: true });
        phones.forEach((phone, index) => {
          const report = windows[index] as { profile?: CpuProfile; eventLoopUtilization?: number; requests?: unknown; profileUnavailable?: string; error?: string };
          if (report.profile) {
            fs.writeFileSync(path.join(dir, `${MODE}-${phone.device.name}-${evidence.startedAt.replace(/[:.]/g, '-')}.cpuprofile`), JSON.stringify(report.profile));
          }
          const summary = {
            eventLoopUtilization: report.eventLoopUtilization,
            requests: report.requests,
            gun: (report as { gun?: unknown }).gun,
            topSelfTime: report.profile ? topSelfTime(report.profile) : null,
            profileUnavailable: report.profileUnavailable ?? report.error,
          };
          (evidence.idle as Record<string, unknown>)[`${phone.device.name}-runtime`] = summary;
          console.log(`[measure] runtime ${phone.device.name} ${JSON.stringify(summary)}`);
        });
      }
      const samples = Math.max(1, Math.round((IDLE_MINUTES * 60) / SAMPLE_SECONDS));
      for (let sample = 0; sample < samples; sample += 1) {
        for (const phone of phones) states[phone.device.name]!.push(await discoveryState(phone));
        await sleep(SAMPLE_SECONDS * 1_000);
      }
      for (const phone of phones) {
        const checkin = await adb(phone.device.serial, 'dumpsys', 'batterystats', '--checkin').catch(() => '');
        const series = states[phone.device.name]!;
        const changes = series.filter((state, index) => index > 0 && state !== series[index - 1]).length;
        evidence.idle[phone.device.name] = {
          minutes: IDLE_MINUTES,
          ...parseBatteryStats(checkin, phone.uid),
          discoveryStateChanges: changes,
          discoveryStates: [...new Set(series)],
          mesh: await phone.user.window.evaluate(() => {
            const mesh = (window as any).__iinpublic_app?.getApp?.()?.peerMeshService;
            return { ...mesh?.getDiagnostics?.(), forwarding: mesh?.getForwardingDiagnostics?.() };
          }).catch(() => null),
        };
        await adb(phone.device.serial, 'dumpsys', 'battery', 'reset').catch(() => '');
      }
      console.log(`[measure] idle ${JSON.stringify(evidence.idle)}`);
    }
    for (const phone of phones) {
      const diagnostics = await phone.user.window.evaluate(() => {
        const nearby = (window as any).__iinpublicNearbyOffline?.getDiagnostics?.() || null;
        const mesh = (window as any).__iinpublic_app?.getApp?.()?.peerMeshService?.getDiagnostics?.() || null;
        return {
          radio: nearby ? {
            stage: nearby.stage,
            discoveryDuty: nearby.discoveryDuty,
            nativeMeasurements: nearby.nativeMeasurements,
            peerSources: (nearby.peers || []).map((peer: { sources?: string[] }) => peer.sources || []),
          } : null,
          transport: mesh?.transport || null,
        };
      }).catch(() => ({ radio: null, transport: null }));
      evidence.radio[phone.device.name] = diagnostics.radio;
      evidence.transport[phone.device.name] = diagnostics.transport;
    }
    console.log(`[measure] radio ${JSON.stringify(evidence.radio)}`);
    console.log(`[measure] transport ${JSON.stringify(evidence.transport)}`);
  });
});
