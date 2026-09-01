import { Page } from '@playwright/test';
import { dismissNotificationOverlays } from './durable-ui';

/**
 * Settings tab is a drill-down (menu list → one section's detail view → back), same
 * list-then-detail pattern as Chatrooms/Contacts. A section's controls only exist in a
 * visible state once its menu item has been tapped — call this after navigating to the
 * Settings tab and before touching any control that lives inside `sectionId`.
 *
 * @param sectionId one of the `settings-section-*` / `settings-storage-inspector` ids
 *                  rendered by `renderSettingsView` (ui-manager.ts).
 */
export async function openSettingsSection(page: Page, sectionId: string): Promise<void> {
  const section = page.locator(`#${sectionId}`);
  const menu = page.locator('#settings-menu-container');
  const back = page.locator('#back-to-settings-menu');

  // The Settings shell exists before the async user/bootstrap render completes. Under
  // parallel load (and especially just after reload), all three elements can briefly be
  // hidden. Wait for the rendered drill-down state instead of assuming hidden menu means
  // an already-rendered detail view.
  await page.waitForFunction((targetId) => {
    const isVisible = (element: Element | null): boolean => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    return (
      isVisible(document.getElementById(targetId)) ||
      isVisible(document.getElementById('settings-menu-container')) ||
      isVisible(document.getElementById('back-to-settings-menu'))
    );
  }, sectionId);

  if (await section.isVisible().catch(() => false)) return;

  if (!(await menu.isVisible().catch(() => false))) {
    await back.waitFor({ state: 'visible' });
    await dismissNotificationOverlays(page);
    await back.click();
    await menu.waitFor({ state: 'visible' });
  }

  await page.locator(`.settings-jump-menu-item[data-target="${sectionId}"]`).click();
  await section.waitFor({ state: 'visible' });
}

/** Returns from a section's detail view back to the Settings menu list. */
export async function backToSettingsMenu(page: Page): Promise<void> {
  const menu = page.locator('#settings-menu-container');
  if (await menu.isVisible().catch(() => false)) return;
  await dismissNotificationOverlays(page);
  await page.locator('#back-to-settings-menu').click();
  await menu.waitFor({ state: 'visible' });
}

export const SETTINGS_SECTION = {
  profile: 'settings-section-profile',
  appearance: 'settings-section-appearance',
  credit: 'settings-section-credit',
  languages: 'settings-section-languages',
  talkBehavior: 'settings-section-talk-behavior',
  distanceHome: 'settings-section-distance-home',
  contentFilters: 'settings-section-content-filters',
  connectivity: 'settings-section-connectivity',
  downloadApp: 'settings-section-download-app',
  linkedDevices: 'settings-section-linked-devices',
  eraseDevice: 'settings-section-erase-device',
  storageInspector: 'settings-storage-inspector',
  help: 'settings-section-help',
} as const;
