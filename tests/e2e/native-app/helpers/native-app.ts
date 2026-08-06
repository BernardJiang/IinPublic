import { _electron as electron, expect, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { gotoWebApp, injectIdbClear } from '../../helpers/clear-database';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { afterLoad, afterNav, E2E_ASSERT_TIMEOUT_MS, waitForAppReady } from '../../helpers/timing';
import { expectTechSupportGreetingReceived, pinStableE2eLocation } from '../../helpers/talks-matching-flow';
import { openSettingsSection } from '../../helpers/settings-nav';

export type NativeUser = {
  app: ElectronApplication;
  window: Page;
  localPort: number;
  userDataDir: string;
};

export type LaunchNativeUserOptions = {
  localPort: number;
  hubGunUrl: string;
  userDataDir: string;
};

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const desktopRoot = path.join(repoRoot, 'platforms', 'desktop');
const webrtcLaunchArgs = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

function resolveElectronExecutable(): string {
  const electronDist = path.join(desktopRoot, 'node_modules', 'electron', 'dist');
  const platformExecutable =
    process.platform === 'darwin'
      ? path.join(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
      : process.platform === 'win32'
        ? path.join(electronDist, 'electron.exe')
        : path.join(electronDist, 'electron');
  if (fs.existsSync(platformExecutable)) return platformExecutable;
  throw new Error(`Electron executable not found at ${platformExecutable}. Run "cd platforms/desktop && npm install".`);
}

export async function launchNativeUser(options: LaunchNativeUserOptions): Promise<NativeUser> {
  fs.mkdirSync(options.userDataDir, { recursive: true });

  const app = await electron.launch({
    executablePath: resolveElectronExecutable(),
    args: [...webrtcLaunchArgs, '.'],
    cwd: desktopRoot,
    env: {
      ...process.env,
      // The shared hub webServer is memory-only, but the embedded app node must
      // still dial it. Do not inherit the Playwright/hub isolation switches.
      E2E_GUN_MEMORY_ONLY: '0',
      DEV_GUN_FRESH: '0',
      IINPUBLIC_LOCAL_PORT: String(options.localPort),
      IINPUBLIC_HUB_GUN_URL: options.hubGunUrl,
      IINPUBLIC_USER_DATA_DIR: options.userDataDir,
    },
  });
  const window = await app.firstWindow();
  return {
    app,
    window,
    localPort: options.localPort,
    userDataDir: options.userDataDir,
  };
}

export function httpGetStatus(port: number, requestPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: requestPath, timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET ${requestPath} on native port ${port} timed out`));
    });
  });
}

async function publishCurrentPublicUserForRelay(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser;
    if (!app || !user?.id) return;
    const pair = app.gunService?.getStoredPair?.();
    if (pair?.pub) user.pub = pair.pub;
    if (pair?.epub) user.epub = pair.epub;
    if (app.userService?.syncPublicUserForRelay) {
      await app.userService.syncPublicUserForRelay(user);
    }
    const apiBase = app.getBackendApiBase?.();
    if (!apiBase) return;
    await fetch(`${apiBase}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    }).catch(() => undefined);
  });
}

export async function bootstrapNativeWindow(
  page: Page,
  stageName: string,
  options: { waitForSupportGreeting?: boolean } = {},
): Promise<string> {
  await expect(page.locator('body')).not.toContainText('Connecting to IinPublic network...', { timeout: 45_000 });
  await waitForAppReady(page, 45_000);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.nav-btn[data-view="settings"]')?.click();
  });
  await afterNav();
  // Settings is a drill-down (menu list first); the profile section's controls (including
  // #settings-stage-name-input below) only render visible once its menu item is opened.
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('.settings-jump-menu-item[data-target="settings-section-profile"]')
      ?.click();
  });
  await afterNav();
  if (!(await page.locator('#settings-stage-name-input').isVisible().catch(() => false))) {
    await page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
      document.querySelector<HTMLElement>('.nav-btn[data-view="settings"]')?.classList.add('active');
      document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.remove('active'));
      document.getElementById('settings-view')?.classList.add('active');
      const headerTitle = document.getElementById('header-title');
      if (headerTitle) headerTitle.textContent = '';
      const headerActions = document.getElementById('header-actions');
      if (headerActions) {
        headerActions.style.display = 'flex';
        headerActions.style.visibility = 'hidden';
      }
      app?.uiManager?.renderSettingsView?.(app.currentUser);
      document
        .querySelector<HTMLElement>('.settings-jump-menu-item[data-target="settings-section-profile"]')
        ?.click();
    }).catch(() => {});
  }
  await page.waitForSelector('#settings-stage-name-input', { timeout: E2E_ASSERT_TIMEOUT_MS });
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  await publishCurrentPublicUserForRelay(page);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await pinStableE2eLocation(page);
  if (options.waitForSupportGreeting !== false) {
    await expectTechSupportGreetingReceived(page, stageName);
  }
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
}

export async function bootstrapBrowserUserOnOrigin(
  browser: Browser,
  baseURL: string,
  label: string,
  stageName: string,
  options: { waitForSupportGreeting?: boolean } = {},
): Promise<{ page: Page; userId: string; close: () => Promise<void> }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await injectIdbClear(page);
  const params = new URLSearchParams({
    e2e_capacity: '50',
    e2e_fifo: 'false',
    e2e_p0_talks: '1',
    e2e_mesh_talks: '1',
  });
  await gotoWebApp(page, `${baseURL}/?${params.toString()}`);
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await openSettingsSection(page, 'settings-section-profile');
  await page.waitForSelector('#settings-stage-name-input', { timeout: E2E_ASSERT_TIMEOUT_MS });
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  await publishCurrentPublicUserForRelay(page);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await pinStableE2eLocation(page);
  if (options.waitForSupportGreeting !== false) {
    await expectTechSupportGreetingReceived(page, stageName);
  }
  attachE2eBrowserTabLabel(page, label);
  const userId = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
  return {
    page,
    userId,
    close: async () => {
      await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await context.close();
    },
  };
}

export async function readGlobalMembersFromHub(hubPort: number): Promise<Array<{ userId: string; stageName: string }>> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: hubPort, path: '/api/chatrooms/global/members', timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`hub members returned ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET /api/chatrooms/global/members on hub port ${hubPort} timed out`));
    });
  });
}

export async function forceJoinGlobal(page: Page): Promise<void> {
  await publishCurrentPublicUserForRelay(page);
  await page.evaluate(async () => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser;
    if (!app || !user?.id) return;
    await app.chatroomService?.joinChatroom?.('global', user.id, user.stageName);
    const apiBase = app.getBackendApiBase?.();
    if (apiBase) {
      await fetch(`${apiBase}/api/chatrooms/global/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, stageName: user.stageName }),
      }).catch(() => undefined);
    }
    app.currentChatroomId = 'global';
    app.uiManager?.setCurrentChatroomId?.('global');
    app.chatroomService?.subscribeToMembers?.('global', (members: Array<{ userId: string; stageName: string }>) => {
      app.uiManager?.updateChatroomMembers?.(members, user.id);
      app.syncPeerMeshRoom?.('global', members);
    });
  });
}
