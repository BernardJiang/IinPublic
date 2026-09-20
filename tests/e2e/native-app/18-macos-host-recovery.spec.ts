import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
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

async function writeMarker(page: Page, marker: string, attempt = 1): Promise<void> {
  await page.evaluate(async ({ id, n }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    await app.gunService.put(`e2e/macos-host-recovery/${id}`, { id, attempt: n });
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
      const userId = await bootstrapNativeWindow(native.window, 'MacSleepPeer', {
        waitForSupportGreeting: false,
      });
      await forceJoinGlobal(native.window);
      const originalPub = await native.window.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
      );
      expect(originalPub).toBeTruthy();

      const beforeMarker = `before-sleep-${Date.now()}`;
      await writeMarker(native.window, beforeMarker);
      await waitForHubMarker(beforeMarker);
      await execFileAsync('bash', [path.join(repoRoot, 'scripts', 'macos-sleep-wake-cycle.sh')], {
        cwd: repoRoot,
        timeout: 210_000,
      });

      await expect.poll(
        () => native!.window.evaluate(
          () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
        ),
        { timeout: 30_000, intervals: [250, 500, 1000] },
      ).toBe(originalPub);
      const afterMarker = `after-wake-${Date.now()}`;
      await expect.poll(async () => {
        await writeMarker(native!.window, afterMarker, Date.now()).catch(() => {});
        const response = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/test/export-snapshot`).catch(() => null);
        return !!response?.ok && JSON.stringify(await response.json()).includes(afterMarker);
      }, { timeout: 45_000, intervals: [500, 1000, 2000] }).toBe(true);
      await expect.poll(async () => (await readGlobalMembersFromHub(HUB_GUN_PORT))
        .some((member) => member.userId === userId), { timeout: 30_000 }).toBe(true);
    } finally {
      await native?.window.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.(),
      ).catch(() => {});
      await native?.app.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('one loopback-addressed peer is isolated by PF while another continues, then reconnects', async () => {
    test.skip(process.platform !== 'darwin', 'requires macOS');
    test.skip(process.env.E2E_REAL_MACOS_FIREWALL !== '1', 'set E2E_REAL_MACOS_FIREWALL=1');
    test.setTimeout(180_000);

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
