/**
 * TODO §M4: Settings tab cleanup. Every section now renders through the shared
 * `renderSettingsSection()` helper (one `<details class="settings-section" open>` wrapper with a
 * `<summary>` title/subtitle, instead of 9 copy-pasted inline-style `<section>` blocks) and stays
 * independently collapsible. This test verifies the wrapper landed everywhere (no leftover ad hoc
 * `<section>` markup) and that a representative control from several sections still reads/writes
 * the same state as before the refactor.
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import type { Browser, BrowserContext, Page } from '@playwright/test';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Settings tab cleanup (M4) — shared section wrapper', () => {
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

  test('every section uses the shared wrapper and stays collapsible; sampled controls still read/write state', async () => {
    const tom = await bootstrapUser(browsers[0]!, 'SettingsWrapTom', 'SettingsWrapTom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    const page = tom.page;

    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');

    // No leftover ad hoc <section> markup — every top-level block is the shared wrapper.
    await expect(page.locator('#settings-content section')).toHaveCount(0);
    const sections = page.locator('#settings-content > div > details.settings-section');
    await expect(sections).toHaveCount(9);
    // Every section starts expanded (open by default — the refactor doesn't hide anything that
    // was previously visible).
    for (let i = 0; i < 9; i++) {
      await expect(sections.nth(i)).toHaveJSProperty('open', true);
    }

    // Collapsing a section via its summary hides its body without touching the others.
    const profileSection = sections.first();
    await profileSection.locator('summary').click();
    await expect(profileSection).toHaveJSProperty('open', false);
    await expect(page.locator('#settings-stage-name-input')).toBeHidden();
    await expect(sections.nth(1)).toHaveJSProperty('open', true);
    await profileSection.locator('summary').click();
    await expect(profileSection).toHaveJSProperty('open', true);
    await expect(page.locator('#settings-stage-name-input')).toBeVisible();

    // Sampled controls across sections still read/write the same state as before the refactor.
    // Profile: stage name.
    await page.fill('#settings-stage-name-input', 'WrapperRenamedTom');
    await page.locator('#settings-stage-name-input').blur();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    await expect(page.locator('#settings-stage-name-input')).toHaveValue('WrapperRenamedTom');

    // Credit: visibility toggle (the action control, rendered below the summary).
    const creditCheckbox = page.locator('#settings-credit-visible');
    await expect(creditCheckbox).toBeChecked();
    await creditCheckbox.uncheck();
    await expect(creditCheckbox).not.toBeChecked();

    // Content filters: grammar toggle + a new dirty-word chip.
    const grammarCheckbox = page.locator('#settings-grammar-filter');
    const grammarWasChecked = await grammarCheckbox.isChecked();
    await grammarCheckbox.setChecked(!grammarWasChecked);
    await expect(grammarCheckbox).toBeChecked({ checked: !grammarWasChecked });
    await page.fill('#dirty-word-add-input', 'wrappertestword');
    await page.click('#dirty-word-add-btn');
    await expect(page.locator('.dirty-word-chip[data-word="wrappertestword"]')).toBeVisible();

    // Distance/home: min-distance value round-trips through the same sync() path.
    await page.fill('#settings-min-distance', '5');
    await page.locator('#settings-min-distance').dispatchEvent('change');
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    await expect(page.locator('#settings-min-distance')).toHaveValue('5');

    // Linked devices / Erase device / Storage inspector: action buttons still fire their dialogs.
    await page.click('[data-testid="settings-linked-devices-btn"]');
    await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="linked-devices-close"]').click();
    await expect(page.locator('[data-testid="linked-devices-page"]')).toHaveCount(0);

    await page.click('[data-testid="settings-erase-device-btn"]');
    await expect(page.locator('[data-testid="erase-device-modal"]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape').catch(() => {});

    await expect(page.locator('#settings-storage-inspector-body')).not.toContainText('Loading', { timeout: 10_000 });
  });
});
