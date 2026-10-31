/**
 * Dialog sweep (test plan P3): open each dialog, then click every control inside it, with the hub
 * stalled. Same rules as the tab sweep (02): a visible reaction within 1 s, no main-thread freeze.
 * Submit buttons are left to the targeted specs (01, 03, 04), which check what a save does.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { afterSync } from '../helpers/timing';
import { webAppURLStableChatroom } from '../helpers/ports';
import { dismissNotificationOverlays } from '../helpers/durable-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';
import {
  formatSweepFailures,
  installMainThreadProbe,
  stallHub,
  sweepClickables,
  type HubFaultHandle,
  type SweepReport,
} from '../helpers/ui-responsiveness';

type Dialog = { name: string; scope: string; open: (page: Page) => Promise<void> };

const tab = async (page: Page, view: string): Promise<void> => {
  await page.locator(`.nav-btn[data-view="${view}"]`).click();
  await expect(page.locator(`#${view}-view`)).toBeVisible();
};

const DIALOGS: Dialog[] = [
  {
    name: 'Talk editor',
    scope: '#talk-editor-modal',
    open: async (page) => { await tab(page, 'talks'); await page.locator('#create-talk-btn').click(); },
  },
  {
    name: 'Talk template picker',
    scope: '#talk-template-picker-modal',
    open: async (page) => { await tab(page, 'talks'); await page.locator('#talks-starter-more').click(); },
  },
  {
    name: 'Answer preferences',
    scope: '#preferences-modal',
    open: async (page) => { await tab(page, 'me'); await page.locator('#view-preferences-btn').click(); },
  },
  {
    name: 'Edit profile',
    scope: '.modal-overlay:has(#edit-profile-form)',
    open: async (page) => {
      await tab(page, 'settings');
      await openSettingsSection(page, SETTINGS_SECTION.profile);
      await page.locator('#settings-edit-profile-btn').click();
    },
  },
  {
    name: 'Linked devices',
    scope: '#linked-devices-overlay',
    open: async (page) => {
      await tab(page, 'settings');
      await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
      await page.locator('#settings-linked-devices-btn').click();
    },
  },
  {
    name: 'Set identity password',
    scope: '#set-identity-password-overlay',
    open: async (page) => {
      await tab(page, 'settings');
      await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
      await page.locator('#settings-linked-devices-btn').click();
      await page.locator('#set-identity-password-btn').click();
    },
  },
  {
    name: 'New Room',
    scope: '.modal-overlay:has(#create-custom-chatroom-form)',
    open: async (page) => { await tab(page, 'chatrooms'); await page.locator('#create-custom-chatroom-btn').click(); },
  },
];

test.describe('GUI responsiveness: dialog sweep with the hub stalled', () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let fault: HubFaultHandle | undefined;
  const reports: SweepReport[] = [];

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
    page.on('popup', (popup) => void popup.close().catch(() => undefined));
    await injectIdbClear(page);
    await installMainThreadProbe(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterSync();
    fault = await stallHub(page);
  });

  test.afterAll(async () => {
    await fault?.clear().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await clearGunForStage1Spec();
    for (const report of reports) console.log(`[${report.surface}] clicked ${report.clicked}`);
  });

  for (const dialog of DIALOGS) {
    test(`every control in the ${dialog.name} dialog responds`, async () => {
      const p = page!;
      const restore = async (): Promise<void> => {
        await p.keyboard.press('Escape').catch(() => undefined);
        await p.evaluate(() => document.querySelectorAll('.modal-overlay, .notification, [id$="-modal"], [id$="-overlay"]:not(#conversation-detail-overlay):not(#peer-detail-overlay)')
          .forEach((element) => element.remove()));
        await dismissNotificationOverlays(p);
        await dialog.open(p);
        await expect(p.locator(dialog.scope).first()).toBeVisible({ timeout: 2_000 });
        await dismissNotificationOverlays(p);
      };
      const report = await sweepClickables(p, {
        surface: `dialog/${dialog.name}`,
        scope: dialog.scope,
        restore,
        deny: ['[type="submit"]'],
      });
      reports.push(report);
      expect(report.clicked, `no controls found in ${dialog.name}`).toBeGreaterThan(0);
      expect.soft(formatSweepFailures([report])).toBe('');
    });
  }
});
