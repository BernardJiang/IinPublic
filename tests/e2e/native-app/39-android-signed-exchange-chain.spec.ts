/**
 * OPEN-108 on two real phones (J-GRAPH-01/02, tests/e2e/journeys/signed-exchange-chain-journey.ts):
 * phone A and phone B exchange a Talk and its matching answer through the app; each phone's own
 * event chain verifies and each holds the other's signed acknowledgement. Then phone A's app is
 * force-stopped, one of A's own chained events is rewritten in the node's radata (pulled and
 * pushed back with `run-as`, so a debuggable build), and the relaunched app's core reports the
 * break at that event's seq. Clears both phones' app data.
 *
 *   E2E_REAL_ANDROID_JOURNEYS=1 NATIVE_APP_ANDROID_SERIALS=<a>,<b> \
 *     npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/39-android-signed-exchange-chain.spec.ts
 */
import { expect, test } from '@playwright/test';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { bootstrapNativeWindow } from './helpers/native-app';
import { ANDROID_PACKAGE, closeAndroidUser, isAndroidDeviceReady, launchAndroidUserViaAdb, resetAndroidAppData, type AndroidUser } from './helpers/native-app-android';
import { tamperChainedEvent } from '../helpers/radisk-tamper';
import { waitForAppReady } from '../helpers/timing';
import { expectSignedExchange, expectTamperReported } from '../journeys/signed-exchange-chain-journey';
import { talkMatchChatJourney } from '../journeys/talk-match-chat-journey';
import { userId } from '../phone-path/phone-path-helpers';

const execFileAsync = promisify(execFile);
const RUN = process.env.E2E_REAL_ANDROID_JOURNEYS === '1';
const SERIALS = String(process.env.NATIVE_APP_ANDROID_SERIALS || '').split(',').map((serial) => serial.trim()).filter(Boolean);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const RADATA = 'files/node-data/radata';

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

const adb = (serial: string, args: string[], timeout = 30_000) =>
  execFileAsync('adb', ['-s', serial, ...args], { timeout, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });

/** Rewrite one of the device's own chained events in the stopped app's radata (`run-as`). */
async function tamperOnPhone(serial: string, deviceId: string): Promise<number> {
  const names = String((await adb(serial, ['shell', 'run-as', ANDROID_PACKAGE, 'ls', RADATA])).stdout)
    .split('\n').map((name) => name.trim()).filter(Boolean);
  const files: Array<{ name: string; text: string }> = [];
  for (const name of names) {
    const { stdout } = await adb(serial, ['exec-out', 'run-as', ANDROID_PACKAGE, 'cat', `${RADATA}/${name}`]);
    if (String(stdout).includes('local/ev')) files.push({ name, text: String(stdout) });
  }
  const tampered = tamperChainedEvent(files, { field: 'title', device: deviceId });
  if (!tampered) throw new Error(`tamper: no chained Talk event of device ${deviceId} in ${serial}'s radata (${names.length} files)`);
  const local = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-tamper-')), 'radata-file');
  fs.writeFileSync(local, tampered.text);
  const staged = '/data/local/tmp/iinpublic-tamper';
  await adb(serial, ['push', local, staged]);
  await adb(serial, ['shell', 'chmod', '644', staged]);
  await adb(serial, ['shell', 'run-as', ANDROID_PACKAGE, 'cp', staged, `${RADATA}/${tampered.file}`]);
  await adb(serial, ['shell', 'rm', '-f', staged]);
  const check = String((await adb(serial, ['exec-out', 'run-as', ANDROID_PACKAGE, 'cat', `${RADATA}/${tampered.file}`])).stdout);
  expect(check, 'the tampered file is what the phone now stores').toContain('HACKED ');
  return tampered.seq;
}

test.describe('Two real phones: signed exchange chain and tamper report (OPEN-108)', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_JOURNEYS=1 to run the physical-device journeys.');
  test.skip(SERIALS.length < 2, 'NATIVE_APP_ANDROID_SERIALS needs two phones.');

  const users: AndroidUser[] = [];
  test.afterAll(async () => {
    for (const user of users) await closeAndroidUser(user);
  });

  test('each phone proves the other\'s signed entry and ack; a tampered event is reported after restart', async () => {
    test.setTimeout(900_000);
    const [serialA, serialB] = SERIALS;
    for (const serial of [serialA!, serialB!]) test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
    await Promise.all([resetAndroidAppData(serialA!), resetAndroidAppData(serialB!)]);
    const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
    const actors = [];
    for (const [name, serial] of [['Alice', serialA!], ['Bob', serialB!]] as const) {
      const user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      users.push(user);
      await bootstrapNativeWindow(user.window, `chain-${name.toLowerCase()}`, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000 });
      actors.push({ id: `${name} (${serial})`, runtime: 'android-webview' as const, page: user.window });
    }
    const [alice, bob] = actors as [typeof actors[0], typeof actors[0]];
    const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

    await talkMatchChatJourney(alice, bob);
    await expectSignedExchange(alice, aliceId, bob, bobId, 180_000);

    await expectTamperReported(alice, async (deviceId) => {
      // Force-stop takes the WebView and the node's foreground service down together.
      await closeAndroidUser(users[0]);
      const seq = await tamperOnPhone(serialA!, deviceId);
      const relaunched = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serialA! });
      users[0] = relaunched;
      await waitForAppReady(relaunched.window, 150_000);
      expect(await userId(relaunched.window)).toBe(aliceId);
      return { page: relaunched.window, seq };
    });
  });
});
