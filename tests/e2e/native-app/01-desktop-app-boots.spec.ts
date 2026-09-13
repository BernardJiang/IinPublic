import { test, expect, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { httpGetStatus, launchNativeUser, type NativeUser } from './helpers/native-app';

const LOCAL_PORT = 19110;
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');

test.describe('Native app: Electron desktop boot', () => {
  let native: NativeUser | undefined;
  let userDataDir = '';

  async function attachDesktopDiagnostics(testInfo: TestInfo): Promise<void> {
    const logPath = native?.electronLogPath || path.join(userDataDir, 'electron.log');
    if (fs.existsSync(logPath)) {
      await testInfo.attach('electron.log', { path: logPath, contentType: 'text/plain' });
    }

    const crashDir = native?.crashDumpsDir || path.join(userDataDir, 'Crashpad');
    if (!fs.existsSync(crashDir)) return;
    const pending = [crashDir];
    let attached = 0;
    while (pending.length > 0 && attached < 10) {
      const current = pending.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else {
          await testInfo.attach(`electron-crash-${attached}-${entry.name}`, { path: entryPath });
          attached += 1;
          if (attached >= 10) break;
        }
      }
    }
  }

  test.afterEach(async ({}, testInfo) => {
    await native?.app.close().catch(() => {});
    await attachDesktopDiagnostics(testInfo);
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

    await expect(native.window).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${LOCAL_PORT}/\\?`));
    await expect(native.window.locator('body')).not.toContainText('Connecting to IinPublic network...', {
      timeout: 45_000,
    });
    await expect(native.window.locator('#app')).toBeVisible();

    const startup = await native.window.evaluate(() => {
      const nativeMetrics = (window as any).iinpublicNative?.startup;
      const query = new URL(window.location.href).searchParams;
      return {
        nativeMetrics,
        queryLaunch: Number(query.get('perf_process_launch_ms')),
        queryNodeReady: Number(query.get('perf_node_health_ready_ms')),
      };
    });
    expect(startup.nativeMetrics.processLaunchEpochMs).toBeGreaterThan(0);
    expect(startup.nativeMetrics.nodeHealthReadyEpochMs).toBeGreaterThanOrEqual(
      startup.nativeMetrics.processLaunchEpochMs,
    );
    expect(startup.queryLaunch).toBe(startup.nativeMetrics.processLaunchEpochMs);
    expect(startup.queryNodeReady).toBe(startup.nativeMetrics.nodeHealthReadyEpochMs);

    await expect.poll(() => httpGetStatus(LOCAL_PORT, '/health'), { timeout: 15_000 }).toBe(200);
    await expect.poll(() => httpGetStatus(LOCAL_PORT, '/worker.js'), { timeout: 15_000 }).toBe(200);
    await expect.poll(() => httpGetStatus(LOCAL_PORT, '/node_modules/gun/gun.js'), { timeout: 15_000 }).toBe(200);

    const electronUserData = await native.app.evaluate(({ app }) => app.getPath('userData'));
    expect(electronUserData).toBe(userDataDir);
    expect(fs.existsSync(path.join(userDataDir, 'node-data'))).toBe(true);
  });
});
