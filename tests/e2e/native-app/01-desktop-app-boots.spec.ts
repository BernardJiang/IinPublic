import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { httpGetStatus, launchNativeUser, type NativeUser } from './helpers/native-app';

const LOCAL_PORT = 19110;
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');

test.describe('Native app: Electron desktop boot', () => {
  let native: NativeUser | undefined;
  let userDataDir = '';

  test.afterEach(async () => {
    await native?.app.close().catch(() => {});
    native = undefined;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('boots a desktop app with isolated userData and serves the embedded SPA', async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-e2e-'));
    native = await launchNativeUser({
      localPort: LOCAL_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });

    await expect(native.window).toHaveURL(`http://127.0.0.1:${LOCAL_PORT}/`);
    await expect(native.window.locator('body')).not.toContainText('Connecting to IinPublic network...', {
      timeout: 45_000,
    });
    await expect(native.window.locator('#app')).toBeVisible();

    await expect.poll(() => httpGetStatus(LOCAL_PORT, '/health'), { timeout: 15_000 }).toBe(200);
    await expect.poll(() => httpGetStatus(LOCAL_PORT, '/worker.js'), { timeout: 15_000 }).toBe(200);
    await expect.poll(() => httpGetStatus(LOCAL_PORT, '/node_modules/gun/gun.js'), { timeout: 15_000 }).toBe(200);

    const electronUserData = await native.app.evaluate(({ app }) => app.getPath('userData'));
    expect(electronUserData).toBe(userDataDir);
    expect(fs.existsSync(path.join(userDataDir, 'node-data'))).toBe(true);
  });
});
