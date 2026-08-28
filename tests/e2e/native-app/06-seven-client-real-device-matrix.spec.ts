/**
 * Real-device matrix: three Android phones, the macOS Electron app, and three
 * browser engines (Chromium, WebKit/Safari, Firefox) share one LAN Gun hub.
 *
 * This is the physical-runtime counterpart to cross-platform X1/X2 and the
 * browser-only multi-user tests. It is opt-in because it requires three adb
 * devices and writes ordinary test talks/contacts into their installed apps.
 */
import { chromium, firefox, test, expect, webkit, type Browser, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';
import {
  closeAndroidUser,
  clearAndroidE2ETestProjections,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';
import {
  clickBroadcastUntilBulkAck,
  completeTalksInAppByAnswerIds,
  createTagTalkViaEditor,
} from '../helpers/talk-demo-ui';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19161;
const DEVICE_SERIALS = (process.env.NATIVE_APP_ANDROID_SERIALS || '')
  .split(',')
  .map((serial) => serial.trim())
  .filter(Boolean);
const RUN_MATRIX = process.env.E2E_REAL_DEVICE_MATRIX === '1';
const WEBRTC_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type MatrixUser = {
  name: string;
  runtime: string;
  page: Page;
  id: string;
};

function attachMatrixDiagnostics(user: MatrixUser): void {
  const failedResponses = new Set<string>();
  user.page.on('console', (message) => {
    const text = message.text();
    if (!/failed to create talk/i.test(text)) return;
    console.log(`[matrix] console ${message.type()} from ${user.runtime} (${user.name}): ${text}`);
  });
  user.page.on('pageerror', (error) => {
    console.log(`[matrix] page error from ${user.runtime} (${user.name}): ${error.message}`);
  });
  user.page.on('response', (response) => {
    if (response.status() < 400) return;
    const key = `${response.status()} ${response.url()}`;
    if (failedResponses.has(key)) return;
    failedResponses.add(key);
    void response.text().catch(() => '').then((body) => {
      console.log(
        `[matrix] HTTP ${key} from ${user.runtime} (${user.name}): ${body.slice(0, 500)}`,
      );
    });
  });
}

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function readCurrentPublicUser(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const pair = app?.gunService?.getStoredPair?.();
    return {
      ...(app?.currentUser || {}),
      ...(pair?.pub ? { pub: pair.pub } : {}),
      ...(pair?.epub ? { epub: pair.epub } : {}),
    };
  });
}

