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
  electronLogPath: string;
  crashDumpsDir: string;
};

export type LaunchNativeUserOptions = {
  localPort: number;
  hubGunUrl: string;
  userDataDir: string;
};

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const desktopRoot = path.join(repoRoot, 'platforms', 'desktop');
const webrtcLaunchArgs = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

type ElectronLaunchTarget = { executablePath: string; args: string[]; cwd?: string };

function assertPackagedDesktopMatchesCurrentBuild(packagedApp: string): void {
  const currentBuildPath = path.join(repoRoot, 'dist', 'web', 'build-id.json');
  const packagedBuildPath = path.join(
    packagedApp,
    'Contents',
    'Resources',
    'app',
    'dist',
    'web',
    'build-id.json',
  );
  const currentChecksumsPath = path.join(repoRoot, 'dist', 'web', 'SHA256SUMS');
  const packagedChecksumsPath = path.join(
    packagedApp,
    'Contents',
    'Resources',
    'app',
    'dist',
    'web',
    'SHA256SUMS',
  );
  const readBuildId = (filePath: string): string => {
    try {
      return String(JSON.parse(fs.readFileSync(filePath, 'utf8'))?.buildId || '');
    } catch {
      return '';
    }
  };
  const currentBuildId = readBuildId(currentBuildPath);
  const packagedBuildId = readBuildId(packagedBuildPath);
  const readChecksums = (filePath: string): string => {
    try { return fs.readFileSync(filePath, 'utf8').trim(); } catch { return ''; }
  };
  const currentChecksums = readChecksums(currentChecksumsPath);
  const packagedChecksums = readChecksums(packagedChecksumsPath);
  if (currentBuildId && packagedBuildId === currentBuildId
    && currentChecksums && packagedChecksums === currentChecksums) return;
  throw new Error(
    `Packaged desktop build is stale (current ${currentBuildId || 'missing'}, packaged ${packagedBuildId || 'missing'}, ` +
      `checksums ${currentChecksums === packagedChecksums ? 'match' : 'differ'}). ` +
      'Run "npm run desktop:dist:dir" before native-app tests.',
  );
}

/**
 * The raw dev Electron binary (platforms/desktop/node_modules/electron) is macOS's
 * official electron@31.7.7 release zip. Apple has since revoked that build's
 * notarization ticket — `codesign -dv` on a fresh extract reports "notarization
 * indicates this code has been revoked", and macOS's on-device XProtect/MRT scanner
 * deletes the app to Trash the moment it's executed (a "Malware Blocked and Moved to
 * Trash" dialog, not just a Gatekeeper first-launch prompt — re-signing the outer
 * bundle alone does not stop it, since the revoked ticket reference lives in the
 * bundled Electron Framework/Helper binaries too). Prefer the already-built,
 * already ad-hoc-signed packaged app (platforms/desktop/dist/mac-arm64/IinPublic.app,
 * built + fully re-signed via afterPack.js's `codesign --force --deep`) when one
 * exists — `codesign -dv` on that bundle shows a clean adhoc signature with no
 * revoked-notarization reference. Falls back to the raw dev binary (`electron .`)
 * otherwise, which still works on machines where XProtect hasn't flagged this build.
 */
