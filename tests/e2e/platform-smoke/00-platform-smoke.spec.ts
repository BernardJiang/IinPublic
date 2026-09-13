/**
 * Platform smoke set (@smoke) — catalog Part 6 / TODO item G.
 *
 * A compact, single-browser pass that runs on desktop (chromium project) and on
 * the mobile device-profile projects (iphone-webkit, android-chromium) when
 * E2E_DEVICE_PROFILES=1. Covers the cross-platform-invariant surface:
 *   - tab sweep with no horizontal clipping (T2/T7)
 *   - AppBar ⋯ overflow reachability (T1/T2)
 *   - a full-screen-takeover dialog opens and closes (§8)
 *   - settings persistence across a reload (R2/R4)
 *
 * The two-user match round-trip and cross-platform presence live in the
 * cross-platform harness (X1/X2) and native-app suites — this file is the part
 * that is meaningful on a single emulated device.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../helpers/timing';
import { webBaseURL } from '../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

const VIEWS = ['chatrooms', 'contacts', 'talks', 'me', 'settings'];

test.describe('@smoke platform smoke set', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    // test:all runs this (webkit + firefox, PW_WORKERS=1) inside wave 2 alongside several
    // other concurrent phases (mesh-batch/mesh-isolated/find-similar/isolated/heavy-staged)
    // sharing the same machine — the default 10s app-ready budget is tuned for an
    // uncontended run and has been observed to time out under that shared load even though
    // this spec itself is lightweight (see the identical "oversubscribed" rationale on
    // waitForAppReady in helpers/timing.ts). 30s matches the precedent already used by
    // other concurrency-sensitive specs (00k-capacity-regional-spread.spec.ts,
    // lan-browser-participant.spec.ts) — an upper bound, not a fixed wait, so it doesn't
    // slow down the fast/uncontended path (chromium in the light wave, device profiles).
    await gotoWebApp(page, webBaseURL(), 30_000);
    await afterLoad();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('tab sweep, overflow, dialog takeover, settings persistence', async () => {
    const p = page!;

    // Tab sweep — no horizontal clipping, bottom nav present.
    for (const view of VIEWS) {
      await p.locator(`.nav-btn[data-view="${view}"]`).click({ timeout: 30_000 });
      await afterNav();
      await expect(p.locator(`#${view}-view`)).toBeVisible({ timeout: 15000 });
      await expect(p.locator('.bottom-nav')).toBeVisible();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `view ${view} overflow`).toBeLessThanOrEqual(2);
    }

    // ⋯ overflow reachability: the create-talk action is reachable inline or via ⋯.
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    const createInline = await p.locator('[data-testid="create-talk-btn"]:visible').count();
    const overflowBtn = p.locator('[data-testid="app-bar-overflow-btn"]:visible');
    if (createInline === 0 && (await overflowBtn.count())) {
      await overflowBtn.first().click();
      await afterNav();
      expect(
        await p.locator('[data-testid="create-talk-btn-overflow"], [data-testid="create-talk-btn"]').count(),
      ).toBeGreaterThan(0);
      await p.keyboard.press('Escape').catch(() => {});
    }

    // A full-screen-takeover dialog (Talk Editor, size-xl) opens and closes.
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog?.());
    await afterNav();
    await expect(p.locator('#talk-editor-modal')).toBeVisible({ timeout: 8000 });
    await p.locator('#cancel-talk-btn').click();
    await afterNav();
    await expect(p.locator('#talk-editor-modal')).toHaveCount(0);

    // Settings persistence across reload: toggle the grammar filter, reload, verify.
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await p.waitForSelector('#settings-grammar-filter');
    const grammar = p.locator('#settings-grammar-filter');
    const was = await grammar.isChecked();
    await grammar.click();
    await grammar.dispatchEvent('change');
    await afterSync();
    await p.reload();
    await afterLoad();
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await p.waitForSelector('#settings-grammar-filter');
    await expect(p.locator('#settings-grammar-filter')).toBeChecked({ checked: !was });
  });

  test('HTTP, WebSocket, localStorage, IndexedDB, and Gun work together', async () => {
    const p = page!;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const network = await p.evaluate(async () => {
      const webPort = Number(window.location.port || (window.location.protocol === 'https:' ? '443' : '80'));
      const gunPort = webPort - 3001 + 8080;
      const healthUrl = `${window.location.protocol}//${window.location.hostname}:${gunPort}/health`;
      const websocketUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:${gunPort}/gun`;

      const response = await fetch(healthUrl, { cache: 'no-store' });
      const websocketOpened = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(websocketUrl);
        const timeoutId = window.setTimeout(() => {
          socket.close();
          resolve(false);
        }, 5_000);
        socket.addEventListener('open', () => {
          window.clearTimeout(timeoutId);
          socket.close();
          resolve(true);
        }, { once: true });
        socket.addEventListener('error', () => {
          window.clearTimeout(timeoutId);
          resolve(false);
        }, { once: true });
      });

      return { healthOk: response.ok, websocketOpened };
    });
    expect(network).toEqual({ healthOk: true, websocketOpened: true });

    await p.evaluate(async (id) => {
      localStorage.setItem('iinpublic-e2e-browser-compat', id);

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('iinpublic-e2e-browser-compat', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('checks');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('checks', 'readwrite');
          transaction.objectStore('checks').put(id, 'run-id');
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      });

      const app = (window as any).__iinpublic_app?.getApp?.();
      if (!app?.gunService) throw new Error('IinPublic Gun service is unavailable');
      await app.gunService.put(`e2e/browser-compat/${id}`, { id, writtenAt: Date.now() });
    }, runId);

    await p.reload();
    await afterLoad();

    const persisted = await p.evaluate(async (id) => {
      const indexedDbValue = await new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('iinpublic-e2e-browser-compat', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('checks', 'readonly');
          const getRequest = transaction.objectStore('checks').get('run-id');
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            database.close();
            resolve(String(getRequest.result || ''));
          };
        };
      });

      const app = (window as any).__iinpublic_app?.getApp?.();
      const gunValue = await app?.gunService?.get?.(`e2e/browser-compat/${id}`);
      return {
        localStorageValue: localStorage.getItem('iinpublic-e2e-browser-compat'),
        indexedDbValue,
        gunValueId: String(gunValue?.id || ''),
      };
    }, runId);

    expect(persisted).toEqual({
      localStorageValue: runId,
      indexedDbValue: runId,
      gunValueId: runId,
    });
  });

  // Closes the "reconnect... behavior" half of docs/TODO.md's Firefox gap (Stage 1.2: "Verify
  // local storage, IndexedDB, permissions, WebSocket, and reconnect behavior" — HTTP/WebSocket/
  // localStorage/IndexedDB were already covered by the test above; reconnect was not). Runs on
  // every engine this file's project matrix already covers (chromium/webkit/firefox via
  // test:e2e:browsers), not just Firefox, since the behavior itself isn't Firefox-specific.
  test('recovers Gun/WebSocket connectivity after a simulated network drop', async () => {
    const p = page!;
    const c = context!;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // context().setOffline(true) drops any already-open WebSocket at the network layer —
    // give the browser a moment to actually notice before flipping back online, otherwise this
    // could pass trivially because the socket never had time to close.
    await c.setOffline(true);
    await p.waitForTimeout(500);
    await c.setOffline(false);

    // Gun's own reconnect logic re-establishes the socket without any app-level intervention —
    // poll for a fresh round-trip succeeding rather than assume the network is back the instant
    // setOffline(false) resolves.
    await expect
      .poll(
        () =>
          p.evaluate(async (id) => {
            try {
              const app = (window as any).__iinpublic_app?.getApp?.();
              if (!app?.gunService) return false;
              await app.gunService.put(`e2e/reconnect-check/${id}`, { id, writtenAt: Date.now() });
              const readBack = await app.gunService.get(`e2e/reconnect-check/${id}`);
              return readBack?.id === id;
            } catch {
              return false;
            }
          }, runId),
        { timeout: 30_000, message: 'Gun read/write should succeed again once back online' },
      )
      .toBe(true);
  });
});
