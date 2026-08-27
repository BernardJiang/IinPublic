/**
 * Settings tab drill-down. Every section renders through the shared `renderSettingsSection()`
 * helper (one `<div class="settings-section">` wrapper with a static title/subtitle header,
 * instead of copy-pasted inline-style `<section>` blocks), and the tab itself is a menu-first
 * drill-down — tapping a menu item hides the menu and every other section, leaving just that
 * one section + a back button (#back-to-settings-menu) — same list-then-detail pattern as
 * Chatrooms/Contacts. This test verifies the wrapper landed everywhere (no leftover ad hoc
 * `<section>` markup), that the menu/detail navigation works, and that a representative control
 * from several sections still reads/writes the same state as before the drill-down.
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import { openSettingsSection, backToSettingsMenu, SETTINGS_SECTION } from '../../helpers/settings-nav';
import type { Browser, BrowserContext, Page } from '@playwright/test';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Settings tab cleanup (M4) — shared section wrapper + drill-down', () => {
  test.setTimeout(90_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browsers = await launchBrowserGrid(1);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunForStage1Spec();
  });

  test('every section uses the shared wrapper; menu/detail drill-down works; sampled controls still read/write state', async () => {
    const tom = await bootstrapUser(browsers[0]!, 'SettingsWrapTom', 'SettingsWrapTom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    const page = tom.page;

    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');

    // No leftover ad hoc <section> markup — every top-level block is the shared wrapper.
    await expect(page.locator('#settings-content section')).toHaveCount(0);
    // Every declared settings section is rendered up front (stable DOM identity across a
    // menu/detail switch) — just not all visible at once. The menu list is the default view.
    const sections = page.locator('#settings-detail-container > div > .settings-section');
    await expect(sections).toHaveCount(Object.values(SETTINGS_SECTION).length);
    await expect(page.locator('#settings-menu-container')).toBeVisible();
    await expect(page.locator('#settings-detail-container')).toBeHidden();
    await expect(page.locator('#back-to-settings-menu')).toBeHidden();

    // Opening a section hides the menu and every other section, and shows the back button.
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await expect(page.locator('#settings-menu-container')).toBeHidden();
    await expect(page.locator('#back-to-settings-menu')).toBeVisible();
    await expect(page.locator(`#${SETTINGS_SECTION.profile}`)).toBeVisible();
    for (const id of Object.values(SETTINGS_SECTION)) {
      if (id === SETTINGS_SECTION.profile) continue;
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
    await expect(page.locator('#settings-stage-name-input')).toBeVisible();

    // Back returns to the menu list; the section itself is untouched (still rendered, just hidden).
    await backToSettingsMenu(page);
    await expect(page.locator('#settings-menu-container')).toBeVisible();
    await expect(page.locator('#settings-detail-container')).toBeHidden();
    await expect(page.locator('#back-to-settings-menu')).toBeHidden();
    await expect(page.locator(`#${SETTINGS_SECTION.profile}`)).toHaveCount(1);

    // Sampled controls across sections still read/write the same state as before the refactor.
    // Profile: stage name.
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.fill('#settings-stage-name-input', 'WrapperRenamedTom');
    await page.locator('#settings-stage-name-input').blur();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    // Re-entering the Settings tab always resets to the menu (same convention as
    // Chatrooms/Contacts resetting to their list on tab entry).
    await expect(page.locator('#settings-menu-container')).toBeVisible();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await expect(page.locator('#settings-stage-name-input')).toHaveValue('WrapperRenamedTom');
    await backToSettingsMenu(page);

    // Credit: visibility toggle (the action control, rendered below the section header).
    await openSettingsSection(page, SETTINGS_SECTION.credit);
    const creditCheckbox = page.locator('#settings-credit-visible');
    await expect(creditCheckbox).toBeChecked();
    await creditCheckbox.uncheck();
    await expect(creditCheckbox).not.toBeChecked();
    await backToSettingsMenu(page);

    // Content filters: grammar toggle + a new dirty-word chip.
    await openSettingsSection(page, SETTINGS_SECTION.contentFilters);
    const grammarCheckbox = page.locator('#settings-grammar-filter');
    const grammarWasChecked = await grammarCheckbox.isChecked();
    await grammarCheckbox.setChecked(!grammarWasChecked);
    await expect(grammarCheckbox).toBeChecked({ checked: !grammarWasChecked });
    await page.fill('#dirty-word-add-input', 'wrappertestword');
    await page.click('#dirty-word-add-btn');
    await expect(page.locator('.dirty-word-chip[data-word="wrappertestword"]')).toBeVisible();
    await backToSettingsMenu(page);

    // Distance/home: min-distance value round-trips through the same sync() path, and survives
    // a tab-away-and-back (which resets the drill-down to the menu but not the field's state).
    await openSettingsSection(page, SETTINGS_SECTION.distanceHome);
    await page.fill('#settings-min-distance', '5');
    await page.locator('#settings-min-distance').dispatchEvent('change');
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    await openSettingsSection(page, SETTINGS_SECTION.distanceHome);
    await expect(page.locator('#settings-min-distance')).toHaveValue('5');
    await backToSettingsMenu(page);

    // Linked devices / Erase device / Storage inspector: action buttons still fire their dialogs.
    await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
    await page.click('[data-testid="settings-linked-devices-btn"]');
    await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="linked-devices-close"]').click();
    await expect(page.locator('[data-testid="linked-devices-page"]')).toHaveCount(0);
    await backToSettingsMenu(page);

    await openSettingsSection(page, SETTINGS_SECTION.eraseDevice);
    await page.click('[data-testid="settings-erase-device-btn"]');
    await expect(page.locator('[data-testid="erase-device-modal"]')).toBeVisible({ timeout: 10_000 });
    await page.click('#erase-cancel-btn');
    await expect(page.locator('[data-testid="erase-device-modal"]')).toHaveCount(0);
    await backToSettingsMenu(page);

    await openSettingsSection(page, SETTINGS_SECTION.storageInspector);
    await expect(page.locator('#settings-storage-inspector-body')).not.toContainText('Loading', { timeout: 10_000 });
  });
});