function resolveElectronLaunchTarget(): ElectronLaunchTarget {
  const explicitExecutable = String(process.env.IINPUBLIC_DESKTOP_EXECUTABLE || '').trim();
  if (explicitExecutable) {
    if (!fs.existsSync(explicitExecutable)) {
      throw new Error(`IINPUBLIC_DESKTOP_EXECUTABLE does not exist: ${explicitExecutable}`);
    }
    return { executablePath: explicitExecutable, args: [...webrtcLaunchArgs] };
  }
  if (process.platform === 'darwin') {
    const packagedAppRoot = path.join(desktopRoot, 'dist', 'mac-arm64', 'IinPublic.app');
    const packagedApp = path.join(packagedAppRoot, 'Contents', 'MacOS', 'IinPublic');
    if (fs.existsSync(packagedApp)) {
      assertPackagedDesktopMatchesCurrentBuild(packagedAppRoot);
      return { executablePath: packagedApp, args: [...webrtcLaunchArgs] };
    }
  }
  if (process.platform === 'win32') {
    const packagedApp = path.join(desktopRoot, 'dist', 'win-unpacked', 'IinPublic.exe');
    if (fs.existsSync(packagedApp)) {
      return { executablePath: packagedApp, args: [...webrtcLaunchArgs] };
    }
  }
  const electronDist = path.join(desktopRoot, 'node_modules', 'electron', 'dist');
  const platformExecutable =
    process.platform === 'darwin'
      ? path.join(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
      : process.platform === 'win32'
        ? path.join(electronDist, 'electron.exe')
        : path.join(electronDist, 'electron');
  if (fs.existsSync(platformExecutable)) {
    return { executablePath: platformExecutable, args: [...webrtcLaunchArgs, '.'], cwd: desktopRoot };
  }
  throw new Error(
    `No Electron executable found (checked packaged output and ${platformExecutable}). ` +
      'Run "npm run desktop:dist" (packaged) or "cd platforms/desktop && npm install" (dev binary).',
  );
}

export async function launchNativeUser(options: LaunchNativeUserOptions): Promise<NativeUser> {
  fs.mkdirSync(options.userDataDir, { recursive: true });

  const target = resolveElectronLaunchTarget();
  const electronLogPath = path.join(options.userDataDir, 'electron.log');
  const app = await electron.launch({
    executablePath: target.executablePath,
    // --use-mock-keychain keeps safeStorage off the login Keychain: the ad-hoc-signed app
    // otherwise blocks on a macOS "IinPublic Safe Storage" prompt at boot until someone clicks.
    args: [...target.args, '--use-mock-keychain', '--enable-logging=file', `--log-file=${electronLogPath}`],
    ...(target.cwd ? { cwd: target.cwd } : {}),
    env: {
      ...process.env,
      // The shared hub webServer is memory-only, but the embedded app node must
      // still dial it. Do not inherit the Playwright/hub isolation switches.
      E2E_GUN_MEMORY_ONLY: '0',
      DEV_GUN_FRESH: '0',
      IINPUBLIC_LOCAL_PORT: String(options.localPort),
      IINPUBLIC_HUB_GUN_URL: options.hubGunUrl,
      IINPUBLIC_USER_DATA_DIR: options.userDataDir,
      // Keep native E2E profiles isolated from unrelated mDNS-advertised nodes.
      IINPUBLIC_LAN_DISCOVERY_ENABLED: '0',
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
  const window = await app.firstWindow();
  const crashDumpsDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('crashDumps'));
  return {
    app,
    window,
    localPort: options.localPort,
    userDataDir: options.userDataDir,
    electronLogPath,
    crashDumpsDir,
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
      // Gun acknowledgements can remain pending on an established physical
      // device while its local graph is hydrating. This publish is best-effort
      // setup; the matrix follows it with a bounded HTTP publish and verifies
      // the hub's complete member set before authoring any talks.
      await Promise.race([
        Promise.resolve(app.userService.syncPublicUserForRelay(user)).catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
      ]);
    }
    const apiBase = app.getBackendApiBase?.();
    if (!apiBase) return;
    await Promise.race([
      fetch(`${apiBase}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      }).catch(() => undefined),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
    ]);
  });
}

async function dismissAutomaticWalkthroughForBootstrap(page: Page): Promise<void> {
  const modal = page.locator('[data-testid="walkthrough-modal"]');
  if (!(await modal.isVisible().catch(() => false))) return;
  // A freshly installed Android WebView can keep the introduction card moving while its
  // map/location layer settles. Playwright's pointer click then waits forever for a "stable"
  // bounding box even though the real close button and listener are already present. Trigger the
  // button's ordinary DOM click through the authenticated CDP connection; this exercises the same
  // listener without weakening actionability checks in product-facing UI tests.
  await page.locator('[data-testid="walkthrough-close-btn"]').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(modal).toHaveCount(0);
}

/**
 * Production bundles (build:embedded) have no simulated GPS, so web and desktop users get a random
 * city plus a one-time "choose your location" picker that covers the nav. Cancel keeps the random point.
 */
async function dismissLocationPickerForBootstrap(page: Page): Promise<void> {
  const picker = page.locator('[data-testid="encounter-location-modal"]');
  if (!(await picker.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false))) return;
  await page.locator('#encounter-location-cancel').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(picker).toHaveCount(0);
}

async function dismissBootstrapOverlays(page: Page): Promise<void> {
  // The location picker is appended above the walkthrough, and on slower phones it can appear a
  // moment after app-ready. Recheck it after closing the walkthrough so no late first-run overlay
  // intercepts the first navigation click.
  await dismissLocationPickerForBootstrap(page);
  await dismissAutomaticWalkthroughForBootstrap(page);
  await dismissLocationPickerForBootstrap(page);
}

export async function bootstrapNativeWindow(
  page: Page,
  stageName: string,
  options: {
    waitForSupportGreeting?: boolean;
    readinessTimeoutMs?: number;
    pinStableLocation?: boolean;
    updateStageName?: boolean;
  } = {},
): Promise<string> {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 45_000;
  await expect(page.locator('body')).not.toContainText('Connecting to IinPublic network...', { timeout: readinessTimeoutMs });
  await waitForAppReady(page, readinessTimeoutMs);
  // The first-run location picker is appended after the walkthrough and therefore sits above it.
  // Dismiss the topmost modal first; otherwise its map canvas intercepts the walkthrough's close
  // button and every fresh-install native test stalls before it reaches its actual scenario.
  await dismissBootstrapOverlays(page);
  if (options.updateStageName !== false) {
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.nav-btn[data-view="settings"]')?.click();
    });
    await afterNav();
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
        app?.uiManager?.renderSettingsView?.(app.currentUser);
        document
          .querySelector<HTMLElement>('.settings-jump-menu-item[data-target="settings-section-profile"]')
          ?.click();
      }).catch(() => {});
    }
    await page.waitForSelector('#settings-stage-name-input', { timeout: E2E_ASSERT_TIMEOUT_MS });
    await page.fill('#settings-stage-name-input', stageName);
    // This helper prepares a peer; the Settings form itself has broad browser coverage.
    // Invoke the same authoritative callback directly so Playwright can await and retry the
    // asynchronous Gun write. `locator.blur()` only waits for DOM dispatch, not the async
    // change listener, and a transient write failure used to leave the matrix polling the old
    // random name for the entire 110-second readiness budget with no useful error detail.
    let updated = false;
    let lastUpdateError = '';
    for (let attempt = 0; attempt < 4 && !updated; attempt += 1) {
      const outcome = await page.evaluate(async (nextStageName) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (!app?.currentUser?.id || !app?.uiManager?.onStageNameChange) {
          return { ok: false, error: 'stage-name callback unavailable' };
        }
        try {
          await app.uiManager.onStageNameChange(app.currentUser.id, nextStageName);
          return { ok: app.currentUser.stageName === nextStageName, error: '' };
        } catch (error) {
          const detail = error instanceof Error
            ? `${error.name}: ${error.message}`
            : (() => {
                try { return JSON.stringify(error); } catch { return String(error); }
              })();
          return { ok: false, error: detail };
        }
      }, stageName);
      updated = outcome.ok;
      lastUpdateError = outcome.error;
      if (!updated) await page.waitForTimeout(500 * (attempt + 1));
    }
    if (!updated) {
      throw new Error(`Native stage-name update failed for "${stageName}": ${lastUpdateError || 'unknown error'}`);
    }
    await afterNav();
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
        { timeout: Math.max(E2E_ASSERT_TIMEOUT_MS, readinessTimeoutMs) },
      )
      .toBe(stageName);
  }
  await publishCurrentPublicUserForRelay(page);
  // Settings can re-render while the asynchronous public-user publish settles. On physical
  // WebViews that can keep the bottom bar's bounding box moving long enough for Playwright's
  // pointer-stability guard to time out. Bootstrap only needs the production listener to run;
  // pointer/actionability behavior remains covered by the UI-specific navigation specs.
  await page.locator('.nav-btn[data-view="chatrooms"]').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await afterNav();
  if (options.pinStableLocation !== false) await pinStableE2eLocation(page);
  // Entering Chatrooms is what requests an encounter location on a new profile, so the picker can
  // legitimately be created after the earlier first-run cleanup.
  await dismissLocationPickerForBootstrap(page);
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
  await dismissBootstrapOverlays(page);
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
  await page.locator('.nav-btn[data-view="chatrooms"]').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await afterNav();
  await pinStableE2eLocation(page);
  await dismissLocationPickerForBootstrap(page);
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

export async function readRoomMembersFromHub(
  hubPort: number,
  roomId: string,
): Promise<Array<{ userId: string; stageName: string }>> {
  return new Promise((resolve, reject) => {
    const requestPath = `/api/chatrooms/${encodeURIComponent(roomId)}/members`;
    const req = http.get({ host: '127.0.0.1', port: hubPort, path: requestPath, timeout: 1500 }, (res) => {
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
      reject(new Error(`GET ${requestPath} on hub port ${hubPort} timed out`));
    });
  });
}

export async function readGlobalMembersFromHub(hubPort: number): Promise<Array<{ userId: string; stageName: string }>> {
  return readRoomMembersFromHub(hubPort, 'global');
}

export async function forceJoinGlobal(page: Page): Promise<void> {
  // Use the production ordered room transition so the visible room, chatroom service, active-room
  // state machine, presence, nearby radios, and mesh all agree. The old helper mutated only the
  // first two, which correctly caused room-bound mailbox bodies to fail closed in OPEN-37 tests.
  await forceJoinRoom(page, 'global');
  await page.evaluate(async () => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser;
    if (!app || !user?.id) return;
    const apiBase = app.getBackendApiBase?.();
    if (apiBase) {
      await Promise.race([
        fetch(`${apiBase}/api/chatrooms/global/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, stageName: user.stageName }),
        }).catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
      ]);
    }
  });
}

