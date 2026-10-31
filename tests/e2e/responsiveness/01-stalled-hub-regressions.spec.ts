/**
 * GUI responsiveness under a stalled hub — one test per audit finding
 * (docs/testing/gui-responsiveness-audit.md, plan: docs/testing/gui-responsiveness-test-plan.md).
 *
 * "Stalled" = requests to the hub are held forever and its WebSocket stays silent (a phone on
 * Wi-Fi with no internet, a captive portal, a dead cell). That is the case that turns an
 * `await fetch()` without a timeout in a click path into a button that does nothing.
 *
 * Tests marked `test.fail()` reproduce a finding that is still open: they pass while the bug is
 * there and turn red once it is fixed — then delete the marker.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, waitForAppReady } from '../helpers/timing';
import { dismissNotificationOverlays } from '../helpers/durable-ui';
import { webAppURLStableChatroom } from '../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';
import {
  expectClickResponds,
  installMainThreadProbe,
  readMainThreadProbe,
  stallHub,
  stallHubPath,
  UI_FREEZE_GAP_MS,
  type HubFaultHandle,
} from '../helpers/ui-responsiveness';

test.describe('GUI responsiveness: stalled hub regressions', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let fault: HubFaultHandle | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    await injectIdbClear(page);
    await installMainThreadProbe(page);
  });

  test.afterEach(async () => {
    await fault?.clear().catch(() => undefined);
    fault = undefined;
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  const bootReady = async (): Promise<Page> => {
    const p = page!;
    await gotoWebApp(p, webAppURLStableChatroom());
    await afterSync();
    // First-launch toasts sit over the app bar (finding F9, its own test below). Clear them so
    // each test here measures the network finding it names, not the overlay.
    await dismissNotificationOverlays(p);
    return p;
  };

  // F1 — boot awaited GET /api/debug/storage (app.ts syncConversationTransportFromServer) with no
  // timeout, before setupEventHandlers(). One hung request kept the whole app un-booted.
  test('F1: boot finishes while the transport-flags request hangs', async () => {
    const p = page!;
    fault = await stallHubPath(p, /\/api\/debug\/storage/);
    await p.goto(webAppURLStableChatroom());
    await waitForAppReady(p, 25_000);
    expect(fault.intercepted()).toBeGreaterThan(0);
  });

  // F1 — with the whole hub stalled, boot also waited on presence register/nearby/acks (no
  // timeouts) during room entry. Now bounded: ~7.5 s measured.
  test('F1: boot finishes with the whole hub stalled', async () => {
    const p = page!;
    fault = await stallHub(p);
    await p.goto(webAppURLStableChatroom());
    await waitForAppReady(p, 15_000);
    await dismissNotificationOverlays(p);
    await p.locator('.nav-btn[data-view="talks"]').click();
    await expectClickResponds(p, p.locator('#create-talk-btn'), 'Create talk after an offline boot');
  });

  // Control for F1: the same boot with the hub fully reachable is well inside the budget.
  test('F1 control: boot with a healthy hub is ready within 25 s', async () => {
    const p = page!;
    await p.goto(webAppURLStableChatroom());
    await waitForAppReady(p, 25_000);
  });

  // F3 — Settings → stage name: onStageNameChange awaited syncPublicUserForRelay (3 × 4 s
  // attempts + back-off ≈ 13.5 s) before any confirmation. Now local-first.
  test('F3: renaming yourself confirms within 3 s while the hub is stalled', async () => {
    const p = await bootReady();
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.profile);
    fault = await stallHub(p);
    await p.fill('#settings-stage-name-input', `Stalled ${Date.now() % 100000}`);
    await p.locator('#settings-stage-name-input').blur();
    await expect(p.locator('.notification', { hasText: /Stage name updated/i })).toBeVisible({ timeout: 3_000 });
  });

  // F4 — New Room awaited GET /room-creation-credit (chatroom-shell-controller.ts) with no
  // timeout before opening the form. Now the form opens at once and the check runs alongside.
  test('F4: New Room opens its form (or explains why not) while the hub is stalled', async () => {
    const p = await bootReady();
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    fault = await stallHub(p);
    await dismissNotificationOverlays(p);
    await p.locator('#create-custom-chatroom-btn').click();
    await expect(p.locator('[data-testid="custom-room-name-input"]')).toBeVisible({ timeout: 2_000 });
  });

  // Control for F4 with a fast failure (airplane mode): the existing catch handles it.
  test('F4 control: New Room opens its form when hub requests fail fast', async () => {
    const p = await bootReady();
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await p.context().route(/\/room-creation-credit/, (route) => route.abort('internetdisconnected'));
    await p.locator('#create-custom-chatroom-btn').click();
    await expect(p.locator('[data-testid="custom-room-name-input"]')).toBeVisible({ timeout: 2_000 });
    await p.locator('#cancel-custom-room-btn').click();
  });

  // Every bottom-nav tab must switch at once with the hub stalled, and the main thread must
  // never freeze while it does (regression for the 1.0.201–1.0.203 Settings/map reports).
  test('bottom navigation stays live with the hub stalled', async () => {
    const p = await bootReady();
    fault = await stallHub(p);
    await dismissNotificationOverlays(p);
    for (const view of ['talks', 'contacts', 'me', 'settings', 'chatrooms', 'settings', 'talks']) {
      const button = p.locator(`.nav-btn[data-view="${view}"]`);
      await expectClickResponds(p, button, `nav → ${view}`);
      await expect(button).toHaveClass(/active/, { timeout: 1_000 });
      await expect(p.locator(`#${view}-view`)).toBeVisible({ timeout: 1_000 });
    }
    const sample = await readMainThreadProbe(p);
    expect(sample.maxGapMs).toBeLessThan(UI_FREEZE_GAP_MS);
  });

  // Talk editor is local-first: create + save must not wait for the network.
  test('Create talk → editor opens and Cancel closes it with the hub stalled', async () => {
    const p = await bootReady();
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    fault = await stallHub(p);
    await dismissNotificationOverlays(p);
    await expectClickResponds(p, p.locator('#create-talk-btn'), 'Create talk');
    await expect(p.locator('.modal-overlay').last()).toBeVisible({ timeout: 1_000 });
    await p.keyboard.press('Escape');
  });

  // F9 — toasts were fixed at top: 58 px. With the web download banner (and on any layout where
  // the app bar is lower than 58 px) the first-launch toasts covered the app-bar actions for 3–10 s,
  // and a tap there only dismissed the toast. Now placed below the measured app bar.
  test('F9: app-bar actions are tappable right after first launch (toasts do not cover them)', async () => {
    const p = page!;
    await gotoWebApp(p, webAppURLStableChatroom());
    await p.locator('.nav-btn[data-view="talks"]').click();
    await expect(p.locator('.notification').first()).toBeVisible({ timeout: 5_000 });
    await expectClickResponds(p, p.locator('#create-talk-btn'), 'Create talk under first-launch toasts');
    await expect(p.locator('.modal-overlay').last()).toBeVisible({ timeout: 1_000 });
  });
});
