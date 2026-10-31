/**
 * The phone path with a hung hub (GUI responsiveness test plan P4, audit F1/F3/F4/F16). A phone's
 * page talks to its own node over loopback and the node talks to the hub — here the hub accepts
 * connections and never answers (Wi-Fi with no internet), which is what turns an untimed request
 * into a dead button. The phone must start, and every control on every tab must react at once.
 */
import * as net from 'net';
import { test, expect } from '@playwright/test';
import { SETTINGS_SECTION, backToSettingsMenu, openSettingsSection } from '../helpers/settings-nav';
import { dismissNotificationOverlays } from '../helpers/durable-ui';
import {
  closeAppOverlays,
  expectClickResponds,
  formatSweepFailures,
  installMainThreadProbe,
  sweepClickables,
  type SweepReport,
} from '../helpers/ui-responsiveness';
import { closeUsers, openUser, startPhoneNode, type JourneyUser, type SpecPhoneNode } from './phone-path-helpers';
import { PHONE_PATH_SPEC_PORTS } from './phone-path-ports';

test.describe('Phone with a hung hub', () => {
  let hungHub: net.Server | undefined;
  const sockets = new Set<net.Socket>();
  let node: SpecPhoneNode | undefined;
  let hana: JourneyUser | undefined;

  test.beforeAll(async () => {
    hungHub = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>((resolve) => hungHub!.listen(PHONE_PATH_SPEC_PORTS.hungHub, '127.0.0.1', resolve));
    node = await startPhoneNode(PHONE_PATH_SPEC_PORTS.hungHubPhone, PHONE_PATH_SPEC_PORTS.hungHub);
  });

  test.afterAll(async () => {
    await closeUsers(hana);
    await node?.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => hungHub?.close(resolve));
  });

  test('starts, and every control on every tab reacts at once', async ({ browser }) => {
    test.setTimeout(600_000);
    const context = await browser.newContext({
      viewport: { width: 480, height: 900 },
      geolocation: { latitude: 32.7157, longitude: -117.1611, accuracy: 10 },
      permissions: ['geolocation'],
    });
    await installMainThreadProbe(context);
    const started = Date.now();
    hana = await openUser(browser, 'Hana', 'phoneA', { baseUrl: node!.url, context });
    console.log(`[phone] ready with a hung hub in ${Date.now() - started} ms`);
    const page = hana.page;
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));

    const reports: SweepReport[] = [];
    for (const view of ['chatrooms', 'contacts', 'talks', 'me', 'settings']) {
      const restore = async (): Promise<void> => {
        await closeAppOverlays(page);
        await page.locator(`.nav-btn[data-view="${view}"]`).click();
        if (view === 'settings') {
          await page.locator('#settings-menu-container:visible, #back-to-settings-menu:visible').first().waitFor({ timeout: 5_000 });
          await backToSettingsMenu(page);
        }
        await dismissNotificationOverlays(page);
      };
      reports.push(await sweepClickables(page, { surface: `phone/${view}`, scope: `#${view}-view`, restore }));
      reports.push(await sweepClickables(page, { surface: `phone/${view}/app-bar`, scope: '#top-header', restore, deny: ['.nav-btn'] }));
    }
    for (const r of reports) console.log(`[${r.surface}] clicked ${r.clicked}`);
    expect(reports.reduce((n, r) => n + r.clicked, 0)).toBeGreaterThan(20);
    expect(formatSweepFailures(reports)).toBe('');

    // Saving your own data never waits for the hub (F3), and New Room opens its form (F4).
    await page.locator('.nav-btn[data-view="settings"]').click();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await dismissNotificationOverlays(page);
    await page.fill('#settings-stage-name-input', `Hana ${Date.now() % 100000}`);
    await page.locator('#settings-stage-name-input').blur();
    await expect(page.locator('.notification', { hasText: /Stage name updated/i })).toBeVisible({ timeout: 3_000 });
    await page.locator('.nav-btn[data-view="chatrooms"]').click();
    await dismissNotificationOverlays(page);
    await expectClickResponds(page, page.locator('#create-custom-chatroom-btn'), 'New Room');
    await expect(page.locator('[data-testid="custom-room-name-input"]')).toBeVisible({ timeout: 2_000 });
  });
});