/**
 * Move a bootstrapped native user through the production one-active-room transition instead of
 * mutating only the visible room id. OPEN-37 hardware tests use this for opaque synthetic rooms
 * that are intentionally absent from the navigation tree.
 */
export async function forceJoinRoom(page: Page, roomId: string): Promise<void> {
  await publishCurrentPublicUserForRelay(page);
  await page.evaluate(async (nextRoomId) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser;
    if (!app || !user?.id || !nextRoomId) return;
    await app.chatroomService?.switchChatroom?.(user.id, nextRoomId, user.stageName);
    app.currentChatroomId = nextRoomId;
    localStorage.setItem('iinpublic_last_chatroom', nextRoomId);
    app.uiManager?.setCurrentChatroomId?.(nextRoomId);
    app.chatroomService?.subscribeToMembers?.(nextRoomId, (members: Array<{ userId: string; stageName: string }>) => {
      if (app.currentChatroomId !== nextRoomId) return;
      // Same per-update work as the app's own room callbacks: this one replaces them (single slot),
      // and without the roster the Nearby discovery policy keeps a phone that joined first alone.
      app.harvestRosterEpubs?.(members);
      app.observeNearbyRoomRoster?.(nextRoomId, members);
      app.uiManager?.updateChatroomMembers?.(members, user.id);
      app.syncPeerMeshRoom?.(nextRoomId, members);
    });
    // Surface a failed signed-manifest bootstrap to the physical test instead of letting
    // activateRoomExchange's user-facing catch turn it into a later, opaque room-state timeout.
    await app.ensureProtocolManifestController?.();
    // Manual room selection ends by activating the room's exchange (app.ts `chatroomChanged`);
    // without it the receiver rejects every Talk body as outside its active room.
    await app.activateRoomExchange?.(nextRoomId);
  }, roomId);
  await refreshRoomMembership(page, roomId);
  await expect.poll(
    () => page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return {
        app: String(app?.currentChatroomId || ''),
        chatroom: String(app?.chatroomService?.getCurrentChatroomId?.() || ''),
        mesh: String(app?.peerMeshService?.getDiagnostics?.()?.roomId || ''),
        exchange: String(app?.activeExchangeRoomController?.getActiveRoom?.()?.roomId || ''),
      };
    }),
    { timeout: 30_000, message: `native user should activate room ${roomId}` },
  ).toEqual({ app: roomId, chatroom: roomId, mesh: roomId, exchange: roomId });
}

