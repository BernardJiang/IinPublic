import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const APP_A_PORT = 19121;
const APP_B_PORT = 19122;

test.describe('Native app: two Electron desktop apps on one machine', () => {
  let nativeA: NativeUser | undefined;
  let nativeB: NativeUser | undefined;
  let userDataDirA = '';
  let userDataDirB = '';

  test.afterEach(async () => {
    await nativeA?.app.close().catch(() => {});
    await nativeB?.app.close().catch(() => {});
    nativeA = undefined;
    nativeB = undefined;
    if (userDataDirA) fs.rmSync(userDataDirA, { recursive: true, force: true });
    if (userDataDirB) fs.rmSync(userDataDirB, { recursive: true, force: true });
  });

  test('both desktop app users keep isolated local nodes and appear together in Global', async () => {
    userDataDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-a-'));
    userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-b-'));

    nativeA = await launchNativeUser({
      localPort: APP_A_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir: userDataDirA,
    });
    nativeB = await launchNativeUser({
      localPort: APP_B_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir: userDataDirB,
    });

    const [userIdA, userIdB] = await Promise.all([
      bootstrapNativeWindow(nativeA.window, 'NativeDesktopA', { waitForSupportGreeting: false }),
      bootstrapNativeWindow(nativeB.window, 'NativeDesktopB', { waitForSupportGreeting: false }),
    ]);
    expect(userIdA).toBeTruthy();
    expect(userIdB).toBeTruthy();
    expect(userIdA).not.toBe(userIdB);

    const [electronUserDataA, electronUserDataB] = await Promise.all([
      nativeA.app.evaluate(({ app }) => app.getPath('userData')),
      nativeB.app.evaluate(({ app }) => app.getPath('userData')),
    ]);
    expect(electronUserDataA).toBe(userDataDirA);
    expect(electronUserDataB).toBe(userDataDirB);
    expect(electronUserDataA).not.toBe(electronUserDataB);

    await Promise.all([
      forceJoinGlobal(nativeA.window),
      forceJoinGlobal(nativeB.window),
    ]);

    await expect
      .poll(
        async () => {
          const names = (await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.stageName);
          return {
            appA: names.includes('NativeDesktopA'),
            appB: names.includes('NativeDesktopB'),
          };
        },
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ appA: true, appB: true });

    await expect(nativeA.window.locator('body')).toContainText('NativeDesktopB', { timeout: 30_000 });
    await expect(nativeB.window.locator('body')).toContainText('NativeDesktopA', { timeout: 30_000 });
  });
});
