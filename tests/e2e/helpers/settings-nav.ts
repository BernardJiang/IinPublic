import { Page } from '@playwright/test';

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
  await page.locator(`.settings-jump-menu-item[data-target="${sectionId}"]`).click();
}

/** Returns from a section's detail view back to the Settings menu list. */
export async function backToSettingsMenu(page: Page): Promise<void> {
  await page.locator('#back-to-settings-menu').click();
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
