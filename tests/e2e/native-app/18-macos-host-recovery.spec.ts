import { chromium, expect, test, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  forceJoinRoom,
  launchNativeUser,
  readRoomMembersFromHub,
  type NativeUser,
} from './helpers/native-app';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19181;
const FIREWALL_TARGET = '127.0.0.2';

async function waitForHubMarker(marker: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => {
    const response = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/test/export-snapshot`);
    return response.ok && JSON.stringify(await response.json()).includes(marker);
  }, { timeout, intervals: [250, 500, 1000] }).toBe(true);
}

/**
 * Run code in the app's window through the main process. Playwright's page target detaches on
 * system suspend and never re-attaches, while the window itself lives on (the main process sees
 * only power suspend/resume), so after a wake the page is reached this way.
 */
async function inAppWindow<T>(app: ElectronApplication, code: string): Promise<T> {
  return app.evaluate(({ BrowserWindow }, js) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win) throw new Error('the app has no window');
    return win.webContents.executeJavaScript(js, true);
  }, code) as Promise<T>;
}

/** Join a fresh room (retrying the join) until the hub lists this user in it. */
async function joinRoomSeenByHub(page: Page, userId: string, roomId: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => {
    await forceJoinRoom(page, roomId).catch(() => {});
    const members = await readRoomMembersFromHub(HUB_GUN_PORT, roomId).catch(() => []);
    return members.some((member) => member.userId === userId);
  }, { timeout, intervals: [1000, 2000, 4000] }).toBe(true);
}

async function writeMarker(page: Page, marker: string, attempt = 1): Promise<void> {
  await page.evaluate(async ({ id, n }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    // Under a shared root: the sharing policy (OPEN-91) keeps any other soul on the device.
    await app.gunService.put(`public/e2e-macos-host-recovery/${id}`, { id, attempt: n });
  }, { id: marker, n: attempt });
}

async function startFirewallIsolation(): Promise<() => Promise<void>> {
  const script = path.join(repoRoot, 'scripts', 'macos-pf-peer-isolation.sh');
  const child = spawn('bash', [script, FIREWALL_TARGET, String(HUB_GUN_PORT)], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errorOutput += chunk; });

  await expect.poll(() => {
    if (output.includes('READY')) return 'ready';
    if (child.exitCode != null) return `exit:${child.exitCode}:${errorOutput.trim()}`;
    return 'waiting';
  }, { timeout: 10_000, intervals: [50, 100, 250] }).toBe('ready');

  return async () => {
    if (child.exitCode == null) child.stdin.end('\n');
    await new Promise<void>((resolve, reject) => {
      if (child.exitCode != null) {
        if (child.exitCode === 0) resolve();
        else reject(new Error(`PF controller exited ${child.exitCode}: ${errorOutput}`));
        return;
      }
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`PF controller exited ${code}: ${errorOutput}`));
      });
    });
  };
}

test.describe('macOS host recovery', () => {
  test('native app preserves identity and reconnects after real host sleep/wake', async () => {
    test.skip(process.platform !== 'darwin', 'requires macOS');
    test.skip(process.env.E2E_REAL_MACOS_SLEEP_WAKE !== '1', 'set E2E_REAL_MACOS_SLEEP_WAKE=1');
    test.setTimeout(240_000);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-macos-sleep-'));
    let native: NativeUser | undefined;
    try {
      native = await launchNativeUser({
        localPort: APP_PORT,
        hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
        userDataDir,
      });
      native.app.process().once('exit', (code, signal) => {
        // eslint-disable-next-line no-console
        console.log(`[macos-sleep] app process exited code=${code} signal=${signal} at ${new Date().toISOString()}`);
      });
      await native.app.evaluate(({ app: a, BrowserWindow, powerMonitor }) => {
        const g = globalThis as any;
        g.__sleepEvents = [];
        const note = (e: string) => g.__sleepEvents.push(`${new Date().toISOString()} ${e}`);
        for (const ev of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'shutdown']) {
          powerMonitor.on(ev as any, () => note(`power ${ev}`));
        }
        a.on('before-quit', () => note('app before-quit'));
        a.on('window-all-closed', () => note('app window-all-closed'));
        a.on('render-process-gone', (_e, _w, d) => note(`render-process-gone ${d.reason} ${d.exitCode}`));
        a.on('child-process-gone', (_e, d) => note(`child-process-gone ${d.type} ${d.reason}`));
        for (const w of BrowserWindow.getAllWindows()) {
          w.on('close', () => note(`window ${w.id} close`));
          w.on('closed', () => note(`window ${w.id} closed`));
          w.webContents.on('destroyed', () => note(`webContents ${w.id} destroyed`));
          w.webContents.on('did-start-navigation', (_e, url) => note(`nav ${url}`));
        }
      });
      const userId = await bootstrapNativeWindow(native.window, 'MacSleepPeer', {
        waitForSupportGreeting: false,
      });
      await forceJoinGlobal(native.window);
      const originalPub = await native.window.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
      );
      expect(originalPub).toBeTruthy();

      // The desktop node reaches the hub by explicit HTTP calls only (DEFAULT_HUB_RELAY_MODE), so
      // no Gun write shows in the hub's snapshot; a room join is what the hub sees.
      await joinRoomSeenByHub(native.window, userId, `macos-before-sleep-${Date.now()}`);
      if (process.env.E2E_MACOS_SLEEP_DRY === '1') {
        // Same scenario with a 40 s wait in place of the sleep: separates the app from the sleep.
        await new Promise((resolve) => setTimeout(resolve, 40_000));
      } else {
        await execFileAsync('bash', [path.join(repoRoot, 'scripts', 'macos-sleep-wake-cycle.sh')], {
          cwd: repoRoot,
          timeout: 210_000,
        });
      }

      const storedPub = `(window.__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '')`;
      await expect.poll(() => inAppWindow<string>(native!.app, storedPub).catch(() => ''),
        { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(originalPub);
      const afterRoom = `macos-after-wake-${Date.now()}`;
      await expect.poll(async () => {
        await inAppWindow(native!.app, `(async () => {
          const app = window.__iinpublic_app?.getApp?.();
          const user = app?.currentUser;
          if (user?.id) await app.chatroomService?.switchChatroom?.(user.id, ${JSON.stringify(afterRoom)}, user.stageName);
        })()`).catch(() => {});
        const members = await readRoomMembersFromHub(HUB_GUN_PORT, afterRoom).catch(() => []);
        return members.some((member) => member.userId === userId);
      }, { timeout: 45_000, intervals: [1000, 2000, 4000] }).toBe(true);
    } finally {
      await native?.window.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.(),
      ).catch(() => {});
      // eslint-disable-next-line no-console
      console.log('[macos-sleep] main events:', JSON.stringify(
        await native?.app.evaluate(() => (globalThis as any).__sleepEvents).catch((e) => String(e)), null, 1));
      await native?.app.close().catch(() => {});
      if (native) {
        try { fs.copyFileSync(native.electronLogPath, test.info().outputPath('electron.log')); } catch { /* none */ }
      }
      // The app can still be flushing its profile just after close; never let cleanup mask the result.
      try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* temp dir */ }
    }
  });

  test('one loopback-addressed peer is isolated by PF while another continues, then reconnects', async () => {
    test.skip(process.platform !== 'darwin', 'requires macOS');
    test.skip(process.env.E2E_REAL_MACOS_FIREWALL !== '1', 'set E2E_REAL_MACOS_FIREWALL=1');
    test.setTimeout(180_000);
    // macOS puts only 127.0.0.1 on lo0; without the alias the isolated peer's page never loads.
    const lo0 = Object.values(os.networkInterfaces()).flat().some((i) => i?.address === FIREWALL_TARGET);
    expect(lo0, `${FIREWALL_TARGET} is not on lo0: run \`sudo ifconfig lo0 alias ${FIREWALL_TARGET} up\``).toBe(true);

    let browser: Browser | undefined;
    let stopFirewall: (() => Promise<void>) | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const healthy = await bootstrapBrowserUserOnOrigin(
        browser,
        `http://127.0.0.1:${WEB_PORT}`,
        'PF healthy peer',
        'PfHealthy',
        { waitForSupportGreeting: false },
      );
      const isolated = await bootstrapBrowserUserOnOrigin(
        browser,
        `http://${FIREWALL_TARGET}:${WEB_PORT}`,
        'PF isolated peer',
        'PfIsolated',
        { waitForSupportGreeting: false },
      );
      await Promise.all([forceJoinGlobal(healthy.page), forceJoinGlobal(isolated.page)]);
      expect(await isolated.page.evaluate(() => ({ secure: isSecureContext, subtle: !!crypto.subtle })))
        .toEqual({ secure: true, subtle: true });

      const isolatedPub = await isolated.page.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
      );
      stopFirewall = await startFirewallIsolation();

      const healthyMarker = `pf-healthy-${Date.now()}`;
      await writeMarker(healthy.page, healthyMarker);
      await waitForHubMarker(healthyMarker);

      const blockedMarker = `pf-blocked-${Date.now()}`;
      await writeMarker(isolated.page, blockedMarker);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const blockedSnapshot = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/test/export-snapshot`);
      expect(JSON.stringify(await blockedSnapshot.json())).not.toContain(blockedMarker);

      await stopFirewall();
      stopFirewall = undefined;
      await expect.poll(async () => {
        await writeMarker(isolated.page, blockedMarker, Date.now()).catch(() => {});
        const response = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/test/export-snapshot`);
        return response.ok && JSON.stringify(await response.json()).includes(blockedMarker);
      }, { timeout: 45_000, intervals: [500, 1000, 2000] }).toBe(true);
      expect(await isolated.page.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
      )).toBe(isolatedPub);

      await Promise.all([healthy.close(), isolated.close()]);
    } finally {
      await stopFirewall?.().catch(() => {});
      await browser?.close().catch(() => {});
    }
  });
});