async function publishPublicUserToHub(user: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Hub user publish failed: ${response.status}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runUserSetupStep(
  user: MatrixUser,
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  console.log(`[matrix] ${label}: ${user.runtime} (${user.name})`);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      action(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after 35s`)), 35_000);
      }),
    ]);
  } catch (error) {
    throw new Error(`[matrix] ${label} failed for ${user.runtime} (${user.name}): ${String(error)}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  console.log(`[matrix] ${label} complete: ${user.runtime} (${user.name})`);
}

function oneTagTalk(authorId: string, owner: string, runId: string): any[] {
  const title = `${runId} ${owner} cross-platform tag`;
  return [{
    title,
    authorId,
    type: 'tag',
    language: 'en',
    isAdult: false,
    tags: [],
    questions: [{
      id: 'q_1',
      text: `${title}: can every runtime receive this?`,
      answers: [
        { id: 'match_1', text: 'Received', isMatch: true, isTerminal: true },
        { id: 'ignore_1', text: 'Ignore', isIgnore: true, isTerminal: true },
      ],
    }],
    createdAt: new Date().toISOString(),
    isTemplate: false,
    usageCount: 0,
  }];
}

test.describe('Real-device seven-client cross-platform matrix', () => {
  test.skip(!RUN_MATRIX, 'Set E2E_REAL_DEVICE_MATRIX=1 to run the physical-device matrix.');
  test.skip(DEVICE_SERIALS.length !== 3, 'Set NATIVE_APP_ANDROID_SERIALS to exactly three comma-separated adb serials.');

  let electron: NativeUser | undefined;
  const androidUsers: AndroidUser[] = [];
  const browsers: Browser[] = [];
  const browserClosers: Array<() => Promise<void>> = [];
  let userDataDir = '';

  test.afterAll(async () => {
    for (const close of browserClosers) await close().catch(() => {});
    for (const browser of browsers) await browser.close().catch(() => {});
    await Promise.all(androidUsers.map((user) => clearAndroidE2ETestProjections(user).catch(() => {})));
    await Promise.all(androidUsers.map((user) => closeAndroidUser(user)));
    await electron?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('all seven runtimes share presence and exchange one matching talk each', async () => {
    test.setTimeout(900_000);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    const loopbackHubUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;
    const users: MatrixUser[] = [];

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-seven-client-e2e-'));
    electron = await launchNativeUser({ localPort: APP_PORT, hubGunUrl: loopbackHubUrl, userDataDir });
    const macId = await bootstrapNativeWindow(electron.window, 'Matrix Mac', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    users.push({ name: 'Matrix Mac', runtime: 'macOS Electron', page: electron.window, id: macId });

    // Attach physical WebViews before launching three more local browser engines. On this
    // Mac, Playwright's experimental Android bridge can miss an adb WebView socket when
    // Chromium, WebKit, and Firefox are already consuming its browser-process event loop.
    for (let index = 0; index < DEVICE_SERIALS.length; index += 1) {
      console.log(`[matrix] launching Android ${index + 1}: ${DEVICE_SERIALS[index]}`);
      const androidUser = await launchAndroidUserViaAdb({
        hubGunUrl: lanHubUrl,
        deviceSerial: DEVICE_SERIALS[index],
      });
      androidUsers.push(androidUser);
      const name = `Matrix Android ${index + 1}`;
      const id = await bootstrapNativeWindow(androidUser.window, name, {
        waitForSupportGreeting: false,
        readinessTimeoutMs: 110_000,
        pinStableLocation: false,
        updateStageName: false,
      });
      const actualName = await androidUser.window.evaluate(() =>
        String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''),
      );
      users.push({ name: actualName || name, runtime: `Android:${DEVICE_SERIALS[index]}`, page: androidUser.window, id });
      console.log(`[matrix] ready: ${actualName || name} (${id})`);
    }

    const engines = [
      { name: 'Matrix Chrome', runtime: 'Chromium', launch: () => chromium.launch({ headless: true, args: WEBRTC_ARGS }) },
      { name: 'Matrix Safari', runtime: 'WebKit', launch: () => webkit.launch({ headless: true }) },
      { name: 'Matrix Firefox', runtime: 'Firefox', launch: () => firefox.launch({ headless: true }) },
    ];
    for (const engine of engines) {
      const browser = await engine.launch();
      browsers.push(browser);
      const browserUser = await bootstrapBrowserUserOnOrigin(
        browser,
        `http://127.0.0.1:${WEB_PORT}`,
        engine.name,
        engine.name,
        { waitForSupportGreeting: false },
      );
      browserClosers.push(browserUser.close);
      users.push({ name: engine.name, runtime: engine.runtime, page: browserUser.page, id: browserUser.userId });
    }

    expect(new Set(users.map((user) => user.id)).size).toBe(7);
    users.forEach(attachMatrixDiagnostics);

    await Promise.all(users.map((user) => runUserSetupStep(
      user,
      'joining Global',
      () => forceJoinGlobal(user.page),
    )));
    await Promise.all(users.map((user) => runUserSetupStep(
      user,
      'publishing public user',
      async () => publishPublicUserToHub(await readCurrentPublicUser(user.page)),
    )));

    await expect.poll(async () => {
      const memberIds = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId));
      return users.filter((user) => memberIds.has(user.id)).map((user) => user.runtime).sort();
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toEqual(users.map((user) => user.runtime).sort());

    const runId = `matrix-${Date.now()}`;
    const authored = new Map<MatrixUser, Awaited<ReturnType<typeof createTagTalkViaEditor>>>();
    for (const user of users) {
      console.log(`[matrix] authoring: ${user.runtime} (${user.name})`);
      // Physical WebViews share the Mac-hosted Gun relay with six other active runtimes;
      // allow their authoritative write acknowledgement more time than an in-process browser.
      authored.set(user, await createTagTalkViaEditor(
        user.page,
        { title: oneTagTalk(user.id, user.name, runId)[0].title, timeoutMs: 90_000 },
      ));
    }
    // Exercise the lower-memory C10 first; this is a cross-runtime matrix, not a 42-response
    // saturation test. Every runtime still authors and broadcasts exactly once.
    const broadcastOrder = [
      ...users.filter((user) => user.runtime.includes('PADC100013000534')),
      ...users.filter((user) => !user.runtime.includes('PADC100013000534')),
    ];
    for (const user of broadcastOrder) {
      console.log(`[matrix] broadcasting: ${user.runtime} (${user.name})`);
      await clickBroadcastUntilBulkAck(user.page, { minGunPeers: 1, minSent: 1 });
    }

    // Seven-node ring: each runtime completes one different runtime's talk, covering every
    // sender and receiver without turning this compatibility matrix into an all-to-all load test.
    for (let index = 0; index < users.length; index += 1) {
      const recipient = users[index];
      const author = users[(index + users.length - 1) % users.length];
      console.log(`[matrix] completing incoming talk: ${recipient.runtime} <- ${author.runtime}`);
      const incoming = authored.get(author);
      await completeTalksInAppByAnswerIds(recipient.page, (incoming ? [incoming] : []).map((talk) => ({
        talkId: talk.talkId,
        talkData: talk.talkData,
        // Real UI-generated tag ids are always fixed (`processTalkForm`'s tag branch,
        // ui-manager.ts) regardless of the script fixture's own semantic id.
        answerIds: ['a_0_match'],
        outcome: 'match' as const,
      })));
    }
    console.log('[matrix] seven-client exchange complete');

  });
});