/** Renew a synthetic room's ordinary membership lease without restarting its exchange. */
export async function refreshRoomMembership(page: Page, roomId: string): Promise<void> {
  await page.evaluate(async (currentRoomId) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser;
    const apiBase = app?.getBackendApiBase?.();
    if (!apiBase || !user?.id) throw new Error('room membership renewal requires an active user and API');
    const response = await Promise.race([
      fetch(`${apiBase}/api/chatrooms/${encodeURIComponent(currentRoomId)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, stageName: user.stageName }),
      }),
      new Promise<Response>((_, reject) => window.setTimeout(
        () => reject(new Error(`room membership POST timed out for ${currentRoomId}`)),
        10_000,
      )),
    ]);
    if (!response.ok) throw new Error(`room membership POST failed: ${response.status}`);
  }, roomId);
}

/**
 * Nearby v3 (design §3.7): move the phone to `location` and wait until it is in Nearby — its own
 * list, with no hub roster to join (`forceJoinRoom` would write one). Returns the scope id.
 */
export async function enterNearbyAt(
  page: Page,
  location: { latitude: number; longitude: number; accuracy: number; timestamp: string | number | Date },
): Promise<string> {
  await page.evaluate(async (point) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.currentUser?.id) throw new Error('app user unavailable');
    await app.updateLocationAndMaybeSwitch({ ...point, timestamp: new Date(point.timestamp) });
  }, { ...location, timestamp: new Date(location.timestamp).toISOString() });
  await expect.poll(
    () => page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '')),
    { timeout: 30_000, message: 'phone should be in Nearby' },
  ).toBe('nearby-v3');
  return 'nearby-v3';
}

/** The user ids on this phone's Nearby list (§3.7: each phone's own list, not a room roster). */
export function nearbyListIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const runtime = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3;
    return (runtime?.service.entries() ?? []).map((entry: { card: { userId: string } }) => String(entry.card.userId));
  });
}
